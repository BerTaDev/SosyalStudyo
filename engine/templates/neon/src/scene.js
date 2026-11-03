import { TAU, clamp, lerp, prog, ease, mix, rgba, rng, hash, makeCanvas } from "../../_engine/core/util.js";
import { font, vignette } from "../../_engine/core/overlay.js";
import { tile } from "../../_engine/core/assets.js";
import { glow } from "../../_engine/core/kit.js";

const noise = (...n) => hash(...n) / 4294967296;

function wrapWords(ctx, words, maxW) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    const next = [...cur, w];
    if (cur.length && ctx.measureText(next.join(" ")).width > maxW) {
      lines.push(cur);
      cur = [w];
    } else cur = next;
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function fitBox(img, bw, bh) {
  const r = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
  return [img.naturalWidth * r, img.naturalHeight * r];
}

function framePath(c, x, y, w, h, r, gap) {
  const cx = x + w / 2;
  c.beginPath();
  c.moveTo(gap ? cx + gap / 2 : cx, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.lineTo(gap ? cx - gap / 2 : cx, y);
  if (!gap) c.closePath();
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
  const cx = W / 2;
  const signY = H * (tall ? 0.37 : wide ? 0.41 : 0.39);
  const floorY = H * (tall ? 0.7 : wide ? 0.82 : 0.79);
  const maxTextW = W * (wide ? 0.54 : tall ? 0.7 : 0.66);
  const maxTextH = H * (tall ? 0.3 : 0.4);
  const logoImg = images?.ref1 && images.ref1.naturalWidth ? images.ref1 : null;
  const glassCol = mix(C.muted, "#FFFFFF", 0.3);
  const coreA = mix(C.accent, C.text, 0.8);
  const coreB = mix(C.accent2, C.text, 0.8);
  const Q = 4;
  const small = makeCanvas(W / Q, H / Q);
  const bloomA = makeCanvas(W / Q, H / Q);
  const bloomB = makeCanvas(W / Q, H / Q);
  const seed = cfg.video?.seed ?? 7;
  const R = rng(seed + 11);
  const motes = Array.from({ length: 34 }, () => ({ x: R(), y: R(), s: 0.4 + R() * 0.9, v: 0.15 + R() * 0.4, ph: R() * TAU }));
  const wallTex = buildWall();
  const layouts = new Map();
  let outroLayout = null;

  function buildWall() {
    const c = makeCanvas(W, H);
    const g = c.getContext("2d");
    const r = rng(seed + 5);
    g.fillStyle = "#3B3A3A";
    g.fillRect(0, 0, W, H);
    const bw = 172 * k;
    const bh = 56 * k;
    const m = 7 * k;
    for (let row = 0, y = -bh * 0.4; y < floorY + bh; row++, y += bh) {
      for (let x = row % 2 ? -bw / 2 : 0; x < W; x += bw) {
        const v = 150 + r() * 75;
        g.fillStyle = `rgb(${Math.round(v)},${Math.round(v * 0.97)},${Math.round(v * 0.95)})`;
        g.beginPath();
        g.roundRect(x + m / 2, y + m / 2, bw - m, bh - m, 4 * k);
        g.fill();
        const gr = g.createLinearGradient(0, y, 0, y + bh);
        gr.addColorStop(0, "rgba(255,255,255,0.12)");
        gr.addColorStop(0.35, "rgba(255,255,255,0)");
        gr.addColorStop(1, "rgba(0,0,0,0.22)");
        g.fillStyle = gr;
        g.fill();
        if (r() < 0.22) {
          g.fillStyle = "rgba(0,0,0,0.18)";
          g.beginPath();
          g.ellipse(x + bw * (0.2 + r() * 0.6), y + bh * (0.3 + r() * 0.4), bw * (0.08 + r() * 0.12), bh * 0.18, 0, 0, TAU);
          g.fill();
        }
      }
    }
    for (let j = 0; j < 3; j++) tile(g, A.paper, W, H, j * 71, j * 53);
    for (let j = 0; j < 7; j++) {
      const x = r() * W;
      const w = (30 + r() * 140) * k;
      const len = H * (0.25 + r() * 0.5);
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, "rgba(0,0,0,0.14)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x, 0, w, len);
    }
    return c;
  }

  function sceneAt(t) {
    let i = scenes.findIndex((s) => t >= s.start && t < s.end);
    if (i < 0 && scenes.length && t >= scenes[scenes.length - 1].end) i = scenes.length - 1;
    return i;
  }

  function power(lt, d, e, sd, tm, faulty) {
    const t0 = 0.1 + e * tm.stag;
    if (lt < t0) return 0;
    let p = 1;
    const f = (lt - t0) / tm.ign;
    if (f < 1) {
      const n = noise(Math.floor(lt * 22), sd * 97 + e * 13 + 5);
      p = n < f * 1.3 - 0.15 ? 1 : n < f * 1.3 ? 0.4 : 0;
    }
    if (faulty && d > 2.6) {
      const fs = d * 0.55;
      if (lt > fs && lt < fs + 0.32) p = noise(Math.floor(lt * 26), sd * 7 + 3) < 0.5 ? 0.12 : 1;
    }
    const x0 = d - tm.exit - (e % 3) * 0.03;
    if (lt > x0) {
      const g = (lt - x0) / (tm.exit * 0.8);
      if (g >= 1) return 0;
      if (noise(Math.floor(lt * 22), sd * 31 + e * 7 + 9) < g * 1.25) p *= 0.05;
    }
    return p * (0.95 + 0.05 * Math.sin(lt * 37 + e * 1.7));
  }

  function layoutCard(ctx, i) {
    if (layouts.has(i)) return layouts.get(i);
    const text = String(T.cards?.[i] ?? "").trim();
    if (!text) {
      layouts.set(i, null);
      return null;
    }
    const words = text.split(/\s+/).filter(Boolean);
    let size = 132 * k;
    let lines = [];
    const fitOk = () => {
      const lh = size * 1.3;
      return lines.length <= (size < 84 * k ? 4 : 3) && lines.length * lh <= maxTextH && lines.every((l) => ctx.measureText(l.join(" ")).width <= maxTextW);
    };
    for (; size > 46 * k; size -= 3 * k) {
      font(ctx, size, 300, family, "normal", `${size * 0.02}px`);
      lines = wrapWords(ctx, words, maxTextW);
      if (fitOk()) break;
    }
    font(ctx, size, 300, family, "normal", `${size * 0.02}px`);
    const lh = size * 1.3;
    const out = [];
    let widest = 0;
    lines.forEach((line, j) => {
      const str = line.join(" ");
      const lw = ctx.measureText(str).width;
      widest = Math.max(widest, lw);
      const x0 = cx - lw / 2;
      const y = signY + (j - (lines.length - 1) / 2) * lh;
      line.forEach((w, n) => {
        const before = n ? ctx.measureText(line.slice(0, n).join(" ") + " ").width : 0;
        out.push({ str: w, x: x0 + before, y });
      });
    });
    const lw = Math.max(9 * k, size * 0.09);
    const padX = Math.max(size * 0.5, 40 * k);
    const padY = Math.max(size * 0.55, 40 * k);
    const fw = Math.min(W * 0.92, Math.max(widest + padX * 2, W * (wide ? 0.34 : 0.5)));
    const fh = lines.length * lh + padY * 2 - lh * 0.15;
    const fx = cx - fw / 2;
    const fy = signY - fh / 2;
    const labelSize = Math.max(38 * k, size * 0.44);
    const labelStr = String(i + 1).padStart(2, "0");
    font(ctx, labelSize, 300, family, "normal", `${labelSize * 0.08}px`);
    const gap = ctx.measureText(labelStr).width + labelSize * 1.3;
    const L = {
      size,
      words: out,
      frame: { x: fx, y: fy, w: fw, h: fh, r: Math.min(fh, fw) * 0.16, gap, lw },
      label: { str: labelStr, size: labelSize, x: cx, y: fy },
      faulty: Math.floor(noise(i, seed) * out.length),
    };
    layouts.set(i, L);
    return L;
  }

  function cardEls(L, i, lt, d) {
    const els = [];
    const vis = clamp(lt / 0.15) * (1 - prog(lt, d - 0.1, d));
    const tm = { ign: Math.min(0.42, d * 0.2), stag: Math.min(0.07, (d * 0.22) / Math.max(1, L.words.length)), exit: Math.min(0.36, d * 0.16) };
    L.words.forEach((w, e) => els.push({ type: "text", str: w.str, x: w.x, y: w.y, size: L.size, col: C.accent, core: coreA, vis, p: power(lt, d, e, i + 1, tm, e === L.faulty), grp: "a" }));
    const F = L.frame;
    const pf = power(lt - 0.06, d - 0.06, 0, i + 40, tm, false);
    els.push({ type: "frame", x: F.x, y: F.y, w: F.w, h: F.h, r: F.r, gap: F.gap, lw: F.lw, col: C.accent2, core: coreB, vis, p: pf, grp: "b", mount: true, cable: true });
    els.push({ type: "text", align: "center", str: L.label.str, x: L.label.x, y: L.label.y, size: L.label.size, col: C.accent2, core: coreB, vis, p: power(lt - 0.1, d - 0.1, 1, i + 40, tm, false), grp: "b" });
    return els;
  }

  function buildOutro(ctx) {
    const handle = T.handle || "";
    const follow = T.follow || "Takip et";
    const lw = 11 * k;
    let mark;
    if (logoImg) {
      const [w, h] = fitBox(logoImg, Math.min(W * 0.46, 420 * k), 220 * k);
      const pad = 46 * k;
      mark = { kind: "logo", w: w + pad * 2, h: h + pad * 2, lw: w, lh: h };
    } else {
      const r = 128 * k;
      mark = { kind: "circle", w: r * 2, h: r * 2, r };
    }
    let hs = 92 * k;
    font(ctx, hs, 300, family, "normal", `${hs * 0.02}px`);
    while (hs > 40 * k && ctx.measureText(handle).width > W * 0.82) {
      hs -= 3 * k;
      font(ctx, hs, 300, family, "normal", `${hs * 0.02}px`);
    }
    let fs = 62 * k;
    const chevW = 104 * k;
    let tw = 0;
    for (; fs > 30 * k; fs -= 2 * k) {
      font(ctx, fs, 300, family, "normal", `${fs * 0.04}px`);
      tw = ctx.measureText(follow).width;
      if (tw + fs * 1.8 + 40 * k + chevW <= W * 0.86) break;
    }
    const pillW = tw + fs * 1.8;
    const pillH = fs * 1.9;
    const g1 = 96 * k;
    const g2 = 90 * k;
    const total = mark.h + g1 + (handle ? hs + g2 : 0) + pillH;
    const top = H * (tall ? 0.37 : 0.42) - total / 2;
    const my = top + mark.h / 2;
    const hy = top + mark.h + g1 + hs / 2;
    const py = (handle ? hy + hs / 2 + g2 : top + mark.h + g1) + pillH / 2;
    const groupW = pillW + 40 * k + chevW;
    const px = cx - groupW / 2;
    outroLayout = { mark, my, lw, handle, hs, hy, follow, fs, pillW, pillH, px, py, chevX: px + pillW + 40 * k };
    return outroLayout;
  }

  function outroEls(ctx, lt) {
    const O = outroLayout || buildOutro(ctx);
    const tm = { ign: 0.45, stag: 0.05, exit: 0 };
    const vis = clamp(lt / 0.15);
    const els = [];
    const M = O.mark;
    const pm = power(lt, 1e9, 0, 71, tm, false);
    if (M.kind === "logo") els.push({ type: "frame", x: cx - M.w / 2, y: O.my - M.h / 2, w: M.w, h: M.h, r: Math.min(M.w, M.h) * 0.2, lw: O.lw, col: C.accent2, core: coreB, vis, p: pm, grp: "b", mount: true });
    else {
      els.push({ type: "circle", x: cx, y: O.my, r: M.r, lw: O.lw, col: C.accent2, core: coreB, vis, p: pm, grp: "b", mount: true });
      const ch = (O.handle || "@").replace("@", "").slice(0, 1).toLocaleUpperCase("tr-TR") || "@";
      els.push({ type: "text", align: "center", str: ch, x: cx, y: O.my + M.r * 0.04, size: M.r * 1.15, col: C.accent, core: coreA, vis, p: power(lt - 0.2, 1e9, 1, 72, tm, false), grp: "a" });
    }
    if (O.handle) els.push({ type: "text", align: "center", str: O.handle, x: cx, y: O.hy, size: O.hs, col: C.accent, core: coreA, vis, p: power(lt - 0.35, 1e9, 2, 73, tm, false), grp: "a" });
    const pp = power(lt - 0.55, 1e9, 3, 74, tm, false);
    els.push({ type: "frame", x: O.px, y: O.py - O.pillH / 2, w: O.pillW, h: O.pillH, r: O.pillH / 2, lw: O.lw * 0.85, col: C.accent2, core: coreB, vis, p: pp, grp: "b", cable: true });
    els.push({ type: "text", align: "center", spacing: 0.04, str: O.follow, x: O.px + O.pillW / 2, y: O.py, size: O.fs, col: C.accent, core: coreA, vis, p: power(lt - 0.65, 1e9, 4, 75, tm, false), grp: "a" });
    const step = Math.floor((lt - 1.1) * 4);
    for (let j = 0; j < 3; j++) {
      const x = O.chevX + j * 34 * k;
      const h = 24 * k;
      const on = lt < 1.1 ? 0 : step % 4 > j ? 1 : 0.04;
      els.push({ type: "line", pts: [[x, O.py - h], [x + h * 0.85, O.py], [x, O.py + h]], lw: O.lw * 0.8, col: C.accent, core: coreA, vis: vis * clamp((lt - 0.7) / 0.2), p: on * (0.95 + 0.05 * Math.sin(lt * 37 + j)), grp: "a" });
    }
    const logo = M.kind === "logo" ? { x: cx, y: O.my, w: M.lw, h: M.lh, p: pm > 0.3 ? pm : pm * 0.4, vis } : null;
    return { els, logo, cy: O.my + (O.py - O.my) * 0.4 };
  }

  function shape(c, e) {
    if (e.type === "circle") {
      c.beginPath();
      c.arc(e.x, e.y, e.r, 0, TAU);
    } else if (e.type === "frame") framePath(c, e.x, e.y, e.w, e.h, e.r, e.gap);
    else {
      c.beginPath();
      e.pts.forEach((p, j) => (j ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    }
  }

  function drawEl(c, e, mode) {
    const a = mode === "glass" ? e.vis * 0.3 : e.p;
    if (a <= 0.01) return;
    c.save();
    c.globalAlpha = a;
    c.lineJoin = "round";
    c.lineCap = "round";
    if (e.type === "text") {
      font(c, e.size, 300, family, "normal", `${e.size * (e.spacing ?? 0.02)}px`);
      c.textAlign = e.align || "left";
      c.textBaseline = "middle";
      const tw = e.size * 0.085;
      if (mode === "glass") {
        c.fillStyle = c.strokeStyle = glassCol;
        c.lineWidth = tw;
        c.fillText(e.str, e.x, e.y);
        c.strokeText(e.str, e.x, e.y);
      } else if (mode === "bloom") {
        c.globalAlpha = a * clamp(e.size / (110 * k), 0.45, 1);
        c.fillStyle = c.strokeStyle = e.col;
        c.lineWidth = tw * 2.6;
        c.strokeText(e.str, e.x, e.y);
      } else {
        c.fillStyle = c.strokeStyle = e.col;
        c.lineWidth = tw;
        c.fillText(e.str, e.x, e.y);
        c.strokeText(e.str, e.x, e.y);
        c.fillStyle = e.core;
        c.fillText(e.str, e.x, e.y);
      }
    } else {
      shape(c, e);
      if (mode === "glass") {
        c.strokeStyle = glassCol;
        c.lineWidth = e.lw;
        c.stroke();
      } else if (mode === "bloom") {
        c.strokeStyle = e.col;
        c.lineWidth = e.lw * 2.6;
        c.stroke();
      } else {
        c.strokeStyle = e.col;
        c.lineWidth = e.lw;
        c.stroke();
        c.strokeStyle = e.core;
        c.lineWidth = e.lw * 0.42;
        c.stroke();
      }
    }
    c.restore();
  }

  function mounts(c, e) {
    if (!(e.mount || e.cable) || e.vis <= 0) return;
    const pts = [];
    if (e.mount && e.type === "circle") for (let j = 0; j < 4; j++) pts.push([e.x + Math.cos(j * (TAU / 4) + 0.6) * e.r, e.y + Math.sin(j * (TAU / 4) + 0.6) * e.r]);
    else if (e.mount) {
      const ins = e.r * 0.9 + e.w * 0.08;
      pts.push([e.x + ins, e.y], [e.x + e.w - ins, e.y], [e.x + ins, e.y + e.h], [e.x + e.w - ins, e.y + e.h], [e.x, e.y + e.h / 2], [e.x + e.w, e.y + e.h / 2]);
    }
    c.save();
    c.globalAlpha = e.vis;
    for (const [x, y] of pts) {
      c.fillStyle = "#16161B";
      c.beginPath();
      c.roundRect(x - 9 * k, y - 6 * k, 18 * k, 12 * k, 3 * k);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.22)";
      c.fillRect(x - 7 * k, y - 5 * k, 14 * k, 2 * k);
    }
    if (!e.cable) {
      c.restore();
      return;
    }
    const bx = e.type === "circle" ? e.x + e.r * 0.5 : e.x + e.w * 0.8;
    const by = e.type === "circle" ? e.y + e.r * 0.86 : e.y + e.h;
    c.strokeStyle = "#060608";
    c.lineWidth = 5 * k;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(bx, by);
    c.bezierCurveTo(bx + 10 * k, by + (floorY - by) * 0.55, bx + 70 * k, floorY - 40 * k, bx + 120 * k, floorY + 6 * k);
    c.stroke();
    c.strokeStyle = rgba(C.accent, 0.22 * e.p);
    c.lineWidth = 1.6 * k;
    c.stroke();
    c.restore();
  }

  function level(els, grp) {
    let s = 0;
    let n = 0;
    for (const e of els) {
      if (e.grp !== grp) continue;
      s += e.p;
      n++;
    }
    return n ? s / n : 0;
  }

  function renderBloom(els, logo) {
    const s = small.getContext("2d");
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, small.width, small.height);
    s.setTransform(small.width / W, 0, 0, small.height / H, 0, 0);
    for (const e of els) drawEl(s, e, "bloom");
    if (logo && logo.p > 0) {
      s.globalAlpha = logo.p * 0.7;
      s.drawImage(logoImg, logo.x - logo.w / 2, logo.y - logo.h / 2, logo.w, logo.h);
      s.globalAlpha = 1;
    }
    for (const [cv, b] of [[bloomA, 2.5], [bloomB, 9]]) {
      const g = cv.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      g.filter = `blur(${b}px)`;
      g.drawImage(small, 0, 0);
      g.filter = "none";
    }
  }

  function wall(ctx, t, La, Lb, gy) {
    ctx.fillStyle = mix(C.bg2, C.bg, 0.6);
    ctx.fillRect(-20, -20, W + 40, floorY + 40);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const big = Math.max(W, H);
    glow(ctx, cx, gy, big * 0.36, C.accent, 0.8 * La);
    glow(ctx, cx, gy, big * 0.52, C.accent2, 0.3 * Lb);
    glow(ctx, cx, gy, big * 0.2, C.text, 0.12 * (La + Lb));
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(wallTex, 0, 0, W, H);
    ctx.restore();
    const sh = ctx.createLinearGradient(0, floorY - 70 * k, 0, floorY);
    sh.addColorStop(0, "rgba(0,0,0,0)");
    sh.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = sh;
    ctx.fillRect(-20, floorY - 70 * k, W + 40, 70 * k);
  }

  function floor(ctx, t, La, Lb, bottom) {
    const fh = H - floorY;
    const g = ctx.createLinearGradient(0, floorY, 0, H);
    g.addColorStop(0, mix(C.bg2, C.bg, 0.45));
    g.addColorStop(1, C.bg);
    ctx.fillStyle = g;
    ctx.fillRect(-20, floorY, W + 40, fh + 20);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    glow(ctx, cx, floorY, W * 0.7, C.accent, 0.2 * La);
    ctx.beginPath();
    ctx.rect(-20, floorY, W + 40, fh + 20);
    ctx.clip();
    const axis = Math.min(floorY, bottom + 26 * k);
    const sq = 0.82;
    ctx.translate(0, floorY);
    ctx.scale(1, -sq);
    const strips = 48;
    const span = fh / sq;
    const hs = span / strips;
    for (let j = 0; j < strips; j++) {
      const u0 = j * hs;
      const u1 = u0 + hs + 0.5;
      const off = Math.sin(j * 0.55 + t * 1.8) * (1 + j * 0.12) * k;
      const sy = (axis - u1) / Q;
      if (sy + hs / Q < 0) break;
      ctx.globalAlpha = 0.5;
      ctx.drawImage(bloomB, 0, sy, W / Q, (u1 - u0) / Q, off, -u1, W, u1 - u0);
      ctx.globalAlpha = 0.28;
      ctx.drawImage(bloomA, 0, sy, W / Q, (u1 - u0) / Q, off * 1.6, -u1, W, u1 - u0);
    }
    ctx.restore();
    const fade = ctx.createLinearGradient(0, floorY, 0, floorY + Math.min(fh, H * 0.24));
    fade.addColorStop(0, rgba(C.bg, 0.25));
    fade.addColorStop(1, rgba(C.bg, 0.95));
    ctx.fillStyle = fade;
    ctx.fillRect(-20, floorY, W + 40, fh + 20);
    ctx.fillStyle = rgba(mix(C.accent, C.text, 0.4), 0.12 + 0.18 * La);
    ctx.fillRect(-20, floorY, W + 40, 2 * k);
  }

  function dust(ctx, t, L) {
    if (L <= 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const m of motes) {
      const y = ((m.y - t * m.v * 0.03) % 1 + 1) % 1;
      const x = m.x + Math.sin(t * 0.5 + m.ph) * 0.02;
      const px = x * W;
      const py = H * 0.1 + y * (floorY - H * 0.1);
      const near = clamp(1 - Math.hypot(px - cx, py - signY) / (Math.max(W, H) * 0.5));
      const s = 26 * k * m.s;
      ctx.globalAlpha = 0.35 * L * near * (0.6 + 0.4 * Math.sin(t * 2 + m.ph));
      ctx.drawImage(A.mote, px - s / 2, py - s / 2, s, s);
    }
    ctx.restore();
  }

  const cam = (c, t) => {
    const z = 1.022 + 0.008 * Math.sin(t * 0.23);
    c.translate(W / 2, H / 2);
    c.scale(z, z);
    c.translate(-W / 2 + Math.sin(t * 0.37) * 4 * k, -H / 2 + Math.cos(t * 0.29) * 3 * k);
  };

  return {
    renderWorld(ctx, t, S) {
      const i = sceneAt(t);
      let els = [];
      let logo = null;
      let gy = signY;
      let bottom = signY;
      if (i >= 0 && i < count) {
        const L = layoutCard(ctx, i);
        if (L) {
          els = cardEls(L, i, t - scenes[i].start, scenes[i].end - scenes[i].start);
          bottom = L.frame.y + L.frame.h;
        }
      } else if (i >= 0 && i === scenes.length - 1) {
        const o = outroEls(ctx, t - scenes[i].start);
        els = o.els;
        logo = o.logo;
        gy = o.cy;
        bottom = outroLayout.py + outroLayout.pillH / 2;
      }
      const La = level(els, "a");
      const Lb = level(els, "b");
      renderBloom(els, logo);
      ctx.save();
      cam(ctx, t);
      wall(ctx, t, La, Lb, gy);
      for (const e of els) drawEl(ctx, e, "glass");
      if (logo && logo.vis > 0) {
        ctx.save();
        ctx.globalAlpha = logo.vis * 0.25;
        ctx.filter = "grayscale(1) brightness(0.5)";
        ctx.drawImage(logoImg, logo.x - logo.w / 2, logo.y - logo.h / 2, logo.w, logo.h);
        ctx.restore();
      }
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.9;
      ctx.drawImage(bloomB, 0, 0, W, H);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(bloomA, 0, 0, W, H);
      ctx.restore();
      for (const e of els) drawEl(ctx, e, "lit");
      if (logo && logo.p > 0) {
        ctx.save();
        ctx.globalAlpha = logo.p;
        ctx.drawImage(logoImg, logo.x - logo.w / 2, logo.y - logo.h / 2, logo.w, logo.h);
        ctx.restore();
      }
      for (const e of els) mounts(ctx, e);
      floor(ctx, t, La, Lb, bottom);
      dust(ctx, t, (La + Lb) / 2);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.32;
      tile(ctx, A.grain, W, H, (S.frame * 37) % 256, (S.frame * 53) % 256);
      ctx.restore();
      vignette(S, 0.6, "0,0,0");
    },
  };
}
