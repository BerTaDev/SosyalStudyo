import { TAU, clamp, lerp, prog, ease, mix, rgba, hash } from "../../_engine/core/util.js";
import { font, label, vignette } from "../../_engine/core/overlay.js";
import { tile } from "../../_engine/core/assets.js";
import { glow } from "../../_engine/core/kit.js";

const TAIL_EMOJI = /\s*(\p{Extended_Pictographic}(?:[️⃣\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic})*)\s*$/u;
const spring = (x, w = 11, d = 6) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-d * x) * Math.cos(w * x));
const bump = (x) => Math.sin(Math.PI * clamp(x));
const rnd = (...n) => hash(...n) / 4294967296;

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

function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function parseCard(raw) {
  let text = String(raw ?? "").replace(/\p{Regional_Indicator}/gu, "").replace(/\*/g, "").trim();
  let other = false;
  if (text.startsWith(">")) {
    other = true;
    text = text.slice(1).trim();
  }
  let react = null;
  const m = text.match(TAIL_EMOJI);
  if (m && m.index > 0) {
    react = m[1];
    text = text.slice(0, m.index).trim();
  }
  return { text, other, react };
}

export default async function makeScene({ cfg, tl, W, H, A, images }) {
  const C = cfg.colors;
  const T = cfg.text || {};
  const scenes = tl.scenes;
  const last = scenes.length - 1;
  const family = cfg.fonts?.[0] || "Segoe UI";
  const emojiFamily = (cfg.fonts || []).find((f) => /emoji/i.test(f)) || "Segoe UI Emoji";
  const u = Math.min(1, W / 1080, H / 1300);
  const pw = Math.min(W * 0.88, H * 0.9);
  const px = (W - pw) / 2;
  const py = H * clamp(0.06 + (H / W - 1) * 0.07, 0.06, 0.115);
  const pb = H * 0.665;
  const ph = pb - py;
  const pcx = W / 2;
  const pcy = (py + pb) / 2;
  const pr = 56 * u;
  const headH = 134 * u;
  const compH = 124 * u;
  const areaTop = py + headH;
  const areaBot = pb - compH;
  const inset = 30 * u;
  const miniAv = 54 * u;
  const inX = px + inset + miniAv + 14 * u;
  const outX = px + pw - inset;
  const bubbleMax = Math.min((pw - inset * 2) * 0.8, pw - inset * 2 - miniAv - 14 * u);
  const padX = 34 * u;
  const padY = 24 * u;
  const dotsW = 132 * u;
  const dotsH = 84 * u;
  const gap = 18 * u;
  const reactPad = 40 * u;
  const chipH = 50 * u;
  const metaSize = 23 * u;
  const bubbleR = 36 * u;
  const tailR = 8 * u;
  const panelCol = mix(C.bg, C.bg2, 0.22);
  const headCol = mix(panelCol, C.text, 0.035);
  const inCol = mix(panelCol, C.text, 0.13);
  const handle = String(T.handle || "@kanal");
  const initial = handle.replace(/^@/, "").slice(0, 1).toLocaleUpperCase("tr-TR") || "@";
  const logoImg = images?.ref1 && images.ref1.naturalWidth ? images.ref1 : null;

  const parsed = scenes.slice(0, Math.max(0, last)).map((s, i) => parseCard(T.cards?.[i]));
  const explicit = parsed.some((p) => p.other);
  const msgs = [];
  parsed.forEach((p, i) => {
    if (!p.text) return;
    const s = scenes[i];
    const d = s.end - s.start;
    let ts = s.start + Math.min(0.12, d * 0.05);
    if (s.start < 0.3) ts = Math.max(ts, 0.3);
    const ta = Math.max(s.start + clamp(d * 0.3, 0.35, 0.7), ts + 0.4);
    const side = explicit ? (p.other ? "in" : "out") : msgs.length % 2 === 0 ? "in" : "out";
    msgs.push({ ...p, side, ts, ta, tr: ta + clamp(d * 0.22, 0.3, 0.6), tread: ta + clamp(d * 0.25, 0.3, 0.7), seed: i });
  });
  if (msgs.length && !msgs[msgs.length - 1].react) msgs[msgs.length - 1].react = "🔥";
  msgs.forEach((m, n) => (m.stamp = `20:${String((14 + n * 2) % 60).padStart(2, "0")}`));
  const pool = [...new Set([...msgs.map((m) => m.react).filter(Boolean), "🔥", "❤️", "👏", "😍"])].slice(0, 5);
  const floaters = Array.from({ length: 14 }, (_, j) => ({
    x: rnd(j, 1),
    y: rnd(j, 2),
    w: lerp(90, 230, rnd(j, 3)),
    h: lerp(56, 120, rnd(j, 4)),
    v: lerp(14, 36, rnd(j, 5)),
    a: lerp(0.03, 0.075, rnd(j, 6)),
    right: rnd(j, 7) < 0.5,
    tint: rnd(j, 8) < 0.35,
  }));
  let laid = false;

  function layout(ctx) {
    const maxText = bubbleMax - padX * 2;
    let size = 58 * u;
    for (; size > 38 * u; size -= 2 * u) {
      font(ctx, size, 600, family);
      if (msgs.every((m) => wrap(ctx, m.text, maxText).length <= 4)) break;
    }
    for (const m of msgs) {
      font(ctx, size, 600, family);
      m.size = size;
      m.lh = size * 1.24;
      m.lines = wrap(ctx, m.text, maxText);
      const widths = m.lines.map((l) => ctx.measureText(l).width);
      font(ctx, metaSize, 600, family);
      m.metaW = ctx.measureText(m.stamp).width + (m.side === "out" ? 40 * u : 0);
      const lastW = widths[widths.length - 1];
      const maxW = Math.max(...widths);
      m.inline = lastW + 20 * u + m.metaW <= maxText;
      m.bw = (m.inline ? Math.max(maxW, lastW + 20 * u + m.metaW) : Math.max(maxW, m.metaW)) + padX * 2;
      m.bh = m.lines.length * m.lh + padY * 2 + (m.inline ? 0 : metaSize * 1.5);
      m.h = m.bh + (m.react ? reactPad : 0);
    }
    laid = true;
  }

  function background(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, W * 0.55, H);
    g.addColorStop(0, C.bg2);
    g.addColorStop(0.62, C.bg);
    g.addColorStop(1, C.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const R = Math.max(W, H);
    glow(ctx, W * 0.12 + Math.cos(t * 0.27) * W * 0.07, H * 0.16 + Math.sin(t * 0.21) * H * 0.04, R * 0.55, C.accent, 0.22);
    glow(ctx, W * 0.92 + Math.sin(t * 0.18) * W * 0.05, H * 0.8 + Math.cos(t * 0.24) * H * 0.03, R * 0.45, C.accent2, 0.1);
    const span = H + 300 * u;
    for (const f of floaters) {
      const y = ((((f.y * span - t * f.v * u) % span) + span) % span) - 150 * u;
      const x = f.x * W + Math.sin(t * 0.4 + f.y * 9) * 14 * u;
      const w = f.w * u;
      const h = f.h * u;
      const r = Math.min(h / 2, 34 * u);
      const col = f.tint ? C.accent : C.text;
      ctx.fillStyle = rgba(col, f.a * 0.55);
      ctx.strokeStyle = rgba(col, f.a);
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - h / 2, w, h, f.right ? [r, r, 6 * u, r] : [r, r, r, 6 * u]);
      ctx.fill();
      ctx.stroke();
    }
  }

  function avatarDisc(ctx, x, y, r, size) {
    const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    g.addColorStop(0, C.accent);
    g.addColorStop(1, C.accent2);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    label(ctx, initial, x, y + size * 0.04, size, C.text, { weight: 700, family });
  }

  function header(ctx, t) {
    const cy = py + headH / 2;
    ctx.fillStyle = headCol;
    ctx.fillRect(px, py, pw, headH);
    ctx.fillStyle = rgba(C.text, 0.07);
    ctx.fillRect(px, py + headH - 1.5 * u, pw, 1.5 * u);
    const intro = ease.outCubic(prog(t, 0.15, 0.7));
    ctx.save();
    ctx.globalAlpha *= intro;
    ctx.translate(lerp(-24 * u, 0, intro), 0);
    const ar = 42 * u;
    const ax = px + inset + ar;
    avatarDisc(ctx, ax, cy, ar, 40 * u);
    const dx = ax + ar * 0.72;
    const dy = cy + ar * 0.72;
    const pulse = (t * 0.9) % 1;
    ctx.strokeStyle = rgba(C.accent2, (1 - pulse) * 0.7);
    ctx.lineWidth = 2.5 * u;
    ctx.beginPath();
    ctx.arc(dx, dy, 10 * u + pulse * 16 * u, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = C.accent2;
    ctx.strokeStyle = headCol;
    ctx.lineWidth = 5 * u;
    ctx.beginPath();
    ctx.arc(dx, dy, 10 * u, 0, TAU);
    ctx.stroke();
    ctx.fill();
    const nx = ax + ar + 24 * u;
    const nameW = px + pw - inset - 50 * u - nx;
    font(ctx, 38 * u, 700, family);
    const name = ellipsize(ctx, handle, nameW);
    label(ctx, name, nx, cy - 17 * u, 38 * u, C.text, { weight: 700, family, align: "left" });
    let typingIn = 0;
    for (const m of msgs) if (m.side === "in") typingIn = Math.max(typingIn, prog(t, m.ts, m.ts + 0.2) * (1 - prog(t, m.ta, m.ta + 0.2)));
    if (typingIn < 1) label(ctx, "çevrimiçi", nx, cy + 23 * u, 27 * u, C.muted, { weight: 600, family, align: "left", alpha: 1 - typingIn });
    if (typingIn > 0) label(ctx, `yazıyor${".".repeat(1 + (Math.floor(t * 4) % 3))}`, nx, cy + 23 * u, 27 * u, C.accent2, { weight: 600, family, align: "left", alpha: typingIn });
    ctx.fillStyle = C.muted;
    for (let j = -1; j <= 1; j++) {
      ctx.beginPath();
      ctx.arc(px + pw - inset - 10 * u, cy + j * 14 * u, 4.5 * u, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function wallpaper(ctx, t) {
    const sp = 46 * u;
    const off = (t * 8 * u) % sp;
    ctx.fillStyle = rgba(C.text, 0.035);
    ctx.beginPath();
    for (let y = areaTop - off; y < areaBot + sp; y += sp) {
      const row = Math.round((y + off - areaTop) / sp);
      for (let x = px + sp / 2 + (row % 2 ? sp / 2 : 0); x < px + pw; x += sp) {
        ctx.moveTo(x + 1.8 * u, y);
        ctx.arc(x, y, 1.8 * u, 0, TAU);
      }
    }
    ctx.fill();
  }

  function slot(m, t) {
    if (t < m.ts) return 0;
    if (t < m.ta) return dotsH * spring(prog(t, m.ts, m.ts + 0.5), 9, 7);
    return lerp(dotsH, m.h, spring(prog(t, m.ta, m.ta + 0.6), 9, 7));
  }

  function shape(ctx, x, y, w, h, out) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, out ? [bubbleR, bubbleR, tailR, bubbleR] : [bubbleR, bubbleR, bubbleR, tailR]);
  }

  function typing(ctx, m, t, bottom) {
    if (t < m.ts || t > m.ta + 0.14) return;
    const out = m.side === "out";
    const k = spring(prog(t, m.ts, m.ts + 0.55), 12, 6);
    const fade = 1 - prog(t, m.ta, m.ta + 0.14);
    const x = out ? outX - dotsW : inX;
    const y = bottom - dotsH;
    const ox = out ? x + dotsW : x;
    ctx.save();
    ctx.globalAlpha *= clamp(prog(t, m.ts, m.ts + 0.1)) * fade;
    const sc = lerp(0.4, 1, k) * lerp(0.85, 1, fade);
    ctx.translate(ox, bottom);
    ctx.scale(sc, sc);
    ctx.translate(-ox, -bottom);
    if (!out) avatarDisc(ctx, px + inset + miniAv / 2, bottom - miniAv / 2, miniAv / 2, 26 * u);
    ctx.fillStyle = out ? rgba(C.accent, 0.55) : inCol;
    shape(ctx, x, y, dotsW, dotsH, out);
    ctx.fill();
    for (let j = 0; j < 3; j++) {
      const ph = (((t - m.ts) * 2.2 - j * 0.16) % 1 + 1) % 1;
      const hop = bump(clamp(ph * 1.8));
      ctx.fillStyle = rgba(C.text, 0.4 + 0.6 * hop);
      ctx.beginPath();
      ctx.arc(x + dotsW / 2 + (j - 1) * 28 * u, y + dotsH / 2 + 3 * u - hop * 11 * u, 8.5 * u, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function ticks(ctx, x, y, t, m) {
    const two = ease.outBack(prog(t, m.ta + 0.18, m.ta + 0.4));
    const read = prog(t, m.tread, m.tread + 0.2);
    const pop = 1 + bump(prog(t, m.tread, m.tread + 0.3)) * 0.4;
    ctx.save();
    ctx.translate(x + 16 * u, y);
    ctx.scale(pop, pop);
    ctx.strokeStyle = mix(C.text, C.accent2, read, lerp(0.65, 1, read));
    ctx.lineWidth = 3.4 * u;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-16 * u, 0);
    ctx.lineTo(-10 * u, 6 * u);
    ctx.lineTo(2 * u, -7 * u);
    ctx.stroke();
    if (two > 0) {
      ctx.globalAlpha *= clamp(two);
      ctx.beginPath();
      ctx.moveTo(-1 * u, 6 * u);
      ctx.lineTo(11 * u, -7 * u);
      ctx.stroke();
    }
    ctx.restore();
  }

  function burst(ctx, x, y, k, seed) {
    if (k <= 0 || k >= 1) return;
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * TAU + seed;
      const d = lerp(30 * u, 96 * u, ease.outCubic(k));
      ctx.fillStyle = rgba(j % 2 ? C.accent2 : C.accent, 1 - k);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, lerp(6 * u, 2 * u, k), 0, TAU);
      ctx.fill();
    }
  }

  function reaction(ctx, m, t, bx, top) {
    if (!m.react || t < m.tr) return;
    const out = m.side === "out";
    const k = prog(t, m.tr, m.tr + 0.9);
    const sc = ease.outElastic(k);
    const cx = out ? bx + 54 * u : bx + m.bw - 54 * u;
    const base = top + m.bh + 6 * u;
    const hop = -bump(prog(t, m.tr, m.tr + 0.4)) * 28 * u + Math.sin((t - m.tr) * 3.4) * 2.5 * u * prog(t, m.tr + 0.5, m.tr + 1);
    burst(ctx, cx, base, prog(t, m.tr + 0.05, m.tr + 0.6), m.seed);
    ctx.save();
    ctx.translate(cx, base + hop);
    ctx.scale(sc, sc);
    const w = 96 * u;
    const h = 66 * u;
    ctx.fillStyle = mix(panelCol, C.text, 0.16);
    ctx.strokeStyle = panelCol;
    ctx.lineWidth = 6 * u;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    ctx.stroke();
    ctx.fill();
    label(ctx, m.react, 0, 2 * u, 40 * u, C.text, { weight: 400, family: emojiFamily });
    ctx.restore();
  }

  function bubble(ctx, m, t, bottom, next) {
    if (t < m.ta) return;
    const out = m.side === "out";
    const sc = lerp(0.5, 1, spring(prog(t, m.ta, m.ta + 0.7), 13, 5)) * (1 + 0.035 * bump(prog(t, m.tr, m.tr + 0.3)) * (m.react ? 1 : 0));
    const dim = next ? lerp(1, 0.7, ease.inOutQuad(prog(t, next.ta, next.ta + 0.5))) : 1;
    const top = bottom - m.h;
    const bx = out ? outX - m.bw : inX;
    const ox = out ? bx + m.bw : bx;
    const oy = top + m.bh;
    ctx.save();
    ctx.globalAlpha *= clamp(prog(t, m.ta, m.ta + 0.1)) * dim;
    ctx.translate(ox, oy);
    ctx.scale(sc, sc);
    ctx.translate(-ox, -oy);
    if (!out) avatarDisc(ctx, px + inset + miniAv / 2, oy - miniAv / 2, miniAv / 2, 26 * u);
    ctx.save();
    ctx.shadowColor = out ? rgba(C.accent, 0.45) : "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 34 * u;
    ctx.shadowOffsetY = 10 * u;
    if (out) {
      const g = ctx.createLinearGradient(bx, top, bx + m.bw, oy);
      g.addColorStop(0, mix(C.accent, C.text, 0.1));
      g.addColorStop(1, mix(C.accent, C.bg, 0.4));
      ctx.fillStyle = g;
    } else ctx.fillStyle = inCol;
    shape(ctx, bx, top, m.bw, m.bh, out);
    ctx.fill();
    ctx.restore();
    const sh = ctx.createLinearGradient(0, top, 0, top + m.bh * 0.6);
    sh.addColorStop(0, rgba(C.text, out ? 0.14 : 0.05));
    sh.addColorStop(1, rgba(C.text, 0));
    ctx.fillStyle = sh;
    shape(ctx, bx, top, m.bw, m.bh, out);
    ctx.fill();
    if (!out) {
      ctx.strokeStyle = rgba(C.text, 0.06);
      ctx.lineWidth = 2 * u;
      ctx.stroke();
    }
    font(ctx, m.size, 600, family);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = C.text;
    m.lines.forEach((l, j) => ctx.fillText(l, bx + padX, top + padY + m.lh * (j + 0.5)));
    const my = m.inline ? top + padY + m.lh * (m.lines.length - 0.5) + m.size * 0.2 : top + padY + m.lines.length * m.lh + metaSize * 0.75;
    const mx = bx + m.bw - padX;
    const sx = out ? mx - 40 * u : mx;
    label(ctx, m.stamp, sx, my, metaSize, out ? rgba(C.text, 0.72) : C.muted, { weight: 600, family, align: "right" });
    if (out) ticks(ctx, mx - 30 * u, my, t, m);
    reaction(ctx, m, t, bx, top);
    ctx.restore();
  }

  function chip(ctx, t, y) {
    const a = ease.outCubic(prog(t, 0.2, 0.55));
    if (a <= 0 || y < areaTop - chipH) return;
    font(ctx, 24 * u, 700, family, "normal", `${2 * u}px`);
    const text = "BUGÜN";
    const w = ctx.measureText(text).width + 52 * u;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.fillStyle = rgba(C.text, 0.07);
    ctx.beginPath();
    ctx.roundRect(pcx - w / 2, y - chipH / 2, w, chipH, chipH / 2);
    ctx.fill();
    label(ctx, text, pcx + u, y + u, 24 * u, C.muted, { weight: 700, family, spacing: `${2 * u}px` });
    ctx.restore();
  }

  function chat(ctx, t) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, areaTop, pw, areaBot - areaTop);
    ctx.clip();
    wallpaper(ctx, t);
    let y = areaBot - 26 * u;
    const pos = [];
    for (let j = msgs.length - 1; j >= 0; j--) {
      const g = slot(msgs[j], t);
      if (g <= 0.5) continue;
      pos.push([msgs[j], y, msgs[j + 1]]);
      y -= g + gap * clamp(g / dotsH);
    }
    chip(ctx, t, y - chipH / 2 - 8 * u);
    for (const [m, bottom, next] of pos) {
      typing(ctx, m, t, bottom);
      bubble(ctx, m, t, bottom, next);
    }
    const f = ctx.createLinearGradient(0, areaTop, 0, areaTop + 110 * u);
    f.addColorStop(0, panelCol);
    f.addColorStop(1, rgba(panelCol, 0));
    ctx.fillStyle = f;
    ctx.fillRect(px, areaTop, pw, 110 * u);
    ctx.restore();
  }

  function composer(ctx, t) {
    const cy = pb - compH / 2;
    ctx.fillStyle = rgba(C.text, 0.06);
    ctx.fillRect(px, pb - compH, pw, 1.5 * u);
    const intro = ease.outCubic(prog(t, 0.25, 0.8));
    const br = 40 * u;
    const bx = px + pw - inset - br;
    const fx = px + inset;
    const fw = bx - br - 16 * u - fx;
    const fh = 80 * u;
    ctx.save();
    ctx.globalAlpha *= intro;
    ctx.translate(0, lerp(22 * u, 0, intro));
    ctx.fillStyle = rgba(C.text, 0.06);
    ctx.strokeStyle = rgba(C.text, 0.08);
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.roundRect(fx, cy - fh / 2, fw, fh, fh / 2);
    ctx.fill();
    ctx.stroke();
    const typingOut = msgs.some((m) => m.side === "out" && t >= m.ts && t < m.ta);
    if (typingOut && (t * 2.4) % 1 < 0.55) {
      ctx.fillStyle = C.accent2;
      ctx.fillRect(fx + 30 * u, cy - 19 * u, 3.5 * u, 38 * u);
    }
    font(ctx, 30 * u, 500, family);
    label(ctx, ellipsize(ctx, "Mesaj yaz…", fw - 70 * u), fx + 44 * u, cy + u, 30 * u, C.muted, { weight: 500, family, align: "left", alpha: typingOut ? 0.45 : 1 });
    let pulse = 0;
    for (const m of msgs) {
      if (m.side !== "out") continue;
      pulse = Math.max(pulse, bump(prog(t, m.ta - 0.05, m.ta + 0.3)));
      const k = prog(t, m.ta, m.ta + 0.55);
      if (k > 0 && k < 1) {
        ctx.strokeStyle = rgba(C.accent, (1 - k) * 0.7);
        ctx.lineWidth = 4 * u;
        ctx.beginPath();
        ctx.arc(bx, cy, br + k * 44 * u, 0, TAU);
        ctx.stroke();
      }
    }
    const ready = typingOut ? 0.6 + 0.4 * Math.sin(t * 9) : 0;
    if (ready + pulse > 0) glow(ctx, bx, cy, br * 2.4, C.accent, 0.3 * clamp(ready + pulse));
    ctx.save();
    ctx.translate(bx, cy);
    ctx.scale(1 + 0.14 * pulse, 1 + 0.14 * pulse);
    const g = ctx.createLinearGradient(-br, -br, br, br);
    g.addColorStop(0, C.accent);
    g.addColorStop(1, mix(C.accent, C.accent2, 0.45));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, br, 0, TAU);
    ctx.fill();
    ctx.fillStyle = C.text;
    ctx.beginPath();
    ctx.moveTo(-13 * u, -15 * u);
    ctx.lineTo(18 * u, 0);
    ctx.lineTo(-13 * u, 15 * u);
    ctx.lineTo(-7 * u, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function panel(ctx, t, exit) {
    const intro = spring(prog(t, 0, 0.8), 9, 6);
    const a = clamp(prog(t, 0, 0.25)) * (1 - exit);
    if (a <= 0) return;
    const sc = lerp(0.9, 1, intro) * lerp(1, 0.9, exit);
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(pcx, pcy + lerp(100 * u, 0, intro) + Math.sin(t * 1.1) * 5 * u + exit * 80 * u);
    ctx.rotate(Math.sin(t * 0.6) * 0.0035);
    ctx.scale(sc, sc);
    ctx.translate(-pcx, -pcy);
    glow(ctx, pcx, py, pw * 0.75, C.accent, 0.16);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 90 * u;
    ctx.shadowOffsetY = 40 * u;
    ctx.fillStyle = panelCol;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, pr);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, pr);
    ctx.clip();
    header(ctx, t);
    chat(ctx, t);
    composer(ctx, t);
    ctx.restore();
    const b = ctx.createLinearGradient(0, py, 0, pb);
    b.addColorStop(0, rgba(C.accent, 0.55));
    b.addColorStop(0.5, rgba(C.text, 0.08));
    b.addColorStop(1, rgba(C.accent2, 0.3));
    ctx.strokeStyle = b;
    ctx.lineWidth = 2.5 * u;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, pr);
    ctx.stroke();
    ctx.restore();
  }

  function drawLogo(ctx, cx, cy, box) {
    const r = Math.min(box / logoImg.naturalWidth, box / logoImg.naturalHeight);
    const w = logoImg.naturalWidth * r;
    const h = logoImg.naturalHeight * r;
    ctx.fillStyle = panelCol;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2 - 20 * u, cy - h / 2 - 20 * u, w + 40 * u, h + 40 * u, 30 * u);
    ctx.fill();
    ctx.drawImage(logoImg, cx - w / 2, cy - h / 2, w, h);
  }

  function outro(ctx, t, s) {
    const k = spring(prog(t, s.start + 0.15, s.start + 0.95), 10, 6);
    const a = clamp(prog(t, s.start + 0.15, s.start + 0.35));
    if (a <= 0) return;
    const lt = t - s.start;
    const cw = Math.min(pw * 0.86, 740 * u);
    const ch = 600 * u;
    const top = pcy - ch / 2;
    const left = pcx - cw / 2;
    const coverH = 170 * u;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(pcx, pcy + lerp(130 * u, 0, k) + Math.sin(lt * 1.6) * 4 * u);
    ctx.scale(lerp(0.75, 1, k), lerp(0.75, 1, k));
    ctx.translate(-pcx, -pcy);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 80 * u;
    ctx.shadowOffsetY = 36 * u;
    ctx.fillStyle = panelCol;
    ctx.beginPath();
    ctx.roundRect(left, top, cw, ch, pr);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, cw, ch, pr);
    ctx.clip();
    const cg = ctx.createLinearGradient(left, top, left + cw, top + coverH);
    cg.addColorStop(0, C.accent);
    cg.addColorStop(1, C.accent2);
    ctx.fillStyle = cg;
    ctx.fillRect(left, top, cw, coverH);
    for (let j = 0; j < 6; j++) {
      const bw = lerp(70, 150, rnd(j, 21)) * u;
      const bh = lerp(40, 70, rnd(j, 22)) * u;
      const bx = left + ((rnd(j, 23) * cw + lt * 30 * u * (j % 2 ? 1 : -1)) % cw + cw) % cw - bw / 2;
      const by = top + lerp(20, 140, rnd(j, 24)) * u - bh / 2;
      ctx.fillStyle = rgba(C.text, 0.12);
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, j % 2 ? [bh / 2, bh / 2, 5 * u, bh / 2] : [bh / 2, bh / 2, bh / 2, 5 * u]);
      ctx.fill();
    }
    ctx.restore();
    const b = ctx.createLinearGradient(0, top, 0, top + ch);
    b.addColorStop(0, rgba(C.text, 0.2));
    b.addColorStop(1, rgba(C.accent2, 0.25));
    ctx.strokeStyle = b;
    ctx.lineWidth = 2.5 * u;
    ctx.beginPath();
    ctx.roundRect(left, top, cw, ch, pr);
    ctx.stroke();
    const ay = top + coverH;
    const ar = 92 * u;
    const ak = ease.outBack(prog(t, s.start + 0.35, s.start + 0.85));
    if (logoImg) {
      ctx.save();
      ctx.translate(pcx, ay);
      ctx.scale(ak, ak);
      drawLogo(ctx, 0, 0, ar * 2.3);
      ctx.restore();
    } else {
      for (let j = 0; j < 2; j++) {
        const p = ((lt * 0.75 + j * 0.5) % 1 + 1) % 1;
        ctx.strokeStyle = rgba(C.accent2, (1 - p) * 0.55 * clamp(ak));
        ctx.lineWidth = 3 * u;
        ctx.beginPath();
        ctx.arc(pcx, ay, ar + 10 * u + p * 70 * u, 0, TAU);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(pcx, ay);
      ctx.scale(ak, ak);
      ctx.fillStyle = panelCol;
      ctx.beginPath();
      ctx.arc(0, 0, ar + 10 * u, 0, TAU);
      ctx.fill();
      avatarDisc(ctx, 0, 0, ar, 92 * u);
      ctx.fillStyle = C.accent2;
      ctx.strokeStyle = panelCol;
      ctx.lineWidth = 7 * u;
      ctx.beginPath();
      ctx.arc(ar * 0.72, ar * 0.72, 16 * u, 0, TAU);
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
    const k2 = ease.outCubic(prog(t, s.start + 0.45, s.start + 0.95));
    font(ctx, 56 * u, 800, family);
    const name = ellipsize(ctx, handle, cw - 80 * u);
    label(ctx, name, pcx, top + 338 * u + lerp(30 * u, 0, k2), 56 * u, C.text, { weight: 800, family, alpha: k2 });
    font(ctx, 30 * u, 600, family);
    const st = "çevrimiçi";
    const sw = ctx.measureText(st).width + 26 * u;
    ctx.save();
    ctx.globalAlpha *= k2;
    ctx.fillStyle = C.accent2;
    ctx.beginPath();
    ctx.arc(pcx - sw / 2 + 8 * u, top + 400 * u, 8 * u, 0, TAU);
    ctx.fill();
    ctx.restore();
    label(ctx, st, pcx - sw / 2 + 26 * u, top + 401 * u, 30 * u, C.muted, { weight: 600, family, align: "left", alpha: k2 });
    const k3 = ease.outBack(prog(t, s.start + 0.6, s.start + 1.1));
    if (k3 > 0) {
      const text = T.follow || "Takip et";
      font(ctx, 44 * u, 800, family);
      const bw = Math.min(cw - 80 * u, Math.max(320 * u, ctx.measureText(text).width + 130 * u));
      const bh = 96 * u;
      const by = top + 500 * u;
      const tp = s.start + clamp((s.end - s.start) * 0.55, 1.05, 1.6);
      const press = 1 - 0.08 * bump(prog(t, tp, tp + 0.24));
      const rk = prog(t, tp + 0.08, tp + 0.7);
      if (rk > 0 && rk < 1) {
        const inf = rk * 46 * u;
        ctx.strokeStyle = rgba(C.accent2, (1 - rk) * 0.8);
        ctx.lineWidth = 4 * u;
        ctx.beginPath();
        ctx.roundRect(pcx - bw / 2 - inf, by - bh / 2 - inf, bw + inf * 2, bh + inf * 2, bh / 2 + inf);
        ctx.stroke();
      }
      ctx.save();
      ctx.globalAlpha *= clamp(k3);
      ctx.translate(pcx, by);
      const bs = lerp(0.7, 1, clamp(k3)) * press;
      ctx.scale(bs, bs);
      const g = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
      g.addColorStop(0, C.accent);
      g.addColorStop(1, mix(C.accent, C.accent2, 0.55));
      ctx.shadowColor = rgba(C.accent, 0.5);
      ctx.shadowBlur = 30 * u;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2);
      ctx.fill();
      ctx.shadowColor = "transparent";
      font(ctx, 44 * u, 800, family);
      label(ctx, ellipsize(ctx, text, bw - 60 * u), 0, 2 * u, 44 * u, C.text, { weight: 800, family });
      const tap = prog(t, tp - 0.2, tp + 0.35);
      if (tap > 0 && tap < 1) {
        ctx.fillStyle = rgba(C.text, 0.35 * bump(tap));
        ctx.beginPath();
        ctx.arc(bw * 0.22, 6 * u, lerp(46 * u, 26 * u, tap), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
    for (let j = 0; j < 10; j++) {
      const t0 = s.start + 0.5 + j * 0.16;
      const p = prog(t, t0, t0 + 1.7);
      if (p <= 0 || p >= 1) continue;
      const side = j % 2 ? 1 : -1;
      const x = pcx + side * (cw / 2 + lerp(-40, 40, rnd(j, 11)) * u) + Math.sin(p * 5 + j) * 18 * u;
      const y = pcy + ch * 0.38 - p * (ch * 0.85 + 180 * u * rnd(j, 12));
      const size = lerp(46, 72, rnd(j, 13)) * u * (0.6 + 0.4 * ease.outBack(clamp(p * 4)));
      label(ctx, pool[j % pool.length], x, y, size, C.text, { weight: 400, family: emojiFamily, alpha: clamp(p * 6) * (1 - prog(p, 0.7, 1)) });
    }
  }

  return {
    renderWorld(ctx, t, S) {
      if (!laid) layout(ctx);
      background(ctx, t);
      const os = scenes[last];
      const exit = !os ? 0 : last === 0 ? 1 : ease.inOutCubic(prog(t, os.start, os.start + 0.5));
      panel(ctx, t, exit);
      if (os && t >= os.start) outro(ctx, t, os);
      ctx.save();
      ctx.globalAlpha = 0.35;
      tile(ctx, A.grain, W, H, (S.frame * 37) % 256, (S.frame * 53) % 256);
      ctx.restore();
      vignette(S, 0.38, "0,0,0");
    },
  };
}
