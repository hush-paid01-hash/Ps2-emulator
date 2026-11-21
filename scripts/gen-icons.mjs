// Generates EmberStation PNG app icons + iOS launch splash using only Node's
// built-in zlib. Safe to run before or after `npx cap add ios`.
// Usage: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---- colors -------------------------------------------------------------
const BG = [0x0b, 0x0e, 0x17];
const ORANGE = [0xff, 0x8c, 0x42];
const TEAL = [0x2e, 0xc4, 0xb6];

// ---- minimal PNG encoder ------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- artwork (resolution independent) -----------------------------------
const inRect = (nx, ny, x0, y0, x1, y1) =>
  nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1;

function sampleIcon(nx, ny) {
  const glow = Math.max(0, 1 - Math.hypot(nx - 0.3, ny - 0.2) * 1.6) * 0.10;
  let r = BG[0] + glow * 40;
  let g = BG[1] + glow * 40;
  let b = BG[2] + glow * 60;

  const stem = inRect(nx, ny, 0.24, 0.22, 0.37, 0.78);
  const top = inRect(nx, ny, 0.24, 0.22, 0.74, 0.35);
  const mid = inRect(nx, ny, 0.24, 0.435, 0.64, 0.565);
  const bot = inRect(nx, ny, 0.24, 0.65, 0.74, 0.78);
  if (stem || top || mid || bot) {
    r = ORANGE[0]; g = ORANGE[1]; b = ORANGE[2];
  }

  const dx = nx - 0.80;
  const dy = ny - 0.50;
  if (dx * dx + dy * dy <= 0.075 * 0.075) {
    r = TEAL[0]; g = TEAL[1]; b = TEAL[2];
  }
  return [r, g, b];
}

/** Render `size`x`size` RGBA pixels with 3x supersampling. */
function renderPixels(size) {
  const ss = 3;
  const W = size * ss;
  const hi = new Uint8Array(W * W * 3);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = sampleIcon((x + 0.5) / W, (y + 0.5) / W);
      const i = (y * W + x) * 3;
      hi[i] = r; hi[i + 1] = g; hi[i + 2] = b;
    }
  }
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * W + (x * ss + sx)) * 3;
          r += hi[i]; g += hi[i + 1]; b += hi[i + 2];
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 0xff;
    }
  }
  return out;
}

const renderIconPNG = (size) => encodePNG(size, size, renderPixels(size));

/** Dark launch splash with a centered app icon. */
function renderSplashPNG(size, iconFrac = 0.26) {
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = BG[0]; out[i + 1] = BG[1]; out[i + 2] = BG[2]; out[i + 3] = 0xff;
  }
  const iconSize = Math.round(size * iconFrac);
  const icon = renderPixels(iconSize);
  const off = Math.floor((size - iconSize) / 2);
  for (let y = 0; y < iconSize; y++) {
    for (let x = 0; x < iconSize; x++) {
      const si = (y * iconSize + x) * 4;
      const di = ((y + off) * size + (x + off)) * 4;
      out[di] = icon[si];
      out[di + 1] = icon[si + 1];
      out[di + 2] = icon[si + 2];
    }
  }
  return encodePNG(size, size, out);
}

// ---- emit ---------------------------------------------------------------
function write(rel, buf) {
  const full = join(ROOT, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, buf);
  console.log(`wrote ${rel} (${buf.length} bytes)`);
}

write("public/icons/apple-touch-icon.png", renderIconPNG(180));
write("public/icons/icon-192.png", renderIconPNG(192));
write("public/icons/icon-512.png", renderIconPNG(512));
write("public/icons/icon-1024.png", renderIconPNG(1024));
write("public/favicon.png", renderIconPNG(64));

// iOS asset catalog (only if `cap add ios` has already run)
const appIcon = "ios/App/App/Assets.xcassets/AppIcon.appiconset";
if (existsSync(join(ROOT, appIcon))) {
  write(`${appIcon}/AppIcon-512@2x.png`, renderIconPNG(1024));
}

const splashDir = "ios/App/App/Assets.xcassets/Splash.imageset";
if (existsSync(join(ROOT, splashDir))) {
  const splash = renderSplashPNG(2732);
  write(`${splashDir}/splash-2732x2732-2.png`, splash);
  write(`${splashDir}/splash-2732x2732-1.png`, splash);
  write(`${splashDir}/splash-2732x2732.png`, splash);
}

console.log("done");