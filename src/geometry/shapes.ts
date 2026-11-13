/**
 * Shape helpers that turn centrelines into outlines. Everything here works in
 * world coordinates (mm, y up). Converting to SVG (y down) happens in `svgPath`.
 */
import { Vec, v, add, sub, mul, norm, perp, len, lerp, rad } from './vec';

/** Quadratic Bézier point. */
export function quad(a: Vec, c: Vec, b: Vec, t: number): Vec {
  const mt = 1 - t;
  return v(mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x, mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y);
}

/** Control point that gives a quadratic curve from a to b the given sagitta (bulge at mid-span). */
export function bendControl(a: Vec, b: Vec, sagitta: number): Vec {
  const mid = lerp(a, b, 0.5);
  return add(mid, mul(perp(norm(sub(b, a))), 2 * sagitta));
}

/** Sample a (possibly curved) centreline. */
export function centreline(a: Vec, b: Vec, sagitta = 0, n = 24): Vec[] {
  if (Math.abs(sagitta) < 0.01) return [a, b];
  const c = bendControl(a, b, sagitta);
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) pts.push(quad(a, c, b, i / n));
  return pts;
}

/** Length of a polyline. */
export function polyLength(pts: Vec[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += len(sub(pts[i], pts[i - 1]));
  return l;
}

/**
 * Outline polygon of a tube following a centreline, with radius tapering
 * linearly from r0 at the start to r1 at the end.
 */
export function tubeOutline(pts: Vec[], r0: number, r1: number): Vec[] {
  if (pts.length < 2) return [];
  // Densify straight tubes so tapers look right.
  if (pts.length === 2 && Math.abs(r0 - r1) > 0.01) {
    const [a, b] = pts;
    pts = [a, lerp(a, b, 0.5), b];
  }
  const total = polyLength(pts);
  const left: Vec[] = [];
  const right: Vec[] = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += len(sub(pts[i], pts[i - 1]));
    const t = total ? acc / total : 0;
    const r = r0 + (r1 - r0) * t;
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const nrm = perp(norm(sub(next, prev)));
    left.push(add(pts[i], mul(nrm, r)));
    right.push(sub(pts[i], mul(nrm, r)));
  }
  return [...left, ...right.reverse()];
}

/** Point and unit tangent at a distance along a polyline. */
export function pointAlong(pts: Vec[], dist: number): { p: Vec; t: Vec } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = len(sub(pts[i], pts[i - 1]));
    if (acc + seg >= dist || i === pts.length - 1) {
      const k = seg ? Math.max(0, Math.min(1, (dist - acc) / seg)) : 0;
      return { p: lerp(pts[i - 1], pts[i], k), t: norm(sub(pts[i], pts[i - 1])) };
    }
    acc += seg;
  }
  return { p: pts[0], t: v(1, 0) };
}

export function circlePts(c: Vec, r: number, n = 48): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push(v(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
  }
  return out;
}

export function arcPts(c: Vec, r: number, a0deg: number, a1deg: number, n = 24): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const a = rad(a0deg + ((a1deg - a0deg) * i) / n);
    out.push(v(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
  }
  return out;
}

/** World → SVG coordinates (flip y). */
export const sx = (p: Vec) => p.x;
export const sy = (p: Vec) => -p.y;

export function svgPath(pts: Vec[], close = true): string {
  if (!pts.length) return '';
  const f = (n: number) => (Math.round(n * 100) / 100).toString();
  let s = `M${f(sx(pts[0]))} ${f(sy(pts[0]))}`;
  for (let i = 1; i < pts.length; i++) s += `L${f(sx(pts[i]))} ${f(sy(pts[i]))}`;
  return close ? s + 'Z' : s;
}

/** Rectangle oriented along a direction, from a start point. */
export function orientedRect(start: Vec, dir: Vec, length: number, width: number): Vec[] {
  const d = norm(dir);
  const n = mul(perp(d), width / 2);
  const end = add(start, mul(d, length));
  return [add(start, n), add(end, n), sub(end, n), sub(start, n)];
}
