import { makeCanvas, rng, TAU } from "./util.js";

export function makeAssets(seed) {
  const R = rng(seed + 77);
  const noise = (alphaMax, mono) => {
    const c = makeCanvas(256, 256);
    const g = c.getContext("2d");
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = mono ? (R() < 0.5 ? 0 : 255) : Math.floor(R() * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.floor(R() * alphaMax);
    }
    g.putImageData(img, 0, 0);
    return c;
  };
  const grain = noise(26, true);
  const paper = noise(14, false);
  const blurred = (draw, size = 256, blur = 14) => {
    const raw = makeCanvas(size, size);
    draw(raw.getContext("2d"), size);
    const out = makeCanvas(size, size);
    const g = out.getContext("2d");
    g.filter = `blur(${blur}px)`;
    g.drawImage(raw, 0, 0);
    return out;
  };
  const mote = blurred((g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.3);
    gr.addColorStop(0, "rgba(255,255,255,0.9)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }, 64, 3);
  const cloud = blurred((g, s) => {
    g.fillStyle = "rgba(235,244,247,0.85)";
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.ellipse(s * (0.25 + R() * 0.5), s * (0.35 + R() * 0.3), s * (0.12 + R() * 0.12), s * (0.07 + R() * 0.08), R(), 0, TAU);
      g.fill();
    }
  }, 384, 26);
  const dust = blurred((g, s) => {
    for (let i = 0; i < 26; i++) {
      const v = 60 + Math.floor(R() * 50);
      g.fillStyle = `rgba(${v},${v - 6},${v - 12},${0.25 + R() * 0.35})`;
      g.beginPath();
      g.ellipse(s * (0.2 + R() * 0.6), s * (0.2 + R() * 0.6), s * (0.08 + R() * 0.18), s * (0.06 + R() * 0.14), R() * TAU, 0, TAU);
      g.fill();
    }
  }, 384, 22);
  return { grain, paper, mote, cloud, dust };
}

export function tile(ctx, img, W, H, ox = 0, oy = 0) {
  const w = img.width;
  const h = img.height;
  for (let x = -(ox % w); x < W; x += w) for (let y = -(oy % h); y < H; y += h) ctx.drawImage(img, x, y);
}
