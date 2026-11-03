import { TAU, clamp, lerp, prog, ease, mix, rgba, rng } from "../../_engine/core/util.js";
import { font, label, vignette } from "../../_engine/core/overlay.js";
import { tile } from "../../_engine/core/assets.js";

function drawLogo(ctx, img, cx, cy, box) {
  const r = Math.min(box / img.naturalWidth, box / img.naturalHeight);
  const w = img.naturalWidth * r;
  const h = img.naturalHeight * r;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

function partial(ctx, pts, k) {
  if (k <= 0 || pts.length < 2) return;
  const seg = [];
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(l);
    L += l;
  }
  const target = L * clamp(k);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = seg[i - 1];
    if (acc + l >= target) {
      const e = l ? (target - acc) / l : 0;
      ctx.lineTo(lerp(pts[i - 1][0], pts[i][0], e), lerp(pts[i - 1][1], pts[i][1], e));
      break;
    }
    ctx.lineTo(pts[i][0], pts[i][1]);
    acc += l;
  }
  ctx.stroke();
}

function parseWords(text) {
  const words = [];
  let on = false;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    let w = raw;
    let hl = on;
    if (w.startsWith("*")) {
      w = w.slice(1);
      hl = true;
      on = true;
    }
    if (w.endsWith("*")) {
      w = w.slice(0, -1);
      on = false;
    }
    if (w) words.push({ w, hl });
  }
  if (!words.some((x) => x.hl)) {
    let best = null;
    for (const x of words) if (x.w.length >= 3 && (!best || x.w.length >= best.w.length)) best = x;
    if (best) best.hl = true;
  }
  return words;
}

export default async function makeScene({ cfg, tl, W, H, A, images }) {
  const C = cfg.colors;
  const T = cfg.text || {};
  const scenes = tl.scenes;
  const count = Math.max(0, scenes.length - 1);
  const hand = cfg.fonts?.[0] || "Segoe Print";
  const family = cfg.fonts?.[1] || "Segoe UI";
  const k = Math.min(1, W / 1080, H / 1300);
  const tall = W / H < 0.7;
  const noteH = H * (tall ? 0.42 : 0.44);
  const noteW = Math.min(W * 0.8, noteH * (tall ? 1 : 1.45));
  const ncx = W / 2;
  const ncy = H * (tall ? 0.405 : 0.385);
  const noteCol = "#FFE68A";
  const ink = C.text;
  const logoImg = images?.ref1 && images.ref1.naturalWidth ? images.ref1 : null;
  const R = rng(cfg.video?.seed ?? 7);
  const fibers = Array.from({ length: 140 }, () => ({ x: R() * W, y: R() * H, l: (20 + R() * 60) * k, a: R() * TAU, c: R() }));
  const rots = [-2.6, 2.1, -1.5, 2.8, -2.2, 1.6];
  const layouts = new Map();

  function sceneAt(t) {
    let i = scenes.findIndex((s) => t >= s.start && t < s.end);
    if (i < 0 && scenes.length && t >= scenes[scenes.length - 1].end) i = scenes.length - 1;
    return i;
  }

  function wobbleLine(x0, x1, y, seed, amp) {
    const r = rng(seed);
    const pts = [];
    const n = 14;
    for (let j = 0; j <= n; j++) {
      const e = j / n;
      pts.push([lerp(x0, x1, e), y + Math.sin(e * 5.5 + seed) * amp * 0.5 + (r() - 0.5) * amp * 0.5 - e * amp * 0.8]);
    }
    return pts;
  }

  function layout(ctx, i) {
    if (layouts.has(i)) return layouts.get(i);
    const text = String(T.cards?.[i] ?? "").trim();
    if (!text) {
      layouts.set(i, null);
      return null;
    }
    const words = parseWords(text);
    const maxW = noteW * 0.8;
    const areaH = noteH * 0.6;
    let size = 100 * k;
    let lines = [];
    for (; size > 40 * k; size -= 3) {
      font(ctx, size, 700, hand);
      lines = [];
      let cur = [];
      let curW = 0;
      const space = ctx.measureText(" ").width;
      for (const w of words) {
        const ww = ctx.measureText(w.w).width;
        if (cur.length && curW + space + ww > maxW) {
          lines.push({ words: cur, w: curW });
          cur = [];
          curW = 0;
        }
        curW += (cur.length ? space : 0) + ww;
        cur.push(Object.assign({ width: ww }, w));
      }
      if (cur.length) lines.push({ words: cur, w: curW });
      if (lines.length * size * 1.3 <= areaH && lines.every((l) => l.w <= maxW)) break;
    }
    font(ctx, size, 700, hand);
    const space = ctx.measureText(" ").width;
    const lh = size * 1.3;
    const top = noteH * 0.08 - ((lines.length - 1) * lh) / 2;
    const marks = [];
    lines.forEach((line, j) => {
      line.x = -line.w / 2;
      line.y = top + j * lh;
      let x = line.x;
      let run = null;
      for (const w of line.words) {
        if (w.hl) {
          if (!run) run = { x0: x, y: line.y, j };
          run.x1 = x + w.width;
        } else if (run) {
          marks.push(run);
          run = null;
        }
        x += w.width + space;
      }
      if (run) marks.push(run);
    });
    const last = lines[lines.length - 1];
    const under = wobbleLine(last.x - size * 0.15, last.x + last.w + size * 0.2, last.y + size * 0.62, i * 7 + 3, size * 0.12);
    const total = lines.reduce((p, l) => p + l.w, 0);
    const L = { size, lines, marks, under, total, rot: (rots[i % rots.length] * Math.PI) / 180 };
    layouts.set(i, L);
    return L;
  }

  function background(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.bg2);
    g.addColorStop(1, C.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.9;
    tile(ctx, A.paper, W, H);
    ctx.restore();
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 1.6 * k;
    for (const f of fibers) {
      ctx.strokeStyle = f.c < 0.5 ? "rgba(90,60,30,0.10)" : "rgba(255,245,225,0.16)";
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.quadraticCurveTo(f.x + Math.cos(f.a) * f.l * 0.5 + 6 * k, f.y + Math.sin(f.a) * f.l * 0.5, f.x + Math.cos(f.a) * f.l, f.y + Math.sin(f.a) * f.l);
      ctx.stroke();
    }
    ctx.restore();
    const lightX = W * (0.3 + Math.sin(t * 0.25) * 0.1);
    const lg = ctx.createRadialGradient(lightX, H * 0.3, 0, lightX, H * 0.3, Math.max(W, H) * 0.7);
    lg.addColorStop(0, "rgba(255,248,230,0.28)");
    lg.addColorStop(1, "rgba(255,248,230,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);
    doodles(ctx, t);
  }

  function doodles(ctx, t) {
    const a = ease.outCubic(prog(t, 0.2, 1.4));
    ctx.save();
    ctx.strokeStyle = rgba(C.muted, 0.45);
    ctx.lineWidth = 4 * k;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const star = (x, y, r, rot) => {
      const pts = [];
      for (let j = 0; j <= 10; j++) {
        const ang = rot + (j * Math.PI * 4) / 5;
        pts.push([x + Math.cos(ang) * r, y + Math.sin(ang) * r]);
      }
      partial(ctx, pts, a);
    };
    const swirl = (x, y, r) => {
      const pts = [];
      for (let j = 0; j <= 40; j++) {
        const ang = (j / 40) * TAU * 2.2;
        const rr = r * (j / 40);
        pts.push([x + Math.cos(ang) * rr, y + Math.sin(ang) * rr]);
      }
      partial(ctx, pts, a);
    };
    const sway = Math.sin(t * 0.8) * 0.05;
    star(W * 0.12, H * 0.09, 34 * k, -Math.PI / 2 + sway);
    swirl(W * 0.88, H * 0.1, 38 * k);
    star(W * 0.9, H * 0.86, 26 * k, -Math.PI / 2 - sway);
    const wave = [];
    for (let j = 0; j <= 30; j++) wave.push([W * 0.08 + j * 7 * k, H * 0.88 + Math.sin(j * 0.7 + t * 0.6) * 12 * k]);
    partial(ctx, wave, a);
    ctx.restore();
  }

  function stickyBase(ctx, w, h, col) {
    ctx.save();
    ctx.shadowColor = "rgba(70,45,20,0.38)";
    ctx.shadowBlur = 46 * k;
    ctx.shadowOffsetY = 22 * k;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.lineTo(w / 2, h / 2 - h * 0.04);
    ctx.quadraticCurveTo(w / 2 - w * 0.02, h / 2, w / 2 - w * 0.08, h / 2 + h * 0.008);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.clip();
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, "rgba(255,255,255,0.18)");
    g.addColorStop(0.15, "rgba(255,255,255,0)");
    g.addColorStop(0.85, "rgba(120,80,0,0)");
    g.addColorStop(1, "rgba(120,80,0,0.14)");
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.globalAlpha = 0.8;
    ctx.translate(-w / 2, -h / 2);
    tile(ctx, A.paper, w, h, 40, 90);
    ctx.restore();
  }

  function tape(ctx, x, y, w, h, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = "rgba(255,250,235,0.62)";
    ctx.shadowColor = "rgba(70,45,20,0.12)";
    ctx.shadowBlur = 6 * k;
    ctx.beginPath();
    const zig = h / 6;
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    for (let j = 0; j <= 6; j++) ctx.lineTo(w / 2 + (j % 2 ? -zig * 0.6 : 0), -h / 2 + j * zig);
    ctx.lineTo(-w / 2, h / 2);
    for (let j = 6; j >= 0; j--) ctx.lineTo(-w / 2 + (j % 2 ? zig * 0.6 : 0), -h / 2 + j * zig);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function circleNum(ctx, n, x, y, r, e, seed) {
    if (e <= 0) return;
    const pts = [];
    for (let j = 0; j <= 48; j++) {
      const a = -2.2 + (j / 48) * TAU * 1.12;
      const rr = r * (1 + 0.07 * Math.sin(a * 3 + seed) + (j / 48) * 0.08);
      pts.push([x + Math.cos(a) * rr * 1.08, y + Math.sin(a) * rr]);
    }
    ctx.save();
    ctx.strokeStyle = C.accent2;
    ctx.lineWidth = 6 * k;
    ctx.lineCap = "round";
    partial(ctx, pts, ease.inOutQuad(e));
    ctx.restore();
    label(ctx, String(n), x, y + 4 * k, r * 1.15, C.accent2, { weight: 700, family: hand, alpha: clamp(e * 2) });
  }

  function note(ctx, t, i, exit) {
    const L = layout(ctx, i);
    if (!L) return;
    const s = scenes[i];
    const d = s.end - s.start;
    const lt = t - s.start;
    const drop = ease.outBack(prog(lt, 0, 0.55));
    const din = prog(lt, 0, 0.55);
    if (din <= 0) return;
    const ex = ease.inCubic(exit);
    const x = ncx - ex * W * 0.95 + Math.sin(t * 0.7 + i) * 3 * k;
    const y = ncy - (1 - drop) * H * 0.55 + ex * H * 0.12;
    const rot = L.rot + (1 - drop) * 0.14 - ex * 0.35 + Math.sin(t * 0.9 + i) * 0.004;
    const sc = lerp(1.1, 1, clamp(din * 1.4)) * lerp(1, 0.92, ex);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    stickyBase(ctx, noteW, noteH, noteCol);
    tape(ctx, 0, -noteH / 2, noteW * 0.34, noteH * 0.1, -L.rot * 1.6 + 0.04);
    circleNum(ctx, i + 1, -noteW / 2 + noteW * 0.13, -noteH / 2 + noteH * 0.14, Math.min(noteW, noteH) * 0.065, prog(lt, 0.3, 0.85), i);
    const wStart = 0.35;
    const wDur = clamp(d * 0.3, 0.5, 1.2);
    const wEnd = wStart + wDur;
    for (const m of L.marks) {
      const e = ease.outCubic(prog(lt, wEnd - 0.1, wEnd + 0.3));
      if (e <= 0) continue;
      const h = L.size * 0.62;
      const y0 = m.y + L.size * 0.12 - h / 2;
      const x0 = m.x0 - L.size * 0.12;
      const x1 = lerp(x0, m.x1 + L.size * 0.14, e);
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = rgba(C.accent, 0.75);
      ctx.beginPath();
      ctx.moveTo(x0 + 4 * k, y0 + 3 * k);
      ctx.lineTo(x1, y0 - 2 * k);
      ctx.lineTo(x1 - 6 * k, y0 + h + 2 * k);
      ctx.lineTo(x0, y0 + h - 2 * k);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    font(ctx, L.size, 700, hand);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let acc = 0;
    for (const line of L.lines) {
      const a = (acc / L.total) * wDur + wStart;
      const b = ((acc + line.w) / L.total) * wDur + wStart;
      acc += line.w;
      const e = prog(lt, a, b);
      if (e <= 0) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(line.x - L.size * 0.3, line.y - L.size, (line.w + L.size * 0.6) * e, L.size * 2);
      ctx.clip();
      ctx.fillStyle = ink;
      ctx.fillText(line.words.map((w) => w.w).join(" "), line.x, line.y);
      ctx.restore();
    }
    const u = prog(lt, wEnd + 0.1, wEnd + 0.5);
    if (u > 0) {
      ctx.save();
      ctx.strokeStyle = C.accent2;
      ctx.lineWidth = 7 * k;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      partial(ctx, L.under, ease.inOutQuad(u));
      ctx.restore();
    }
    ctx.restore();
  }

  function outro(ctx, t, s) {
    const lt = t - s.start;
    const r = 130 * k;
    const oy = H * (tall ? 0.31 : 0.3);
    const a = prog(lt, 0.35, 0.85);
    if (a > 0) {
      const e = ease.outBack(a);
      ctx.save();
      ctx.translate(W / 2, oy - (1 - e) * 120 * k);
      ctx.rotate(-0.05 + (1 - e) * 0.3 + Math.sin(t * 0.8) * 0.01);
      ctx.scale(lerp(1.15, 1, clamp(a * 1.3)), lerp(1.15, 1, clamp(a * 1.3)));
      if (logoImg) {
        const box = r * 2.1;
        const pw = box + 60 * k;
        stickyBase(ctx, pw, pw, "#FFFCF4");
        drawLogo(ctx, logoImg, 0, 0, box);
        tape(ctx, 0, -pw / 2, pw * 0.45, pw * 0.13, 0.06);
      } else {
        ctx.save();
        ctx.shadowColor = "rgba(70,45,20,0.38)";
        ctx.shadowBlur = 40 * k;
        ctx.shadowOffsetY = 18 * k;
        ctx.fillStyle = "#FFFCF4";
        ctx.beginPath();
        ctx.arc(0, 0, r + 14 * k, 0, TAU);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = C.accent2;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.fill();
        label(ctx, (T.handle || "@").replace("@", "").slice(0, 1).toLocaleUpperCase("tr-TR") || "@", 0, 10 * k, r * 1.1, "#FFFCF4", { weight: 700, family: hand });
        tape(ctx, 0, -r - 6 * k, r * 1.1, r * 0.32, 0.08);
      }
      ctx.restore();
    }
    const hy = oy + r + 120 * k;
    const handle = T.handle || "";
    font(ctx, 72 * k, 700, hand);
    const hw = ctx.measureText(handle).width;
    const hk = ease.outCubic(prog(lt, 0.9, 1.3));
    if (hk > 0 && handle) {
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = rgba(C.accent, 0.7);
      const x0 = W / 2 - hw / 2 - 20 * k;
      const x1 = lerp(x0, W / 2 + hw / 2 + 20 * k, hk);
      ctx.beginPath();
      ctx.moveTo(x0, hy - 22 * k);
      ctx.lineTo(x1, hy - 28 * k);
      ctx.lineTo(x1 - 6 * k, hy + 34 * k);
      ctx.lineTo(x0 + 4 * k, hy + 30 * k);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const wk = prog(lt, 0.55, 1.05);
    if (wk > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(W / 2 - hw / 2 - 30 * k, hy - 80 * k, (hw + 60 * k) * wk, 160 * k);
      ctx.clip();
      label(ctx, handle, W / 2, hy, 72 * k, ink, { weight: 700, family: hand });
      ctx.restore();
    }
    const ck = prog(lt, 1.1, 1.5);
    if (ck > 0) {
      const text = T.follow || "Takip et";
      font(ctx, 48 * k, 700, hand);
      const pw = Math.max(320 * k, ctx.measureText(text).width + 110 * k);
      const ph = 104 * k;
      const py = hy + 150 * k;
      const e = ease.outBack(ck);
      ctx.save();
      ctx.translate(W / 2, py);
      ctx.rotate(-0.02);
      ctx.scale(lerp(0.6, 1, clamp(e)) * (1 + Math.sin(lt * 4) * 0.015), lerp(0.6, 1, clamp(e)) * (1 + Math.sin(lt * 4) * 0.015));
      ctx.globalAlpha = clamp(e);
      ctx.shadowColor = "rgba(70,45,20,0.3)";
      ctx.shadowBlur = 20 * k;
      ctx.shadowOffsetY = 8 * k;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
      ctx.fill();
      ctx.shadowColor = "transparent";
      label(ctx, text, 0, 2 * k, 48 * k, "#FFF6E4", { weight: 700, family: hand });
      ctx.restore();
      const arrowK = prog(lt, 1.35, 1.8);
      if (arrowK > 0) {
        const ax = W / 2 - pw / 2 - 40 * k;
        const pts = [];
        for (let j = 0; j <= 20; j++) {
          const e2 = j / 20;
          pts.push([ax - 150 * k + e2 * 130 * k, py - 120 * k + Math.pow(e2, 1.6) * 110 * k + Math.sin(e2 * 3) * 14 * k]);
        }
        ctx.save();
        ctx.strokeStyle = C.accent2;
        ctx.lineWidth = 6 * k;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        partial(ctx, pts, ease.inOutQuad(arrowK));
        if (arrowK >= 1) {
          const [ex, ey] = pts[pts.length - 1];
          const [px, py2] = pts[pts.length - 3];
          const ang = Math.atan2(ey - py2, ex - px);
          ctx.beginPath();
          ctx.moveTo(ex + Math.cos(ang + 2.5) * 30 * k, ey + Math.sin(ang + 2.5) * 30 * k);
          ctx.lineTo(ex, ey);
          ctx.lineTo(ex + Math.cos(ang - 2.5) * 30 * k, ey + Math.sin(ang - 2.5) * 30 * k);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  return {
    renderWorld(ctx, t, S) {
      background(ctx, t);
      const i = sceneAt(t);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(Math.sin(t * 0.35) * 0.004);
      ctx.translate(-W / 2 + Math.sin(t * 0.5) * 4 * k, -H / 2 + Math.cos(t * 0.4) * 4 * k);
      if (i > 0 && i - 1 < count) {
        const e = prog(t, scenes[i].start, scenes[i].start + 0.5);
        if (e < 1) note(ctx, t, i - 1, e);
      }
      if (i >= 0 && i < count) note(ctx, t, i, 0);
      else if (i === scenes.length - 1) outro(ctx, t, scenes[i]);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.35;
      tile(ctx, A.grain, W, H, (S.frame * 37) % 256, (S.frame * 53) % 256);
      ctx.restore();
      vignette(S, 0.32, "60,35,10");
    },
  };
}
