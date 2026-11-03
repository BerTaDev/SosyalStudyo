import { TAU, clamp, lerp, prog, ease, mix, rgba } from "../../_engine/core/util.js";
import { font, label, vignette } from "../../_engine/core/overlay.js";
import { tile } from "../../_engine/core/assets.js";
import { glow, ring } from "../../_engine/core/kit.js";

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

const POS = /^\s*(✓|✔|✅|\+)\s*/;
const NEG = /^\s*(✗|✘|×|❌|-|–)\s*/;
const NEG_WORDS = /(değil|yok|yanlış|hata|kötü|yapma|asla|olmaz|zor|yavaş|eksik|kaybet|pahalı|sıkıcı|boşa|gereksiz)/;

function parse(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const parts = text.split(/\s+vs\.?\s+/i);
  if (parts.length >= 2 && parts[0] && parts[1]) return { kind: "vs", a: parts[0].trim(), b: parts.slice(1).join(" vs ").trim() };
  if (POS.test(text)) return { kind: "verdict", ok: true, text: text.replace(POS, "") };
  if (NEG.test(text)) return { kind: "verdict", ok: false, text: text.replace(NEG, "") };
  return { kind: "verdict", ok: !NEG_WORDS.test(text.toLocaleLowerCase("tr-TR")), text };
}

export default async function makeScene({ cfg, tl, W, H, A, images }) {
  const C = cfg.colors;
  const T = cfg.text || {};
  const scenes = tl.scenes;
  const count = Math.max(0, scenes.length - 1);
  const family = cfg.fonts?.[0] || "Segoe UI";
  const badgeFamily = cfg.fonts?.[1] || "Bahnschrift";
  const k = Math.min(1, W / 1080, H / 1300);
  const land = W > H * 1.2;
  const slant = Math.min(W, H) * 0.07;
  const cy = H * (land ? 0.42 : 0.4);
  const logoImg = images?.ref1 && images.ref1.naturalWidth ? images.ref1 : null;
  const stack = W / H < 0.9;
  const badgeR = (stack ? 96 : 84) * k;
  const sideW = stack ? W * 0.42 : W / 2 - badgeR - 34 * k - W * 0.05;
  const cards = Array.from({ length: count }, (_, i) => parse(T.cards?.[i]));

  const targetOf = (i) => {
    if (i >= count) return 0.5;
    const c = cards[i];
    if (!c || c.kind === "vs") return 0.5;
    return c.ok ? -0.25 : 1.25;
  };

  function sceneAt(t) {
    let i = scenes.findIndex((s) => t >= s.start && t < s.end);
    if (i < 0 && scenes.length && t >= scenes[scenes.length - 1].end) i = scenes.length - 1;
    return i;
  }

  function splitAt(t, i) {
    if (i < 0) return 0.5;
    const s = scenes[i];
    const from = i > 0 ? targetOf(i - 1) : 0.5;
    return lerp(from, targetOf(i), ease.inOutCubic(prog(t, s.start, s.start + 0.65)));
  }

  const divX = (split, y) => split * W + slant * (1 - (2 * y) / H);

  function panel(ctx, col, t, dir) {
    const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, mix(col, "#000000", 0.18));
    g.addColorStop(1, mix(col, "#000000", 0.62));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    const sp = 46 * k;
    const off = (t * 26 * k * dir) % sp;
    for (let y = -sp + off; y < H + sp; y += sp)
      for (let x = ((Math.round(y / sp) % 2) * sp) / 2 - sp; x < W + sp; x += sp) {
        ctx.beginPath();
        ctx.arc(x, y, 2.6 * k, 0, TAU);
        ctx.fill();
      }
  }

  function background(ctx, t, split) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const intro = ease.outCubic(prog(t, 0, 0.45));
    const slide = (1 - intro) * W * 0.65;
    ctx.save();
    ctx.translate(-slide, 0);
    ctx.beginPath();
    ctx.moveTo(-W, 0);
    ctx.lineTo(divX(split, 0), 0);
    ctx.lineTo(divX(split, H), H);
    ctx.lineTo(-W, H);
    ctx.closePath();
    ctx.clip();
    ctx.translate(slide, 0);
    panel(ctx, C.accent, t, -1);
    ctx.restore();
    ctx.save();
    ctx.translate(slide, 0);
    ctx.beginPath();
    ctx.moveTo(2 * W, 0);
    ctx.lineTo(divX(split, 0), 0);
    ctx.lineTo(divX(split, H), H);
    ctx.lineTo(2 * W, H);
    ctx.closePath();
    ctx.clip();
    ctx.translate(-slide, 0);
    panel(ctx, C.accent2, t, 1);
    ctx.restore();
    if (intro >= 1 && split > -0.2 && split < 1.2) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 6 * k;
      ctx.shadowColor = "rgba(255,255,255,0.6)";
      ctx.shadowBlur = 24 * k;
      ctx.beginPath();
      ctx.moveTo(divX(split, 0), 0);
      ctx.lineTo(divX(split, H), H);
      ctx.stroke();
      ctx.restore();
    }
  }

  function side(ctx, t, s, text, cx, place, dir, delay) {
    const a = ease.outCubic(prog(t, s.start + 0.3 + delay, s.start + 0.85 + delay));
    const b = ease.inCubic(prog(t, s.end - 0.38, s.end - 0.05));
    if (a <= 0 || b >= 1) return;
    const f = fit(ctx, text, sideW, stack ? 2 : 3, (land ? 140 : 124) * k, 40 * k, 900, family);
    const lh = f.size * 1.12;
    const off = place ? Math.max(H * 0.125, badgeR * 0.7 + (f.lines.length * lh) / 2 + 30 * k) : 0;
    const cyy = cy + place * off;
    const bob = Math.sin(t * 1.8 + (dir > 0 ? Math.PI : 0)) * 8 * k;
    const x = cx + dir * (W * 0.35 * (1 - a) + W * 0.45 * b);
    const top = cyy - ((f.lines.length - 1) * lh) / 2 + bob;
    ctx.save();
    ctx.globalAlpha = a * (1 - b);
    f.lines.forEach((line, j) => {
      label(ctx, line, x + 6 * k, top + j * lh + 8 * k, f.size, "rgba(0,0,0,0.28)", { weight: 900, family });
      label(ctx, line, x, top + j * lh, f.size, C.text, { weight: 900, family });
    });
    const u = ease.outExpo(prog(t, s.start + 0.6 + delay, s.start + 1.2 + delay));
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.roundRect(x - 60 * k * u, top + (f.lines.length - 1) * lh + f.size * 0.75, 120 * k * u, 8 * k, 4 * k);
    ctx.fill();
    ctx.restore();
  }

  function badge(ctx, t, s, split) {
    const p = prog(t, s.start + 0.55, s.start + 1.0);
    const a = ease.outBack(p);
    const b = ease.inCubic(prog(t, s.end - 0.3, s.end - 0.05));
    if (p <= 0 || b >= 1) return;
    const r = badgeR;
    const x = divX(split, cy);
    const pulse = ((t - s.start) % 1.1) / 1.1;
    ring(ctx, x, cy, r + pulse * 90 * k, "#FFFFFF", 4 * k, (1 - pulse) * 0.5 * (1 - b));
    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate(Math.sin(t * 2.4) * 0.06 - (1 - clamp(a)) * 0.8);
    const sc = Math.max(0, a) * (1 - b);
    ctx.scale(sc, sc);
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 30 * k;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 6 * k;
    ctx.strokeStyle = C.bg;
    ctx.beginPath();
    ctx.arc(0, 0, r - 12 * k, 0, TAU);
    ctx.stroke();
    label(ctx, "VS", 2 * k, 4 * k, 74 * k, C.bg, { weight: 700, family: badgeFamily, spacing: `${2 * k}px` });
    ctx.restore();
  }

  function mark(ctx, ok, cx, cy2, r, k1, col, lw) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    if (ok) {
      const p = [[-0.42, 0.02], [-0.12, 0.32], [0.46, -0.3]];
      const l1 = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
      const l2 = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
      const d = k1 * (l1 + l2);
      ctx.moveTo(cx + p[0][0] * r, cy2 + p[0][1] * r);
      if (d <= l1) ctx.lineTo(cx + lerp(p[0][0], p[1][0], d / l1) * r, cy2 + lerp(p[0][1], p[1][1], d / l1) * r);
      else {
        ctx.lineTo(cx + p[1][0] * r, cy2 + p[1][1] * r);
        const e = (d - l1) / l2;
        ctx.lineTo(cx + lerp(p[1][0], p[2][0], e) * r, cy2 + lerp(p[1][1], p[2][1], e) * r);
      }
    } else {
      const e1 = clamp(k1 * 2);
      const e2 = clamp(k1 * 2 - 1);
      const q = 0.36;
      ctx.moveTo(cx - q * r, cy2 - q * r);
      ctx.lineTo(cx + lerp(-q, q, e1) * r, cy2 + lerp(-q, q, e1) * r);
      if (e2 > 0) {
        ctx.moveTo(cx + q * r, cy2 - q * r);
        ctx.lineTo(cx + lerp(q, -q, e2) * r, cy2 + lerp(-q, q, e2) * r);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function verdictScene(ctx, t, s, c) {
    const col = c.ok ? C.accent2 : C.accent;
    const p = prog(t, s.start + 0.4, s.start + 0.9);
    const a = ease.outBack(p);
    const b = ease.inCubic(prog(t, s.end - 0.35, s.end - 0.05));
    if (p <= 0 || b >= 1) return;
    const R = Math.max(W, H);
    const wm = ease.outCubic(prog(t, s.start + 0.3, s.start + 1.2));
    ctx.save();
    ctx.globalAlpha = 0.08 * wm * (1 - b);
    ctx.translate(W * 0.78, H * 0.62);
    ctx.rotate(-0.15 + (t - s.start) * 0.02);
    mark(ctx, c.ok, 0, 0, R * 0.42, 1, "#FFFFFF", R * 0.05);
    ctx.restore();
    const r = (land ? 105 : 125) * k;
    const my = H * (land ? 0.3 : 0.29);
    ctx.save();
    ctx.globalAlpha = 1 - b;
    ctx.translate(W / 2, my + Math.sin(t * 1.6) * 5 * k);
    const sc = Math.max(0, a) * lerp(1, 0.8, b);
    ctx.scale(sc, sc);
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 36 * k;
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (a > 0.3) {
      ctx.save();
      ctx.globalAlpha = 1 - b;
      ctx.translate(W / 2, my + Math.sin(t * 1.6) * 5 * k);
      ctx.scale(sc, sc);
      mark(ctx, c.ok, 0, 0, r * 1.1, ease.outCubic(prog(t, s.start + 0.6, s.start + 1.05)), mix(col, "#000000", 0.15), 22 * k);
      ctx.restore();
    }
    const f = fit(ctx, c.text, W * 0.84, 3, (land ? 96 : 110) * k, 48 * k, 900, family);
    const lh = f.size * 1.13;
    const top = my + r + 70 * k + f.size * 0.55;
    let wi = 0;
    f.lines.forEach((line, j) => {
      font(ctx, f.size, 900, family);
      const words = line.split(" ");
      const space = ctx.measureText(" ").width;
      const widths = words.map((w) => ctx.measureText(w).width);
      let x = W / 2 - (widths.reduce((p, q) => p + q, 0) + space * (words.length - 1)) / 2;
      words.forEach((w, n) => {
        const e = ease.outBack(prog(t, s.start + 0.55 + wi * 0.07, s.start + 0.95 + wi * 0.07));
        wi++;
        if (e > 0) {
          const y = top + j * lh + lerp(50, 0, clamp(e)) * k - b * 40 * k;
          ctx.save();
          ctx.globalAlpha = clamp(e) * (1 - b);
          label(ctx, w, x + 5 * k, y + 7 * k, f.size, "rgba(0,0,0,0.25)", { weight: 900, family, align: "left" });
          label(ctx, w, x, y, f.size, C.text, { weight: 900, family, align: "left" });
          ctx.restore();
        }
        x += widths[n] + space;
      });
    });
  }

  function outro(ctx, t, s, split) {
    const r = 130 * k;
    const oy = H * (land ? 0.3 : 0.33);
    const x = divX(split, oy);
    const p = prog(t, s.start + 0.45, s.start + 1.0);
    const a = ease.outBack(p);
    const pulse = ((t - s.start) % 1.3) / 1.3;
    if (p > 0.5) ring(ctx, x, oy, r + 20 * k + pulse * 120 * k, "#FFFFFF", 5 * k, (1 - pulse) * 0.45);
    ctx.save();
    ctx.translate(x, oy);
    ctx.scale(Math.max(0, a), Math.max(0, a));
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 40 * k;
    if (logoImg) {
      const box = r * 2.1;
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.roundRect(-box / 2 - 24 * k, -box / 2 - 24 * k, box + 48 * k, box + 48 * k, 40 * k);
      ctx.fill();
      ctx.shadowBlur = 0;
      drawLogo(ctx, logoImg, 0, 0, box);
    } else {
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(0, 0, r + 14 * k, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      const g = ctx.createLinearGradient(-r, 0, r, 0);
      g.addColorStop(0.35, C.accent);
      g.addColorStop(0.65, C.accent2);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      label(ctx, (T.handle || "@").replace("@", "").slice(0, 1).toLocaleUpperCase("tr-TR") || "@", 0, 8 * k, r * 1.1, "#FFFFFF", { weight: 900, family });
    }
    ctx.restore();
    const k2 = ease.outCubic(prog(t, s.start + 0.65, s.start + 1.15));
    const hy = oy + r + 110 * k;
    label(ctx, T.handle || "", W / 2 + 5 * k, hy + 7 * k + lerp(40, 0, k2) * k, 70 * k, "rgba(0,0,0,0.3)", { weight: 900, family, alpha: k2 });
    label(ctx, T.handle || "", W / 2, hy + lerp(40, 0, k2) * k, 70 * k, C.text, { weight: 900, family, alpha: k2 });
    const k3 = ease.outBack(prog(t, s.start + 0.85, s.start + 1.4));
    if (k3 > 0) {
      const text = T.follow || "Takip et";
      font(ctx, 46 * k, 900, family);
      const pw = Math.max(330 * k, ctx.measureText(text).width + 120 * k);
      const ph = 100 * k;
      ctx.save();
      ctx.globalAlpha = clamp(k3);
      ctx.translate(W / 2, hy + 130 * k);
      const sc = lerp(0.7, 1, clamp(k3)) * (1 + Math.sin((t - s.start) * 4) * 0.02);
      ctx.scale(sc, sc);
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = 24 * k;
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      label(ctx, text, 0, 3 * k, 46 * k, C.bg, { weight: 900, family });
      ctx.restore();
    }
  }

  return {
    renderWorld(ctx, t, S) {
      const i = sceneAt(t);
      const split = splitAt(t, i);
      background(ctx, t, split);
      if (i >= 0 && i < count && cards[i]) {
        const s = scenes[i];
        const c = cards[i];
        if (c.kind === "vs") {
          if (stack) {
            side(ctx, t, s, c.a, W * 0.27, -1, -1, 0);
            side(ctx, t, s, c.b, W * 0.73, 1, 1, 0.12);
          } else {
            const bx = divX(split, cy);
            side(ctx, t, s, c.a, bx - badgeR - 34 * k - sideW / 2, 0, -1, 0);
            side(ctx, t, s, c.b, bx + badgeR + 34 * k + sideW / 2, 0, 1, 0.12);
          }
          badge(ctx, t, s, split);
        } else verdictScene(ctx, t, s, c);
      } else if (i === scenes.length - 1 && i >= count) outro(ctx, t, scenes[i], split);
      ctx.save();
      ctx.globalAlpha = 0.4;
      tile(ctx, A.grain, W, H, (S.frame * 37) % 256, (S.frame * 53) % 256);
      ctx.restore();
      vignette(S, 0.35, "0,0,0");
    },
  };
}
