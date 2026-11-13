/** Dimension-line primitives drawn in world coordinates. */
import { Vec, v, add, sub, mul, norm, perp, len, deg, rad } from '../geometry/vec';
import { sx, sy } from '../geometry/shapes';

interface DimStyle {
  color: string;
  textSize: number;
  stroke: number;
}

/**
 * Aligned linear dimension between a and b, offset sideways by `offset`
 * (positive = to the left of a→b). `mode` can force horizontal/vertical.
 */
export function LinearDim({
  a,
  b,
  offset,
  label,
  style,
  mode = 'aligned',
  onClick,
}: {
  a: Vec;
  b: Vec;
  offset: number;
  label: string;
  style: DimStyle;
  mode?: 'aligned' | 'horizontal' | 'vertical';
  onClick?: () => void;
}) {
  let p1 = a;
  let p2 = b;
  let dir: Vec;
  if (mode === 'horizontal') {
    dir = v(Math.sign(b.x - a.x) || 1, 0);
  } else if (mode === 'vertical') {
    dir = v(0, Math.sign(b.y - a.y) || 1);
  } else {
    dir = norm(sub(b, a));
  }
  const n = perp(dir);
  // Dimension line points: project a and b onto the dimension line.
  const base = add(a, mul(n, offset));
  const along = (p: Vec) => (p.x - base.x) * dir.x + (p.y - base.y) * dir.y;
  p1 = add(base, mul(dir, along(a)));
  p2 = add(base, mul(dir, along(b)));
  if (mode !== 'aligned') {
    // For horizontal/vertical, base the line on the extreme point so extension lines don't cross.
    const offA = (a.x - p1.x) * n.x + (a.y - p1.y) * n.y;
    const offB = (b.x - p2.x) * n.x + (b.y - p2.y) * n.y;
    const shift = offset >= 0 ? Math.max(offA, offB, 0) : Math.min(offA, offB, 0);
    p1 = add(p1, mul(n, shift));
    p2 = add(p2, mul(n, shift));
  }
  const ext = (from: Vec, to: Vec) => {
    const dv = sub(to, from);
    const l = len(dv);
    if (l < 0.5) return null;
    const u = mul(dv, 1 / l);
    const s = add(from, mul(u, 4));
    const e = add(to, mul(u, 6));
    return <line x1={sx(s)} y1={sy(s)} x2={sx(e)} y2={sy(e)} />;
  };
  const mid = mul(add(p1, p2), 0.5);
  let ang = -deg(Math.atan2(p2.y - p1.y, p2.x - p1.x));
  if (ang > 90) ang -= 180;
  if (ang < -90) ang += 180;
  const arrow = (tip: Vec, back: Vec) => {
    const u = norm(sub(back, tip));
    const w = perp(u);
    const s = style.textSize * 0.55;
    const p = [tip, add(add(tip, mul(u, s)), mul(w, s * 0.3)), add(add(tip, mul(u, s)), mul(w, -s * 0.3))];
    return <polygon points={p.map((q) => `${sx(q)},${sy(q)}`).join(' ')} fill={style.color} stroke="none" />;
  };
  const textOff = add(mid, mul(n, offset >= 0 ? style.textSize * 0.35 : -style.textSize * 1.05));
  return (
    <g className="dim" stroke={style.color} strokeWidth={style.stroke} fill="none" onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
      {ext(a, p1)}
      {ext(b, p2)}
      <line x1={sx(p1)} y1={sy(p1)} x2={sx(p2)} y2={sy(p2)} />
      {arrow(p1, p2)}
      {arrow(p2, p1)}
      <text
        x={sx(textOff)}
        y={sy(textOff)}
        transform={`rotate(${ang} ${sx(textOff)} ${sy(textOff)})`}
        fill={style.color}
        stroke="var(--paper, #fff)"
        strokeWidth={style.textSize * 0.25}
        paintOrder="stroke"
        fontSize={style.textSize}
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {label}
      </text>
    </g>
  );
}

/** Angle dimension at a vertex between two directions (degrees from +x, CCW). */
export function AngleDim({
  at,
  fromDeg,
  toDeg,
  r,
  label,
  style,
  onClick,
}: {
  at: Vec;
  fromDeg: number;
  toDeg: number;
  r: number;
  label: string;
  style: DimStyle;
  onClick?: () => void;
}) {
  let a0 = fromDeg;
  let a1 = toDeg;
  while (a1 < a0) a1 += 360;
  const pts: Vec[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = rad(a0 + ((a1 - a0) * i) / 24);
    pts.push(v(at.x + r * Math.cos(a), at.y + r * Math.sin(a)));
  }
  const midA = rad((a0 + a1) / 2);
  const tp = v(at.x + (r + style.textSize * 0.9) * Math.cos(midA), at.y + (r + style.textSize * 0.9) * Math.sin(midA));
  return (
    <g className="dim" stroke={style.color} strokeWidth={style.stroke} fill="none" onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
      <polyline points={pts.map((q) => `${sx(q)},${sy(q)}`).join(' ')} />
      <text
        x={sx(tp)}
        y={sy(tp) + style.textSize * 0.35}
        fill={style.color}
        stroke="var(--paper, #fff)"
        strokeWidth={style.textSize * 0.25}
        paintOrder="stroke"
        fontSize={style.textSize}
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {label}
      </text>
    </g>
  );
}

export type { DimStyle };
