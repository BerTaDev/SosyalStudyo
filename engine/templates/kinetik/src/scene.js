import { TAU, clamp, lerp, prog, ease } from "../../_engine/core/util.js";
import { font, label, vignette } from "../../_engine/core/overlay.js";
import { tile } from "../../_engine/core/assets.js";
import { glow, ring } from "../../_engine/core/kit.js";

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(next).width > maxWidth) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export default async function makeScene({ cfg, tl, W, H, A }) {
  const C = cfg.colors;
  const T = cfg.text;
  const scenes = tl.scenes;
  const family = cfg.fonts?.[0] || "Segoe UI";
  const cy = H * 0.4;
  const k = Math.min(1, W / 1080, H / 1300);

  function background(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg2);
    g.addColorStop(1, C.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) {
      const a = t * 0.12 + i * 2.1;
      glow(ctx, W / 2 + Math.cos(a) * W * 0.3, cy + Math.sin(a * 1.3) * H * 0.22, Math.max(W, H) * 0.27, i % 2 ? C.accent2 : C.accent, 0.16);
    }
  }

  function card(ctx, text, s, t, index) {
    const kin = ease.outCubic(prog(t, s.start, s.start + 0.55));
    const out = 1 - ease.inOutQuad(prog(t, s.end - 0.3, s.end));
    const alpha = kin * out;
    if (alpha <= 0) return;
    const size = 96 * k;
    ctx.save();
    ctx.globalAlpha = alpha;
    font(ctx, size, 800, family);
    const lines = wrap(ctx, text, Math.min(W * 0.8, 900));
    const lh = size * 1.17;
    const top = cy - ((lines.length - 1) * lh) / 2 + lerp(60, 0, kin);
    label(ctx, String(index + 1).padStart(2, "0"), W / 2, top - 150 * k, 40 * k, C.accent, { weight: 800, family, spacing: "6px" });
    lines.forEach((line, i) => label(ctx, line, W / 2, top + i * lh, size, C.text, { weight: 800, family }));
    const bar = ease.outExpo(prog(t, s.start + 0.25, s.start + 0.9));
    ctx.fillStyle = C.accent;
    ctx.beginPath();
    ctx.roundRect(W / 2 - 160 * k * bar, top + lines.length * lh - 20 * k, 320 * k * bar, 10 * k, 5 * k);
    ctx.fill();
    ctx.restore();
  }

  function outro(ctx, s, t) {
    const kin = ease.outBack(prog(t, s.start, s.start + 0.7));
    const pulse = (t - s.start) % 1.2;
    ring(ctx, W / 2, cy, (150 + pulse * 220) * k, C.accent, 6, clamp(1 - pulse / 1.2) * 0.6);
    ctx.save();
    ctx.globalAlpha = clamp(kin);
    ctx.translate(W / 2, cy);
    ctx.scale(lerp(0.7, 1, clamp(kin)) * k, lerp(0.7, 1, clamp(kin)) * k);
    const g = ctx.createLinearGradient(-150, -150, 150, 150);
    g.addColorStop(0, C.accent);
    g.addColorStop(1, C.accent2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 150, 0, TAU);
    ctx.fill();
    label(ctx, (T.handle || "@").replace("@", "").slice(0, 1).toUpperCase(), 0, 6, 150, C.text, { weight: 800, family });
    ctx.restore();
    const k2 = ease.outCubic(prog(t, s.start + 0.3, s.start + 0.9));
    label(ctx, T.handle || "", W / 2, cy + 250 * k + lerp(40, 0, k2), 68 * k, C.text, { weight: 800, family, alpha: k2 });
    const k3 = ease.outBack(prog(t, s.start + 0.6, s.start + 1.2));
    if (k3 > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(k3);
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.roundRect(W / 2 - 170 * k, cy + 330 * k, 340 * k, 96 * k, 48 * k);
      ctx.fill();
      label(ctx, T.follow || "Takip et", W / 2, cy + 380 * k, 46 * k, C.text, { weight: 800, family });
      ctx.restore();
    }
  }

  return {
    renderWorld(ctx, t, S) {
      background(ctx, t);
      const i = scenes.findIndex((s) => t >= s.start && t < s.end);
      if (i >= 0) {
        const s = scenes[i];
        if (i === scenes.length - 1) outro(ctx, s, t);
        else card(ctx, T.cards?.[i] || "", s, t, i);
      }
      ctx.save();
      ctx.globalAlpha = 0.5;
      tile(ctx, A.grain, W, H, (S.frame * 37) % 256, (S.frame * 53) % 256);
      ctx.restore();
      vignette(S, 0.45, "0,0,0");
    },
  };
}
