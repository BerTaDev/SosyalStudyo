import { TAU, clamp, lerp, prog, ease, mix, rgba, rng } from "../../_engine/core/util.js";
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

function partial(ctx, pts, k) {
  if (k <= 0 || pts.length < 2) return null;
  let L = 0;
  const seg = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(l);
    L += l;
  }
  const target = L * clamp(k);
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = seg[i - 1];
    if (acc + l >= target) {
      const e = l ? (target - acc) / l : 0;
      out.push([lerp(pts[i - 1][0], pts[i][0], e), lerp(pts[i - 1][1], pts[i][1], e)]);
      break;
    }
    out.push(pts[i]);
    acc += l;
  }
  return out;
}

const UNITS = ["kat", "dakika", "dk", "saniye", "sn", "saat", "gün", "hafta", "ay", "yıl", "kişi", "bin", "milyon", "milyar", "tl", "lira", "adım", "kez", "defa", "gb", "mb", "km", "kg", "x"];

function parse(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const m = text.match(/%\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?%?/);
  if (!m) return { kind: "text", text };
  const tok = m[0].replace(/\s/g, "");
  const pct = tok.includes("%");
  const digits = tok.replace("%", "");
  const dec = /[.,]\d{1,2}$/.test(digits) ? digits.split(/[.,]/)[1].length : 0;
  const value = dec ? parseFloat(digits.replace(",", ".")) : parseFloat(digits.replace(/[.,]/g, ""));
  if (!isFinite(value)) return { kind: "text", text };
  const before = text.slice(0, m.index).trim();
  let after = text.slice(m.index + m[0].length);
  after = after.replace(/^['’]\S*/, "").trim();
  let unit = "";
  if (!pct) {
    const first = after.split(/\s+/)[0] || "";
    const low = first.toLocaleLowerCase("tr-TR");
    const u = UNITS.find((x) => low.startsWith(x) && low.length <= x.length + 4);
    if (u) {
      unit = first;
      after = after.slice(first.length).trim();
    }
  }
  return { kind: pct ? "pct" : "num", value, dec, prefix: pct && tok.startsWith("%"), suffix: pct && !tok.startsWith("%"), unit, caption: `${before} ${after}`.trim() };
}

function fmt(v, dec) {
  const s = v.toFixed(dec);
  const [i, d] = s.split(".");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return d ? `${int},${d}` : int;
}

export default async function makeScene({ cfg, tl, W, H, A, images }) {
  const C = cfg.colors;
  const T = cfg.text || {};
  const scenes = tl.scenes;
  const count = Math.max(0, scenes.length - 1);
  const numFamily = cfg.fonts?.[0] || "Bahnschrift";
  const family = cfg.fonts?.[1] || "Segoe UI";
  const k = Math.min(1, W / 1080, H / 1300);
  const land = W > H * 1.2;
  const tall = W / H < 0.7;
  const logoImg = images?.ref1 && images.ref1.naturalWidth ? images.ref1 : null;
  const cards = Array.from({ length: count }, (_, i) => parse(T.cards?.[i]));
  const numCy = H * (tall ? 0.255 : 0.25);
  const capY = H * (tall ? 0.375 : 0.4);
  const chartTop = H * (tall ? 0.45 : 0.47);
  const chartBot = H * (tall ? 0.62 : 0.62);
  const chartW = Math.min(W * 0.84, (chartBot - chartTop) * 5.2);
  const chartX = (W - chartW) / 2;
  const R = rng(cfg.video?.seed ?? 7);
  const columns = Array.from({ length: 7 }, (_, j) => 0.22 + (j / 6) * 0.55 + R() * 0.16);
  const linePts = Array.from({ length: 9 }, (_, j) => 0.15 + (j / 8) * 0.7 + (R() - 0.5) * 0.22 * (j % 2 ? 1 : -1));
  linePts[8] = 0.95;

  function sceneAt(t) {
    let i = scenes.findIndex((s) => t >= s.start && t < s.end);
    if (i < 0 && scenes.length && t >= scenes[scenes.length - 1].end) i = scenes.length - 1;
    return i;
  }

  function background(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg2);
    g.addColorStop(1, C.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const R2 = Math.max(W, H);
    glow(ctx, W * 0.5 + Math.sin(t * 0.3) * W * 0.15, H * 0.22, R2 * 0.45, C.accent, 0.13);
    glow(ctx, W * 0.15, H * 0.7 + Math.cos(t * 0.25) * H * 0.05, R2 * 0.35, C.accent2, 0.1);
    const sp = 72 * k;
    const oy = (t * 14 * k) % sp;
    ctx.save();
    ctx.strokeStyle = rgba(C.text, 0.045);
    ctx.lineWidth = 1.5 * k;
    ctx.beginPath();
    for (let x = (W / 2) % sp; x < W; x += sp) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = -sp + oy; y < H; y += sp) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    ctx.fillStyle = rgba(C.accent, 0.16);
    for (let x = (W / 2) % sp; x < W; x += sp * 3)
      for (let y = -sp + oy; y < H; y += sp * 3) ctx.fillRect(x - 3 * k, y - 3 * k, 6 * k, 6 * k);
    ctx.restore();
  }

  function chip(ctx, t, i) {
    const a = ease.outCubic(prog(t, 0.1, 0.6));
    if (a <= 0) return;
    const y = H * 0.13;
    const text = i < count ? `VERİ ${String(i + 1).padStart(2, "0")}` : "TAKİPTE KAL";
    font(ctx, 30 * k, 700, numFamily, "normal", `${5 * k}px`);
    const w = ctx.measureText(text).width + 90 * k;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = rgba(C.accent, 0.6);
    ctx.lineWidth = 2.5 * k;
    ctx.fillStyle = rgba(C.accent, 0.08);
    ctx.beginPath();
    ctx.roundRect(W / 2 - w / 2, y - 30 * k, w, 60 * k, 30 * k);
    ctx.fill();
    ctx.stroke();
    const blink = 0.5 + 0.5 * Math.sin(t * 5);
    ctx.fillStyle = C.accent;
    ctx.globalAlpha = a * (0.4 + blink * 0.6);
    ctx.beginPath();
    ctx.arc(W / 2 - w / 2 + 34 * k, y, 8 * k, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = a;
    label(ctx, text, W / 2 + 16 * k, y + 2 * k, 30 * k, C.text, { weight: 700, family: numFamily, spacing: `${5 * k}px` });
    ctx.restore();
  }

  function bigNumber(ctx, t, s, c, out) {
    const p = prog(t, s.start + 0.15, s.start + 0.6);
    if (p <= 0) return;
    const count1 = ease.outCubic(prog(t, s.start + 0.15, s.start + 1.35));
    const v = c.value * count1;
    const str = `${c.prefix ? "%" : ""}${fmt(v, c.dec)}${c.suffix ? "%" : ""}`;
    const fin = `${c.prefix ? "%" : ""}${fmt(c.value, c.dec)}${c.suffix ? "%" : ""}`;
    const base0 = Math.min((land ? 300 : 340) * k, H * (tall ? 0.18 : 0.2));
    let size = base0;
    font(ctx, size, 700, numFamily);
    const unitSize = size * 0.34;
    let fw = ctx.measureText(fin).width;
    font(ctx, unitSize, 700, numFamily);
    const uw = c.unit ? ctx.measureText(c.unit.toLocaleUpperCase("tr-TR")).width + 24 * k : 0;
    if (fw + uw > W * 0.86) size *= (W * 0.86) / (fw + uw);
    font(ctx, size, 700, numFamily);
    fw = ctx.measureText(fin).width;
    const total = fw + (c.unit ? uw * (size / base0) : 0);
    const x0 = W / 2 - total / 2;
    const y = numCy + lerp(60, 0, ease.outCubic(p)) * k - out * 80 * k;
    const capH = size * 0.36;
    ctx.save();
    ctx.globalAlpha = ease.outCubic(p) * (1 - out);
    glow(ctx, W / 2, numCy, size * 1.3, C.accent, 0.12 + 0.04 * Math.sin(t * 2.2));
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    font(ctx, size, 700, numFamily);
    const gr = ctx.createLinearGradient(0, y - capH, 0, y + capH);
    gr.addColorStop(0, mix(C.accent, "#FFFFFF", 0.35));
    gr.addColorStop(1, C.accent);
    ctx.fillStyle = gr;
    ctx.shadowColor = rgba(C.accent, 0.45);
    ctx.shadowBlur = 40 * k;
    ctx.fillText(str, x0, y + capH);
    ctx.shadowBlur = 0;
    if (c.unit) {
      const us = size * 0.34;
      font(ctx, us, 700, numFamily);
      ctx.fillStyle = C.text;
      ctx.fillText(c.unit.toLocaleUpperCase("tr-TR"), x0 + fw + 24 * k * (size / base0), y + capH);
    }
    ctx.restore();
  }

  function caption(ctx, t, s, text, y0, size, out, accentLast) {
    if (!text) return;
    const f = fit(ctx, text, W * 0.84, 3, size, size * 0.55, 800, family);
    const lh = f.size * 1.16;
    const top = y0 - ((f.lines.length - 1) * lh) / 2;
    let wi = 0;
    const nWords = text.split(/\s+/).filter(Boolean).length;
    f.lines.forEach((line, j) => {
      font(ctx, f.size, 800, family);
      const words = line.split(" ");
      const space = ctx.measureText(" ").width;
      const widths = words.map((w) => ctx.measureText(w).width);
      let x = W / 2 - (widths.reduce((p, q) => p + q, 0) + space * (words.length - 1)) / 2;
      words.forEach((w, n) => {
        const e = ease.outCubic(prog(t, s.start + 0.45 + wi * 0.06, s.start + 0.9 + wi * 0.06));
        const isLast = wi === nWords - 1;
        wi++;
        if (e > 0) {
          ctx.save();
          ctx.globalAlpha = e * (1 - out);
          label(ctx, w, x, top + j * lh + lerp(36, 0, e) * k - out * 60 * k, f.size, accentLast && isLast ? C.accent : C.text, { weight: 800, family, align: "left" });
          ctx.restore();
        }
        x += widths[n] + space;
      });
    });
  }

  function waffle(ctx, t, s, value, out) {
    const cols = 20;
    const rows = 5;
    const gap = 7 * k;
    const cell = Math.min((chartW - gap * (cols - 1)) / cols, (chartBot - chartTop - gap * (rows - 1)) / rows);
    const gw = cols * cell + (cols - 1) * gap;
    const gx = W / 2 - gw / 2;
    const lit = Math.round(clamp(value, 0, 100));
    const fillK = prog(t, s.start + 0.3, s.start + 1.35);
    for (let n = 0; n < 100; n++) {
      const cx = n % cols;
      const cy = Math.floor(n / cols);
      const appear = ease.outBack(prog(t, s.start + 0.2 + (cx + cy) * 0.018, s.start + 0.5 + (cx + cy) * 0.018));
      const gone = ease.inCubic(prog(t, s.end - 0.4 + ((cx + cy) / 24) * 0.2, s.end - 0.15 + ((cx + cy) / 24) * 0.2));
      const sc = clamp(appear) * (1 - gone);
      if (sc <= 0) continue;
      const on = n < Math.round(lit * fillK);
      const x = gx + cx * (cell + gap) + cell / 2;
      const y = chartTop + cy * (cell + gap) + cell / 2;
      const c2 = cell * sc * (on ? 1 + 0.06 * Math.sin(t * 3 + n * 0.3) : 0.86);
      ctx.fillStyle = on ? (n === lit - 1 ? mix(C.accent, "#FFFFFF", 0.4) : C.accent) : rgba(C.text, 0.1);
      ctx.beginPath();
      ctx.roundRect(x - c2 / 2, y - c2 / 2, c2, c2, c2 * 0.25);
      ctx.fill();
    }
    const la = ease.outCubic(prog(t, s.start + 1.0, s.start + 1.4)) * (1 - out);
    if (la > 0 && tall) {
      label(ctx, `100'DE ${lit}`, W / 2, chartBot + 52 * k, 34 * k, C.muted, { weight: 600, family: numFamily, alpha: la, spacing: `${2 * k}px` });
    }
  }

  function columnsChart(ctx, t, s, out) {
    const n = columns.length;
    const gap = chartW * 0.035;
    const cw = (chartW - gap * (n - 1)) / n;
    const hMax = chartBot - chartTop;
    ctx.save();
    ctx.strokeStyle = rgba(C.text, 0.18);
    ctx.lineWidth = 2 * k;
    const base = ease.outCubic(prog(t, s.start + 0.15, s.start + 0.6)) * (1 - out);
    ctx.beginPath();
    ctx.moveTo(W / 2 - (chartW / 2) * base, chartBot + 6 * k);
    ctx.lineTo(W / 2 + (chartW / 2) * base, chartBot + 6 * k);
    ctx.stroke();
    ctx.restore();
    for (let j = 0; j < n; j++) {
      const grow = ease.outCubic(prog(t, s.start + 0.3 + j * 0.08, s.start + 1.0 + j * 0.08));
      const shrink = ease.inCubic(prog(t, s.end - 0.42 + j * 0.03, s.end - 0.12 + j * 0.03));
      const breathe = 1 + Math.sin(t * 2 + j) * 0.015;
      const h = hMax * columns[j] * (j === n - 1 ? 1.25 : 1) * 0.8 * grow * (1 - shrink) * breathe;
      if (h <= 1) continue;
      const x = chartX + j * (cw + gap);
      const last = j === n - 1;
      const g = ctx.createLinearGradient(0, chartBot - h, 0, chartBot);
      g.addColorStop(0, last ? mix(C.accent, "#FFFFFF", 0.25) : rgba(C.accent2, 0.55));
      g.addColorStop(1, last ? C.accent : rgba(C.accent2, 0.15));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x, chartBot - h, cw, h, [cw * 0.18, cw * 0.18, 0, 0]);
      ctx.fill();
      if (last && grow > 0.9) {
        const pulse = ((t - s.start) % 1.2) / 1.2;
        ring(ctx, x + cw / 2, chartBot - h, 10 * k + pulse * 40 * k, C.accent, 3 * k, (1 - pulse) * 0.7 * (1 - shrink));
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(x + cw / 2, chartBot - h, 9 * k * (1 - shrink), 0, TAU);
        ctx.fill();
      }
    }
  }

  function lineChart(ctx, t, s, out) {
    const pts = linePts.map((v, j) => [chartX + (j / (linePts.length - 1)) * chartW, chartBot - v * (chartBot - chartTop) + Math.sin(t * 1.5 + j) * 3 * k]);
    const draw = ease.inOutCubic(prog(t, s.start + 0.4, s.start + 1.5)) * (1 - ease.inCubic(prog(t, s.end - 0.4, s.end - 0.1)));
    const part = partial(ctx, pts, draw);
    if (!part) return;
    ctx.save();
    const g = ctx.createLinearGradient(0, chartTop, 0, chartBot);
    g.addColorStop(0, rgba(C.accent, 0.35));
    g.addColorStop(1, rgba(C.accent, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(part[0][0], chartBot);
    part.forEach((p) => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(part[part.length - 1][0], chartBot);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 7 * k;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = rgba(C.accent, 0.6);
    ctx.shadowBlur = 18 * k;
    ctx.beginPath();
    part.forEach((p, j) => (j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
    ctx.shadowBlur = 0;
    const tip = part[part.length - 1];
    ctx.fillStyle = "#FFFFFF";
    for (const p of pts) if (p[0] <= tip[0] + 1) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 7 * k, 0, TAU);
      ctx.fill();
    }
    const pulse = ((t - s.start) % 1.0) / 1.0;
    ring(ctx, tip[0], tip[1], 12 * k + pulse * 36 * k, C.accent, 3 * k, (1 - pulse) * 0.8);
    ctx.fillStyle = C.accent;
    ctx.beginPath();
    ctx.arc(tip[0], tip[1], 12 * k, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function source(ctx, t, s, out) {
    if (!T.source) return;
    const a = ease.outCubic(prog(t, s.start + 1.0, s.start + 1.4)) * (1 - out);
    label(ctx, `Kaynak: ${T.source}`, W / 2, chartBot + 100 * k, 26 * k, C.muted, { weight: 500, family, alpha: a * 0.8 });
  }

  function content(ctx, t, s, c) {
    const out = ease.inCubic(prog(t, s.end - 0.4, s.end - 0.08));
    if (c.kind === "text") {
      caption(ctx, t, s, c.text, H * (tall ? 0.29 : 0.3), (land ? 92 : 108) * k, out, true);
      lineChart(ctx, t, s, out);
    } else {
      bigNumber(ctx, t, s, c, out);
      caption(ctx, t, s, c.caption, capY, (land ? 60 : 70) * k, out, false);
      if (c.kind === "pct" && c.value <= 100) waffle(ctx, t, s, c.value, out);
      else columnsChart(ctx, t, s, out);
    }
    source(ctx, t, s, out);
  }

  function outro(ctx, t, s) {
    const lt = t - s.start;
    const r = 130 * k;
    const oy = H * (tall ? 0.33 : 0.3);
    const p = prog(lt, 0.3, 0.85);
    const a = ease.outBack(p);
    const sweep = ease.inOutCubic(prog(lt, 0.4, 1.4));
    if (p > 0) {
      ctx.save();
      ctx.translate(W / 2, oy);
      ctx.scale(Math.max(0, a), Math.max(0, a));
      glow(ctx, 0, 0, r * 2.4, C.accent, 0.25);
      if (logoImg) drawLogo(ctx, logoImg, 0, 0, r * 2);
      else {
        const g = ctx.createLinearGradient(-r, -r, r, r);
        g.addColorStop(0, C.accent);
        g.addColorStop(1, C.accent2);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.fill();
        label(ctx, (T.handle || "@").replace("@", "").slice(0, 1).toLocaleUpperCase("tr-TR") || "@", 0, 8 * k, r * 1.05, C.bg, { weight: 700, family: numFamily });
      }
      ctx.restore();
      const rr = (logoImg ? r * 1.25 : r) + 30 * k;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineWidth = 8 * k;
      ctx.strokeStyle = rgba(C.text, 0.1);
      ctx.beginPath();
      ctx.arc(W / 2, oy, rr, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = C.accent;
      ctx.shadowColor = rgba(C.accent, 0.7);
      ctx.shadowBlur = 16 * k;
      ctx.beginPath();
      ctx.arc(W / 2, oy, rr, -Math.PI / 2, -Math.PI / 2 + TAU * sweep);
      ctx.stroke();
      ctx.restore();
      for (let j = 0; j < 24; j++) {
        const ang = (j / 24) * TAU;
        const len = (j % 6 === 0 ? 18 : 9) * k;
        ctx.strokeStyle = rgba(C.text, j / 24 < sweep ? 0.5 : 0.12);
        ctx.lineWidth = 2.5 * k;
        ctx.beginPath();
        ctx.moveTo(W / 2 + Math.cos(ang) * (rr + 20 * k), oy + Math.sin(ang) * (rr + 20 * k));
        ctx.lineTo(W / 2 + Math.cos(ang) * (rr + 20 * k + len), oy + Math.sin(ang) * (rr + 20 * k + len));
        ctx.stroke();
      }
    }
    const k2 = ease.outCubic(prog(lt, 0.6, 1.1));
    const hy = oy + r + (tall ? 140 : 110) * k;
    label(ctx, T.handle || "", W / 2, hy + lerp(40, 0, k2) * k, 66 * k, C.text, { weight: 800, family, alpha: k2 });
    const k3 = prog(lt, 0.85, 1.35);
    if (k3 > 0) {
      const e = ease.outBack(k3);
      const text = T.follow || "Takip et";
      font(ctx, 44 * k, 800, family);
      const pw = Math.max(320 * k, ctx.measureText(text).width + 120 * k);
      const ph = 96 * k;
      ctx.save();
      ctx.globalAlpha = clamp(e);
      ctx.translate(W / 2, hy + (tall ? 125 : 100) * k);
      ctx.scale(lerp(0.7, 1, clamp(e)), lerp(0.7, 1, clamp(e)));
      ctx.shadowColor = rgba(C.accent, 0.5);
      ctx.shadowBlur = 30 * k * (0.6 + 0.4 * Math.sin(lt * 4));
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      label(ctx, text, 0, 3 * k, 44 * k, C.bg, { weight: 800, family });
      ctx.restore();
    }
  }

  return {
    renderWorld(ctx, t, S) {
      background(ctx, t);
      const i = sceneAt(t);
      if (i >= 0) chip(ctx, t, i);
      if (i >= 0 && i < count && cards[i]) content(ctx, t, scenes[i], cards[i]);
      else if (i === scenes.length - 1 && i >= count) outro(ctx, t, scenes[i]);
      ctx.save();
      ctx.globalAlpha = 0.4;
      tile(ctx, A.grain, W, H, (S.frame * 37) % 256, (S.frame * 53) % 256);
      ctx.restore();
      vignette(S, 0.45, "0,0,0");
    },
  };
}
