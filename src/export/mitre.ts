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
 * Unrolling the cut tube gives a paper template that wraps round the tube for
 * marking. z(φ) always uses the true tube radius; the paper thickness t only
 * widens the template (x = (r + t/2)·φ, circumference π·(OD + t)) so it wraps
 * the tube exactly. Cut lengths do not depend on t.
 *
 * Where |r·sinφ + e| > R the cut tube's side passes beside the receiving tube
 * (the branch is larger than the tube it meets, or offset past its edge):
 * those points are not part of the cope. They are drawn at the receiving
 * tube's edge but left out of zMin/zMax, and a warning is added.
 */
import { Design, numOf } from '../model/schema';
import { Geometry } from '../geometry/solve';
import { angleBetween, sub, dot, dist, mul, Vec } from '../geometry/vec';
import { frameTubes, seatTubeSections } from '../render/BikeDrawing';
import { polyLength, endTangent } from '../geometry/shapes';

export interface MitreEnd {
  /** What it mitres into. */
  into: string;
  /** Receiving tube radius at the junction (local radius for a tapered/hourglass head tube). */
  R: number;
  angle: number;
  offset: number;
  /** Curve points in template coordinates (mm): x around, y along tube. */
  curve: { x: number; y: number }[];
  /** z of the shortest and longest points relative to the axes' crossing (cope points only). */
  zMin: number;
  zMax: number;
  /** Problems with this end (e.g. branch larger than the receiving tube). */
  warnings: string[];
}

export interface TubeCut {
  id: string;
  name: string;
  od: number;
  wall: number;
  cc: number;
  ends: MitreEnd[];
  /** Length between the long points of the two mitres (never negative). */
  lengthLongPoints: number;
  /** Length to cut from stock, including the face allowance at each end (never negative). */
  cutLength: number;
  /** Rotation between the two ends' reference lines (degrees). */
  phaseDeg: number;
  quantity: number;
  /** Problems a builder must know about for this tube (includes its ends' warnings). */
  warnings: string[];
}

/**
 * @param wrapR radius the template is unrolled on (tube radius + half the paper thickness). Defaults to r.
 */
export function mitreCurve(
  r: number,
  R: number,
  angleDeg: number,
  e = 0,
  steps = 180,
  wrapR = r,
): { pts: { x: number; y: number }[]; zMin: number; zMax: number; clamped: number } {
  const th = (Math.max(1, Math.min(179, angleDeg)) * Math.PI) / 180;
  const raw: { x: number; z: number; ok: boolean }[] = [];
  for (let i = 0; i <= steps; i++) {
    const phi = (i / steps) * Math.PI * 2;
    const k = r * Math.sin(phi) + e;
    const under = R * R - k * k;
    const z = Math.sqrt(Math.max(0, under)) / Math.sin(th) - (r * Math.cos(phi)) / Math.tan(th);
    raw.push({ x: wrapR * phi, z, ok: under >= -1e-9 });
  }
  const good = raw.filter((p) => p.ok);
  const zs = (good.length ? good : raw).map((p) => p.z);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  return { pts: raw.map((p) => ({ x: p.x, y: p.z - zMin })), zMin, zMax, clamped: raw.length - good.length };
}

function end(into: string, r: number, R: number, angle: number, e: number, paper: number): MitreEnd {
  const c = mitreCurve(r, R, angle, e, 180, r + paper / 2);
  const warnings: string[] = [];
  if (c.clamped > 0) {
    warnings.push(
      r + e > R + 1e-9 && r > R
        ? `Tube Ø${(2 * r).toFixed(1)} is larger than the ${into} it meets (Ø${(2 * R).toFixed(1)}): its sides pass beside the ${into}, so this is not a plain cope. ${c.clamped} of ${c.pts.length} template points are off the ${into} and excluded from the cut length.`
        : `Tube is offset ${e.toFixed(1)} mm so its side passes beside the ${into} (Ø${(2 * R).toFixed(1)}): ${c.clamped} of ${c.pts.length} template points are off the ${into} and excluded from the cut length.`,
    );
  }
  return { into, R, angle, offset: e, curve: c.pts, zMin: c.zMin, zMax: c.zMax, warnings };
}

/** Included angle between two directions, as seen from the joint (0..180). */
function ang(a: Vec, b: Vec) {
  return angleBetween(a, b);
}

/**
 * Head tube radius at a point on its axis, interpolated as the drawing does:
 * straight; tapered linearly htOD (top) → htODBottom (bottom); hourglass
 * htODBottom at both ends, htOD at mid-length. The head tube runs from htTop to htBottom
 * (its full length: the headset cups sit at its ends, as in BikeCAD).
 */
export function headTubeRadiusAt(d: Design, g: Geometry, p: Vec): number {
  const top = numOf(d, 'htOD');
  if (d.htProfile !== 'tapered' && d.htProfile !== 'hourglass') return top / 2;
  const bot = numOf(d, 'htODBottom');
  const a = g.htTop;
  const b = g.htBottom;
  const L = dist(a, b);
  const t = L > 1e-9 ? Math.max(0, Math.min(1, dot(sub(p, a), g.steerDir) / L)) : 0;
  if (d.htProfile === 'tapered') return (top + (bot - top) * t) / 2;
  const w = t < 0.5 ? t / 0.5 : (1 - t) / 0.5; // 0 at the ends, 1 at the waist
  return (bot + (top - bot) * w) / 2;
}

export function tubeCuts(d: Design, g: Geometry): TubeCut[] {
  const paper = numOf(d, 'paperThicknessComp');
  const allowance = numOf(d, 'faceAllowance');
  const stR = numOf(d, 'stOD') / 2;
  const bbR = numOf(d, 'bbShellOD') / 2;
  const frameStyle = String(d.frameStyle);
  const hasTT = frameStyle !== 'stepThrough';
  const beam = frameStyle === 'beam';
  const { ttPts, dtPts, stPts, csPts, ssPts } = frameTubes(d, g);
  // Beam frame = BikeCAD's discontinuous seat tube: only the sections drawn are cut. A tube
  // joining the seat tube mitres into it only where a section is there to receive it.
  const stSections = beam ? seatTubeSections(d, stPts) : [];
  const stLen = polyLength(stPts);
  const seatTubeAt = (p: Vec) => {
    if (!beam) return true;
    const s = dot(sub(p, g.stBottom), g.seatDir);
    return stSections.some((sec) => s >= sec.from - 1e-6 && s <= sec.to + 1e-6);
  };
  const hasTTJoint = seatTubeAt(g.ttRear);
  const hasSSJoint = seatTubeAt(g.ssTop);
  const tubes: TubeCut[] = [];

  /** `trim`: length removed from the c-c at square-cut (dropout) ends. */
  const make = (id: string, name: string, odKey: string, wallKey: string, cc: number, ends: MitreEnd[], quantity = 1, trim = 0, extra: string[] = []) => {
    const od = numOf(d, odKey);
    const warnings = [...extra, ...ends.flatMap((e) => e.warnings)];
    const raw = cc - trim - ends.reduce((s, e) => s + e.zMin, 0);
    if (raw <= 0) warnings.push(`${name} has no length left between its mitres (${raw.toFixed(1)} mm); check the geometry.`);
    const longPts = Math.max(0, raw);
    tubes.push({
      id,
      name,
      od,
      wall: numOf(d, wallKey),
      cc,
      ends,
      lengthLongPoints: longPts,
      cutLength: longPts > 0 ? longPts + allowance * ends.length : 0,
      phaseDeg: 0,
      quantity,
      warnings,
    });
  };

  // Top tube: rear end into seat tube, front end into head tube. Angles use
  // the centreline's end tangents so a curved tube is coped correctly.
  if (hasTT) {
    const r = numOf(d, 'ttOD') / 2;
    const tRear = endTangent(ttPts, false); // forward along TT at the seat tube
    const tFront = endTangent(ttPts, true); // forward along TT at the head tube
    const ends: MitreEnd[] = [];
    const extra: string[] = [];
    if (hasTTJoint) ends.push(end('seat tube', r, stR, 180 - ang(g.seatDir, tRear), 0, paper)); // seat tube up vs TT forward
    else extra.push('Beam frame: no seat tube section at the top tube junction, so the rear end is left square (joint design is up to the builder).');
    const a2 = ang(sub(g.htTop, g.ttFront), mul(tFront, -1));
    ends.push(end('head tube', r, headTubeRadiusAt(d, g, g.ttFront), 180 - a2, 0, paper));
    make('tt', 'Top tube', 'ttOD', 'ttWall', polyLength(ttPts), ends, 1, 0, extra);
  }
  // Down tube: BB shell (perpendicular), head tube.
  {
    const r = numOf(d, 'dtOD') / 2;
    const tFront = endTangent(dtPts, true);
    const a = ang(sub(g.htBottom, g.dtFront), mul(tFront, -1));
    make('dt', 'Down tube', 'dtOD', 'dtWall', polyLength(dtPts), [end('BB shell', r, bbR, 90, 0, paper), end('head tube', r, headTubeRadiusAt(d, g, g.dtFront), a, 0, paper)]);
  }
  // Seat tube into BB shell (square cut at top).
  if (!beam) {
    const r = numOf(d, 'stODBottom') / 2;
    make('st', 'Seat tube', 'stOD', 'stWall', stLen, [end('BB shell', r, bbR, 90, 0, paper)]);
  }
  // Beam frame: the seat tube sections. The bottom one mitres into the BB shell; the gap ends
  // and the top are square.
  for (const sec of stSections) {
    const r = numOf(d, 'stODBottom') / 2;
    if (sec.from <= 1e-9 && sec.to >= stLen - 1e-9) make('st', 'Seat tube', 'stOD', 'stWall', stLen, [end('BB shell', r, bbR, 90, 0, paper)]);
    else if (sec.id === 'bottom') make('stBottom', 'Seat tube, BB section (K)', 'stOD', 'stWall', sec.to, [end('BB shell', r, bbR, 90, 0, paper)]);
    else make('stTop', 'Seat tube, top section (J)', 'stOD', 'stWall', sec.to - sec.from, []);
  }
  // Chainstays into BB shell, seatstays into seat tube. The stays stop short
  // of the axle by the dropout offsets (as drawn); those ends are square.
  {
    const r = numOf(d, 'csOD') / 2;
    make('cs', 'Chainstay', 'csOD', 'csWall', polyLength(csPts), [end('BB shell', r, bbR, 90, 0, paper)], 2, numOf(d, 'csDropoutOffset'));
  }
  {
    const r = numOf(d, 'ssOD') / 2;
    const ends: MitreEnd[] = [];
    const extra: string[] = [];
    if (hasSSJoint) {
      // Stays sit on the sides of the seat tube: offset so the stay's outer
      // surface is flush with the seat tube's side (r + e = R), never outside it.
      const a = ang(sub(g.stBottom, g.ssTop), sub(g.rearAxle, g.ssTop));
      const e = Math.max(0, stR - r);
      ends.push(end('seat tube', r, stR, 180 - a, e, paper));
    } else extra.push('Beam frame: no seat tube section at the seatstay junction, so the seatstay top end is left square (joint design is up to the builder).');
    make('ss', 'Seatstay', 'ssOD', 'ssWall', polyLength(ssPts), ends, 2, numOf(d, 'ssDropoutOffset'), extra);
  }
  // Head tube: square both ends.
  {
    const htl = g.dims.headTubeLength;
    const raw = htl;
    const warnings: string[] = [];
    if (htl <= 0) warnings.push(`Head tube length is ${htl.toFixed(1)} mm (stack too low for this fork); cut length shown is clamped at zero.`);
    const lp = Math.max(0, raw);
    tubes.push({
      id: 'ht',
      name: 'Head tube',
      od: numOf(d, 'htOD'),
      wall: numOf(d, 'htWall'),
      cc: Math.max(0, htl),
      ends: [],
      lengthLongPoints: lp,
      cutLength: lp > 0 ? lp + 2 * allowance : 0,
      phaseDeg: 0,
      quantity: 1,
      warnings,
    });
  }
  return tubes;
}

/**
 * Frame-level notes for the cut list: tubes the frame style has that the cut
 * list cannot give, followed by every tube's warnings (prefixed with its name).
 */
export function cutListWarnings(d: Design, g: Geometry, cuts: TubeCut[] = tubeCuts(d, g)): string[] {
  const out: string[] = [];
  const frameStyle = String(d.frameStyle);
  if (frameStyle === 'stepThrough') out.push('Step-through tube is not in the cut list (its geometry is drawing-only); cut and mitre it from the drawing.');
  if (frameStyle === 'mixte') out.push('Mixte stays are not in the cut list (their geometry is drawing-only); cut and mitre them from the drawing.');
  for (const t of cuts) for (const w of t.warnings) out.push(`${t.name}: ${w}`);
  return out;
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
