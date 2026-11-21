// WebGL2 "GS-Enhance" post-processing pipeline.
// The differentiating idea: instead of one fixed enhancement preset, the GS
// output frame passes through a user-composable chain of shader passes,
// each toggled/re-ordered live — treated as a node graph, not a monolith.

export interface PassSpec {
  id: string;
  name: string;
  enabled: boolean;
  uniforms?: Record<string, number>;
}

export const PASS_DEFS: Omit<PassSpec, "enabled">[] = [
  { id: "upscale", name: "Bicubic ×3 Upscale", uniforms: { uSharp: 0.85 } },
  { id: "scanline", name: "CRT Scanlines", uniforms: { uIntensity: 0.22 } },
  { id: "chroma", name: "Chromatic Fringe", uniforms: { uShift: 0.0025 } },
  { id: "bloom", name: "Soft Glow (Bloom)", uniforms: { uThresh: 0.72, uMix: 0.5 } },
  { id: "grade", name: "Warm Filmic Grade", uniforms: { uWarm: 0.14 } },
];

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; vUv.y = 1.0 - vUv.y; gl_Position = vec4(aPos, 0., 1.); }`;

const FRAG: Record<string, string> = {
  upscale: `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform float uSharp;
void main(){
  vec2 px = 1.0 / vec2(textureSize(uTex, 0));
  vec3 c = texture(uTex, vUv).rgb * (1.0 + 4.0 * uSharp);
  c -= texture(uTex, vUv + vec2(px.x, 0.)).rgb * uSharp;
  c -= texture(uTex, vUv - vec2(px.x, 0.)).rgb * uSharp;
  c -= texture(uTex, vUv + vec2(0., px.y)).rgb * uSharp;
  c -= texture(uTex, vUv - vec2(0., px.y)).rgb * uSharp;
  o = vec4(clamp(c, 0., 1.), 1.0);
}`,
  scanline: `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform float uIntensity;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float s = 1.0 - uIntensity * (0.5 + 0.5 * sin(vUv.y * 1200.0));
  o = vec4(c * s, 1.0);
}`,
  chroma: `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform float uShift;
void main(){
  float r = texture(uTex, vUv + vec2(uShift, 0.)).r;
  float g = texture(uTex, vUv).g;
  float b = texture(uTex, vUv - vec2(uShift, 0.)).b;
  o = vec4(r, g, b, 1.0);
}`,
  bloom: `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform float uThresh; uniform float uMix;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  vec3 acc = vec3(0.); vec2 px = 1.0 / vec2(textureSize(uTex, 0));
  for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++)
    acc += texture(uTex, vUv + vec2(float(x), float(y)) * px * 2.0).rgb;
  acc /= 49.0;
  vec3 glow = max(acc - uThresh, 0.0) * 1.6;
  o = vec4(clamp(c + glow * uMix, 0., 1.), 1.0);
}`,
  grade: `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform float uWarm;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  c = pow(c, vec3(0.98));
  c.r = clamp(c.r + uWarm * (1.0 - c.r) * c.r, 0., 1.);
  c.b = clamp(c.b * (1.0 - uWarm * 0.6), 0., 1.);
  o = vec4(c, 1.0);
}`,
};

export class Pipeline {
  private gl: WebGL2RenderingContext;
  private progs = new Map<string, { prog: WebGLProgram; tex: WebGLTexture; fb: WebGLFramebuffer | null }>();
  passes: PassSpec[];
  private vao: WebGLVertexArrayObject;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.passes = PASS_DEFS.map((p) => ({ ...p, enabled: true }));

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)!);
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    for (const def of PASS_DEFS) {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG[def.id]));
      gl.linkProgram(prog);
      const tex = gl.createTexture()!;
      const fb = gl.createFramebuffer()!;
      this.progs.set(def.id, { prog, tex, fb });
    }
  }

  resize(w: number, h: number) {
    this.canvas.width = w; this.canvas.height = h;
  }

  /** Render `source` (a low-res GS frame) through the enabled pass chain. */
  render(source: TexImageSource) {
    const gl = this.gl;
    let inputTex: WebGLTexture | null = null;

    // upload source into a texture
    const srcTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    inputTex = srcTex;

    const active = this.passes.filter((p) => p.enabled);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (active.length === 0) {
      // passthrough: blit source straight to screen
      this.blitToScreen(inputTex);
      gl.deleteTexture(srcTex);
      return;
    }

    active.forEach((pass, i) => {
      const node = this.progs.get(pass.id)!;
      const last = i === active.length - 1;
      gl.useProgram(node.prog);
      const loc = gl.getAttribLocation(node.prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTex);
      gl.uniform1i(gl.getUniformLocation(node.prog, "uTex"), 0);

      if (last) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      } else {
        const w = Math.max(1, Math.round(this.canvas.width / 2));
        const h = Math.max(1, Math.round(this.canvas.height / 2));
        gl.bindTexture(gl.TEXTURE_2D, node.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, node.fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, node.tex, 0);
        gl.viewport(0, 0, w, h);
      }

      // re-bind the INPUT texture: allocating the render target above re-bound
      // the active texture unit, which would create a feedback loop
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTex);
      gl.uniform1i(gl.getUniformLocation(node.prog, "uTex"), 0);

      for (const [k, v] of Object.entries(pass.uniforms ?? {}))
        gl.uniform1f(gl.getUniformLocation(node.prog, k), v);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!last) inputTex = node.tex;
    });

    gl.deleteTexture(srcTex);
  }

  private blitToScreen(tex: WebGLTexture) {
    const gl = this.gl;
    // use the scanline shader with uIntensity=0 as a straight textured blit
    const node = this.progs.get("scanline")!;
    gl.useProgram(node.prog);
    const loc = gl.getAttribLocation(node.prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(node.prog, "uTex"), 0);
    gl.uniform1f(gl.getUniformLocation(node.prog, "uIntensity"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  setUniform(id: string, key: string, v: number) {
    const p = this.passes.find((x) => x.id === id);
    if (p) p.uniforms = { ...p.uniforms, [key]: v };
  }

  movePass(id: string, dir: -1 | 1) {
    const i = this.passes.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.passes.length) return;
    [this.passes[i], this.passes[j]] = [this.passes[j], this.passes[i]];
  }

  /**
   * Release GPU resources and the WebGL context. Important on iOS, where the
   * number of simultaneous WebGL contexts is limited — pipelines are re-created
   * whenever the canvas remounts on a tab switch.
   */
  dispose() {
    const gl = this.gl;
    for (const { prog, tex, fb } of this.progs.values()) {
      gl.deleteProgram(prog);
      gl.deleteTexture(tex);
      if (fb) gl.deleteFramebuffer(fb);
    }
    this.progs.clear();
    if (this.vao) gl.deleteVertexArray(this.vao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}