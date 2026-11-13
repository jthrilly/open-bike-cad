/**
 * Rider model and fit calculations.
 *
 * The rider is a simple linkage (hip–knee–ankle, hip–shoulder–elbow–hand)
 * posed on the bike from body measurements. The fit advisor uses widely
 * published rules of thumb, not any particular commercial fit system.
 */
import { Design, numOf, parseTeeth } from '../model/schema';
import { Geometry } from '../geometry/solve';
import { Vec, v, add, sub, mul, dist, twoLinkIK, rad, deg, angleBetween, dirDeg, norm } from '../geometry/vec';

export interface RiderPose {
  hip: Vec;
  knee: Vec;
  ankle: Vec;
  ball: Vec;
  heel: Vec;
  pedal: Vec;
  shoulder: Vec;
  elbow: Vec;
  hand: Vec;
  neck: Vec;
  head: Vec;
  headR: number;
  /** Other leg (pedal opposite). */
  knee2: Vec;
  ankle2: Vec;
  ball2: Vec;
  heel2: Vec;
  pedal2: Vec;
  armReached: boolean;
  legReached: boolean;
}

export interface Body {
  thigh: number;
  shin: number;
  ankleH: number;
  footLen: number;
  torso: number;
  upperArm: number;
  forearm: number;
  height: number;
}

export function bodyOf(d: Design): Body {
  const inseam = numOf(d, 'inseam');
  const footLen = numOf(d, 'footLength');
  const ankleH = Math.max(50, inseam * 0.08);
  const femurShare = numOf(d, 'femurRatio') / 100;
  // Hip joint to ankle. Inseam is measured to the floor through the foot, but
  // on the bike the hip joint sits above and behind the sit bones, so the
  // working leg is a little longer than the inseam.
  const leg = inseam * 1.06;
  const arm = numOf(d, 'arm');
  const ua = numOf(d, 'upperArmRatio') / 100;
  return {
    thigh: leg * femurShare,
    shin: leg * (1 - femurShare),
    ankleH,
    footLen,
    torso: numOf(d, 'torso') - 40,
    upperArm: arm * ua,
    forearm: arm * (1 - ua),
    height: numOf(d, 'riderHeight'),
  };
}

/** Hip joint relative to the saddle reference point. */
function hipOf(g: Geometry): Vec {
  return add(g.saddleTop, v(-30, 40));
}

function legPose(hip: Vec, pedal: Vec, b: Body, d: Design) {
  // Ball of foot over the pedal axle (adjusted by cleat), foot roughly level with heel a little down.
  const cleat = numOf(d, 'cleatSetback');
  const ball = add(pedal, v(-cleat, numOf(d, 'pedalStack')));
  const footDir = norm(v(-1, 0.18));
  const ankle = add(add(ball, mul(footDir, b.footLen * 0.5)), v(0, b.ankleH * 0.7));
  const heel = add(ball, mul(footDir, b.footLen * 0.8));
  const ik = twoLinkIK(hip, ankle, b.thigh, b.shin, 1);
  return { ball, ankle, heel, knee: ik.joint, reached: ik.reached };
}

export function poseRider(d: Design, g: Geometry): RiderPose {
  const b = bodyOf(d);
  const hip = hipOf(g);
  const crankA = numOf(d, 'crankAngle');
  const crank = numOf(d, 'crankLength');
  const pedal = mul(dirDeg(-crankA), crank);
  const pedal2 = mul(pedal, -1);
  const L1 = legPose(hip, pedal, b, d);
  const L2 = legPose(hip, pedal2, b, d);

  // Torso: find the lean angle that puts the hands at ~93% of full arm length.
  const hand = g.hands;
  const armLen = b.upperArm + b.forearm;
  let best = 45;
  let bestErr = Infinity;
  for (let a = 0; a <= 90; a += 0.25) {
    const sh = add(hip, mul(dirDeg(a), b.torso));
    const err = Math.abs(dist(sh, hand) - armLen * 0.93);
    if (err < bestErr) {
      bestErr = err;
      best = a;
    }
  }
  const shoulder = add(hip, mul(dirDeg(best), b.torso));
  const arm = twoLinkIK(shoulder, hand, b.upperArm, b.forearm, -1);
  const neck = add(shoulder, mul(dirDeg(best + 15), 70));
  const headR = Math.max(85, b.height * 0.06);
  const head = add(neck, mul(dirDeg(best - 25), headR + 20));

  return {
    hip,
    knee: L1.knee,
    ankle: L1.ankle,
    ball: L1.ball,
    heel: L1.heel,
    pedal,
    shoulder,
    elbow: arm.joint,
    hand,
    neck,
    head,
    headR,
    knee2: L2.knee,
    ankle2: L2.ankle,
    ball2: L2.ball,
    heel2: L2.heel,
    pedal2,
    armReached: arm.reached,
    legReached: L1.reached && L2.reached,
  };
}

export interface FitMetrics {
  kneeAngleBottom: number;
  hipAngleTop: number;
  torsoAngle: number;
  shoulderAngle: number;
  elbowAngle: number;
  kops: number;
  saddleToBarDrop: number;
  saddleToHands: number;
}

/** Knee angle measured as the interior angle hip–knee–ankle (180 = straight). */
export function fitMetrics(d: Design, g: Geometry): FitMetrics {
  const b = bodyOf(d);
  const hip = hipOf(g);
  const crank = numOf(d, 'crankLength');
  // Bottom of stroke: crank in line with the seat tube, pointing down.
  const bottom = mul(norm(g.seatDir), -crank);
  const Lb = legPose(hip, bottom, b, d);
  const kneeAngleBottom = angleBetween(sub(hip, Lb.knee), sub(Lb.ankle, Lb.knee));
  const top = mul(norm(g.seatDir), crank);
  const Lt = legPose(hip, top, b, d);
  const pose = poseRider(d, g);
  const hipAngleTop = angleBetween(sub(pose.shoulder, hip), sub(Lt.knee, hip));
  const torsoAngle = deg(Math.atan2(pose.shoulder.y - hip.y, pose.shoulder.x - hip.x));
  const shoulderAngle = angleBetween(sub(hip, pose.shoulder), sub(pose.elbow, pose.shoulder));
  const elbowAngle = angleBetween(sub(pose.shoulder, pose.elbow), sub(pose.hand, pose.elbow));
  // KOPS: horizontal offset of the knee from the pedal axle with the crank forward horizontal.
  const Lf = legPose(hip, v(crank, 0), b, d);
  const kops = Lf.knee.x - crank;
  return {
    kneeAngleBottom,
    hipAngleTop,
    torsoAngle,
    shoulderAngle,
    elbowAngle,
    kops,
    saddleToBarDrop: g.dims.saddleToBarDrop,
    saddleToHands: dist(g.saddleTop, g.hands),
  };
}

export interface Recommendation {
  label: string;
  param?: string;
  recommended: number;
  current: number;
  unit: string;
  note?: string;
}

const SCHEMES: Record<string, { saddle: number; st: number; drop: number; reach: number; torso: [number, number] }> = {
  road: { saddle: 0.883, st: 0.66, drop: 0.09, reach: 0.47, torso: [35, 50] },
  racing: { saddle: 0.886, st: 0.65, drop: 0.13, reach: 0.49, torso: [30, 42] },
  touring: { saddle: 0.875, st: 0.67, drop: 0.03, reach: 0.44, torso: [42, 55] },
  mtb: { saddle: 0.875, st: 0.53, drop: 0.04, reach: 0.46, torso: [40, 55] },
  tt: { saddle: 0.885, st: 0.64, drop: 0.16, reach: 0.5, torso: [10, 25] },
  city: { saddle: 0.86, st: 0.6, drop: -0.08, reach: 0.38, torso: [60, 80] },
};

export function fitAdvice(d: Design, g: Geometry): Recommendation[] {
  const s = SCHEMES[String(d.fitScheme)] ?? SCHEMES.road;
  const inseam = numOf(d, 'inseam');
  const torso = numOf(d, 'torso');
  const arm = numOf(d, 'arm');
  const m = fitMetrics(d, g);
  const crankRec = Math.round((inseam * 0.205) / 2.5) * 2.5;
  const out: Recommendation[] = [
    { label: 'Saddle height (BB to top)', param: 'saddleHeight', recommended: inseam * s.saddle, current: numOf(d, 'saddleHeight'), unit: 'mm' },
    { label: 'Seat tube length (c-t)', param: 'seatTubeLength', recommended: inseam * s.st, current: numOf(d, 'seatTubeLength'), unit: 'mm' },
    { label: 'Saddle to bar drop', recommended: inseam * s.drop, current: m.saddleToBarDrop, unit: 'mm', note: 'Change stem, spacers or stack.' },
    { label: 'Saddle to hands', recommended: (torso + arm) * s.reach, current: m.saddleToHands, unit: 'mm', note: 'Change reach or stem length.' },
    { label: 'Crank length', param: 'crankLength', recommended: crankRec, current: numOf(d, 'crankLength'), unit: 'mm' },
    { label: 'Knee angle at bottom of stroke', recommended: 145, current: m.kneeAngleBottom, unit: '°', note: 'Typical range 140–150°.' },
    { label: 'Torso angle', recommended: (s.torso[0] + s.torso[1]) / 2, current: m.torsoAngle, unit: '°', note: `Typical ${s.torso[0]}–${s.torso[1]}° for this scheme.` },
    { label: 'Knee forward of pedal (3 o’clock)', recommended: 0, current: m.kops, unit: 'mm', note: 'Starting point only; ±20 mm is common.' },
    { label: 'Standover clearance', recommended: 30, current: inseam - g.dims.standover, unit: 'mm', note: 'Inseam minus standover height.' },
  ];
  return out;
}

/** Estimate missing body measurements from height. */
export function estimateBodyFromHeight(height: number): Partial<Design> {
  return {
    inseam: Math.round(height * 0.47),
    torso: Math.round(height * 0.36),
    arm: Math.round(height * 0.365),
    footLength: Math.round(height * 0.152 + 10),
    shoulderWidth: Math.round(height * 0.225),
  };
}

// ---------------------------------------------------------------- gearing
export interface GearRow {
  ring: number;
  cog: number;
  ratio: number;
  gearInches: number;
  developmentM: number;
  speedKmh: number;
}

export function gearTable(d: Design, g: Geometry): GearRow[] {
  const rings = parseTeeth(d.chainrings);
  const cogs = parseTeeth(d.cogs);
  const wheelDiaMm = g.rearWheelR * 2;
  const cad = numOf(d, 'cadence');
  const rows: GearRow[] = [];
  for (const ring of rings)
    for (const cog of cogs) {
      const ratio = ring / cog;
      const development = (ratio * Math.PI * wheelDiaMm) / 1000;
      rows.push({
        ring,
        cog,
        ratio,
        gearInches: (ratio * wheelDiaMm) / 25.4,
        developmentM: development,
        speedKmh: (development * cad * 60) / 1000,
      });
    }
  return rows;
}

/** Lean angle of the steering axis etc. — exposed for the info panel. */
export function wheelFlop(g: Geometry): number {
  return g.dims.flop;
}

export const _internal = { rad };
