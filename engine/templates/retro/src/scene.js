import { TAU, clamp, lerp, prog, ease, mix, rgba, hash, rng, smooth, makeCanvas } from "../../_engine/core/util.js";
import { font, vignette } from "../../_engine/core/overlay.js";
import { tile } from "../../_engine/core/assets.js";
import { glow } from "../../_engine/core/kit.js";

const rnd = (...n) => hash(...n) / 4294967296;
const bump = (k) => Math.sin(Math.PI * clamp(k));

function parseCard(text) {
  const out = [];
  let hot = false;
  let cur = "";
  let curHot = false;
  const push = () => {
    if (cur) out.push({ text: cur.toLocaleUpperCase("tr-TR"), hot: curHot });
    cur = "";
    curHot = false;
  };
  for (const ch of String(text ?? "")) {
    if (ch === "*") {
      hot = !hot;
      continue;
    }
    if (/\s/.test(ch)) {
      push();
      continue;
    }
    if (hot) curHot = true;
    cur += ch;
  }
  push();
  return out;
}

function wrapWords(ctx, words, maxW) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    const next = [...cur, w];
    if (cur.length && ctx.measureText(next.map((x) => x.text).join(" ")).width > maxW) {
      lines.push(cur);
      cur = [w];
    } else cur = next;
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function fitWords(ctx, words, maxW, maxLines, size, minSize, family) {
  for (let s = size; s > minSize; s -= 3) {
    font(ctx, s, 900, family);
    const room = maxW - s * 0.3;
    const lines = wrapWords(ctx, words, room);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l.map((x) => x.text).join(" ")).width <= room)) return { size: s, lines };
  }
  font(ctx, minSize, 900, family);
  return { size: minSize, lines: wrapWords(ctx, words, maxW - minSize * 0.3) };
}

function makeRidge(seed) {
  const R = rng(seed);
  const pts = [];
  let x = 0;
  let up = true;
  while (x < 1) {
    pts.push([x, up ? 0.5 + R() * 0.5 : 0.12 + R() * 0.3]);
    x += 0.022 + R() * 0.03;
    up = !up;
  }
  return pts;
}

export default async function makeScene({ cfg, tl, W, H, A, images }) {
  const C = cfg.colors;
  const T = cfg.text || {};
  const scenes = tl.scenes;
  const count = Math.max(0, scenes.length - 1);
  const family = cfg.fonts?.[0] || "Arial Black";
  const mono = cfg.fonts?.[1] || "Consolas";
  const seed = cfg.video?.seed ?? 7;
  const k = Math.min(1, W / 1080, H / 1300);
  const k0 = Math.min(W, H) / 1080;
  const aspect = H / W;
  const tall = aspect > 1.5;
  const hy = H * (tall ? 0.6 : 0.64);
  const depth = H - hy;
  const sunR = Math.min(W * 0.36, H * 0.22);
  const sunCy = hy - sunR * 0.12;
  const mH = Math.min(W, H) * 0.18;
  const textCy = H * 0.34;
  const maxLines = aspect > 1.1 ? 3 : 2;
  const maxW = W * (tall ? 0.86 : 0.8);
  const hudY = H * (tall ? 0.125 : 0.075);
  const cell = Math.min(W, H) * 0.14;
  const ridgePeriod = Math.max(W, H) * 1.6;
  const far = makeRidge(seed + 3);
  const near = makeRidge(seed + 9);
  const logoImg = images?.ref1 && images.ref1.naturalWidth ? images.ref1 : null;
  const pad2 = (n) => String(n).padStart(2, "0");
  const cardWords = scenes.map((_, i) => parseCard(T.cards?.[i]));
  const layouts = [];
  const end = tl.duration ?? scenes[scenes.length - 1]?.end ?? 0;

  const stars = [];
  {
    const R = rng(seed + 41);
    for (let i = 0; i < 110; i++) stars.push({ x: R() * W, y: Math.pow(R(), 1.3) * hy * 0.9, s: 1.5 + R() * 2.5, ph: R() * TAU, sp: 1 + R() * 3 });
  }

  const snow = makeCanvas(256, 48);
  {
    const g = snow.getContext("2d");
    const img = g.createImageData(256, 48);
    const R = rng(seed + 57);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(R() * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.floor(R() * 200);
    }
    g.putImageData(img, 0, 0);
  }

  function makeSun(R, from, to, stripes, gap) {
    let cv = null;
    let qq = 0;
    return (ctx, x, y, t, q) => {
      if (!cv || qq !== q) {
        qq = q;
        cv = makeCanvas(Math.ceil(2 * R * q) + 4, Math.ceil(2 * R * q) + 4);
      }
      const s = cv.getContext("2d");
      const n = cv.width;
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.clearRect(0, 0, n, n);
      s.setTransform(q, 0, 0, q, n / 2, n / 2);
      const g = s.createLinearGradient(0, -R, 0, R);
      g.addColorStop(0, mix(C.accent, C.text, 0.35));
      g.addColorStop(0.45, C.accent);
      g.addColorStop(1, C.accent2);
      s.fillStyle = g;
      s.beginPath();
      s.arc(0, 0, R, 0, TAU);
      s.fill();
      s.globalCompositeOperation = "destination-out";
      const lines = stripes;
      const ph = (t * 0.32) % 1;
      for (let i = 0; i < lines; i++) {
        const p = (i + ph) / lines;
        const yy = lerp(R * from, R * to, p);
        const hh = lerp(0.006, gap, p) * R;
        s.fillRect(-R, yy - hh / 2, 2 * R, hh);
      }
      s.globalCompositeOperation = "source-over";
      const hw = n / q / 2;
      ctx.drawImage(cv, x - hw, y - hw, hw * 2, hw * 2);
    };
  }
  const bigSun = makeSun(sunR, -0.55, 0.16, 7, 0.085);
  const emblemR = (tall ? 150 : 125) * k;
  const miniSun = makeSun(emblemR, -0.04, 1, 8, 0.13);
  const outroStart = scenes.length > 1 ? scenes[scenes.length - 1].start : Infinity;

  function glitch(t) {
    let trans = 0;
    for (let i = 1; i < scenes.length; i++) {
      const d = t - scenes[i].start;
      if (d > -0.2 && d < 0.28) trans = Math.max(trans, d < 0 ? smooth(1 + d / 0.2) : smooth(1 - d / 0.28));
    }
    let g = trans;
    if (t < 0.4) g = Math.max(g, 0.7 * (1 - t / 0.4));
    const slot = Math.floor(t / 1.9);
    if (rnd(slot, 91) < 0.6) {
      const at = slot * 1.9 + 0.3 + rnd(slot, 92) * 1.2;
      const d = t - at;
      if (d >= 0 && d < 0.13) g = Math.max(g, 0.3 + 0.25 * rnd(slot, 93));
    }
    return { g: clamp(g), trans };
  }

  function sceneAt(t) {
    let i = scenes.findIndex((s) => t >= s.start && t < s.end);
    if (i < 0 && scenes.length && t >= scenes[scenes.length - 1].end) i = scenes.length - 1;
    return i;
  }

  function sky(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, 0, hy);
    g.addColorStop(0, C.bg);
    g.addColorStop(0.5, C.bg2);
    g.addColorStop(1, mix(C.bg2, C.accent2, 0.5));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, hy + 2);
    ctx.fillStyle = C.text;
    for (const s of stars) {
      const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
      ctx.globalAlpha = a * clamp(1.2 - s.y / (hy * 0.9));
      const z = s.s * k0;
      ctx.fillRect(s.x - z / 2, s.y - z / 2, z, z);
    }
    ctx.globalAlpha = 1;
    glow(ctx, W / 2, hy, Math.max(W, H) * 0.6, C.accent2, 0.25);
  }

  function ridge(ctx, pts, off, mh, fillTop, fillBot, rim, rimW) {
    const xs = [];
    const o = ((off % ridgePeriod) + ridgePeriod) % ridgePeriod;
    for (let rep = -1; rep < Math.ceil(W / ridgePeriod) + 2; rep++) {
      for (const p of pts) {
        const sx = p[0] * ridgePeriod + rep * ridgePeriod - o;
        if (sx < -ridgePeriod * 0.08 || sx > W + ridgePeriod * 0.08) continue;
        const env = lerp(0.14, 1, smooth(clamp((Math.abs(sx - W / 2) - sunR * 0.35) / (sunR * 1.3))));
        xs.push([sx, hy - p[1] * mh * env]);
      }
    }
    if (!xs.length) return;
    const g = ctx.createLinearGradient(0, hy - mh, 0, hy);
    g.addColorStop(0, fillTop);
    g.addColorStop(1, fillBot);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(xs[0][0], hy + 2);
    for (const p of xs) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(xs[xs.length - 1][0], hy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rim;
    ctx.lineWidth = rimW;
    ctx.lineJoin = "round";
    ctx.beginPath();
    xs.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
  }

  function floor(ctx, t) {
    const g = ctx.createLinearGradient(0, hy, 0, H);
    g.addColorStop(0, mix(C.bg2, C.accent2, 0.3));
    g.addColorStop(0.3, mix(C.bg, C.bg2, 0.55));
    g.addColorStop(1, C.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, hy, W, depth);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, hy, W, depth);
    ctx.clip();
    const ph = (t * 1.1) % 1;
    const a0 = 4;
    const rows = [];
    for (let i = 0; i < 80; i++) {
      const y = hy + (depth * a0) / (a0 + i - ph);
      if (y - hy < 2.5 * k0) break;
      rows.push(y);
    }
    const N = Math.ceil(W / 2 / cell) + 2;
    ctx.lineCap = "round";
    for (const [lw, al] of [[8, 0.16], [2.6, 0.95]]) {
      ctx.strokeStyle = rgba(C.accent2, al);
      ctx.lineWidth = lw * k0 * 0.8;
      ctx.beginPath();
      for (let j = -N; j <= N; j++) {
        ctx.moveTo(W / 2, hy);
        ctx.lineTo(W / 2 + j * cell * 1.15, H);
      }
      ctx.stroke();
      for (const y of rows) {
        const near = (y - hy) / depth;
        ctx.lineWidth = lw * k0 * lerp(0.35, 1.1, near);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
    }
    const fg = ctx.createLinearGradient(0, hy, 0, hy + depth * 0.5);
    fg.addColorStop(0, rgba(mix(C.bg2, C.accent2, 0.35), 0.95));
    fg.addColorStop(0.4, rgba(mix(C.bg2, C.bg, 0.3), 0.45));
    fg.addColorStop(1, rgba(C.bg, 0));
    ctx.fillStyle = fg;
    ctx.fillRect(0, hy, W, depth * 0.5);
    ctx.restore();
    ctx.save();
    ctx.scale(1, 0.12);
    glow(ctx, W / 2, hy / 0.12, W * 0.7, C.accent2, 0.55);
    ctx.restore();
    ctx.fillStyle = mix(C.accent2, C.text, 0.45);
    ctx.fillRect(0, hy - 1.5 * k0, W, 3 * k0);
  }

  function background(ctx, t, q) {
    sky(ctx, t);
    const sink = ease.inOutCubic(prog(t, outroStart - 0.1, outroStart + 1.3));
    const sy = sunCy + sink * sunR * 0.8;
    glow(ctx, W / 2, sy, sunR * 2.1, C.accent2, lerp(0.5, 0.3, sink));
    glow(ctx, W / 2, sy, sunR * 1.45, C.accent, lerp(0.28, 0.12, sink));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, hy);
    ctx.clip();
    bigSun(ctx, W / 2, sy, t, q);
    ctx.restore();
    ridge(ctx, far, t * 9 * k0, mH, mix(C.bg2, C.accent2, 0.22), mix(C.bg2, C.bg, 0.4), rgba(C.accent2, 0.45), 2 * k0);
    ridge(ctx, near, t * 22 * k0 + ridgePeriod * 0.37, mH * 0.62, mix(C.bg, C.bg2, 0.7), C.bg, rgba(mix(C.accent2, C.text, 0.35), 0.9), 2.6 * k0);
    floor(ctx, t);
  }

  function chrome(ctx, top, bot) {
    const g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, mix(C.muted, C.text, 0.35));
    g.addColorStop(0.46, C.text);
    g.addColorStop(0.5, mix(C.bg2, C.bg, 0.3));
    g.addColorStop(0.6, mix(C.accent2, C.bg2, 0.45));
    g.addColorStop(0.86, C.accent);
    g.addColorStop(1, mix(C.accent, C.text, 0.55));
    return g;
  }

  function sunset(ctx, top, bot) {
    const g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, mix(C.accent2, C.text, 0.25));
    g.addColorStop(0.45, C.accent2);
    g.addColorStop(0.55, mix(C.accent2, C.accent, 0.5));
    g.addColorStop(1, C.accent);
    return g;
  }

  function drawLine(ctx, line, size, o) {
    font(ctx, size, 900, family);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const space = ctx.measureText(" ").width;
    const widths = line.map((w) => ctx.measureText(w.text).width);
    const total = widths.reduce((a, b) => a + b, 0) + space * (line.length - 1);
    const xs = [];
    let x = -total / 2;
    for (const w of widths) {
      xs.push(x);
      x += w + space;
    }
    const cap = ctx.measureText("H");
    const top = -cap.actualBoundingBoxAscent;
    const bot = cap.actualBoundingBoxDescent;
    const each = (fn) => line.forEach((w, i) => fn(w.text, xs[i], w));
    const steps = 7;
    const st = size * 0.017;
    ctx.save();
    ctx.shadowColor = rgba(C.accent2, 0.9);
    ctx.shadowBlur = size * 0.4 * o.q;
    ctx.fillStyle = mix(C.accent2, C.bg, 0.7);
    each((s, px) => ctx.fillText(s, px + st * steps * 0.5, st * steps));
    ctx.restore();
    for (let d = steps - 1; d >= 1; d--) {
      ctx.fillStyle = mix(C.accent2, C.bg, lerp(0.2, 0.7, d / steps));
      each((s, px) => ctx.fillText(s, px + st * d * 0.5, st * d));
    }
    ctx.lineJoin = "round";
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = size * 0.075;
    each((s, px) => ctx.strokeText(s, px, 0));
    if (o.chroma > 0.4) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha *= 0.85;
      ctx.fillStyle = C.accent2;
      each((s, px) => ctx.fillText(s, px - o.chroma, 0));
      ctx.fillStyle = C.muted;
      each((s, px) => ctx.fillText(s, px + o.chroma, 0));
      ctx.restore();
    }
    const gc = chrome(ctx, top, bot);
    const gs = sunset(ctx, top, bot);
    each((s, px, w) => {
      ctx.fillStyle = w.hot ? gs : gc;
      ctx.fillText(s, px, 0);
    });
    ctx.strokeStyle = rgba(C.text, 0.35);
    ctx.lineWidth = Math.max(1, size * 0.012);
    each((s, px) => ctx.strokeText(s, px, 0));
    if (o.glint > 0 && o.glint < 1) {
      const gx = lerp(-total / 2 - size, total / 2 + size, o.glint);
      const g = ctx.createLinearGradient(gx - size * 0.45, top, gx + size * 0.45, bot);
      g.addColorStop(0, rgba(C.text, 0));
      g.addColorStop(0.42, rgba(C.text, 0));
      g.addColorStop(0.5, rgba(C.text, 0.95));
      g.addColorStop(0.58, rgba(C.text, 0));
      g.addColorStop(1, rgba(C.text, 0));
      ctx.fillStyle = g;
      each((s, px) => ctx.fillText(s, px, 0));
    }
    return { total, top, bot };
  }

  function sparkle(ctx, x, y, r, a) {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha *= clamp(a);
    glow(ctx, x, y, r * 1.1, C.text, 0.7);
    ctx.fillStyle = C.text;
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x, y - r * 0.08);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r * 0.08);
    ctx.closePath();
    ctx.moveTo(x, y - r * 0.75);
    ctx.lineTo(x + r * 0.07, y);
    ctx.lineTo(x, y + r * 0.75);
    ctx.lineTo(x - r * 0.07, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function crtLine(ctx, cx, cy, w, a) {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp(a);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.08);
    glow(ctx, 0, 0, w * 0.6, C.muted, 0.8);
    ctx.restore();
    ctx.fillStyle = C.text;
    ctx.fillRect(cx - w / 2, cy - 2.5 * k, w, 5 * k);
    ctx.restore();
  }

  function layoutFor(ctx, i) {
    if (!layouts[i]) layouts[i] = fitWords(ctx, cardWords[i], maxW, maxLines, 128 * k, 56 * k, family);
    return layouts[i];
  }

  function card(ctx, t, i, s, gl, q) {
    const words = cardWords[i];
    if (!words.length) return;
    const L = layoutFor(ctx, i);
    const lh = L.size * 1.13;
    const n = L.lines.length;
    const top = textCy - ((n - 1) * lh) / 2;
    const out = ease.inCubic(prog(t, s.end - 0.34, s.end - 0.04));
    if (out >= 1) return;
    ctx.save();
    ctx.translate(W / 2, textCy);
    ctx.scale(lerp(1, 1.22, out), lerp(1, 0.02, out));
    ctx.translate(-W / 2, -textCy);
    const life = t - s.start;

    const kick = `${pad2(i + 1)} / ${pad2(count)}`;
    const typed = Math.floor(clamp(prog(t, s.start + 0.12, s.start + 0.5)) * kick.length);
    const ky = top - lh / 2 - 62 * k;
    if (typed > 0) {
      const shown = kick.slice(0, typed);
      font(ctx, 38 * k, 700, mono, "normal", `${6 * k}px`);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fw = ctx.measureText(kick).width;
      const sw = ctx.measureText(shown).width;
      const x0 = W / 2 - fw / 2;
      ctx.fillStyle = rgba(C.bg, 0.6);
      ctx.textAlign = "left";
      ctx.fillText(shown, x0 + 3 * k, ky + 3 * k);
      ctx.fillStyle = C.muted;
      ctx.fillText(shown, x0, ky);
      if (typed < kick.length || Math.floor(life * 3) % 2 === 0) {
        ctx.fillStyle = C.muted;
        ctx.fillRect(x0 + sw + 4 * k, ky - 17 * k, 18 * k, 34 * k);
      }
      const lw = ease.outCubic(prog(t, s.start + 0.3, s.start + 0.8)) * 70 * k;
      ctx.fillStyle = C.accent2;
      ctx.fillRect(W / 2 - fw / 2 - 28 * k - lw, ky - 2 * k, lw, 4 * k);
      ctx.fillRect(W / 2 + fw / 2 + 28 * k + 16 * k, ky - 2 * k, lw, 4 * k);
    }

    let firstLine = null;
    L.lines.forEach((line, j) => {
      const a = ease.outExpo(prog(t, s.start + 0.05 + j * 0.1, s.start + 0.9 + j * 0.1));
      if (a <= 0) return;
      const y = lerp(sunCy, top + j * lh, a) + Math.sin(t * 1.6 + j * 0.9) * 5 * k;
      const sc = lerp(0.06, 1, a) * (1 + Math.sin(t * 1.1 + j) * 0.006);
      const gp = ((life - 1.0 - j * 0.07) % 2.6) / 0.75;
      ctx.save();
      ctx.globalAlpha = clamp(a * 2.5);
      ctx.translate(W / 2, y);
      ctx.scale(sc, sc);
      ctx.transform(1, 0, -0.17, 1, 0, 0);
      const m = drawLine(ctx, line, L.size, { q, chroma: (1 - a) * 30 * k + gl.g * 14 * k, glint: life > 1.0 ? gp : -1 });
      if (j === 0) firstLine = { m, gp, sc };
      if (j === 0 && life > 1.0) sparkle(ctx, m.total / 2 - L.size * 0.15, m.top, L.size * 0.45, bump((gp - 0.7) / 0.6));
      ctx.restore();
    });

    const grow = ease.outExpo(prog(t, s.start + 0.45, s.start + 1.15));
    if (grow > 0) {
      const by = top + (n - 1) * lh + lh / 2 + 34 * k;
      const bw = 380 * k * grow;
      const bars = [[0, 11, C.accent], [19, 7, mix(C.accent, C.accent2, 0.5)], [33, 4, C.accent2]];
      for (const [off, th, col] of bars) {
        const bx = W / 2 - bw / 2 + Math.sin(t * 2 + off) * 3 * k;
        ctx.fillStyle = rgba(C.bg, 0.85);
        ctx.fillRect(bx - 3 * k, by + off * k - 3 * k, bw + 6 * k, (th + 6) * k);
        ctx.fillStyle = col;
        ctx.fillRect(bx, by + off * k, bw, th * k);
      }
    }
    ctx.restore();
    crtLine(ctx, W / 2, textCy, W * lerp(0.9, 0.5, out), bump(out * 0.98) * 1.2);
  }

  function drawLogo(ctx, img, box) {
    const r = Math.min(box / img.naturalWidth, box / img.naturalHeight);
    const w = img.naturalWidth * r;
    const h = img.naturalHeight * r;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  }

  function outro(ctx, t, s, gl, q) {
    const life = t - s.start;
    const ey = H * (tall ? 0.31 : 0.27);
    const r = emblemR;
    const a = ease.outExpo(prog(t, s.start + 0.08, s.start + 1.0));
    if (a > 0) {
      const y = lerp(sunCy, ey, a) + Math.sin(life * 1.8) * 6 * k;
      const sc = lerp(0.12, 1, a);
      ctx.save();
      ctx.globalAlpha = clamp(a * 2.2);
      ctx.translate(W / 2, y);
      ctx.scale(sc, sc);
      glow(ctx, 0, 0, r * 2.3, C.accent2, 0.45);
      ctx.save();
      ctx.rotate(life * 0.6);
      ctx.setLineDash([22 * k, 14 * k]);
      ctx.strokeStyle = rgba(C.muted, 0.8);
      ctx.lineWidth = 4 * k;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.2, 0, TAU);
      ctx.stroke();
      ctx.restore();
      if (logoImg) {
        drawLogo(ctx, logoImg, r * 2.1);
      } else {
        miniSun(ctx, 0, 0, t, q);
        const ini = (T.handle || "@").replace("@", "").slice(0, 1).toLocaleUpperCase("tr-TR") || "@";
        ctx.save();
        ctx.translate(0, -r * 0.1);
        ctx.transform(1, 0, -0.17, 1, 0, 0);
        drawLine(ctx, [{ text: ini, hot: false }], r * 1.05, { q, chroma: gl.g * 12 * k, glint: ((life - 1.2) % 2.4) / 0.7 });
        ctx.restore();
      }
      ctx.restore();
    }

    const hy2 = ey + r + 100 * k;
    const ho = ease.outCubic(prog(t, s.start + 0.45, s.start + 0.8));
    if (ho > 0 && T.handle) {
      const hw = [{ text: T.handle, hot: false }];
      if (!layouts.handle) layouts.handle = fitWords(ctx, hw, W * 0.86, 1, 92 * k, 36 * k, family);
      ctx.save();
      ctx.translate(W / 2, hy2);
      ctx.scale(lerp(1.3, 1, ho), lerp(0.02, 1, ho));
      ctx.transform(1, 0, -0.17, 1, 0, 0);
      const gp = ((life - 1.4) % 2.4) / 0.75;
      const m = drawLine(ctx, hw, layouts.handle.size, { q, chroma: gl.g * 12 * k, glint: life > 1.4 ? gp : -1 });
      sparkle(ctx, m.total / 2 - layouts.handle.size * 0.1, m.top, layouts.handle.size * 0.5, life > 1.4 ? bump((gp - 0.7) / 0.6) : 0);
      ctx.restore();
      crtLine(ctx, W / 2, hy2, W * 0.8, bump(ho) * (1 - ho) * 2);
    }

    const fo = ease.outExpo(prog(t, s.start + 0.75, s.start + 1.15));
    if (fo > 0) {
      const text = (T.follow || "Takip et").toLocaleUpperCase("tr-TR");
      const fs = 44 * k;
      font(ctx, fs, 700, mono, "normal", `${5 * k}px`);
      const tw = ctx.measureText(text).width;
      const bw = tw + 150 * k;
      const bh = 96 * k;
      const fy = hy2 + 130 * k;
      ctx.save();
      ctx.translate(W / 2, fy);
      ctx.scale(fo, 1);
      ctx.fillStyle = rgba(C.bg, 0.72);
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx.shadowColor = rgba(C.accent2, 0.9);
      ctx.shadowBlur = (18 + Math.sin(life * 4) * 6) * k * q;
      ctx.strokeStyle = C.accent2;
      ctx.lineWidth = 4 * k;
      ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
      ctx.restore();
      const typed = Math.floor(prog(t, s.start + 0.95, s.start + 1.35) * text.length);
      if (typed > 0) {
        font(ctx, fs, 700, mono, "normal", `${5 * k}px`);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const x0 = W / 2 - tw / 2 + 26 * k;
        ctx.fillStyle = C.text;
        ctx.fillText(text.slice(0, typed), x0, fy + 2 * k);
        {
          const tx = W / 2 - bw / 2 + 36 * k + Math.max(0, Math.sin(life * 6)) * 6 * k;
          ctx.fillStyle = C.accent;
          ctx.beginPath();
          ctx.moveTo(tx, fy - 18 * k);
          ctx.lineTo(tx + 28 * k, fy);
          ctx.lineTo(tx, fy + 18 * k);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  let tmp = null;
  let scan = null;

  function buffer(cv) {
    if (!tmp || tmp.width !== cv.width || tmp.height !== cv.height) tmp = makeCanvas(cv.width, cv.height);
    const tc = tmp.getContext("2d");
    tc.globalCompositeOperation = "source-over";
    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.clearRect(0, 0, tmp.width, tmp.height);
    tc.drawImage(cv, 0, 0);
    return tc;
  }

  function vhs(c, t, S, gl) {
    const cv = c.canvas;
    const Wp = cv.width;
    const Hp = cv.height;
    const g = gl.g;
    let tc = buffer(cv);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    const hs = Math.round(Hp * 0.02);
    const hx = Math.round(Wp * (0.025 + 0.01 * Math.sin(t * 7)));
    c.drawImage(tmp, 0, Hp - hs, Wp, hs, hx, Hp - hs, Wp, hs);
    c.drawImage(tmp, 0, Hp - hs, Wp, hs, hx - Wp, Hp - hs, Wp, hs);
    if (g > 0.02) {
      const sd = Math.floor(t * 24);
      const n = 2 + Math.floor(g * 7);
      for (let i = 0; i < n; i++) {
        const y = Math.floor(rnd(sd, i, 1) * Hp);
        const h = Math.max(2, Math.floor((0.004 + rnd(sd, i, 2) * 0.06 * g) * Hp));
        const dx = Math.round((rnd(sd, i, 3) - 0.5) * 2 * g * 0.1 * Wp);
        c.drawImage(tmp, 0, y, Wp, h, dx, y, Wp, h);
        c.drawImage(tmp, 0, y, Wp, h, dx + (dx > 0 ? -Wp : Wp), y, Wp, h);
      }
    }
    const d = Math.round((1.6 + g * 18) * k0 * S.q);
    if (d >= 1) {
      tc = buffer(cv);
      tc.globalCompositeOperation = "multiply";
      tc.fillStyle = "#FF0000";
      tc.fillRect(0, 0, Wp, Hp);
      tc.globalCompositeOperation = "source-over";
      c.globalCompositeOperation = "multiply";
      c.fillStyle = "#00FFFF";
      c.fillRect(0, 0, Wp, Hp);
      c.globalCompositeOperation = "lighter";
      c.drawImage(tmp, d, 0);
      c.drawImage(tmp, 0, 0, d, Hp, 0, 0, d, Hp);
      c.globalCompositeOperation = "source-over";
    }
    c.restore();
  }

  function tape(c, t, S, gl) {
    const f = S.frame;
    const g = gl.g;
    c.save();
    const n = 2 + Math.floor(g * 16);
    for (let i = 0; i < n; i++) {
      if (rnd(f, i, 7) > 0.3 + g) continue;
      const y = rnd(f, i, 8) * H;
      const w = (0.04 + rnd(f, i, 10) * 0.45) * W;
      const x = rnd(f, i, 9) * W - w / 2;
      c.fillStyle = rgba(C.text, 0.1 + 0.3 * rnd(f, i, 11));
      c.fillRect(x, y, w, (1 + rnd(f, i, 12) * 2) * k0);
    }
    if (g > 0.2) {
      const by = (((t * 0.9) % 1) * 1.2 - 0.1) * H;
      const bh = H * (0.025 + 0.05 * g);
      c.globalAlpha = clamp(g * 1.1);
      c.imageSmoothingEnabled = false;
      c.drawImage(snow, (f * 37) % 128, 0, 128, 48, 0, by, W, bh);
      c.imageSmoothingEnabled = true;
      c.globalAlpha = 1;
    }
    const hs = H * 0.02;
    c.globalAlpha = 0.7;
    c.drawImage(snow, (f * 53) % 128, (f * 7) % 24, 128, 24, 0, H - hs, W, hs);
    c.globalAlpha = 1;
    const rb = (((t * 0.11) % 1.4) - 0.2) * H;
    const rg = c.createLinearGradient(0, rb, 0, rb + H * 0.16);
    rg.addColorStop(0, rgba(C.text, 0));
    rg.addColorStop(0.5, rgba(C.text, 0.05));
    rg.addColorStop(1, rgba(C.text, 0));
    c.fillStyle = rg;
    c.fillRect(0, rb, W, H * 0.16);
    c.restore();
  }

  function scanlines(c, S) {
    if (!scan || scan.ctx !== c || scan.q !== S.q) {
      const p = Math.max(2, Math.round(6 * k0 * S.q));
      const pc = makeCanvas(1, p);
      const g = pc.getContext("2d");
      g.fillStyle = "rgba(0,0,0,0.26)";
      g.fillRect(0, 0, 1, Math.max(1, Math.round(p * 0.45)));
      scan = { ctx: c, q: S.q, pat: c.createPattern(pc, "repeat") };
    }
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = scan.pat;
    c.fillRect(0, 0, c.canvas.width, c.canvas.height);
    c.restore();
  }

  function osdText(ctx, text, x, y, col) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(text, x + 3 * k, y + 3 * k);
    ctx.fillStyle = col;
    ctx.fillText(text, x, y);
  }

  function tri(ctx, x, y, h, col) {
    for (const [dx, c] of [[3 * k, "rgba(0,0,0,0.55)"], [0, col]]) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x + dx, y - h / 2 + dx);
      ctx.lineTo(x + dx + h * 0.85, y + dx);
      ctx.lineTo(x + dx, y + h / 2 + dx);
      ctx.closePath();
      ctx.fill();
    }
  }

  function hud(ctx, t, S, gl) {
    const size = (tall ? 40 : 34) * k;
    const fade = ease.outCubic(prog(t, 0.1, 0.45));
    if (fade <= 0) return;
    const ff = gl.trans > 0.3;
    const jx = gl.g > 0.1 ? (rnd(S.frame, 3) - 0.5) * 16 * k * gl.g : 0;
    const x0 = W * 0.07 + jx;
    const x1 = W * 0.93 + jx;
    ctx.save();
    ctx.globalAlpha = fade * (0.88 + 0.12 * Math.sin(t * 37));
    font(ctx, size, 700, mono, "normal", `${3 * k}px`);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const word = ff ? "FF" : "PLAY";
    osdText(ctx, word, x0, hudY, C.text);
    const tw = ctx.measureText(word).width;
    const th = size * 0.72;
    const blink = t > 1.2 || Math.floor(t * 4) % 2 === 0;
    if (blink) {
      tri(ctx, x0 + tw + size * 0.35, hudY, th, C.text);
      if (ff) tri(ctx, x0 + tw + size * 0.35 + th * 0.8, hudY, th, C.text);
    }
    const sec = Math.floor(t);
    const tc = `${Math.floor(sec / 3600)}:${pad2(Math.floor(sec / 60) % 60)}:${pad2(sec % 60)}`;
    ctx.textAlign = "right";
    osdText(ctx, tc, x1, hudY, C.text);
    const cw = ctx.measureText(tc).width;
    font(ctx, size * 0.8, 700, mono, "normal", `${2 * k}px`);
    osdText(ctx, "SP", x1 - cw - size * 0.6, hudY, C.muted);
    ctx.restore();
  }

  function powerOff(ctx, t) {
    const e = prog(t, end - 0.45, end - 0.03);
    if (e <= 0) return;
    const cv = ctx.canvas;
    const Wp = cv.width;
    const Hp = cv.height;
    buffer(cv);
    const e1 = ease.inCubic(clamp(e / 0.6));
    const e2 = ease.inCubic(clamp((e - 0.6) / 0.4));
    const sy = lerp(1, 0.005, e1);
    const sx = lerp(1, 0.004, e2);
    const w = Wp * sx;
    const h = Math.max(2, Hp * sy);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, Wp, Hp);
    ctx.fillStyle = "#000000";
    ctx.globalAlpha = e1;
    ctx.fillRect(0, 0, Wp, Hp);
    ctx.globalAlpha = 1;
    ctx.drawImage(tmp, Wp / 2 - w / 2, Hp / 2 - h / 2, w, h);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = e1 * 0.85;
    ctx.fillStyle = C.text;
    ctx.fillRect(Wp / 2 - w / 2, Hp / 2 - h / 2, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.restore();
    if (e2 > 0) {
      ctx.save();
      ctx.globalAlpha = bump(e2 * 0.9 + 0.1);
      glow(ctx, W / 2, H / 2, W * 0.12, C.text, 0.9);
      ctx.restore();
    }
  }

  let gl = { g: 0, trans: 0 };

  return {
    renderWorld(ctx, t, S) {
      const q = S.q || 1;
      gl = glitch(t);
      background(ctx, t, q);
      const i = sceneAt(t);
      if (i >= 0) {
        const s = scenes[i];
        if (i === scenes.length - 1) outro(ctx, t, s, gl, q);
        else card(ctx, t, i, s, gl, q);
      }
      vhs(ctx, t, S, gl);
      tape(ctx, t, S, gl);
      ctx.save();
      ctx.globalAlpha = 0.5;
      tile(ctx, A.grain, W, H, (S.frame * 37) % 256, (S.frame * 53) % 256);
      ctx.restore();
      scanlines(ctx, S);
      vignette(S, 0.5, "0,0,0");
    },
    overlay(ctx, S) {
      hud(ctx, S.t, S, gl);
      powerOff(ctx, S.t);
    },
  };
}
