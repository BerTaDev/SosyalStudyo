import { TAU, clamp, lerp, prog, ease, rgba } from "../../_engine/core/util.js";
import { font, label } from "../../_engine/core/overlay.js";
import { tile } from "../../_engine/core/assets.js";

function drawLogo(ctx, img, cx, cy, box) {
  const r = Math.min(box / img.naturalWidth, box / img.naturalHeight);
  const w = img.naturalWidth * r;
  const h = img.naturalHeight * r;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

function parseWords(text) {
  const words = [];
  let on = false;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    let w = raw;
    let em = on;
    if (w.startsWith("*")) {
      w = w.slice(1);
      em = true;
      on = true;
    }
    if (w.endsWith("*")) {
      w = w.slice(0, -1);
      on = false;
    }
    if (w) words.push({ w, em });
  }
  if (words.length > 1 && !words.some((x) => x.em)) words[words.length - 1].em = true;
  return words;
}

export default async function makeScene({ cfg, tl, W, H, A, images }) {
  const C = cfg.colors;
  const T = cfg.text || {};
  const scenes = tl.scenes;
  const count = Math.max(0, scenes.length - 1);
  const sans = cfg.fonts?.[0] || "Segoe UI";
  const serif = cfg.fonts?.[1] || "Georgia";
  const k = Math.min(1, W / 1080, H / 1300);
  const land = W > H * 1.2;
  const tall = W / H < 0.7;
  const mx = W * (land ? 0.09 : 0.1);
  const topY = H * 0.12;
  const botY = H * (tall ? 0.8 : 0.86);
  const cy = H * (tall ? 0.38 : 0.4);
  const logoImg = images?.ref1 && images.ref1.naturalWidth ? images.ref1 : null;
  const layouts = new Map();
  const pad2 = (n) => String(n).padStart(2, "0");

  function sceneAt(t) {
    let i = scenes.findIndex((s) => t >= s.start && t < s.end);
    if (i < 0 && scenes.length && t >= scenes[scenes.length - 1].end) i = scenes.length - 1;
    return i;
  }

  function setWordFont(ctx, w, size) {
    if (w.em) font(ctx, size * 1.04, "italic 400", serif);
    else font(ctx, size, 300, sans);
  }

  function layout(ctx, i) {
    if (layouts.has(i)) return layouts.get(i);
    const text = String(T.cards?.[i] ?? "").trim();
    if (!text) {
      layouts.set(i, null);
      return null;
    }
    const words = parseWords(text);
    const maxW = W - mx * 2 - (land ? W * 0.12 : 0);
    let size = (land ? 130 : 122) * k;
    let lines;
    for (; size > 44 * k; size -= 3) {
      lines = [];
      let cur = [];
      let curW = 0;
      font(ctx, size, 300, sans);
      const space = ctx.measureText(" ").width;
      let ok = true;
      for (const w of words) {
        setWordFont(ctx, w, size);
        const ww = ctx.measureText(w.w).width;
        if (ww > maxW) ok = false;
        if (cur.length && curW + space + ww > maxW) {
          lines.push(cur);
          cur = [];
          curW = 0;
        }
        cur.push(Object.assign({ x: curW + (cur.length ? space : 0), width: ww }, w));
        curW += (cur.length > 1 ? space : 0) + ww;
      }
      if (cur.length) lines.push(cur);
      if (ok && lines.length <= 4 && lines.length * size * 1.14 <= H * 0.3) break;
    }
    const L = { size, lines, lh: size * 1.14 };
    layouts.set(i, L);
    return L;
  }

  function background(ctx, t) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.2, H * 0.1, 0, W * 0.2, H * 0.1, Math.max(W, H) * 0.9);
    g.addColorStop(0, rgba(C.bg2, 0.9));
    g.addColorStop(1, rgba(C.bg2, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const R = Math.min(W, H) * 0.42;
    const ox = W * (land ? 0.82 : 0.86) + Math.sin(t * 0.18) * 14 * k;
    const oy = H * (land ? 0.3 : 0.24) + Math.cos(t * 0.15) * 14 * k;
    const a = ease.outCubic(prog(t, 0.1, 1.6));
    ctx.save();
    ctx.strokeStyle = rgba(C.text, 0.08);
    ctx.lineWidth = 1.6 * k;
    ctx.beginPath();
    ctx.arc(ox, oy, R, -Math.PI / 2 + t * 0.05, -Math.PI / 2 + t * 0.05 + TAU * a);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ox, oy, R * 0.72, Math.PI / 2 - t * 0.07, Math.PI / 2 - t * 0.07 + TAU * a * 0.6);
    ctx.stroke();
    const dot = -Math.PI / 2 + t * 0.05 + TAU * a;
    ctx.fillStyle = rgba(C.accent, 0.8 * a);
    ctx.beginPath();
    ctx.arc(ox + Math.cos(dot) * R, oy + Math.sin(dot) * R, 6 * k, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function frame(ctx, t, i) {
    const a = ease.inOutCubic(prog(t, 0.05, 1.0));
    ctx.save();
    ctx.strokeStyle = rgba(C.text, 0.22);
    ctx.lineWidth = 1.6 * k;
    ctx.beginPath();
    ctx.moveTo(mx, topY);
    ctx.lineTo(mx + (W - 2 * mx) * a, topY);
    ctx.moveTo(W - mx, botY);
    ctx.lineTo(W - mx - (W - 2 * mx) * a, botY);
    ctx.stroke();
    ctx.restore();
    const la = ease.outCubic(prog(t, 0.4, 1.0));
    if (la <= 0) return;
    const shown = i < 0 ? 0 : Math.min(i + 1, count);
    const ly = topY - 34 * k;
    label(ctx, i >= count ? "SON" : `${pad2(shown)} — ${pad2(count)}`, mx, ly, 26 * k, C.text, { weight: 600, family: sans, align: "left", spacing: `${5 * k}px`, alpha: la });
    label(ctx, (T.handle || "").toLocaleUpperCase("tr-TR"), W - mx, ly, 26 * k, C.muted, { weight: 400, family: sans, align: "right", spacing: `${5 * k}px`, alpha: la });
    const total = scenes.length ? scenes[scenes.length - 1].end : 1;
    const p = clamp(t / total);
    const by = botY;
    ctx.fillStyle = C.text;
    ctx.globalAlpha = la;
    ctx.beginPath();
    ctx.arc(mx + (W - 2 * mx) * p, by, 5 * k, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function content(ctx, t, i) {
    const L = layout(ctx, i);
    if (!L) return;
    const s = scenes[i];
    const lt = t - s.start;
    const out = ease.inOutQuad(prog(t, s.end - 0.45, s.end - 0.05));
    const drift = (t - s.start) * 4 * k;
    const blockH = L.lines.length * L.lh;
    const top = cy - blockH / 2 + L.lh / 2 - out * 30 * k - drift * 0.5;
    const na = ease.outCubic(prog(lt, 0.1, 0.6)) * (1 - out);
    if (na > 0) {
      const ny = top - L.lh / 2 - 70 * k;
      ctx.save();
      ctx.globalAlpha = na;
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(mx, ny);
      ctx.lineTo(mx + 56 * k * na, ny);
      ctx.stroke();
      ctx.restore();
      label(ctx, `No. ${i + 1}`, mx + 76 * k, ny + 2 * k, 34 * k, C.accent, { weight: "italic 400", family: serif, align: "left", alpha: na });
    }
    let wi = 0;
    L.lines.forEach((line, j) => {
      const y = top + j * L.lh;
      ctx.save();
      ctx.beginPath();
      ctx.rect(mx - 20 * k, y - L.lh * 0.62, W, L.lh * 1.22);
      ctx.clip();
      for (const w of line) {
        const e = ease.outCubic(prog(lt, 0.2 + wi * 0.07, 0.85 + wi * 0.07));
        wi++;
        if (e <= 0) continue;
        ctx.globalAlpha = e * (1 - out);
        setWordFont(ctx, w, L.size);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = w.em ? C.accent : C.text;
        ctx.fillText(w.w, mx + w.x, y + lerp(L.lh * 0.7, 0, e));
      }
      ctx.restore();
    });
    const ly = top + (L.lines.length - 0.5) * L.lh + 50 * k;
    const ga = ease.inOutCubic(prog(lt, 0.5, 1.4));
    const gr = ease.inOutCubic(prog(t, s.end - 0.5, s.end - 0.05));
    const x0 = mx + (W - 2 * mx) * gr;
    const x1 = mx + (W - 2 * mx) * ga;
    if (x1 > x0) {
      ctx.save();
      ctx.strokeStyle = rgba(C.text, 0.5);
      ctx.lineWidth = 1.6 * k;
      ctx.beginPath();
      ctx.moveTo(x0, ly);
      ctx.lineTo(x1, ly);
      ctx.stroke();
      ctx.fillStyle = C.text;
      ctx.beginPath();
      ctx.arc(x1, ly, 5 * k, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function outro(ctx, t, s) {
    const lt = t - s.start;
    const r = 120 * k;
    const oy = H * (tall ? 0.33 : 0.34);
    const ra = ease.inOutCubic(prog(lt, 0.25, 1.1));
    const fa = ease.outCubic(prog(lt, 0.45, 1.0));
    if (logoImg) {
      ctx.save();
      ctx.globalAlpha = fa;
      drawLogo(ctx, logoImg, W / 2, oy + lerp(20, 0, fa) * k, r * 2);
      ctx.restore();
    } else {
      ctx.save();
      ctx.strokeStyle = C.text;
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.arc(W / 2, oy, r, -Math.PI / 2, -Math.PI / 2 + TAU * ra);
      ctx.stroke();
      ctx.restore();
      label(ctx, (T.handle || "@").replace("@", "").slice(0, 1).toLocaleUpperCase("tr-TR") || "@", W / 2, oy + lerp(16, 4, fa) * k, r * 1.05, C.text, { weight: 400, family: serif, alpha: fa });
    }
    const ha = ease.outCubic(prog(lt, 0.6, 1.15));
    const hy = oy + r + 100 * k;
    label(ctx, T.handle || "", W / 2, hy + lerp(24, 0, ha) * k, 56 * k, C.text, { weight: 300, family: sans, alpha: ha, spacing: `${2 * k}px` });
    const pa = ease.outCubic(prog(lt, 0.85, 1.35));
    if (pa > 0) {
      const text = (T.follow || "Takip et").toLocaleUpperCase("tr-TR");
      font(ctx, 32 * k, 600, sans, "normal", `${6 * k}px`);
      const tw = ctx.measureText(text).width;
      const pw = tw + 150 * k;
      const ph = 92 * k;
      const py = hy + 120 * k + lerp(20, 0, pa) * k;
      const fill = ease.inOutCubic(prog(lt, 1.3, 1.8));
      ctx.save();
      ctx.globalAlpha = pa;
      ctx.beginPath();
      ctx.roundRect(W / 2 - pw / 2, py - ph / 2, pw, ph, ph / 2);
      ctx.strokeStyle = C.text;
      ctx.lineWidth = 2 * k;
      ctx.stroke();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = C.text;
      ctx.fillRect(W / 2 - pw / 2, py - ph / 2, pw * fill, ph);
      ctx.restore();
      const nudge = Math.sin(lt * 4) * 4 * k;
      ctx.save();
      ctx.beginPath();
      ctx.rect(W / 2 - pw / 2, py - ph / 2, pw * fill, ph);
      ctx.clip();
      label(ctx, text, W / 2 - 20 * k, py + 2 * k, 32 * k, C.bg, { weight: 600, family: sans, spacing: `${6 * k}px` });
      label(ctx, "→", W / 2 + tw / 2 + 14 * k + nudge, py, 34 * k, C.bg, { weight: 400, family: sans });
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(W / 2 - pw / 2 + pw * fill, py - ph / 2, pw * (1 - fill), ph);
      ctx.clip();
      label(ctx, text, W / 2 - 20 * k, py + 2 * k, 32 * k, C.text, { weight: 600, family: sans, spacing: `${6 * k}px` });
      label(ctx, "→", W / 2 + tw / 2 + 14 * k + nudge, py, 34 * k, C.text, { weight: 400, family: sans });
      ctx.restore();
      ctx.restore();
    }
  }

  return {
    renderWorld(ctx, t, S) {
      background(ctx, t);
      const i = sceneAt(t);
      frame(ctx, t, i);
      if (i >= 0 && i < count) content(ctx, t, i);
      else if (i === scenes.length - 1) outro(ctx, t, scenes[i]);
      ctx.save();
      ctx.globalAlpha = 0.18;
      tile(ctx, A.grain, W, H, (S.frame * 37) % 256, (S.frame * 53) % 256);
      ctx.restore();
    },
  };
}
