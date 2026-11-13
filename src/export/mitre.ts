/**
 * Tube mitre (coping) templates and cut lengths.
 *
 * A tube of radius r meets a receiving tube of radius R. Their axes cross at
 * angle θ, with a perpendicular offset e between the axes (0 when they
 * intersect). Measuring φ around the cut tube from the line in the plane of
 * the two axes, the distance from the axes' crossing point to the cut, along
 * the cut tube's axis, is
 *
 *   z(φ) = √(R² − (r·sinφ + e)²) / sinθ − r·cosφ / tanθ
 *
 * Unrolling the cut tube (x = r·φ) gives a paper template that wraps round
 * the tube for marking.
 */
import { Design, numOf } from '../model/schema';
import { Geometry } from '../geometry/solve';
import { dist, angleBetween, sub, Vec } from '../geometry/vec';
import { frameTubes } from '../render/BikeDrawing';
import { polyLength } from '../geometry/shapes';

export interface MitreEnd {
  /** What it mitres into. */
  into: string;
  R: number;
  angle: number;
  offset: number;
  /** Curve points in template coordinates (mm): x around, y along tube. */
  curve: { x: number; y: number }[];
  /** z of the shortest and longest points relative to the axes' crossing. */
  zMin: number;
  zMax: number;
}

export interface TubeCut {
  id: string;
  name: string;
  od: number;
  wall: number;
  cc: number;
  ends: MitreEnd[];
  /** Length between the long points of the two mitres. */
  lengthLongPoints: number;
  /** Length to cut from stock, including the face allowance at each end. */
  cutLength: number;
  /** Rotation between the two ends' reference lines (degrees). */
  phaseDeg: number;
  quantity: number;
}

export function mitreCurve(r: number, R: number, angleDeg: number, e = 0, steps = 180): { pts: { x: number; y: number }[]; zMin: number; zMax: number } {
  const th = (Math.max(1, Math.min(179, angleDeg)) * Math.PI) / 180;
  const raw: { x: number; z: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const phi = (i / steps) * Math.PI * 2;
    const k = r * Math.sin(phi) + e;
    const under = Math.max(0, R * R - k * k);
    const z = Math.sqrt(under) / Math.sin(th) - (r * Math.cos(phi)) / Math.tan(th);
    raw.push({ x: r * phi, z });
  }
  const zs = raw.map((p) => p.z);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  return { pts: raw.map((p) => ({ x: p.x, y: p.z - zMin })), zMin, zMax };
}

function end(into: string, r: number, R: number, angle: number, e = 0): MitreEnd {
  const c = mitreCurve(r, R, angle, e);
  return { into, R, angle, offset: e, curve: c.pts, zMin: c.zMin, zMax: c.zMax };
}

/** Included angle between two directions, as seen from the joint (0..180). */
function ang(a: Vec, b: Vec) {
  return angleBetween(a, b);
}

export function tubeCuts(d: Design, g: Geometry): TubeCut[] {
  const comp = numOf(d, 'paperThicknessComp');
  const allowance = numOf(d, 'faceAllowance');
  const htR = numOf(d, 'htOD') / 2;
  const stR = numOf(d, 'stOD') / 2;
  const bbR = numOf(d, 'bbShellOD') / 2;
  const { ttPts, dtPts, stPts, csPts, ssPts } = frameTubes(d, g);
  const tubes: TubeCut[] = [];

  const make = (id: string, name: string, odKey: string, wallKey: string, cc: number, ends: MitreEnd[], phaseDeg = 0, quantity = 1) => {
    const od = numOf(d, odKey);
    const longPts = cc - ends.reduce((s, e) => s + e.zMin, 0);
    tubes.push({
      id,
      name,
      od,
      wall: numOf(d, wallKey),
      cc,
      ends,
      lengthLongPoints: longPts,
      cutLength: longPts + allowance * ends.length,
      phaseDeg,
      quantity,
    });
  };

  // Top tube: rear end into seat tube, front end into head tube.
  {
    const r = numOf(d, 'ttOD') / 2 + comp;
    const dirTT = sub(g.ttFront, g.ttRear);
    const a1 = ang(sub(g.stTop, g.ttRear), dirTT); // ST up vs TT forward
    const a2 = ang(sub(g.htTop, g.ttFront), sub(g.ttRear, g.ttFront));
    make('tt', 'Top tube', 'ttOD', 'ttWall', polyLength(ttPts), [end('seat tube', r, stR, 180 - a1), end('head tube', r, htR, 180 - a2)]);
  }
  // Down tube: BB shell (perpendicular), head tube.
  {
    const r = numOf(d, 'dtOD') / 2 + comp;
    const a = ang(sub(g.htBottom, g.dtFront), sub(g.bb, g.dtFront));
    make('dt', 'Down tube', 'dtOD', 'dtWall', polyLength(dtPts), [end('BB shell', r, bbR, 90), end('head tube', r, htR, a)]);
  }
  // Seat tube into BB shell (square cut at top).
  {
    const r = numOf(d, 'stODBottom') / 2 + comp;
    make('st', 'Seat tube', 'stOD', 'stWall', polyLength(stPts), [end('BB shell', r, bbR, 90)]);
  }
  // Chainstays into BB shell, seatstays into seat tube. Dropout ends are slotted, so square cut.
  {
    const r = numOf(d, 'csOD') / 2 + comp;
    make('cs', 'Chainstay', 'csOD', 'csWall', polyLength(csPts), [end('BB shell', r, bbR, 90)], 0, 2);
  }
  {
    const r = numOf(d, 'ssOD') / 2 + comp;
    const a = ang(sub(g.stBottom, g.ssTop), sub(g.rearAxle, g.ssTop));
    const e = Math.max(0, stR - numOf(d, 'ssOD') / 2 + 1);
    make('ss', 'Seatstay', 'ssOD', 'ssWall', polyLength(ssPts), [end('seat tube', r, stR, 180 - a, e)], 0, 2);
  }
  // Head tube: square both ends.
  tubes.push({
    id: 'ht',
    name: 'Head tube',
    od: numOf(d, 'htOD'),
    wall: numOf(d, 'htWall'),
    cc: g.dims.headTubeLength,
    ends: [],
    lengthLongPoints: g.dims.headTubeLength + numOf(d, 'htExtTop') + numOf(d, 'htExtBottom'),
    cutLength: g.dims.headTubeLength + numOf(d, 'htExtTop') + numOf(d, 'htExtBottom') + 2 * allowance,
    phaseDeg: 0,
    quantity: 1,
  });
  void dist;
  return tubes;
}

/** Positions a builder needs to set a frame jig, relative to BB centre. */
export function fixtureTable(d: Design, g: Geometry): { label: string; value: string }[] {
  const f = (n: number) => n.toFixed(1);
  const D = g.dims;
  return [
    { label: 'Seat tube angle', value: `${f(D.seatAngle)}°` },
    { label: 'Head tube angle', value: `${f(D.headAngle)}°` },
    { label: 'Rear axle (x, y)', value: `${f(g.rearAxle.x)}, ${f(g.rearAxle.y)}` },
    { label: 'Front axle (x, y)', value: `${f(g.frontAxle.x)}, ${f(g.frontAxle.y)}` },
    { label: 'Head tube top (x, y)', value: `${f(g.htTop.x)}, ${f(g.htTop.y)}` },
    { label: 'Head tube bottom (x, y)', value: `${f(g.htBottom.x)}, ${f(g.htBottom.y)}` },
    { label: 'Seat tube top (x, y)', value: `${f(g.stTop.x)}, ${f(g.stTop.y)}` },
    { label: 'TT/ST junction (x, y)', value: `${f(g.ttRear.x)}, ${f(g.ttRear.y)}` },
    { label: 'TT/HT junction (x, y)', value: `${f(g.ttFront.x)}, ${f(g.ttFront.y)}` },
    { label: 'DT/HT junction (x, y)', value: `${f(g.dtFront.x)}, ${f(g.dtFront.y)}` },
    { label: 'SS/ST junction (x, y)', value: `${f(g.ssTop.x)}, ${f(g.ssTop.y)}` },
    { label: 'Steering axis to BB (perpendicular)', value: f(Math.abs((g.htTop.x * g.steerDir.y - g.htTop.y * g.steerDir.x))) },
    { label: 'BB to head tube bottom along DT', value: f(D.dtCC) },
    { label: 'Fork axle-to-crown', value: f(D.forkLength) },
    { label: 'Rear spacing', value: f(numOf(d, 'rearSpacing')) },
    { label: 'BB shell width', value: f(numOf(d, 'bbShellWidth')) },
    { label: 'Chainstay c-c', value: f(D.chainstay) },
    { label: 'Seatstay c-c', value: f(D.ssCC) },
  ];
}
