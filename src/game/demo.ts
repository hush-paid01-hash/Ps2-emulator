// Procedural GS-frame producer: renders a low-res (320x224) "PS2 tech demo"
// scene to an offscreen canvas. Frame timing and DMA packets are fed by the
// MIPS core's syscall output, so the interpreter genuinely drives the visuals.

export const GS_W = 320;
export const GS_H = 224;

export interface FrameInput {
  /** values streamed by the EE core via the syscall trap */
  packets: number[];
  /** interpolated continuous signal derived from packet history */
  phase: number;
}

const PALETTE = ["#ff8c42", "#e8483f", "#7a5cff", "#2ec4b6", "#ffd166"];

export function renderFrame(ctx: CanvasRenderingContext2D, t: FrameInput) {
  const w = GS_W, h = GS_H;
  ctx.fillStyle = "#0b0e17";
  ctx.fillRect(0, 0, w, h);

  // grid floor perspective
  ctx.strokeStyle = "rgba(122,92,255,0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const y = h * 0.55 + i * i * 1.9;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  for (let i = -8; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(w / 2 + i * 12, h * 0.55);
    ctx.lineTo(w / 2 + i * 60, h);
    ctx.stroke();
  }

  const latest = t.packets.slice(-8);
  const n = Math.max(latest.length, 1);

  // rotating ring of "polygons", one per DMA packet the EE has sent
  for (let i = 0; i < n; i++) {
    const v = latest[i] ?? 0;
    const ang = t.phase * 0.9 + (i / n) * Math.PI * 2;
    const cx = w / 2 + Math.cos(ang) * 78;
    const cy = h * 0.42 + Math.sin(ang) * 40;
    const size = 10 + (v % 55);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang + t.phase * 0.5);
    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const r = size * (k % 2 === 0 ? 1 : 0.55);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // HUD
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#e8eaf2";
  ctx.font = "9px monospace";
  ctx.fillText("EMBERSTATION BIOS v1.02", 8, 14);
  ctx.fillText(`GS FIFO: ${t.packets.length} packets`, 8, 26);
  ctx.fillText(`DMA: ${(t.phase * 60).toFixed(0).padStart(4, " ")} KB/s`, 8, 38);
  ctx.fillStyle = "#2ec4b6";
  ctx.fillText("R5900 running — interpreter core", w - 172, 14);

  // bottom waveform of packet values
  ctx.strokeStyle = "#ff8c42";
  ctx.beginPath();
  const hist = t.packets.slice(-64);
  const denom = Math.max(1, hist.length - 1);
  hist.forEach((v, i) => {
    const x = (i / denom) * w;
    const y = h - 14 - (v % 97) * 0.5;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}