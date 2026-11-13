/** Tiny 2D vector helpers. Coordinates are millimetres, x forward, y up, BB at origin. */
export interface Vec {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec): Vec => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
/** Rotate 90° counter-clockwise. */
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const rot = (a: Vec, rad: number): Vec => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};
/** Unit vector at an angle in degrees from +x, counter-clockwise. */
export const dirDeg = (deg: number): Vec => ({ x: Math.cos(rad(deg)), y: Math.sin(rad(deg)) });
export const rad = (deg: number): number => (deg * Math.PI) / 180;
export const deg = (r: number): number => (r * 180) / Math.PI;
export const angleOf = (a: Vec): number => deg(Math.atan2(a.y, a.x));

/** Intersection of two infinite lines p + t·d and q + s·e. Returns null if parallel. */
export function lineIntersect(p: Vec, d: Vec, q: Vec, e: Vec): { point: Vec; t: number; s: number } | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return null;
  const w = sub(q, p);
  const t = cross(w, e) / den;
  const s = cross(w, d) / den;
  return { point: add(p, mul(d, t)), t, s };
}

/** Angle in degrees between two directions (0..180). */
export function angleBetween(a: Vec, b: Vec): number {
  const c = dot(norm(a), norm(b));
  return deg(Math.acos(Math.max(-1, Math.min(1, c))));
}

/**
 * Two-link inverse kinematics: given a root, a target, and segment lengths,
 * return the joint position. `bendSign` picks which side the joint bends to.
 */
export function twoLinkIK(root: Vec, target: Vec, l1: number, l2: number, bendSign: 1 | -1): { joint: Vec; reached: boolean } {
  const d = dist(root, target);
  const reach = Math.min(d, l1 + l2 - 1e-6);
  const dir = norm(sub(target, root));
  const reached = d <= l1 + l2 && d >= Math.abs(l1 - l2);
  const dd = Math.max(Math.abs(l1 - l2) + 1e-6, reach);
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const base = add(root, mul(dir, a));
  return { joint: add(base, mul(perp(dir), h * bendSign)), reached };
}

/** Distance from point p to segment ab. */
export function pointSegDist(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return dist(p, add(a, mul(ab, t)));
}
