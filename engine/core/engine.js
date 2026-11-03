import { makeCanvas } from "./util.js";
import { makeAssets } from "./assets.js";
import * as O from "./overlay.js";

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

export async function createEngine(canvas, cfg, tl, makeScene, opts = {}) {
  const W = cfg.video.width;
  const H = cfg.video.height;
  const fps = cfg.video.fps;
  const q = opts.q ?? 1;
  canvas.width = Math.round(W * q);
  canvas.height = Math.round(H * q);
  const ctx = canvas.getContext("2d");
  const B = tl.beats;
  const A = makeAssets(cfg.video.seed ?? 1);
  const fonts = new Set([cfg.subtitle?.font, ...(cfg.fonts || [])].filter(Boolean));
  for (const f of fonts) await document.fonts.load(`700 40px "${f}"`).catch(() => {});
  const images = {};
  for (const [key, src] of Object.entries(cfg.images || {})) {
    try {
      images[key] = await loadImage(src);
    } catch {
      images[key] = null;
    }
  }
  const scene = await makeScene({ cfg, tl, W, H, A, B, images });
  const layer = makeCanvas(W * q, H * q);
  const acc = makeCanvas(W * q, H * q);
  const smp = makeCanvas(W * q, H * q);

  const base = (c) => c.setTransform(q, 0, 0, q, 0, 0);
  const clear = (c) => {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  };
  const footage = !!cfg.video.footage;
  const state = (c, t, extra) => Object.assign({ ctx: c, t, W, H, cfg, tl, B, C: cfg.colors || {}, T: cfg.text || {}, A, images, frame: Math.round(t * fps), q, scene, footage }, extra);

  function world(c, t, S) {
    clear(c);
    base(c);
    scene.renderWorld(c, t, state(c, t, S));
  }

  function render(t, flags = {}) {
    const view = Object.assign({}, cfg, { subtitle: Object.assign({}, cfg.subtitle, { enabled: flags.subtitles ?? cfg.subtitle?.enabled ?? true }) });
    const extra = { cfg: view, preview: !!flags.preview };
    clear(ctx);
    base(ctx);
    const S = state(ctx, t, extra);
    const blur = flags.blur ?? cfg.camera?.motionBlur ?? false;
    const shutter = (cfg.camera?.shutter ?? 0.5) / fps;
    const disp = blur && scene.motion ? scene.motion(t, shutter) : 0;
    const n = Math.min(cfg.camera?.maxBlurSamples ?? 8, Math.max(1, Math.ceil(disp / 5)));
    const lc = layer.getContext("2d");
    if (n <= 1) world(lc, t, extra);
    else {
      const ac = acc.getContext("2d");
      const sc = smp.getContext("2d");
      clear(ac);
      for (let k = 0; k < n; k++) {
        world(sc, t + shutter * (k / (n - 1) - 0.5), extra);
        ac.setTransform(1, 0, 0, 1, 0, 0);
        ac.globalAlpha = 1 / (k + 1);
        ac.drawImage(smp, 0, 0);
      }
      ac.globalAlpha = 1;
      clear(lc);
      lc.drawImage(acc, 0, 0);
    }
    if (scene.mask) {
      base(lc);
      scene.mask(lc, state(lc, t, extra));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    base(ctx);
    if (scene.overlay) scene.overlay(ctx, S);
    base(ctx);
    if (view.subtitle && view.subtitle.enabled) O.drawSubtitles(S);
  }

  return { render, W, H, fps, duration: tl.duration, frames: Math.round(tl.duration * fps), scene, tl, cfg };
}
