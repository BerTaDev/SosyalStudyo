export const TAU = Math.PI * 2;

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(...n) {
  let h = 2166136261;
  for (const v of n) {
    h ^= Math.floor(v) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, k) => a + (b - a) * k;
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const range = (t, r) => prog(t, r[0], r[1]);
export const smooth = (k) => k * k * (3 - 2 * k);
export const smoother = (k) => k * k * k * (k * (k * 6 - 15) + 10);

export const ease = {
  linear: (k) => k,
  inQuad: (k) => k * k,
  outQuad: (k) => 1 - (1 - k) * (1 - k),
  inOutQuad: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
  inCubic: (k) => k * k * k,
  outCubic: (k) => 1 - Math.pow(1 - k, 3),
  inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  inOutQuart: (k) => (k < 0.5 ? 8 * k ** 4 : 1 - Math.pow(-2 * k + 2, 4) / 2),
  outExpo: (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
  inExpo: (k) => (k <= 0 ? 0 : Math.pow(2, 10 * k - 10)),
  inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
  outBack: (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2),
  outElastic: (k) => (k <= 0 ? 0 : k >= 1 ? 1 : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * (TAU / 3)) + 1),
};

export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const a = (hash(i, seed) / 4294967296) * 2 - 1;
  const b = (hash(i + 1, seed) / 4294967296) * 2 - 1;
  return lerp(a, b, smooth(f));
}

export function fbm1(x, seed = 0) {
  return noise1(x, seed) * 0.6 + noise1(x * 2.1, seed + 17) * 0.3 + noise1(x * 4.3, seed + 41) * 0.1;
}

export function hexToRgb(hex) {
  if (hex.startsWith("rgb")) return hex.slice(hex.indexOf("(") + 1, -1).split(",").slice(0, 3).map(Number);
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function mix(a, b, k, alpha = 1) {
  const A = typeof a === "string" ? hexToRgb(a) : a;
  const B = typeof b === "string" ? hexToRgb(b) : b;
  const r = Math.round(lerp(A[0], B[0], k));
  const g = Math.round(lerp(A[1], B[1], k));
  const bl = Math.round(lerp(A[2], B[2], k));
  return `rgba(${r},${g},${bl},${alpha})`;
}

export function rgba(hex, alpha) {
  const [r, g, b] = typeof hex === "string" ? hexToRgb(hex) : hex;
  return `rgba(${r},${g},${b},${alpha})`;
}

export class Track {
  constructor(keys) {
    this.k = keys.slice().sort((a, b) => a[0] - b[0]);
    const n = this.k.length;
    const d = [];
    const m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d.push((this.k[i + 1][1] - this.k[i][1]) / (this.k[i + 1][0] - this.k[i][0]));
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else {
        const h0 = this.k[i][0] - this.k[i - 1][0];
        const h1 = this.k[i + 1][0] - this.k[i][0];
        const w1 = 2 * h1 + h0;
        const w2 = h1 + 2 * h0;
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    this.m = m;
  }
  at(t) {
    const k = this.k;
    if (t <= k[0][0]) return k[0][1];
    if (t >= k[k.length - 1][0]) return k[k.length - 1][1];
    let i = 0;
    while (t > k[i + 1][0]) i++;
    const h = k[i + 1][0] - k[i][0];
    const s = (t - k[i][0]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * k[i][1] + (s3 - 2 * s2 + s) * h * this.m[i] + (-2 * s3 + 3 * s2) * k[i + 1][1] + (s3 - s2) * h * this.m[i + 1];
  }
}

export class Path {
  constructor(points, step = 1) {
    const pts = [];
    const P = points;
    const n = P.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = P[Math.max(0, i - 1)];
      const p1 = P[i];
      const p2 = P[i + 1];
      const p3 = P[Math.min(n - 1, i + 2)];
      const seg = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let j = 0; j < seg; j++) {
        const t = j / seg;
        const t2 = t * t;
        const t3 = t2 * t;
        pts.push([
          0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ]);
      }
    }
    pts.push(P[n - 1].slice());
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.length = this.cum[this.cum.length - 1];
  }
  index(s) {
    const c = this.cum;
    if (s <= 0) return [0, 0];
    if (s >= this.length) return [c.length - 2, 1];
    let lo = 0;
    let hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid;
      else hi = mid;
    }
    return [lo, (s - c[lo]) / (c[lo + 1] - c[lo] || 1)];
  }
  at(s) {
    const [i, f] = this.index(s);
    const a = this.pts[i];
    const b = this.pts[i + 1];
    return { x: lerp(a[0], b[0], f), y: lerp(a[1], b[1], f), a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  normalAt(s) {
    const p = this.at(s);
    return [-Math.sin(p.a), Math.cos(p.a)];
  }
  trace(ctx, s0 = 0, s1 = this.length) {
    if (s1 <= s0) return;
    const [i0, f0] = this.index(s0);
    const [i1, f1] = this.index(s1);
    const a = this.pts[i0];
    const b = this.pts[i0 + 1];
    ctx.moveTo(lerp(a[0], b[0], f0), lerp(a[1], b[1], f0));
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(this.pts[i][0], this.pts[i][1]);
    const c = this.pts[i1];
    const d = this.pts[i1 + 1];
    ctx.lineTo(lerp(c[0], d[0], f1), lerp(c[1], d[1], f1));
  }
  nearest(x, y) {
    let best = Infinity;
    let bs = 0;
    for (let i = 0; i < this.pts.length; i += 2) {
      const d = (this.pts[i][0] - x) ** 2 + (this.pts[i][1] - y) ** 2;
      if (d < best) {
        best = d;
        bs = this.cum[i];
      }
    }
    return { s: bs, d: Math.sqrt(best) };
  }
}

export function pingpong(v, L) {
  const m = ((v % (2 * L)) + 2 * L) % (2 * L);
  return m <= L ? { s: m, dir: 1 } : { s: 2 * L - m, dir: -1 };
}

export function ellipsePath(p, x, y, rx, ry, rot = 0) {
  p.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  p.ellipse(x, y, rx, ry, rot, 0, TAU);
}

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function blobPoints(r, rnd, n = 14, rough = 0.22, aspect = 1) {
  const off = rnd() * TAU;
  const amps = [rnd() * rough, rnd() * rough * 0.6, rnd() * rough * 0.4];
  const ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = 1 + amps[0] * Math.sin(2 * a + ph[0]) + amps[1] * Math.sin(3 * a + ph[1]) + amps[2] * Math.sin(5 * a + ph[2]);
    pts.push([Math.cos(a + off) * r * k * aspect, Math.sin(a + off) * r * k]);
  }
  return pts;
}

export function smoothClosed(ctx, pts) {
  const n = pts.length;
  const mid = (i) => [(pts[i][0] + pts[(i + 1) % n][0]) / 2, (pts[i][1] + pts[(i + 1) % n][1]) / 2];
  const m0 = mid(n - 1);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(i);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  ctx.closePath();
}
