import { TAU, clamp, lerp, prog, ease, mix, rgba } from "../../_engine/core/util.js";
import { font, label, vignette } from "../../_engine/core/overlay.js";
import { tile } from "../../_engine/core/assets.js";
import { glow } from "../../_engine/core/kit.js";

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(next).width > maxWidth) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function fit(ctx, text, maxW, maxLines, size, minSize, weight, family) {
  for (let s = size; s > minSize; s -= 3) {
    font(ctx, s, weight, family);
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { size: s, lines };
  }
  font(ctx, minSize, weight, family);
  return { size: minSize, lines: wrap(ctx, text, maxW) };
}

function drawLogo(ctx, img, cx, cy, box) {
  const r = Math.min(box / img.naturalWidth, box / img.naturalHeight);
  const w = img.naturalWidth * r;
  const h = img.naturalHeight * r;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

export default async function makeScene({ cfg, tl, W, H, A, images }) {
  const C = cfg.colors;
  const T = cfg.text || {};
  const scenes = tl.scenes;
  const count = Math.max(0, scenes.length - 1);
  const numFamily = cfg.fonts?.[0] || "Bahnschrift";
  const family = cfg.fonts?.[1] || "Segoe UI";
  const k = Math.min(1, W / 1080, H / 1300);
  const side = W / H > 0.7;
  const x0 = W * (side ? 0.1 : 0.09);
  const numSize = (side ? Math.min(H * 0.48, W * 0.4) : 560 * k) * (count >= 10 ? 0.72 : 1);
  const numCy = side ? H * 0.44 : H * 0.33;
  const barY = H * 0.12 + 58 * k;
  const logoImg = images?.ref1 && images.ref1.naturalWidth ? images.ref1 : null;
  const pad2 = (n) => String(n).padStart(2, "0");
  const card = (i) => String(T.cards?.[i] ?? "").trim();
  let metrics = null;

  function measure(ctx) {
    font(ctx, numSize, 700, numFamily);
    const m = ctx.measureText("0123456789");
    metrics = { digitH: m.actualBoundingBoxAscent, boxW: ctx.measureText(String(Math.max(1, count)).replace(/./g, "0")).width };
  }

  function sceneAt(t) {
    let i = scenes.findIndex((s) => t >= s.start && t < s.end);
    if (i < 0 && scenes.length && t >= scenes[scenes.length - 1].end) i = scenes.length - 1;
    return i;
  }

  function background(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, C.bg2);
    g.addColorStop(1, C.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const R = Math.max(W, H);
    glow(ctx, W * 0.88 + Math.cos(t * 0.31) * W * 0.06, H * 0.22 + Math.sin(t * 0.23) * H * 0.04, R * 0.5, C.accent2, 0.2);
    glow(ctx, W * 0.05 + Math.sin(t * 0.2) * W * 0.05, H * 0.72, R * 0.42, C.accent, 0.07);
    ctx.save();
    ctx.strokeStyle = rgba(C.text, 0.03);
    ctx.lineWidth = 2 * k;
    const sp = 64 * k;
    const off = (t * 22 * k) % sp;
    ctx.beginPath();
    for (let x = -H + off - sp; x < W + sp; x += sp) {
      ctx.moveTo(x, H);
      ctx.lineTo(x + H, 0);
    }
    ctx.stroke();
    ctx.restore();
  }

  function ghost(ctx, t, i) {
    if (i < 0) return;
    const s = scenes[i];
    const n = i < count && card(i) ? i + 1 : null;
    if (!n) return;
    const a = ease.outCubic(prog(t, s.start, s.start + 0.8)) * (1 - ease.inQuad(prog(t, s.end - 0.35, s.end)));
    ctx.save();
    ctx.globalAlpha = a * 0.08;
    ctx.translate(W * (side ? 0.82 : 0.86) + lerp(80, 0, a) * k - (t - s.start) * 10 * k, H * (side ? 0.5 : 0.52));
    font(ctx, numSize * 1.9, 700, numFamily);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 4 * k;
    ctx.strokeText(String(n), 0, 0);
    ctx.restore();
  }

  function topBar(ctx, t, i) {
    const intro = ease.outCubic(prog(t, 0.05, 0.7));
    const left = W * 0.08;
    const right = W * 0.92;
    const gap = 12 * k;
    const segW = (right - left - gap * (count - 1)) / Math.max(1, count);
    const h = 8 * k;
    ctx.save();
    ctx.globalAlpha = intro;
    const title = (T.title || `${count} MADDE`).toLocaleUpperCase("tr-TR");
    label(ctx, title, left, barY - 40 * k, 30 * k, C.muted, { weight: 600, family: numFamily, align: "left", spacing: `${4 * k}px` });
    const shown = i < 0 ? 0 : Math.min(i + 1, count);
    font(ctx, 34 * k, 700, numFamily, "normal", `${2 * k}px`);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const total = ` / ${pad2(count)}`;
    ctx.fillStyle = C.muted;
    ctx.fillText(total, right, barY - 40 * k);
    const tw = ctx.measureText(total).width;
    ctx.fillStyle = C.accent;
    ctx.fillText(pad2(shown), right - tw, barY - 40 * k);
    ctx.restore();
    for (let j = 0; j < count; j++) {
      const x = left + j * (segW + gap);
      const appear = ease.outCubic(prog(t, 0.1 + j * 0.06, 0.6 + j * 0.06));
      let f = 0;
      if (i > j) f = 1;
      else if (i === j) f = prog(t, scenes[j].start, scenes[j].end);
      ctx.save();
      ctx.globalAlpha = appear;
      ctx.fillStyle = rgba(C.text, 0.16);
      ctx.beginPath();
      ctx.roundRect(x, barY - h / 2, segW * appear, h, h / 2);
      ctx.fill();
      if (f > 0) {
        ctx.fillStyle = i === j ? C.accent : mix(C.accent, C.text, 0.15);
        ctx.beginPath();
        ctx.roundRect(x, barY - h / 2, Math.max(h, segW * f), h, h / 2);
        ctx.fill();
        if (i === j) glow(ctx, x + segW * f, barY, 28 * k, C.accent, 0.8);
      }
      ctx.restore();
    }
  }

  function drawNumber(ctx, n, cy, alpha) {
    if (!n) return;
    const str = String(n);
    font(ctx, numSize, 700, numFamily);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const base = cy + metrics.digitH / 2;
    ctx.globalAlpha = alpha * 0.35;
    ctx.fillStyle = "#000000";
    ctx.fillText(str, x0 + 10 * k, base + 14 * k);
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(0, cy - metrics.digitH / 2, 0, cy + metrics.digitH / 2);
    g.addColorStop(0, mix(C.accent, "#FFFFFF", 0.18));
    g.addColorStop(1, mix(C.accent, "#FF3D00", 0.35));
    ctx.fillStyle = g;
    ctx.fillText(str, x0, base);
  }

  function number(ctx, t, i) {
    if (i < 0) return;
    const s = scenes[i];
    let cur = null;
    let prev = null;
    let e = 1;
    if (i < count) {
      cur = card(i) ? i + 1 : null;
      prev = i > 0 && card(i - 1) ? i : null;
      e = ease.outCubic(prog(t, s.start, s.start + 0.6));
    } else {
      prev = card(count - 1) ? count : null;
      e = ease.inOutCubic(prog(t, s.start, s.start + 0.5));
    }
    const dh = metrics.digitH;
    const travel = dh * 1.35;
    const float = Math.sin(t * 1.7) * 6 * k;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 - 60 * k, numCy - dh * 0.62, metrics.boxW + 140 * k, dh * 1.32);
    ctx.clip();
    if (e < 1) drawNumber(ctx, prev, numCy - travel * e + float, 1 - e * 0.4);
    drawNumber(ctx, cur, numCy + travel * (1 - e) + float, 1);
    ctx.restore();
  }

  function itemText(ctx, t, i) {
    if (i < 0 || i >= count) return;
    const text = card(i);
    if (!text) return;
    const s = scenes[i];
    let tx, maxW, size, maxLines;
    if (side) {
      tx = x0 + metrics.boxW + 70 * k;
      maxW = W * 0.92 - tx;
      size = Math.min(W, H * 1.1) * 0.085;
      maxLines = 4;
    } else {
      tx = x0;
      maxW = W - x0 * 2;
      size = 116 * k;
      maxLines = 3;
    }
    const f = fit(ctx, text, maxW, maxLines, size, size * 0.6, 800, family);
    const lh = f.size * 1.16;
    const blockH = f.lines.length * lh;
    const top = side ? numCy - blockH / 2 + lh / 2 + 20 * k : numCy + metrics.digitH / 2 + 110 * k + lh / 2;
    const bar = ease.outExpo(prog(t, s.start + 0.2, s.start + 0.9)) * (1 - ease.inCubic(prog(t, s.end - 0.4, s.end - 0.1)));
    ctx.fillStyle = C.accent2;
    ctx.beginPath();
    ctx.roundRect(tx, top - lh / 2 - 34 * k, 90 * k * bar, 9 * k, 4.5 * k);
    ctx.fill();
    f.lines.forEach((line, j) => {
      const a = ease.outCubic(prog(t, s.start + 0.18 + j * 0.08, s.start + 0.7 + j * 0.08));
      const b = ease.inCubic(prog(t, s.end - 0.42 + j * 0.05, s.end - 0.17 + j * 0.05));
      if (a <= 0 || b >= 1) return;
      const y = top + j * lh;
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx - 20 * k, y - lh * 0.56, maxW + 60 * k, lh * 1.14);
      ctx.clip();
      const dx = Math.sin(t * 0.9 + j) * 2 * k;
      label(ctx, line, tx + dx, y + lh * (1 - a) - lh * 1.1 * b, f.size, C.text, { weight: 800, family, align: "left" });
      ctx.restore();
    });
  }

  function outro(ctx, t, s) {
    const r = 140 * k;
    const blockH = 2 * r + 300 * k;
    const cy = (side ? H * 0.43 : H * 0.42) - blockH / 2 + r;
    const a = ease.outBack(prog(t, s.start + 0.3, s.start + 0.95));
    const ring = ease.inOutCubic(prog(t, s.start + 0.45, s.start + 1.5));
    ctx.save();
    ctx.translate(W / 2, cy);
    const sc = lerp(0.6, 1, clamp(a)) * (1 + Math.sin((t - s.start) * 2.2) * 0.012);
    ctx.scale(sc, sc);
    ctx.globalAlpha = clamp(a);
    if (logoImg) {
      drawLogo(ctx, logoImg, 0, 0, r * 2.1);
    } else {
      const g = ctx.createLinearGradient(-r, -r, r, r);
      g.addColorStop(0, mix(C.accent, "#FFFFFF", 0.15));
      g.addColorStop(1, mix(C.accent, "#FF3D00", 0.35));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      label(ctx, (T.handle || "@").replace("@", "").slice(0, 1).toLocaleUpperCase("tr-TR") || "@", 0, 8 * k, r * 1.05, C.bg, { weight: 700, family: numFamily });
      ctx.lineCap = "round";
      ctx.lineWidth = 9 * k;
      ctx.strokeStyle = rgba(C.text, 0.14);
      ctx.beginPath();
      ctx.arc(0, 0, r + 26 * k, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = C.accent2;
      ctx.beginPath();
      ctx.arc(0, 0, r + 26 * k, -Math.PI / 2, -Math.PI / 2 + TAU * ring);
      ctx.stroke();
    }
    ctx.restore();
    const k2 = ease.outCubic(prog(t, s.start + 0.5, s.start + 1.05));
    const hy = cy + r + 100 * k;
    label(ctx, T.handle || "", W / 2, hy + lerp(40, 0, k2) * k, 66 * k, C.text, { weight: 800, family, alpha: k2 });
    const k3 = ease.outBack(prog(t, s.start + 0.75, s.start + 1.3));
    if (k3 > 0) {
      const text = T.follow || "Takip et";
      font(ctx, 46 * k, 800, family);
      const pw = Math.max(320 * k, ctx.measureText(text).width + 150 * k);
      const ph = 100 * k;
      const py = hy + 120 * k;
      ctx.save();
      ctx.globalAlpha = clamp(k3);
      ctx.translate(W / 2, py);
      ctx.scale(lerp(0.7, 1, clamp(k3)), lerp(0.7, 1, clamp(k3)));
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
      ctx.fill();
      const nudge = Math.sin((t - s.start) * 5) * 5 * k;
      label(ctx, text, -24 * k, 3 * k, 46 * k, C.bg, { weight: 800, family });
      font(ctx, 46 * k, 800, family);
      const tw = ctx.measureText(text).width;
      label(ctx, "→", tw / 2 + 12 * k + nudge, 0, 46 * k, C.bg, { weight: 800, family });
      ctx.restore();
    }
  }

  return {
    renderWorld(ctx, t, S) {
      if (!metrics) measure(ctx);
      background(ctx, t);
      const i = sceneAt(t);
      ghost(ctx, t, i);
      topBar(ctx, t, i);
      number(ctx, t, i);
      if (i >= 0 && i < count) itemText(ctx, t, i);
      else if (i === scenes.length - 1) outro(ctx, t, scenes[i]);
      ctx.save();
      ctx.globalAlpha = 0.45;
      tile(ctx, A.grain, W, H, (S.frame * 37) % 256, (S.frame * 53) % 256);
      ctx.restore();
      vignette(S, 0.4, "0,0,0");
    },
  };
}
