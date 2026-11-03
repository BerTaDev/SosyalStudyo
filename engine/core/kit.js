import { TAU, clamp, lerp, prog, ease, mix, rgba, hash, rng, Track } from "./util.js";
import { lookAt, viewMotion } from "./view3d.js";
import { label } from "./overlay.js";

export function makeCamera(keys, W, H) {
  const tr = (i, f = (v) => v) => new Track(keys.map((k) => [k[0], f(k[i] ?? keys[0][i])]));
  const kx = tr(1);
  const ky = tr(2);
  const kz = tr(3, Math.log);
  const kp = tr(4);
  const kyaw = tr(5);
  const kf = tr(6);
  const at = (t) => ({ x: kx.at(t), y: ky.at(t), zoom: Math.exp(kz.at(t)), pitch: kp.at(t), yaw: kyaw.at(t), fov: kf.at(t) });
  const view = (t) => {
    const c = at(t);
    return lookAt(W, H, { tx: c.x, ty: c.y, zoom: c.zoom, pitch: c.pitch, yaw: c.yaw, fov: c.fov });
  };
  const apply = (ctx, t) => {
    const c = at(t);
    ctx.translate(W / 2, H / 2);
    ctx.rotate((-c.yaw * Math.PI) / 180);
    ctx.scale(c.zoom, c.zoom);
    ctx.translate(-c.x, -c.y);
    return c;
  };
  const toS = (t, x, y) => {
    const c = at(t);
    const a = (-c.yaw * Math.PI) / 180;
    const dx = (x - c.x) * c.zoom;
    const dy = (y - c.y) * c.zoom;
    return [W / 2 + dx * Math.cos(a) - dy * Math.sin(a), H / 2 + dx * Math.sin(a) + dy * Math.cos(a)];
  };
  const motion = (t, dt) => viewMotion(view(t - dt / 2), view(t + dt / 2), W, H);
  return { at, view, apply, toS, motion };
}

export function cityGrid({ seed = 1, cols = 8, rows = 12, block = 90, road = 26, cx = 0, cy = 0, hMin = 10, hMax = 60, skip = () => false }) {
  const R = rng(seed);
  const pitch = block + road;
  const x0 = cx - (cols * pitch) / 2 + road / 2;
  const y0 = cy - (rows * pitch) / 2 + road / 2;
  const blocks = [];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const bx = x0 + i * pitch;
      const by = y0 + j * pitch;
      if (skip(i, j)) continue;
      const split = R();
      const lots = split < 0.3 ? [[0, 0, 1, 1]] : split < 0.65 ? [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] : [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
      const dist = Math.hypot(bx + block / 2 - cx, by + block / 2 - cy) / (Math.max(cols, rows) * pitch * 0.5);
      for (const [lx, ly, lw, lh] of lots) {
        const pad = 4;
        blocks.push({
          x: bx + lx * block + pad,
          y: by + ly * block + pad,
          w: lw * block - pad * 2,
          d: lh * block - pad * 2,
          h: lerp(hMax, hMin, clamp(dist)) * (0.45 + R() * 0.55),
          tone: R(),
          i,
          j,
          delay: R(),
        });
      }
    }
  const roadsX = [];
  const roadsY = [];
  for (let i = 0; i <= cols; i++) roadsX.push(x0 - road / 2 + i * pitch - road / 2 + road / 2);
  for (let j = 0; j <= rows; j++) roadsY.push(y0 - road / 2 + j * pitch - road / 2 + road / 2);
  return { blocks, roadsX, roadsY, road, x0: x0 - road, y0: y0 - road, x1: x0 + cols * pitch, y1: y0 + rows * pitch, pitch, block };
}

export function drawGround(ctx, v, city, col, roadCol, lineCol, k = 1) {
  ctx.beginPath();
  v.poly(ctx, [[city.x0 - 2000, city.y0 - 2000], [city.x1 + 2000, city.y0 - 2000], [city.x1 + 2000, city.y1 + 2000], [city.x0 - 2000, city.y1 + 2000]]);
  ctx.fillStyle = col;
  ctx.fill();
  if (k <= 0) return;
  const w = city.road * k;
  ctx.fillStyle = roadCol;
  ctx.beginPath();
  for (const x of city.roadsX) v.poly(ctx, [[x - w / 2, city.y0], [x + w / 2, city.y0], [x + w / 2, city.y1], [x - w / 2, city.y1]]);
  for (const y of city.roadsY) v.poly(ctx, [[city.x0, y - w / 2], [city.x1, y - w / 2], [city.x1, y + w / 2], [city.x0, y + w / 2]]);
  ctx.fill();
  if (lineCol) {
    ctx.strokeStyle = lineCol;
    ctx.lineWidth = Math.max(1, v.scaleAt((city.x0 + city.x1) / 2, (city.y0 + city.y1) / 2) * 1.2);
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    for (const x of city.roadsX) v.line(ctx, [x, city.y0], [x, city.y1]);
    for (const y of city.roadsY) v.line(ctx, [city.x0, y], [city.x1, y]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function buildingItems(ctx, v, blocks, { grow = () => 1, colors, edge = null, W = 1080, H = 1920 }) {
  const items = [];
  for (const b of blocks) {
    const g = grow(b);
    if (g <= 0) continue;
    const h = Math.max(0.4, b.h * g);
    const cxp = b.x + b.w / 2;
    const cyp = b.y + b.d / 2;
    const pc = v.project(cxp, cyp, 0);
    if (!pc || pc[0] < -700 || pc[0] > W + 700 || pc[1] < -700 || pc[1] > H + 700) continue;
    const top = typeof colors.top === "function" ? colors.top(b) : colors.top;
    const side = typeof colors.side === "function" ? colors.side(b) : colors.side;
    const side2 = mix(side, "#000000", 0.18);
    items.push({
      d: v.depth(cxp, cyp, h / 2),
      draw: () => {
        if (colors.shadow) {
          ctx.fillStyle = colors.shadow;
          ctx.beginPath();
          const sx = h * 0.35;
          const sy = h * 0.28;
          v.poly(ctx, [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w + sx, b.y + sy], [b.x + b.w + sx, b.y + b.d + sy], [b.x + sx, b.y + b.d + sy], [b.x, b.y + b.d]]);
          ctx.fill();
        }
        v.box(ctx, b.x, b.y, b.x + b.w, b.y + b.d, 0, h, { T: top, N: side2, S: side, W: side2, E: side }, edge, 1);
      },
    });
  }
  return items;
}

export function drawItems(items) {
  items.sort((a, b) => b.d - a.d);
  for (const it of items) it.draw();
}

export function unitDot(ctx, x, y, r, col, alpha = 1, ring = "#FFFFFF") {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = col;
  ctx.strokeStyle = ring;
  ctx.lineWidth = Math.max(1.5, r * 0.22);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function hexagon(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

export function progressRing(ctx, x, y, r, k, col, alpha = 1, lw = 8) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = col;
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(k));
  ctx.stroke();
  ctx.restore();
}

export function arrow(ctx, a, b, col, lw = 6, head = 22) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0] - Math.cos(ang) * head * 0.6, b[1] - Math.sin(ang) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b[0], b[1]);
  ctx.lineTo(b[0] - Math.cos(ang - 0.45) * head, b[1] - Math.sin(ang - 0.45) * head);
  ctx.lineTo(b[0] - Math.cos(ang + 0.45) * head, b[1] - Math.sin(ang + 0.45) * head);
  ctx.closePath();
  ctx.fill();
}

export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

export function pointAlong(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + l >= s || i === pts.length - 1) {
      const k = l ? clamp((s - acc) / l) : 0;
      return { x: lerp(pts[i - 1][0], pts[i][0], k), y: lerp(pts[i - 1][1], pts[i][1], k), a: Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]) };
    }
    acc += l;
  }
  return { x: pts[0][0], y: pts[0][1], a: 0 };
}

export function routeLine(ctx, v, pts, k, col, lw = 4, dash = [16, 10], t = 0, z = 1) {
  if (k <= 0) return null;
  const L = polylineLength(pts);
  const upto = L * k;
  ctx.save();
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  ctx.setLineDash(dash);
  ctx.lineDashOffset = -t * 40;
  ctx.beginPath();
  let acc = 0;
  let last = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc > upto) break;
    const e = Math.min(1, (upto - acc) / (l || 1));
    const bb = [lerp(a[0], b[0], e), lerp(a[1], b[1], e)];
    v.line(ctx, [a[0], a[1], z], [bb[0], bb[1], z]);
    last = [a, bb];
    acc += l;
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (last) {
    const pa = v.project(last[0][0], last[0][1], z);
    const pb = v.project(last[1][0], last[1][1], z);
    if (pa && pb && Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) > 1) {
      const ang = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(pb[0] + Math.cos(ang) * lw * 4, pb[1] + Math.sin(ang) * lw * 4);
      ctx.lineTo(pb[0] + Math.cos(ang + 2.5) * lw * 4.5, pb[1] + Math.sin(ang + 2.5) * lw * 4.5);
      ctx.lineTo(pb[0] + Math.cos(ang - 2.5) * lw * 4.5, pb[1] + Math.sin(ang - 2.5) * lw * 4.5);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
  return last ? last[1] : null;
}

export function ring(ctx, x, y, r, col, lw = 3, alpha = 1) {
  if (alpha <= 0 || r <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

export function glow(ctx, x, y, r, col, a = 0.5) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(col, a));
  g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

export function irisMask(ctx, x, y, r, k) {
  if (k <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = `rgba(0,0,0,${clamp(k)})`;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function fadeMask(ctx, W, H, k) {
  if (k <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = `rgba(0,0,0,${clamp(k)})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

export function paperBg(ctx, W, H, col, A, alpha = 0.55) {
  ctx.fillStyle = col;
  ctx.fillRect(0, 0, W, H);
  if (A && alpha > 0) {
    ctx.globalAlpha = alpha;
    for (let x = 0; x < W; x += A.paper.width) for (let y = 0; y < H; y += A.paper.height) ctx.drawImage(A.paper, x, y);
    ctx.globalAlpha = 1;
  }
}
