export class View3D {
  constructor(W, H) {
    this.W = W;
    this.H = H;
    this.near = 0.05;
  }

  set({ x, y, z, yaw = 0, pitch = 90, fov = 40, ox = 0, oy = 0, roll = 0 }) {
    const p = (pitch * Math.PI) / 180;
    const ya = (yaw * Math.PI) / 180;
    const hx = Math.sin(ya);
    const hy = -Math.cos(ya);
    this.F = [Math.cos(p) * hx, Math.cos(p) * hy, -Math.sin(p)];
    let R = [Math.cos(ya), Math.sin(ya), 0];
    let D = cross(R, this.F);
    if (roll) {
      const r = (roll * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      [R, D] = [add(scale(R, c), scale(D, s)), add(scale(D, c), scale(R, -s))];
    }
    this.R = R;
    this.D = D;
    this.C = [x, y, z];
    this.f = this.H / 2 / Math.tan(((fov * Math.PI) / 180) / 2);
    this.cx = this.W / 2 + ox;
    this.cy = this.H / 2 + oy;
    return this;
  }

  static heightFor(zoom, fov, H) {
    return H / 2 / Math.tan(((fov * Math.PI) / 180) / 2) / zoom;
  }

  cam(x, y, z = 0) {
    const v = [x - this.C[0], y - this.C[1], z - this.C[2]];
    return [dot(v, this.R), dot(v, this.D), dot(v, this.F)];
  }

  screen(c) {
    return [this.cx + (this.f * c[0]) / c[2], this.cy + (this.f * c[1]) / c[2]];
  }

  project(x, y, z = 0) {
    const c = this.cam(x, y, z);
    if (c[2] < this.near) return null;
    const s = this.screen(c);
    return [s[0], s[1], c[2]];
  }

  ground(sx, sy, gz = 0) {
    const dx = (sx - this.cx) / this.f;
    const dy = (sy - this.cy) / this.f;
    const d = [this.F[0] + this.R[0] * dx + this.D[0] * dy, this.F[1] + this.R[1] * dx + this.D[1] * dy, this.F[2] + this.R[2] * dx + this.D[2] * dy];
    if (d[2] > -1e-6) return null;
    const s = (gz - this.C[2]) / d[2];
    return [this.C[0] + d[0] * s, this.C[1] + d[1] * s];
  }

  scaleAt(x, y, z = 0) {
    const c = this.cam(x, y, z);
    return c[2] > this.near ? this.f / c[2] : 0;
  }

  depth(x, y, z = 0) {
    return this.cam(x, y, z)[2];
  }

  clip(cs) {
    const n = this.near;
    const out = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      const b = cs[(i + 1) % cs.length];
      const ain = a[2] >= n;
      const bin = b[2] >= n;
      if (ain) out.push(a);
      if (ain !== bin) {
        const k = (n - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, n]);
      }
    }
    return out;
  }

  poly(ctx, pts, z = 0, move = true) {
    const cs = this.clip(pts.map((p) => this.cam(p[0], p[1], p.length > 2 ? p[2] : z)));
    if (cs.length < 3) return false;
    for (let i = 0; i < cs.length; i++) {
      const s = this.screen(cs[i]);
      if (i === 0 && move) ctx.moveTo(s[0], s[1]);
      else ctx.lineTo(s[0], s[1]);
    }
    ctx.closePath();
    return true;
  }

  line(ctx, a, b) {
    let ca = this.cam(a[0], a[1], a[2] ?? 0);
    let cb = this.cam(b[0], b[1], b[2] ?? 0);
    const n = this.near;
    if (ca[2] < n && cb[2] < n) return false;
    if (ca[2] < n) ca = lerp3(ca, cb, (n - ca[2]) / (cb[2] - ca[2]));
    else if (cb[2] < n) cb = lerp3(cb, ca, (n - cb[2]) / (ca[2] - cb[2]));
    const sa = this.screen(ca);
    const sb = this.screen(cb);
    ctx.moveTo(sa[0], sa[1]);
    ctx.lineTo(sb[0], sb[1]);
    return true;
  }

  polyline(ctx, pts, z = 0) {
    for (let i = 0; i < pts.length - 1; i++) this.line(ctx, [pts[i][0], pts[i][1], pts[i][2] ?? z], [pts[i + 1][0], pts[i + 1][1], pts[i + 1][2] ?? z]);
  }

  faces(x0, y0, x1, y1, z0, z1) {
    const c = this.C;
    const f = [];
    if (c[1] < y0) f.push({ n: "N", pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] });
    if (c[1] > y1) f.push({ n: "S", pts: [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]] });
    if (c[0] < x0) f.push({ n: "W", pts: [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]] });
    if (c[0] > x1) f.push({ n: "E", pts: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] });
    if (c[2] > z1) f.push({ n: "T", pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] });
    return f;
  }

  box(ctx, x0, y0, x1, y1, z0, z1, colors, stroke = null, lw = 1) {
    for (const face of this.faces(x0, y0, x1, y1, z0, z1)) {
      ctx.beginPath();
      if (!this.poly(ctx, face.pts)) continue;
      ctx.fillStyle = colors[face.n] || colors.side;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    }
  }
}

export function viewMotion(a, b, W, H) {
  let m = 0;
  for (const [sx, sy] of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2], [W / 2, H * 0.25], [W / 2, H * 0.75]]) {
    const g = a.ground(sx, sy);
    if (!g) continue;
    const p = b.project(g[0], g[1], 0);
    if (!p) continue;
    m = Math.max(m, Math.hypot(p[0] - sx, p[1] - sy));
  }
  return Math.min(m, 400);
}

export function lookAt(W, H, { tx, ty, tz = 0, zoom, pitch, yaw = 0, fov = 40, ox = 0, oy = 0, roll = 0 }) {
  const p = (pitch * Math.PI) / 180;
  const ya = (yaw * Math.PI) / 180;
  const f = H / 2 / Math.tan(((fov * Math.PI) / 180) / 2);
  const d = f / zoom;
  const F = [Math.cos(p) * Math.sin(ya), -Math.cos(p) * Math.cos(ya), -Math.sin(p)];
  return new View3D(W, H).set({ x: tx - F[0] * d, y: ty - F[1] * d, z: tz - F[2] * d, yaw, pitch, fov, ox, oy, roll });
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a, k) {
  return [a[0] * k, a[1] * k, a[2] * k];
}
function lerp3(a, b, k) {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
