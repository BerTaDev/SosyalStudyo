import { TAU, clamp, lerp, prog, ease, rgba, hash, makeCanvas } from "./util.js";
import { tile } from "./assets.js";

export function font(ctx, size, weight = 600, family = "Bahnschrift", stretch = "normal", spacing = "0px") {
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fontStretch = stretch;
  ctx.letterSpacing = spacing;
}

export const bump = (k) => Math.sin(Math.PI * clamp(k));

export function tag(ctx, x, y, text, sub, col, alpha, align = "center", opts = {}) {
  if (alpha <= 0) return;
  const size = opts.size ?? 34;
  ctx.save();
  ctx.globalAlpha *= alpha;
  font(ctx, size, 700, "Bahnschrift", "normal", "4px");
  const w = ctx.measureText(text).width;
  let sw = 0;
  if (sub) {
    font(ctx, size * 0.76, 400, "Bahnschrift", "normal", "1px");
    sw = ctx.measureText(sub).width;
  }
  const bw = Math.max(w, sw) + size * 1.65;
  const bh = sub ? size * 2.7 : size * 1.7;
  const bx = align === "center" ? x - bw / 2 : align === "left" ? x : x - bw;
  ctx.fillStyle = opts.bg ?? "rgba(14,20,24,0.74)";
  ctx.beginPath();
  ctx.roundRect(bx, y - bh / 2, bw, bh, size * 0.3);
  ctx.fill();
  ctx.fillStyle = col;
  ctx.fillRect(bx, y - bh / 2, size * 0.18, bh);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  font(ctx, size, 700, "Bahnschrift", "normal", "4px");
  ctx.fillStyle = opts.fg ?? "#FFFFFF";
  ctx.fillText(text, bx + size * 0.82, sub ? y - size * 0.47 : y + 1);
  if (sub) {
    font(ctx, size * 0.76, 400, "Bahnschrift", "normal", "1px");
    ctx.fillStyle = opts.subFg ?? "rgba(255,255,255,0.72)";
    ctx.fillText(sub, bx + size * 0.82, y + size * 0.65);
  }
  ctx.restore();
}

export function label(ctx, text, x, y, size, col, opts = {}) {
  ctx.save();
  ctx.globalAlpha *= opts.alpha ?? 1;
  font(ctx, size, opts.weight ?? 700, opts.family ?? "Bahnschrift", opts.stretch ?? "normal", opts.spacing ?? "0px");
  ctx.textAlign = opts.align ?? "center";
  ctx.textBaseline = opts.baseline ?? "middle";
  if (opts.stroke) {
    ctx.lineJoin = "round";
    ctx.strokeStyle = opts.stroke;
    ctx.lineWidth = opts.strokeWidth ?? 8;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = col;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function drawSubtitles(S) {
  const { ctx, t, tl, cfg, W } = S;
  const cx = W / 2;
  const st = cfg.subtitle;
  const cue = tl.subtitles.find((c) => t >= c.start - 0.05 && t < c.end);
  if (!cue || st.enabled === false) return;
  const fadeOut = 1 - prog(t, cue.end - 0.12, cue.end);
  let size = st.size;
  font(ctx, size, st.weight, st.font);
  const widest = Math.max(...cue.rows.map((r) => ctx.measureText(r).width));
  if (widest > W * 0.76) size = Math.floor((size * W * 0.76) / widest);
  font(ctx, size, st.weight, st.font);
  const space = ctx.measureText(" ").width;
  const lh = size * st.lineHeight;
  const rows = [];
  let wi = 0;
  for (const r of cue.rows) {
    const words = r.split(" ").map(() => cue.words[wi++]);
    const widths = words.map((w) => ctx.measureText(w.text).width);
    rows.push({ words, widths, total: widths.reduce((a, b) => a + b, 0) + space * (words.length - 1) });
  }
  let current = null;
  for (const w of cue.words) if (t >= w.start - 0.06) current = w;
  if (current && t > current.end + 0.3) current = null;
  const y0 = st.y - ((rows.length - 1) * lh) / 2;
  if (st.box) {
    const pad = st.box.pad ?? 22;
    const bw = Math.max(...rows.map((r) => r.total)) + pad * 2.2;
    const bh = rows.length * lh + pad;
    const appear = ease.outCubic(prog(t, cue.start - 0.08, cue.start + 0.12));
    ctx.save();
    ctx.globalAlpha = appear * fadeOut;
    ctx.fillStyle = st.box.color ?? "rgba(10,14,18,0.55)";
    ctx.beginPath();
    ctx.roundRect(cx - bw / 2, st.y - bh / 2, bw, bh, st.box.radius ?? 20);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  rows.forEach((row, ri) => {
    let x = cx - row.total / 2;
    const y = y0 + ri * lh;
    row.words.forEach((w, i) => {
      const k = ease.outCubic(prog(t, w.start - 0.06, w.start + 0.1));
      if (k > 0) {
        const sc = lerp(0.82, 1, ease.outBack(prog(t, w.start - 0.06, w.start + 0.14)));
        ctx.save();
        ctx.globalAlpha = k * fadeOut;
        ctx.translate(x + row.widths[i] / 2, y);
        ctx.scale(sc, sc);
        ctx.strokeStyle = st.stroke;
        ctx.lineWidth = st.strokeWidth;
        ctx.strokeText(w.text, -row.widths[i] / 2, 0);
        ctx.fillStyle = w === current ? st.active : st.fill;
        ctx.fillText(w.text, -row.widths[i] / 2, 0);
        ctx.restore();
      }
      x += row.widths[i] + space;
    });
  });
  ctx.restore();
}

export function vignette(S, alpha, rgb = "20,16,12") {
  const { ctx, W, H } = S;
  if (alpha <= 0) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.68);
  g.addColorStop(0, `rgba(${rgb},0)`);
  g.addColorStop(1, `rgba(${rgb},${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
