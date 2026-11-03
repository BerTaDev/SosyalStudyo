import { TAU, clamp, lerp, prog, ease, rgba, mix, rng, hash, noise1, hexToRgb, makeCanvas } from "../../_engine/core/util.js";
import { font, vignette } from "../../_engine/core/overlay.js";
import { tile } from "../../_engine/core/assets.js";

const bump = (v) => Math.sin(Math.PI * clamp(v));
const upper = (s) => String(s ?? "").toLocaleUpperCase("tr-TR");

function softSprite(size, col, mid = 0.35) {
  const c = makeCanvas(size, size);
  const g = c.getContext("2d");
  const r = size / 2;
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, rgba(col, 1));
  gr.addColorStop(mid, rgba(col, 0.35));
  gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

function beamSprite(col) {
  const w = 256;
  const h = 1024;
  const c = makeCanvas(w, h);
  const g = c.getContext("2d");
  g.filter = "blur(18px)";
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, rgba(col, 0.9));
  gr.addColorStop(0.45, rgba(col, 0.35));
  gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(w * 0.45, 0);
  g.lineTo(w * 0.55, 0);
  g.lineTo(w * 0.86, h);
  g.lineTo(w * 0.14, h);
  g.closePath();
  g.fill();
  return c;
}

function blob(ctx, x, y, rx, ry, col, a, rot = 0) {
  if (a <= 0 || rx <= 0 || ry <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale(rx / ry, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
  g.addColorStop(0, rgba(col, Math.min(1, a)));
  g.addColorStop(0.4, rgba(col, Math.min(1, a) * 0.42));
  g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-ry, -ry, ry * 2, ry * 2);
  ctx.restore();
}

function wrapWords(words, mw, maxW) {
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && mw(next) > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function parseCard(raw) {
  let s = String(raw ?? "").replace(/\*/g, "").replace(/\.\.\./g, "…").trim();
  let kicker = "";
  const cut = s.indexOf("|");
  if (cut >= 0) {
    kicker = s.slice(0, cut).trim();
    s = s.slice(cut + 1).trim();
  }
  return { kicker: upper(kicker), title: upper(s) };
}

export default async function makeScene({ cfg, tl, W, H, A, images }) {
  const C = cfg.colors;
  const T = cfg.text || {};
  const scenes = tl.scenes;
  const count = Math.max(0, scenes.length - 1);
  const serif = `"${cfg.fonts?.[0] || "Palatino Linotype"}", "Palatino Linotype", Georgia, serif`;
  const sans = `"${cfg.fonts?.[1] || "Segoe UI"}", "Segoe UI", sans-serif`;
  const k = Math.min(W / 1080, H / 1300);
  const land = W > H * 1.2;
  const tall = W / H < 0.7;
  const M = Math.max(W, H);
  const cy = H * (land ? 0.45 : tall ? 0.4 : 0.42);
  const TRACK = 0.2;
  const logo = images?.ref1 && images.ref1.naturalWidth ? images.ref1 : null;
  const cards = (T.cards || []).map(parseCard);
  const shade = mix(C.bg, [0, 0, 0], 0.55);
  const vigRgb = hexToRgb(C.bg).map((v) => Math.round(v * 0.4)).join(",");
  const moteImg = softSprite(64, C.text, 0.3);
  const beamImg = beamSprite(mix(C.accent, C.text, 0.45));
  const R = rng((cfg.video?.seed ?? 7) * 131 + 9);
  const dust = Array.from({ length: 70 }, () => ({ x: R(), y: R(), z: R(), ph: R() * TAU, sp: 0.5 + R() * 0.9, fl: R() * 50 }));
  const layouts = new Map();
  let outroL = null;

  function sceneAt(t) {
    let i = scenes.findIndex((s) => t >= s.start && t < s.end);
    if (i < 0 && scenes.length && t >= scenes[scenes.length - 1].end) i = scenes.length - 1;
    return i;
  }

  function measure(ctx, text, size, family = serif, weight = 400) {
    font(ctx, size, weight, family);
    return { text, w0: ctx.measureText(text).width, n: [...text].length };
  }

  function tracked(ctx, line, size, sp, x, y, family = serif, weight = 400) {
    font(ctx, size, weight, family, "normal", `${sp}px`);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(line.text, x - (line.w0 + sp * (line.n - 1)) / 2, y);
  }

  const widthOf = (line, sp) => line.w0 + sp * (line.n - 1);
  const capSp = (line, sp, maxW) => Math.max(0, Math.min(sp, (maxW - line.w0) / Math.max(1, line.n - 1)));

  function layout(ctx, i) {
    if (layouts.has(i)) return layouts.get(i);
    const card = cards[i];
    if (!card || !card.title) {
      layouts.set(i, null);
      return null;
    }
    const paras = card.title.split(/\s*\n\s*/).filter(Boolean);
    const maxW = W * (land ? 0.7 : 0.84);
    const maxH = H * (land ? 0.34 : tall ? 0.27 : 0.3);
    let res = null;
    for (let size = (land ? 128 : 124) * k; size >= 34 * k; size -= 2 * k) {
      font(ctx, size, 400, serif);
      const sp = TRACK * size;
      const mw = (s) => ctx.measureText(s).width + sp * Math.max(0, [...s].length - 1);
      const lines = [];
      let ok = true;
      for (const p of paras) {
        const words = p.split(/\s+/);
        const widest = Math.max(...words.map(mw));
        if (widest > maxW) ok = false;
        const n = wrapWords(words, mw, maxW).length;
        let lo = Math.min(widest, maxW);
        let hi = maxW;
        for (let it = 0; it < 14; it++) {
          const mid = (lo + hi) / 2;
          if (wrapWords(words, mw, mid).length > n) lo = mid;
          else hi = mid;
        }
        lines.push(...wrapWords(words, mw, hi));
      }
      const lh = size * 1.24;
      res = { size, lh, kicker: card.kicker, lines: lines.map((s) => ({ text: s, w0: ctx.measureText(s).width, n: [...s].length })) };
      if (ok && lines.length <= 4 && lines.length * lh <= maxH) break;
    }
    layouts.set(i, res);
    return res;
  }

  function lightText(ctx, line, size, x, y, e, sp, fade, blurOut, col = C.text, glow = 1) {
    if (fade <= 0 || e <= 0) return;
    const ga = (bump(e) * 0.85 + 0.12 * clamp(e * 3)) * fade * glow;
    if (ga > 0.005) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.filter = `blur(${lerp(30, 9, ease.outCubic(e)) * k}px)`;
      ctx.fillStyle = rgba(C.accent, Math.min(1, ga));
      tracked(ctx, line, size, sp, x, y);
      ctx.restore();
    }
    const ca = ease.inOutSine(prog(e, 0.08, 0.6)) * fade;
    if (ca <= 0) return;
    ctx.save();
    if (blurOut > 0.3) ctx.filter = `blur(${blurOut}px)`;
    ctx.globalAlpha = ca;
    ctx.fillStyle = mix(C.accent, col, ease.outCubic(prog(e, 0.25, 1)));
    tracked(ctx, line, size, sp, x, y);
    ctx.restore();
  }

  function sheen(ctx, line, size, sp, x, y, p, a) {
    if (p <= 0 || p >= 1 || a <= 0) return;
    const w = widthOf(line, sp);
    const g = ctx.createLinearGradient(x - w * 0.8, 0, x + w * 0.8, 0);
    g.addColorStop(0, rgba(C.accent, 0));
    g.addColorStop(clamp(p - 0.07), rgba(C.accent, 0));
    g.addColorStop(p, rgba(C.accent, a));
    g.addColorStop(clamp(p + 0.07), rgba(C.accent, 0));
    g.addColorStop(1, rgba(C.accent, 0));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    tracked(ctx, line, size, sp, x, y);
    ctx.restore();
  }

  function flare(ctx, x, y, I) {
    if (I <= 0.004) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    blob(ctx, x, y, M * 0.75, 26 * k, C.accent2, 0.26 * I);
    blob(ctx, x, y, M * 0.55, 5 * k, C.accent2, 0.75 * I);
    blob(ctx, x, y, M * 0.32, 1.8 * k, C.text, 0.95 * I);
    blob(ctx, x, y, 210 * k, 210 * k, C.accent2, 0.16 * I);
    blob(ctx, x, y, 70 * k, 70 * k, C.text, 0.5 * I);
    const mx = W / 2;
    const my = H / 2;
    [-0.35, -0.75, 0.45, 1.1].forEach((f, j) => {
      const gx = mx + (mx - x) * f;
      const gy = my + (my - y) * f * 0.25;
      const r = (16 + 34 * Math.abs(f)) * k;
      blob(ctx, gx, gy, r * 1.3, r, j % 2 ? C.accent : C.accent2, 0.11 * I);
    });
    ctx.restore();
  }

  function backdrop(ctx) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    blob(ctx, W / 2, cy, M * 0.62, M * 0.42, C.bg2, 1);
  }

  function beams(ctx, t) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const len = M * 1.3;
    [[-0.36, 0.55], [-0.6, 0.38], [-0.18, 0.3]].forEach(([ang, wf], j) => {
      ctx.save();
      ctx.translate(W * 0.18, -H * 0.12);
      ctx.rotate(ang + 0.035 * Math.sin(t * 0.25 + j * 1.7));
      ctx.globalAlpha = clamp(0.13 + 0.06 * noise1(t * 0.9 + j * 7, 9));
      ctx.drawImage(beamImg, (-len * wf) / 2, 0, len * wf, len);
      ctx.restore();
    });
    ctx.restore();
  }

  function leaks(ctx, t, burst) {
    const n1 = noise1(t * 0.4, 11);
    const n2 = noise1(t * 0.3, 23);
    const n3 = noise1(t * 0.9, 37);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    blob(ctx, W * (0.02 + 0.06 * n1), H * (0.24 + 0.1 * n2), M * 0.42, M * 0.26, C.accent, 0.2 + 0.07 * n3 + 0.45 * burst, 0.6 + 0.2 * n2);
    blob(ctx, W * (1.0 + 0.05 * n2), H * (0.7 + 0.08 * n1), M * 0.36, M * 0.22, C.accent, 0.11 + 0.05 * n3 + 0.25 * burst, -0.5);
    blob(ctx, W * (0.92 + 0.04 * n3), H * (0.1 + 0.05 * n1), M * 0.3, M * 0.16, C.accent2, 0.08 + 0.12 * burst, 0.25);
    ctx.restore();
    if (burst > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      blob(ctx, W / 2, cy, M * 0.9, 20 * k, C.accent2, 0.22 * burst);
      blob(ctx, W / 2, cy, M * 0.7, 2.4 * k, C.text, 0.55 * burst);
      ctx.restore();
    }
  }

  function motes(ctx, t) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of dust) {
      const z = p.z;
      const r = (1.6 + z * z * z * 22) * k;
      const x0 = p.x * W + Math.sin(t * 0.35 * p.sp + p.ph) * 36 * k * (0.4 + z) + t * 10 * k * (p.sp - 0.9);
      const y0 = p.y * H - t * (5 + 22 * z) * k * p.sp;
      const sw = W + 2 * r;
      const sh = H + 2 * r;
      const x = ((((x0 + r) % sw) + sw) % sw) - r;
      const y = ((((y0 + r) % sh) + sh) % sh) - r;
      const tw = 0.5 + 0.5 * noise1(t * 2.2 + p.fl, 3);
      ctx.globalAlpha = z > 0.82 ? 0.06 + 0.05 * tw : 0.18 + 0.55 * tw;
      ctx.drawImage(moteImg, x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  function burstAt(t) {
    let b = 0;
    scenes.forEach((s, j) => {
      const st = j === 0 ? 0.2 : s.start;
      if (t >= st) b = Math.max(b, 1 - ease.outCubic(prog(t, st, st + 1.1)));
    });
    return b;
  }

  function dipAt(t) {
    let d = 1 - ease.outCubic(prog(t, 0, 0.55));
    for (let j = 0; j < scenes.length - 1; j++) {
      const e = scenes[j].end;
      d = Math.max(d, t < e ? ease.inQuad(prog(t, e - 0.24, e)) : 1 - ease.outQuad(prog(t, e, e + 0.24)));
    }
    const end = scenes.length ? scenes[scenes.length - 1].end : 0;
    d = Math.max(d, ease.inQuad(prog(t, end - 0.35, end)) * 0.85);
    return d * 0.97;
  }

  function bars(ctx, t, dip) {
    const base = H * (land ? 0.105 : tall ? 0.085 : 0.075);
    const last = scenes[scenes.length - 1];
    let h = base * ease.outCubic(prog(t, 0.08, 1.0));
    if (last && scenes.length > 1) h += H * 0.022 * ease.inOutCubic(prog(t, last.start, last.start + 1.5));
    h += H * 0.01 * dip;
    if (h <= 0.5) return;
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, h);
    ctx.fillRect(0, H - h, W, h);
    const lw = Math.max(1, 1.2 * k);
    ctx.fillStyle = rgba(C.text, 0.07);
    ctx.fillRect(0, h, W, lw);
    ctx.fillRect(0, H - h - lw, W, lw);
  }

  function rules(ctx, x, y, gap, len, col, a) {
    if (a <= 0 || len <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    const lw = Math.max(1, 1.6 * k);
    ctx.fillRect(x - gap - len, y - lw / 2, len, lw);
    ctx.fillRect(x + gap, y - lw / 2, len, lw);
    ctx.restore();
  }

  function titleCard(ctx, t, i) {
    const L = layout(ctx, i);
    if (!L) return;
    const s = scenes[i];
    const lt = t - s.start;
    const slow = clamp(lt / Math.max(0.5, s.end - s.start));
    const out = ease.inQuad(prog(t, s.end - 0.5, s.end - 0.04));
    const fade = 1 - out;
    const n = L.lines.length;
    const top = cy - ((n - 1) * L.lh) / 2 - out * 10 * k;
    const x = W / 2;
    const maxW = W * 0.9;
    if (L.kicker) {
      const ka = ease.outCubic(prog(lt, 0.05, 0.75)) * fade;
      if (ka > 0) {
        const ks = (land ? 30 : 28) * k;
        const kl = measure(ctx, L.kicker, ks, sans, 600);
        const ksp = capSp(kl, (0.5 + 0.25 * (1 - ka)) * ks, W * 0.8);
        const ky = top - L.lh * 0.5 - 40 * k;
        ctx.save();
        ctx.globalAlpha = ka;
        ctx.fillStyle = C.accent;
        tracked(ctx, kl, ks, ksp, x, ky, sans, 600);
        ctx.restore();
        rules(ctx, x, ky, widthOf(kl, ksp) / 2 + 26 * k, 54 * k * ka, C.accent, ka * 0.7);
      }
    }
    L.lines.forEach((line, j) => {
      const d = 0.08 + j * 0.12;
      const e = prog(lt, d, d + 0.75);
      if (e <= 0) return;
      const y = top + j * L.lh + lerp(16 * k, 0, ease.outCubic(e));
      const sp = capSp(line, (TRACK + 0.38 * (1 - ease.outCubic(e)) + 0.05 * slow + 0.14 * out) * L.size, maxW);
      lightText(ctx, line, L.size, x, y, e, sp, fade, out * 14 * k);
      sheen(ctx, line, L.size, sp, x, y, prog(lt, d + 0.7, d + 1.8), 0.55 * fade);
    });
    const ue = ease.outExpo(prog(lt, 0.4, 1.4));
    if (ue > 0 && fade > 0) {
      const widest = Math.max(...L.lines.map((l) => widthOf(l, TRACK * L.size)));
      const uy = top + (n - 1) * L.lh + L.size * 0.82;
      const half = Math.min(widest, maxW) * (0.3 + 0.06 * slow) * ue;
      const a = (0.75 + 0.15 * noise1(t * 7, 5)) * fade;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      blob(ctx, x, uy, half * 1.3, 9 * k, C.accent2, 0.2 * a);
      blob(ctx, x, uy, half, 1.6 * k, C.text, 0.8 * a);
      blob(ctx, x, uy, 24 * k, 24 * k, C.text, 0.3 * a);
      ctx.restore();
    }
    const fe = prog(lt, 0.04, 0.95);
    if (fe > 0 && fe < 1) flare(ctx, lerp(W * 0.1, W * 0.9, ease.inOutSine(fe)), top + ((n - 1) * L.lh) / 2, bump(fe) * fade);
  }

  function outroLayout(ctx) {
    if (outroL) return outroL;
    const handle = String(T.handle || "").trim();
    let hs = (land ? 74 : 80) * k;
    let hl = handle ? measure(ctx, handle, hs) : null;
    while (hl && widthOf(hl, 0.14 * hs) > W * 0.84 && hs > 28 * k) {
      hs -= 2 * k;
      hl = measure(ctx, handle, hs);
    }
    const follow = upper(T.follow || "Takip et");
    let fs = (land ? 40 : 42) * k;
    let fl = measure(ctx, follow, fs);
    while (widthOf(fl, 0.42 * fs) > W * 0.7 && fs > 22 * k) {
      fs -= 2 * k;
      fl = measure(ctx, follow, fs);
    }
    const bill = cards.map((c) => c.title.replace(/\s*\n\s*/g, " ")).filter(Boolean).join("  ·  ");
    const bs = (land ? 30 : 34) * k;
    const sx = 0.56;
    font(ctx, bs, 400, sans);
    const rows = bill ? wrapWords(bill.split(" "), (s) => ctx.measureText(s).width * sx, W * (land ? 0.5 : 0.7)).map((r) => r.replace(/^[·\s]+|[·\s]+$/g, "")).filter(Boolean).slice(0, 3) : [];
    const letter = upper([...handle.replace(/^@/, "").trim()][0] || "@");
    outroL = { hs, hl, fs, fl, bs, sx, rows, mono: measure(ctx, letter, 100) };
    return outroL;
  }

  function outro(ctx, t, s) {
    const O = outroLayout(ctx);
    const lt = t - s.start;
    const slow = clamp(lt / Math.max(0.5, s.end - s.start));
    const out = ease.inQuad(prog(t, s.end - 0.45, s.end - 0.02));
    const fade = 1 - out;
    const x = W / 2;
    const box = (land ? 170 : 200) * k;
    const oy = H * (land ? 0.31 : tall ? 0.3 : 0.29);
    const ea = prog(lt, 0.05, 0.8);
    if (logo) {
      const r = Math.min(box / logo.naturalWidth, box / logo.naturalHeight);
      const w = logo.naturalWidth * r;
      const h = logo.naturalHeight * r;
      const ga = bump(ea) * 0.75 * fade;
      if (ga > 0.005) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.filter = `blur(${lerp(26, 8, ea) * k}px)`;
        ctx.globalAlpha = ga;
        ctx.drawImage(logo, x - w / 2, oy - h / 2, w, h);
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha = ease.inOutSine(prog(ea, 0.15, 0.8)) * fade;
      ctx.drawImage(logo, x - w / 2, oy - h / 2 + lerp(10 * k, 0, ease.outCubic(ea)), w, h);
      ctx.restore();
    } else {
      const ms = box * 0.62;
      const mono = { text: O.mono.text, w0: (O.mono.w0 * ms) / 100, n: 1 };
      lightText(ctx, mono, ms, x, oy + ms * 0.04, ea, 0, fade, out * 10 * k);
      const he = ease.outExpo(prog(lt, 0.25, 1.0));
      if (he > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const hw = box * (0.5 + 0.05 * slow) * he;
        blob(ctx, x, oy - box * 0.5, hw, 1.4 * k, C.text, 0.7 * fade);
        blob(ctx, x, oy + box * 0.5, hw, 1.4 * k, C.text, 0.7 * fade);
        ctx.restore();
      }
    }
    const hy = oy + box * 0.5 + 105 * k;
    if (O.hl) {
      const he = prog(lt, 0.25, 1.05);
      const sp = capSp(O.hl, (0.14 + 0.3 * (1 - ease.outCubic(he)) + 0.03 * slow + 0.1 * out) * O.hs, W * 0.9);
      const y = hy + lerp(14 * k, 0, ease.outCubic(he));
      lightText(ctx, O.hl, O.hs, x, y, he, sp, fade, out * 12 * k);
      sheen(ctx, O.hl, O.hs, sp, x, y, prog(lt, 1.0, 2.2), 0.5 * fade);
      const fe = prog(lt, 0.2, 1.15);
      if (fe > 0 && fe < 1) flare(ctx, lerp(W * 0.12, W * 0.88, ease.inOutSine(fe)), hy, bump(fe) * 0.85 * fade);
    }
    const fy = hy + (O.hl ? 96 : 0) * k;
    const fa = ease.outCubic(prog(lt, 0.55, 1.2));
    if (fa > 0) {
      const sp = capSp(O.fl, (0.42 + 0.3 * (1 - fa) + 0.04 * slow) * O.fs, W * 0.86);
      lightText(ctx, O.fl, O.fs, x, fy, prog(lt, 0.55, 1.3), sp, fade, out * 10 * k, C.accent, 0.5);
      rules(ctx, x, fy, widthOf(O.fl, sp) / 2 + 30 * k, 70 * k * fa, C.accent, 0.75 * fa * fade);
    }
    const ba = ease.outCubic(prog(lt, 0.8, 1.45)) * fade;
    if (ba > 0 && O.rows.length) {
      const by = fy + 74 * k;
      ctx.save();
      ctx.globalAlpha = ba * 0.85;
      ctx.fillStyle = C.muted;
      font(ctx, O.bs, 400, sans, "normal", `${0.6 * k}px`);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      O.rows.forEach((row, j) => {
        ctx.save();
        ctx.translate(x, by + j * O.bs * 1.08 + lerp(8 * k, 0, ba));
        ctx.scale(O.sx, 1);
        ctx.fillText(row, 0, 0);
        ctx.restore();
      });
      ctx.restore();
    }
  }

  return {
    renderWorld(ctx, t, S) {
      backdrop(ctx);
      const i = sceneAt(t);
      const burst = burstAt(t);
      const dip = dipAt(t);
      const s = scenes[i];
      const z = s ? 1 + 0.055 * ease.inOutSine(prog(t, s.start, s.end)) : 1;
      ctx.save();
      ctx.translate(W / 2 + noise1(t * 5, 91) * 1.2 * k, cy + noise1(t * 5, 93) * 1.2 * k);
      ctx.scale(z, z);
      ctx.translate(-W / 2, -cy);
      beams(ctx, t);
      leaks(ctx, t, burst);
      if (i >= 0 && i < count) titleCard(ctx, t, i);
      else if (i >= 0 && i === scenes.length - 1) outro(ctx, t, s);
      motes(ctx, t);
      ctx.restore();
      const flick = 0.03 * (0.5 + 0.5 * noise1(t * 14, 71));
      ctx.fillStyle = shade;
      ctx.globalAlpha = clamp(Math.max(dip, flick));
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      vignette(S, 0.6, vigRgb);
      bars(ctx, t, dip);
      ctx.save();
      ctx.globalAlpha = 0.6;
      tile(ctx, A.grain, W, H, (S.frame * 37) % 256, (S.frame * 53) % 256);
      ctx.restore();
      const f = S.frame;
      if (hash(f, 3) % 100 < 28) {
        ctx.fillStyle = rgba(C.text, 0.04 + (hash(f, 7) % 80) / 1000);
        ctx.fillRect(((hash(f, 5) % 10000) / 10000) * W, 0, Math.max(1, 1.4 * k), H);
      }
    },
  };
}
