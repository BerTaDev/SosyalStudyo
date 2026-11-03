import { TAU, clamp, lerp, prog, ease, mix, rgba, rng, hexToRgb } from "../../_engine/core/util.js";
import { font, vignette } from "../../_engine/core/overlay.js";
import { tile } from "../../_engine/core/assets.js";
import { glow } from "../../_engine/core/kit.js";

function lum(col) {
  const [r, g, b] = hexToRgb(col).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const inkOn = (fill, list) => list.reduce((best, c) => (contrast(fill, c) > contrast(fill, best) ? c : best), list[0]);

function wrap(ctx, text, maxW) {
  const lines = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(next).width > maxW) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function slant(c, x, y, w, h, sk) {
  c.beginPath();
  c.moveTo(x, y + h);
  c.lineTo(x + sk, y);
  c.lineTo(x + w + sk, y);
  c.lineTo(x + w, y + h);
  c.closePath();
}

function parseCard(raw) {
  const text = String(raw ?? "").trim();
  const m = text.match(/^([^:]{2,18}):\s+(.+)$/);
  if (m && m[1].trim().split(/\s+/).length <= 3) return { tag: m[1].trim(), text: m[2].trim() };
  return { tag: null, text };
}

export default async function makeScene({ cfg, tl, W, H, A, images }) {
  const C = cfg.colors;
  const T = cfg.text || {};
  const scenes = tl.scenes;
  const count = Math.max(0, scenes.length - 1);
  const family = cfg.fonts?.[0] || "Bahnschrift";
  const k = Math.min(1, W / 1080, H / 1300);
  const ratio = W / H;
  const tall = ratio < 0.7;
  const wide = ratio > 1.2;
  const mx = W * (wide ? 0.05 : 0.06);
  const topY = H * (tall ? 0.125 : 0.075);
  const tickerH = 66 * k;
  const tickerY = H * (tall ? 0.64 : 0.6) - tickerH / 2;
  const blockCy = (topY + 50 * k + tickerY - 34 * k) / 2;
  const panelW = wide ? W * 0.6 : W - mx * 2;
  const globeX = wide ? W * 0.78 : W / 2;
  const globeR = wide ? H * 0.42 : Math.min(W, H) * 0.56;
  const paper = C.text;
  const headInk = inkOn(paper, [C.bg, "#0B1222", "#FFFFFF"]);
  const tagInk = inkOn(C.accent, ["#FFFFFF", C.text, "#0B1222"]);
  const goldInk = inkOn(C.accent2, [C.bg, "#0B1222", "#FFFFFF"]);
  const handle = T.handle || "";
  const program = (T.title || "GÜNDEM").toLocaleUpperCase("tr-TR");
  const logoImg = images?.ref1 && images.ref1.naturalWidth ? images.ref1 : null;
  const R = rng((cfg.video?.seed ?? 7) + 3);
  const bokeh = Array.from({ length: 22 }, () => ({ x: R(), y: R(), r: 20 + R() * 90, v: 0.01 + R() * 0.03, a: 0.04 + R() * 0.08, c: R() < 0.3 }));
  const layouts = new Map();
  let ticker = null;
  let outroL = null;
  const up = (s) => s.toLocaleUpperCase("tr-TR");

  function sceneAt(t) {
    let i = scenes.findIndex((s) => t >= s.start && t < s.end);
    if (i < 0 && scenes.length && t >= scenes[scenes.length - 1].end) i = scenes.length - 1;
    return i;
  }

  function background(ctx, t) {
    const g = ctx.createRadialGradient(globeX, blockCy, 0, globeX, blockCy, Math.max(W, H) * 0.75);
    g.addColorStop(0, C.bg2);
    g.addColorStop(1, C.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let j = 0; j < 3; j++) {
      const x = ((t * 0.04 + j * 0.37) % 1.4 - 0.2) * W;
      ctx.save();
      ctx.translate(x, 0);
      ctx.transform(1, 0, -0.35, 1, 0, 0);
      const bw = (90 + j * 70) * k;
      const lg = ctx.createLinearGradient(-bw, 0, bw, 0);
      lg.addColorStop(0, rgba(C.muted, 0));
      lg.addColorStop(0.5, rgba(C.muted, 0.07));
      lg.addColorStop(1, rgba(C.muted, 0));
      ctx.fillStyle = lg;
      ctx.fillRect(-bw, 0, bw * 2, H);
      ctx.restore();
    }
    for (const b of bokeh) {
      const y = ((b.y - t * b.v) % 1 + 1) % 1;
      glow(ctx, b.x * W, y * H, b.r * k, b.c ? C.accent2 : C.muted, b.a);
    }
    ctx.restore();
    globe(ctx, t);
    ctx.save();
    ctx.strokeStyle = rgba(C.muted, 0.05);
    ctx.lineWidth = 1.5 * k;
    const sp = 9 * k;
    ctx.beginPath();
    for (let y = (t * 18 * k) % sp; y < H; y += sp) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function globe(ctx, t) {
    const x = globeX;
    const y = blockCy;
    const r = globeR;
    const tilt = 0.32;
    ctx.save();
    glow(ctx, x, y, r * 1.25, C.accent2, 0.08);
    ctx.strokeStyle = rgba(C.muted, 0.2);
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = rgba(C.muted, 0.13);
    ctx.lineWidth = 1.6 * k;
    for (let j = -3; j <= 3; j++) {
      const phi = (j / 4) * (Math.PI / 2);
      const rr = r * Math.cos(phi);
      ctx.beginPath();
      ctx.ellipse(x, y - r * Math.sin(phi) * Math.cos(tilt), rr, rr * Math.sin(tilt), 0, 0, TAU);
      ctx.stroke();
    }
    const rot = t * 0.18;
    for (let j = 0; j < 9; j++) {
      const lam = rot + (j / 9) * Math.PI;
      const rx = Math.abs(Math.sin(lam)) * r;
      ctx.beginPath();
      ctx.ellipse(x, y, Math.max(0.5, rx), r, Math.sin(tilt) * 0.3, 0, TAU);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(C.accent2, 0.35);
    ctx.lineWidth = 3 * k;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.08, -Math.PI / 2 + t * 0.6, -Math.PI / 2 + t * 0.6 + 0.9);
    ctx.stroke();
    ctx.strokeStyle = rgba(C.accent, 0.3);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.14, Math.PI / 2 - t * 0.4, Math.PI / 2 - t * 0.4 + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function layoutCard(ctx, i) {
    if (layouts.has(i)) return layouts.get(i);
    const { tag, text } = parseCard(T.cards?.[i]);
    if (!text) {
      layouts.set(i, null);
      return null;
    }
    const padX = 42 * k;
    const padY = 30 * k;
    const bar = 14 * k;
    const maxW = panelW - padX * 2 - bar;
    let size = 116 * k;
    let lines = [];
    for (; size > 50 * k; size -= 2 * k) {
      font(ctx, size, 700, family, "condensed");
      lines = wrap(ctx, text, maxW);
      if (lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= maxW)) break;
    }
    font(ctx, size, 700, family, "condensed");
    lines = wrap(ctx, text, maxW);
    const lh = size * 1.1;
    const panelH = lines.length * lh + padY * 2;
    const tabText = up(tag || (i === 0 ? "SON DAKİKA" : "GÜNDEM"));
    const tabH = 72 * k;
    const tabSize = 40 * k;
    font(ctx, tabSize, 700, family, "condensed", `${2 * k}px`);
    const tabW = ctx.measureText(tabText).width + 66 * k;
    const stripH = 56 * k;
    const blockH = tabH + panelH + stripH;
    const top = blockCy - blockH / 2;
    const next = i + 1 < count ? parseCard(T.cards?.[i + 1]).text : "";
    font(ctx, 28 * k, 600, family, "normal", `${3 * k}px`);
    const room = panelW - 52 * k - 140 * k;
    let info = next ? `SIRADA: ${up(next)}` : program;
    if (ctx.measureText(info).width > room) {
      while (info.length > 8 && ctx.measureText(info + "…").width > room) info = info.slice(0, -1);
      info = info.trimEnd() + "…";
    }
    const L = { lines, size, lh, padX, padY, bar, panelH, tabText, tabH, tabSize, tabW, stripH, top, x: mx, info };
    layouts.set(i, L);
    return L;
  }

  function shine(ctx, x, y, w, h, t, period, sk) {
    const p = ((t % period) / period) * 2.2 - 0.6;
    if (p < -0.3 || p > 1.3) return;
    ctx.save();
    slant(ctx, x, y, w, h, sk);
    ctx.clip();
    const sx = x + p * (w + sk);
    const g = ctx.createLinearGradient(sx - 60 * k, 0, sx + 60 * k, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.38)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - 10, y, w + sk + 20, h);
    ctx.restore();
  }

  function tab(ctx, x, y, w, h, text, size, t, flash) {
    const sk = h * 0.28;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 24 * k;
    ctx.shadowOffsetY = 8 * k;
    ctx.fillStyle = flash ? mix(C.accent, "#FFFFFF", flash) : C.accent;
    slant(ctx, x, y, w, h, sk);
    ctx.fill();
    ctx.restore();
    shine(ctx, x, y, w, h, t, 2.2, sk);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w + sk, h);
    ctx.clip();
    font(ctx, size, 700, family, "condensed", `${size * 0.05}px`);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = tagInk;
    ctx.fillText(text, x + (w + sk) / 2, y + h / 2 + size * 0.04);
    ctx.restore();
  }

  function card(ctx, t, i, L) {
    const s = scenes[i];
    const lt = t - s.start;
    const d = s.end - s.start;
    const out = d - 0.42;
    let p0 = 0.18;
    let tx = L.x;
    let ty = L.top;
    let tw = L.tabW;
    let th = L.tabH;
    let ts = L.tabSize;
    let flash = 0;
    if (i === 0) {
      const hold = Math.min(0.3 + 0.15 * Math.max(0, d - 2), 0.75);
      const e = ease.inOutCubic(prog(lt, hold, hold + 0.32));
      const open = ease.outCubic(prog(lt, 0, 0.18));
      font(ctx, 130 * k, 700, family, "condensed", `${6.5 * k}px`);
      const bigS = Math.min(130 * k, (130 * k * W * 0.82) / Math.max(1, ctx.measureText(L.tabText).width));
      const bw = W * 1.1 * open;
      tx = lerp(W / 2 - bw / 2 - 40 * k, L.x, e);
      ty = lerp(blockCy - 110 * k, L.top, e);
      tw = lerp(bw, L.tabW, e);
      th = lerp(220 * k, L.tabH, e);
      ts = lerp(bigS, L.tabSize, e);
      flash = (1 - e) * (Math.floor(lt * 7) % 2 ? 0.18 : 0);
      p0 = hold + 0.22;
    } else {
      const e = ease.outCubic(prog(lt, 0.05, 0.38));
      tx = lerp(-L.tabW - 80 * k, L.x, e);
    }
    const tabOut = ease.inCubic(prog(lt, out + 0.12, out + 0.36));
    tx -= tabOut * (L.tabW + L.x + 120 * k);
    const panelIn = ease.outCubic(prog(lt, p0, p0 + 0.34));
    const panelOut = ease.inCubic(prog(lt, out, out + 0.3));
    const py = L.top + L.tabH;
    if (panelIn > 0 && panelOut < 1) {
      ctx.save();
      const x0 = L.x + panelW * panelOut;
      const x1 = L.x + panelW * panelIn;
      ctx.beginPath();
      ctx.rect(x0, py - 4 * k, Math.max(0, x1 - x0), L.panelH + L.stripH + 8 * k);
      ctx.clip();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 30 * k;
      ctx.shadowOffsetY = 12 * k;
      ctx.fillStyle = paper;
      ctx.fillRect(L.x, py, panelW, L.panelH);
      ctx.shadowColor = "transparent";
      ctx.fillStyle = C.accent2;
      ctx.fillRect(L.x, py, L.bar, L.panelH);
      ctx.fillStyle = rgba(C.bg, 0.94);
      ctx.fillRect(L.x, py + L.panelH, panelW, L.stripH);
      const sy = py + L.panelH + L.stripH / 2;
      const strip = ease.outCubic(prog(lt, p0 + 0.12, p0 + 0.42));
      ctx.globalAlpha = strip;
      ctx.fillStyle = C.accent;
      ctx.fillRect(L.x + 24 * k, sy - 7 * k, 14 * k, 14 * k);
      font(ctx, 28 * k, 600, family, "normal", `${3 * k}px`);
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillStyle = C.text;
      ctx.fillText(L.info, L.x + 52 * k, sy + 1 * k);
      ctx.textAlign = "right";
      ctx.fillStyle = C.accent2;
      ctx.fillText(`${i + 1} / ${count}`, L.x + panelW - 24 * k, sy + 1 * k);
      ctx.globalAlpha = 1;
      ctx.fillStyle = C.accent2;
      ctx.fillRect(L.x, py + L.panelH + L.stripH - 4 * k, panelW * clamp(lt / d), 4 * k);
      font(ctx, L.size, 700, family, "condensed");
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      L.lines.forEach((line, j) => {
        const a = ease.outCubic(prog(lt, p0 + 0.1 + j * 0.07, p0 + 0.42 + j * 0.07));
        if (a <= 0) return;
        const ly = py + L.padY + L.lh * (j + 0.5);
        ctx.save();
        ctx.beginPath();
        ctx.rect(L.x, ly - L.lh / 2, panelW, L.lh);
        ctx.clip();
        ctx.fillStyle = headInk;
        ctx.fillText(line, L.x + L.bar + L.padX, ly + (1 - a) * L.lh * 0.9 + L.size * 0.03);
        ctx.restore();
      });
      ctx.restore();
      if (panelIn < 1) {
        ctx.fillStyle = C.accent;
        ctx.fillRect(x1 - 8 * k, py, 8 * k, L.panelH + L.stripH);
      }
    }
    if (tabOut < 1) tab(ctx, tx, ty, tw, th, L.tabText, ts, lt, flash);
  }

  function buildOutro(ctx) {
    const follow = up(T.follow || "Takip et");
    let logo = null;
    if (logoImg) {
      const r = Math.min((W * 0.5) / logoImg.naturalWidth, (H * (tall ? 0.14 : 0.2)) / logoImg.naturalHeight);
      logo = { w: logoImg.naturalWidth * r, h: logoImg.naturalHeight * r };
    }
    const markH = logo ? logo.h + 70 * k : 230 * k;
    let hs = 84 * k;
    font(ctx, hs, 700, family, "condensed");
    const maxW = (wide ? W * 0.6 : W - mx * 2) - 90 * k;
    while (hs > 40 * k && ctx.measureText(handle).width > maxW) {
      hs -= 2 * k;
      font(ctx, hs, 700, family, "condensed");
    }
    const hw = ctx.measureText(handle).width;
    const pw = Math.max(hw + 90 * k, W * (wide ? 0.3 : 0.5));
    const ph = hs * 1.1 + 50 * k;
    const tabH = 64 * k;
    const tabSize = 36 * k;
    font(ctx, tabSize, 700, family, "condensed", `${2 * k}px`);
    const tabW = ctx.measureText(follow).width + 60 * k;
    const gap = 96 * k;
    const total = markH + gap + tabH + ph;
    const top = blockCy - total / 2;
    outroL = { follow, logo, markH, my: top + markH / 2, hs, pw, ph, px: W / 2 - pw / 2, tabH, tabSize, tabW, ty: top + markH + gap };
    return outroL;
  }

  function outro(ctx, t, s) {
    const O = outroL || buildOutro(ctx);
    const lt = t - s.start;
    const pop = ease.outBack(prog(lt, 0.25, 0.7));
    if (pop > 0) {
      ctx.save();
      ctx.translate(W / 2, O.my + Math.sin(lt * 1.6) * 4 * k);
      ctx.scale(lerp(0.6, 1, clamp(pop)), lerp(0.6, 1, clamp(pop)));
      ctx.globalAlpha = clamp(pop);
      if (O.logo) {
        const bw = O.logo.w + 70 * k;
        const bh = O.logo.h + 70 * k;
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = 40 * k;
        ctx.shadowOffsetY = 14 * k;
        ctx.fillStyle = paper;
        ctx.beginPath();
        ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 18 * k);
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.fillStyle = C.accent;
        ctx.fillRect(-bw / 2, bh / 2 - 10 * k, bw, 10 * k);
        ctx.drawImage(logoImg, -O.logo.w / 2, -O.logo.h / 2 - 4 * k, O.logo.w, O.logo.h);
      } else {
        const r = 105 * k;
        const ring = (lt % 1.4) / 1.4;
        ctx.strokeStyle = rgba(C.accent, 0.6 * (1 - ring));
        ctx.lineWidth = 6 * k;
        ctx.beginPath();
        ctx.arc(0, 0, r + 14 * k + ring * 70 * k, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = C.accent;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.fill();
        font(ctx, r * 1.05, 700, family, "condensed");
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = tagInk;
        ctx.fillText(up(handle.replace("@", "").slice(0, 1)) || "@", 0, r * 0.06);
      }
      ctx.restore();
    }
    const e1 = ease.outCubic(prog(lt, 0.45, 0.8));
    const py = O.ty + O.tabH;
    const p = ease.outCubic(prog(lt, 0.55, 0.9));
    if (p > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(O.px, py - 4 * k, O.pw * p, O.ph + 8 * k);
      ctx.clip();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 30 * k;
      ctx.shadowOffsetY = 12 * k;
      ctx.fillStyle = paper;
      ctx.fillRect(O.px, py, O.pw, O.ph);
      ctx.shadowColor = "transparent";
      ctx.fillStyle = C.accent2;
      ctx.fillRect(O.px, py + O.ph - 10 * k, O.pw, 10 * k);
      const a = ease.outCubic(prog(lt, 0.7, 1.05));
      font(ctx, O.hs, 700, family, "condensed");
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = headInk;
      ctx.fillText(handle, W / 2, py + (O.ph - 10 * k) / 2 + (1 - a) * O.ph * 0.7 + O.hs * 0.03);
      ctx.restore();
    }
    if (e1 > 0) tab(ctx, lerp(-O.tabW - 60 * k, O.px, e1), O.ty, O.tabW, O.tabH, O.follow, O.tabSize, lt, 0);
  }

  function stinger(ctx, t) {
    let best = null;
    for (let i = 1; i < scenes.length; i++) {
      const b = scenes[i].start;
      if (Math.abs(t - b) < 0.32) best = b;
    }
    if (best === null) return;
    const raw = clamp((t - (best - 0.32)) / 0.64);
    const p = lerp(raw, ease.inOutSine(raw), 0.4);
    const sk = H * 0.22;
    const bw = W + sk + 360 * k;
    const x = lerp(-bw - sk - 40 * k, W + 40 * k, p);
    ctx.save();
    ctx.fillStyle = C.accent2;
    slant(ctx, x - 50 * k, 0, 60 * k, H, sk);
    ctx.fill();
    ctx.fillStyle = C.accent;
    slant(ctx, x, 0, bw, H, sk);
    ctx.fill();
    ctx.fillStyle = mix(C.accent, "#000000", 0.25);
    slant(ctx, x + bw - 120 * k, 0, 120 * k, H, sk);
    ctx.fill();
    ctx.fillStyle = C.bg;
    slant(ctx, x + bw, 0, 46 * k, H, sk);
    ctx.fill();
    const mx0 = x + bw / 2 + sk / 2;
    const my0 = H * 0.42;
    mark(ctx, mx0 - 120 * k, my0, 70 * k, "#FFFFFF", rgba("#FFFFFF", 0.55));
    font(ctx, 70 * k, 700, family, "condensed", `${5 * k}px`);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = tagInk;
    ctx.fillText(program, mx0 - 50 * k, my0 + 3 * k);
    ctx.restore();
  }

  function mark(ctx, x, y, h, c1, c2) {
    const w = h * 0.34;
    const sk = h * 0.3;
    ctx.fillStyle = c1;
    slant(ctx, x - w - sk / 2, y - h / 2, w, h, sk);
    ctx.fill();
    ctx.fillStyle = c2;
    slant(ctx, x + w * 0.25 - sk / 2, y - h / 2, w, h, sk);
    ctx.fill();
  }

  function buildTicker(ctx) {
    const items = [];
    for (let i = 0; i < count; i++) {
      const { text } = parseCard(T.cards?.[i]);
      if (text) items.push(up(text));
    }
    if (handle) items.push(up(handle));
    if (!items.length) items.push(program);
    const size = 32 * k;
    font(ctx, size, 600, family, "normal", `${1.5 * k}px`);
    const sep = 60 * k;
    const parts = items.map((s) => ({ s, w: ctx.measureText(s).width }));
    const total = parts.reduce((a, p) => a + p.w + sep, 0);
    ticker = { parts, total, size, sep };
    return ticker;
  }

  function clockText(t) {
    const m = 45 + Math.floor(t / 60);
    return `20${Math.floor(t * 2) % 2 ? " " : ":"}${String(m % 60).padStart(2, "0")}`;
  }

  function tickerBar(ctx, t) {
    const tk = ticker || buildTicker(ctx);
    const e = ease.outCubic(prog(t, 0.2, 0.6));
    if (e <= 0) return;
    const y = tickerY + (1 - e) * (tickerH + 40 * k);
    const x0 = wide ? mx : 0;
    const x1 = wide ? W - mx : W;
    ctx.save();
    ctx.globalAlpha = e;
    ctx.fillStyle = rgba(C.bg, 0.94);
    ctx.fillRect(x0, y, x1 - x0, tickerH);
    ctx.fillStyle = C.accent;
    ctx.fillRect(x0, y, x1 - x0, 4 * k);
    const lw = 150 * k;
    const lx = x0 + (wide ? 0 : mx * 0.5);
    font(ctx, tk.size, 700, family, "condensed", `${2 * k}px`);
    ctx.save();
    ctx.beginPath();
    ctx.rect(lx + lw + 20 * k, y, x1 - lx - lw - 20 * k, tickerH);
    ctx.clip();
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    font(ctx, tk.size, 600, family, "normal", `${1.5 * k}px`);
    let x = lx + lw + 30 * k - ((t * 150 * k) % tk.total);
    while (x < x1) {
      for (const p of tk.parts) {
        if (x > x1) break;
        if (x + p.w > lx + lw) {
          ctx.fillStyle = C.text;
          ctx.fillText(p.s, x, y + tickerH / 2 + 2 * k);
        }
        ctx.fillStyle = C.accent;
        ctx.fillRect(x + p.w + tk.sep / 2 - 6 * k, y + tickerH / 2 - 6 * k, 12 * k, 12 * k);
        x += p.w + tk.sep;
      }
    }
    ctx.restore();
    ctx.fillStyle = C.accent2;
    slant(ctx, lx - 30 * k, y, lw + 30 * k, tickerH, tickerH * 0.3);
    ctx.fill();
    font(ctx, tk.size * 1.15, 700, family, "condensed", `${2 * k}px`);
    ctx.fillStyle = goldInk;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(clockText(t), lx + lw / 2 + 4 * k, y + tickerH / 2 + 2 * k);
    ctx.restore();
  }

  function topBar(ctx, t) {
    const e = ease.outCubic(prog(t, 0.1, 0.5));
    if (e <= 0) return;
    const h = 62 * k;
    const y = topY - h / 2 - (1 - e) * 40 * k;
    ctx.save();
    ctx.globalAlpha = e;
    font(ctx, 36 * k, 700, family, "condensed", `${3 * k}px`);
    const live = "CANLI";
    const lw = ctx.measureText(live).width + 80 * k;
    ctx.fillStyle = C.accent;
    ctx.beginPath();
    ctx.roundRect(mx, y, lw, h, 8 * k);
    ctx.fill();
    ctx.fillStyle = tagInk;
    ctx.globalAlpha = e * (0.35 + 0.65 * (0.5 + 0.5 * Math.cos(t * 5)));
    ctx.beginPath();
    ctx.arc(mx + 30 * k, y + h / 2, 10 * k, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = e;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(live, mx + 52 * k, y + h / 2 + 2 * k);
    const name = up(handle.replace(/^@/, "")) || program;
    let fs = 34 * k;
    font(ctx, fs, 700, family, "condensed", `${3 * k}px`);
    const maxNW = W * 0.5;
    while (fs > 18 * k && ctx.measureText(name).width > maxNW) {
      fs -= 1 * k;
      font(ctx, fs, 700, family, "condensed", `${3 * k}px`);
    }
    const nw = ctx.measureText(name).width;
    const bw = nw + 120 * k;
    const bx = W - mx - bw;
    ctx.fillStyle = rgba(C.bg, 0.7);
    ctx.strokeStyle = rgba(C.text, 0.18);
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.roundRect(bx, y, bw, h, 8 * k);
    ctx.fill();
    ctx.stroke();
    mark(ctx, bx + 44 * k, y + h / 2, h * 0.56, C.accent, C.accent2);
    ctx.fillStyle = C.text;
    ctx.textAlign = "left";
    ctx.fillText(name, bx + 88 * k, y + h / 2 + 2 * k);
    ctx.restore();
  }

  return {
    renderWorld(ctx, t, S) {
      background(ctx, t);
      const i = sceneAt(t);
      if (i >= 0 && i < count) {
        const L = layoutCard(ctx, i);
        if (L) card(ctx, t, i, L);
      } else if (i >= 0 && i === scenes.length - 1) outro(ctx, t, scenes[i]);
      stinger(ctx, t);
      tickerBar(ctx, t);
      topBar(ctx, t);
      ctx.save();
      ctx.globalAlpha = 0.28;
      tile(ctx, A.grain, W, H, (S.frame * 37) % 256, (S.frame * 53) % 256);
      ctx.restore();
      vignette(S, 0.35, "0,0,0");
    },
  };
}
