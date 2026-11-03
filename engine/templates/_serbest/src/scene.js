import { prog, ease } from "../../_engine/core/util.js";
import { label } from "../../_engine/core/overlay.js";

export default async function makeScene({ cfg, tl, W, H }) {
  const C = cfg.colors;
  const T = cfg.text;
  const scenes = tl.scenes;
  const family = cfg.fonts?.[0] || "Segoe UI";
  const k = Math.min(1, W / 1080, H / 1300);

  return {
    renderWorld(ctx, t, S) {
      if (!S.footage) {
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, W, H);
      }
      const i = scenes.findIndex((s) => t >= s.start && t < s.end);
      if (i < 0) return;
      const s = scenes[i];
      const a = ease.outCubic(prog(t, s.start, s.start + 0.4));
      ctx.save();
      ctx.globalAlpha = a;
      if (i === scenes.length - 1) {
        label(ctx, T.handle || "", W / 2, H * 0.4, 64 * k, C.text, { weight: 800, family });
        label(ctx, T.follow || "Takip et", W / 2, H * 0.4 + 90 * k, 44 * k, C.muted, { weight: 600, family });
      } else label(ctx, T.cards?.[i] || "", W / 2, H * 0.4, 72 * k, C.text, { weight: 800, family });
      ctx.restore();
    },
  };
}
