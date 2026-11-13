/**
 * Frame geometry solver. Turns a Design (inputs) into a Geometry (every
 * point and derived dimension needed to draw and specify the bike).
 *
 * Coordinate system: millimetres, BB centre at the origin, +x towards the
 * front wheel, +y up.
 */
import { Design, numOf } from '../model/schema';
import { Vec, v, add, sub, mul, dist, dot, rad, deg, lineIntersect, angleOf, rot, norm, len } from './vec';
import { centreline, pointAtX } from './shapes';

export interface Geometry {
  bb: Vec;
  rearAxle: Vec;
  frontAxle: Vec;
  groundY: number;
  rearWheelR: number;
  frontWheelR: number;
  rearRimR: number;
  frontRimR: number;

  /** Unit vector along the steering axis, pointing down/forward. */
  steerDir: Vec;
  /** Unit vector perpendicular to steering axis, pointing forward/up. */
  steerNormal: Vec;
  htTop: Vec;
  htBottom: Vec;
  crownRace: Vec;
  /** Point where steering axis meets the ground. */
  steerGround: Vec;

  /** Unit vector along seat tube, pointing up/back. */
  seatDir: Vec;
  stBottom: Vec;
  stTop: Vec;

  ttFront: Vec;
  ttRear: Vec;
  dtFront: Vec;
  dtRear: Vec;
  ssTop: Vec;

  steererTop: Vec;
  stemPivot: Vec;
  barClamp: Vec;
  hands: Vec;
  saddleTop: Vec;
  saddleClamp: Vec;
  seatpostTop: Vec;
  pedalForward: Vec;
  toe: Vec;

  dims: Dims;
  warnings: string[];
}

export interface Dims {
  stack: number;
  reach: number;
  headAngle: number;
  seatAngle: number;
  /** Effective seat angle from BB to saddle top. */
  effectiveSeatAngle: number;
  headTubeLength: number;
  ett: number;
  ttCC: number;
  ttAngle: number;
  dtCC: number;
  stCT: number;
  stCC: number;
  ssCC: number;
  chainstay: number;
  rearCenterHoriz: number;
  bbDrop: number;
  bbHeight: number;
  wheelbase: number;
  frontCenter: number;
  frontCenterHoriz: number;
  trail: number;
  mechanicalTrail: number;
  flop: number;
  standover: number;
  forkLength: number;
  forkRake: number;
  toeOverlap: number;
  saddleHeight: number;
  saddleSetback: number;
  saddleToBarDrop: number;
  saddleToBarReach: number;
  barReachFromBB: number;
  barStackFromBB: number;
  stackToTopOfHeadset: number;
  reachToTopOfHeadset: number;
  seatpostExposed: number;
  seatpostMinLength: number;
  frontWheelDia: number;
  rearWheelDia: number;
  headTubeToDownTubeAngle: number;
  headTubeToTopTubeAngle: number;
  seatTubeToTopTubeAngle: number;
  seatTubeToDownTubeAngle: number;
  seatTubeToSeatstayAngle: number;
  seatTubeToChainstayAngle: number;
  chainstayToSeatstayAngle: number;
}

/** Points that are fixed once T (head tube top) is known. */
function solveWithHtTop(d: Design, T: Vec, htlOverride?: number): Geometry {
  const warnings: string[] = [];
  const HA = numOf(d, 'headAngle');
  const SA = numOf(d, 'seatAngle');
  const drop = numOf(d, 'bbDrop');
  const cs = numOf(d, 'chainstayLength');
  const forkLen = numOf(d, 'forkLength');
  const rake = numOf(d, 'forkRake');
  const lowerStack = numOf(d, 'lowerStack');
  const upperStack = numOf(d, 'upperStack');
  const bbOffset = numOf(d, 'bbOffset');

  const rearRimR = numOf(d, 'rearBSD') / 2;
  const frontRimR = numOf(d, 'frontBSD') / 2;
  const rearWheelR = rearRimR + numOf(d, 'rearTyre');
  const frontWheelR = frontRimR + numOf(d, 'frontTyre');

  const bb = v(0, 0);
  const rearX = cs > Math.abs(drop) ? -Math.sqrt(cs * cs - drop * drop) : -cs;
  if (cs <= Math.abs(drop)) warnings.push('Chainstay is shorter than the BB drop.');
  const rearAxle = v(rearX, drop);
  const groundY = drop - rearWheelR;

  const u = v(Math.cos(rad(HA)), -Math.sin(rad(HA)));
  const n = v(Math.sin(rad(HA)), Math.cos(rad(HA)));
  const axial = Math.sqrt(Math.max(0, forkLen * forkLen - rake * rake));

  const htl = htlOverride ?? numOf(d, 'headTubeLength');
  const htTop = T;
  const htBottom = add(T, mul(u, htl));
  const crownRace = add(htBottom, mul(u, lowerStack));
  const frontAxle = add(add(crownRace, mul(u, axial)), mul(n, rake));

  // Steering axis ground intersection.
  const tGround = (groundY - htTop.y) / u.y;
  const steerGround = add(htTop, mul(u, tGround));

  // Seat tube
  const s = v(-Math.cos(rad(SA)), Math.sin(rad(SA)));
  const stBottom = v(bbOffset, 0);
  const stLen = numOf(d, 'seatTubeLength');
  const stTop = add(stBottom, mul(s, stLen));

  // Top tube
  const ttFront = add(htTop, mul(u, numOf(d, 'ttHeadOffset')));
  let ttRear: Vec;
  if (d.topTubeMode === 'extension') {
    ttRear = add(stBottom, mul(s, stLen - numOf(d, 'seatTubeExtension')));
  } else {
    const ta = numOf(d, 'topTubeAngle');
    const back = v(-Math.cos(rad(ta)), -Math.sin(rad(ta)));
    const hit = lineIntersect(ttFront, back, stBottom, s);
    ttRear = hit ? hit.point : add(stBottom, mul(s, stLen - 20));
  }

  // Down tube
  const dtFront = sub(htBottom, mul(u, numOf(d, 'dtHeadOffset')));
  const dtRear = bb;

  // Seatstays meet seat tube below the top tube junction.
  const ssTop = sub(ttRear, mul(s, numOf(d, 'ssSeatOffset')));

  // Cockpit
  const spacers = numOf(d, 'spacers');
  const clampH = numOf(d, 'stemClampHeight');
  const stemLen = numOf(d, 'stemLength');
  const stemAng = numOf(d, 'stemAngle');
  let stemPivot: Vec;
  let steererTop: Vec;
  if (d.stemKind === 'quill') {
    stemPivot = sub(htTop, mul(u, upperStack + numOf(d, 'quillHeight')));
    steererTop = sub(htTop, mul(u, upperStack));
  } else {
    steererTop = sub(htTop, mul(u, upperStack + spacers + clampH));
    stemPivot = sub(htTop, mul(u, upperStack + spacers + clampH / 2));
  }
  const stemDir = rot(n, rad(stemAng));
  const barClamp = add(stemPivot, mul(stemDir, stemLen));
  const hands = handPosition(d, barClamp);

  // Saddle
  const saddleH = numOf(d, 'saddleHeight');
  const above = numOf(d, 'saddleHeightAbove');
  const setback = numOf(d, 'seatpostSetback');
  const slide = numOf(d, 'saddleSetback');
  let postTravelDrop = 0;
  if (d.seatpostType === 'dropper' && d.dropperDown === true) postTravelDrop = numOf(d, 'dropperTravel');
  const seatpostTop = add(stBottom, mul(s, saddleH - above - postTravelDrop));
  const saddleClamp = add(seatpostTop, v(-setback, 0));
  const saddleTop = add(add(stBottom, mul(s, saddleH - postTravelDrop)), v(-setback + slide, 0));

  // Pedal & toe (crank horizontal, forward), using the shared foot model.
  const crank = numOf(d, 'crankLength');
  const pedalForward = v(crank, 0);
  const toe = footModel(d, pedalForward).toe;
  let toeOverlap = frontWheelR - dist(toe, frontAxle);
  if (d.fenders === true) toeOverlap += numOf(d, 'fenderClearance') + 3;

  // Derived dimensions
  const seatLineXAt = (y: number) => stBottom.x + (y / Math.tan(rad(SA))) * -1;
  const ett = htTop.x - seatLineXAt(htTop.y);
  const ttCC = dist(ttFront, ttRear);
  const ttVec = sub(ttFront, ttRear);
  const ttAngle = angleOf(ttVec); // positive when sloping down to the rear
  const trail = (frontWheelR * Math.cos(rad(HA)) - rake) / Math.sin(rad(HA));
  const mechanicalTrail = trail * Math.sin(rad(HA));
  const flop = trail * Math.sin(rad(HA)) * Math.cos(rad(HA));

  // Standover: top of top tube at the mid-point of the top tube's horizontal
  // span, on the (possibly curved) centreline. Same curve as the drawing's
  // frameTubes(): centreline(ttRear, ttFront, ttBend).
  const ttLine = centreline(ttRear, ttFront, numOf(d, 'ttBend'));
  const midTT = pointAtX(ttLine, (ttFront.x + ttRear.x) / 2) ?? mul(add(ttFront, ttRear), 0.5);
  const standover = midTT.y + numOf(d, 'ttOD') / 2 - groundY;

  const angleAt = (vertex: Vec, a: Vec, b: Vec) => {
    const va = norm(sub(a, vertex));
    const vb = norm(sub(b, vertex));
    return deg(Math.acos(Math.max(-1, Math.min(1, va.x * vb.x + va.y * vb.y))));
  };

  const headsetTop = sub(htTop, mul(u, upperStack));
  // Signed: positive when the seatpost top is above the seat tube top, measured along the seat tube.
  const exposed = dot(sub(seatpostTop, stTop), s);
  // The post must still reach minPostInsertion below the seat tube top, so a
  // negative exposure does not shorten it.
  const seatpostMinLength = Math.max(0, exposed) + numOf(d, 'minPostInsertion');
  const frameStyle = String(d.frameStyle);

  if (htl <= 0) warnings.push(`Head tube length is ${htl.toFixed(1)} mm: the stack is too low for this fork length, headset lower stack and head angle. Raise the stack or use a shorter fork.`);
  else if (htl < 50) warnings.push(`Head tube is very short (${htl.toFixed(1)} mm).`);
  if (dist(ttFront, htBottom) < numOf(d, 'dtHeadOffset') + 10) warnings.push('Top tube and down tube junctions overlap on the head tube.');
  // A step-through has no top tube at the seat tube, and a beam frame has no seat tube.
  if (frameStyle !== 'stepThrough' && frameStyle !== 'beam' && dot(sub(ttRear, stBottom), s) > stLen + 1) warnings.push('Top tube meets the seat tube above its top.');
  if (exposed < 0 && d.seatpostType !== 'integrated') warnings.push('Saddle height is lower than the top of the seat tube.');
  if (toeOverlap > 0) warnings.push(`Toe overlap: ${toeOverlap.toFixed(1)} mm.`);
  if (rearWheelR + 4 > dist(rearAxle, bb)) warnings.push('Rear tyre hits the seat tube / BB.');

  const dims: Dims = {
    stack: htTop.y,
    reach: htTop.x,
    headAngle: HA,
    seatAngle: SA,
    effectiveSeatAngle: 180 - angleOf(saddleTop),
    headTubeLength: htl,
    ett,
    ttCC,
    ttAngle,
    dtCC: dist(dtFront, dtRear),
    stCT: stLen,
    stCC: dist(stBottom, ttRear),
    ssCC: dist(rearAxle, ssTop),
    chainstay: cs,
    rearCenterHoriz: -rearX,
    bbDrop: drop,
    bbHeight: -groundY,
    wheelbase: frontAxle.x - rearAxle.x,
    frontCenter: len(frontAxle),
    frontCenterHoriz: frontAxle.x,
    trail,
    mechanicalTrail,
    flop,
    standover,
    forkLength: forkLen,
    forkRake: rake,
    toeOverlap,
    saddleHeight: saddleH,
    saddleSetback: -saddleTop.x,
    saddleToBarDrop: saddleTop.y - hands.y,
    saddleToBarReach: dist(v(saddleTop.x, 0), v(hands.x, 0)),
    barReachFromBB: barClamp.x,
    barStackFromBB: barClamp.y,
    stackToTopOfHeadset: headsetTop.y,
    reachToTopOfHeadset: headsetTop.x,
    seatpostExposed: exposed,
    seatpostMinLength,
    frontWheelDia: frontWheelR * 2,
    rearWheelDia: rearWheelR * 2,
    headTubeToDownTubeAngle: angleAt(dtFront, htTop, bb),
    headTubeToTopTubeAngle: angleAt(ttFront, htBottom, ttRear),
    seatTubeToTopTubeAngle: angleAt(ttRear, stBottom, ttFront),
    seatTubeToDownTubeAngle: angleAt(bb, ttRear, dtFront),
    seatTubeToSeatstayAngle: angleAt(ssTop, rearAxle, stBottom),
    seatTubeToChainstayAngle: angleAt(bb, ttRear, rearAxle),
    chainstayToSeatstayAngle: angleAt(rearAxle, bb, ssTop),
  };

  return {
    bb,
    rearAxle,
    frontAxle,
    groundY,
    rearWheelR,
    frontWheelR,
    rearRimR,
    frontRimR,
    steerDir: u,
    steerNormal: n,
    htTop,
    htBottom,
    crownRace,
    steerGround,
    seatDir: s,
    stBottom,
    stTop,
    ttFront,
    ttRear,
    dtFront,
    dtRear,
    ssTop,
    steererTop,
    stemPivot,
    barClamp,
    hands,
    saddleTop,
    saddleClamp,
    seatpostTop,
    pedalForward,
    toe,
    dims,
    warnings,
  };
}

export function handPosition(d: Design, clamp: Vec): Vec {
  const reach = numOf(d, 'barReach');
  switch (d.barType) {
    case 'drop':
      if (d.handPosition === 'tops') return clamp;
      if (d.handPosition === 'drops') return add(clamp, v(reach - 15, -numOf(d, 'barDrop') + 20));
      return add(clamp, v(reach + 10, 25));
    case 'bullhorn':
      return add(clamp, v(reach + 60, 30));
    case 'riser':
      return add(clamp, v(-5, numOf(d, 'barRise')));
    case 'sweptBack':
      return add(clamp, v(-reach - 60, numOf(d, 'barRise')));
    case 'aero':
      return add(clamp, v(250, 60));
    default:
      return clamp;
  }
}

/** Front axle height relative to BB. Fixed by the wheels and BB drop. */
function frontAxleY(d: Design): number {
  const drop = numOf(d, 'bbDrop');
  const rearR = numOf(d, 'rearBSD') / 2 + numOf(d, 'rearTyre');
  const frontR = numOf(d, 'frontBSD') / 2 + numOf(d, 'frontTyre');
  return drop - rearR + frontR;
}

/** Distance down the steering axis from head tube top to front axle projection, and its components. */
function frontEndOffsets(d: Design, htl: number) {
  const HA = rad(numOf(d, 'headAngle'));
  const forkLen = numOf(d, 'forkLength');
  const rake = numOf(d, 'forkRake');
  const axial = Math.sqrt(Math.max(0, forkLen * forkLen - rake * rake));
  const a = htl + numOf(d, 'lowerStack') + axial;
  // F = T + u*a + n*rake
  return {
    dx: a * Math.cos(HA) + rake * Math.sin(HA),
    dy: -a * Math.sin(HA) + rake * Math.cos(HA),
    axial,
  };
}

/** HTL needed for a given stack. */
function htlForStack(d: Design, stack: number): number {
  const HA = rad(numOf(d, 'headAngle'));
  const forkLen = numOf(d, 'forkLength');
  const rake = numOf(d, 'forkRake');
  const axial = Math.sqrt(Math.max(0, forkLen * forkLen - rake * rake));
  const fy = frontAxleY(d);
  // fy = stack - a sinHA + rake cosHA
  const a = (stack - fy + rake * Math.cos(HA)) / Math.sin(HA);
  return a - numOf(d, 'lowerStack') - axial;
}

export function solve(d: Design): Geometry {
  const mode = String(d.frontEndMode);
  const fy = frontAxleY(d);
  const SA = rad(numOf(d, 'seatAngle'));
  const bbOffset = numOf(d, 'bbOffset');
  const seatLineXAt = (y: number) => bbOffset - y / Math.tan(SA);

  if (mode === 'stackReach') {
    const stack = numOf(d, 'stack');
    const htl = htlForStack(d, stack);
    return solveWithHtTop(d, v(numOf(d, 'reach'), stack), htl);
  }

  if (mode === 'bars') {
    // Work back from the handlebar clamp to the head tube top.
    const HA = rad(numOf(d, 'headAngle'));
    const u = v(Math.cos(HA), -Math.sin(HA));
    const n = v(Math.sin(HA), Math.cos(HA));
    const h =
      d.stemKind === 'quill'
        ? numOf(d, 'upperStack') + numOf(d, 'quillHeight')
        : numOf(d, 'upperStack') + numOf(d, 'spacers') + numOf(d, 'stemClampHeight') / 2;
    const stemDir = rot(n, rad(numOf(d, 'stemAngle')));
    const target = v(numOf(d, 'barReachTarget'), numOf(d, 'barStackTarget'));
    const T = add(sub(target, mul(stemDir, numOf(d, 'stemLength'))), mul(u, h));
    return solveWithHtTop(d, T, htlForStack(d, T.y));
  }

  // Remaining modes: HTL is an input, so stack is fixed; solve for x.
  const htl = numOf(d, 'headTubeLength');
  const off = frontEndOffsets(d, htl);
  const stack = fy - off.dy;
  let x: number;
  // Targets that may be unreachable: checked against the solved result below.
  let check: { label: string; target: number; got: (g: Geometry) => number; why: string } | null = null;
  switch (mode) {
    case 'frontCenter': {
      const fc = numOf(d, 'frontCenter');
      const fx = Math.sqrt(Math.max(0, fc * fc - fy * fy));
      x = fx - off.dx;
      check = { label: 'Front centre', target: fc, got: (g) => g.dims.frontCenter, why: `it must be at least the front axle height above/below the BB (${Math.abs(fy).toFixed(1)} mm)` };
      break;
    }
    case 'ett':
      x = seatLineXAt(stack) + numOf(d, 'ettLength');
      break;
    case 'ttLength': {
      const target = numOf(d, 'ttLengthCC');
      x = bisect((xx) => solveWithHtTop(d, v(xx, stack), htl).dims.ttCC - target, 0, 2000, numOf(d, 'reach'));
      check = { label: 'Top tube length (c-c)', target, got: (g) => g.dims.ttCC, why: 'no reach between 0 and 2000 mm gives it with this head tube, seat angle and top tube angle; reach was left at its stored value' };
      break;
    }
    case 'reachHtl':
    default:
      x = numOf(d, 'reach');
  }
  const g = solveWithHtTop(d, v(x, stack), htl);
  if (check) {
    const got = check.got(g);
    if (Math.abs(got - check.target) > 0.5) {
      g.warnings.unshift(`${check.label} target ${check.target.toFixed(1)} mm can't be met (${check.why}); the frame uses ${got.toFixed(1)} mm.`);
    }
  }
  return g;
}

/**
 * Shared foot model, used by the toe-overlap check and the rider pose.
 * `cleatSetback` follows the usual convention: positive = cleat further back
 * on the shoe, so the ball of the foot (and the toe) sit further forward of
 * the pedal axle.
 */
export const BALL_TO_TOE = 0.3; // fraction of foot/shoe length from ball to toe
export const BALL_TO_HEEL = 1 - BALL_TO_TOE;
/** Height of the shoe toe above the ball/sole line at the pedal. */
export const TOE_HEIGHT = 15;
export function footModel(d: Design, pedal: Vec): { ball: Vec; toe: Vec; footLen: number } {
  const footLen = numOf(d, 'footLength');
  const ball = add(pedal, v(numOf(d, 'cleatSetback'), numOf(d, 'pedalStack')));
  const toe = add(ball, v(footLen * BALL_TO_TOE, TOE_HEIGHT));
  return { ball, toe, footLen };
}

function bisect(f: (x: number) => number, lo: number, hi: number, fallback: number): number {
  let flo = f(lo);
  const fhi = f(hi);
  if (flo * fhi > 0) return fallback;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-6) return mid;
    if (fm * flo < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Change the front end mode without moving the bike: compute the current
 * geometry, then write the values the new mode needs.
 */
export function switchFrontEndMode(d: Design, mode: string): Design {
  const g = solve(d);
  const out: Design = { ...d, frontEndMode: mode };
  out.stack = round(g.dims.stack);
  out.reach = round(g.dims.reach);
  out.headTubeLength = round(g.dims.headTubeLength);
  out.frontCenter = round(g.dims.frontCenter);
  out.ettLength = round(g.dims.ett);
  out.ttLengthCC = round(g.dims.ttCC);
  out.barReachTarget = round(g.barClamp.x);
  out.barStackTarget = round(g.barClamp.y);
  return out;
}

/** Same idea for the top tube mode. */
export function switchTopTubeMode(d: Design, mode: string): Design {
  const g = solve(d);
  return {
    ...d,
    topTubeMode: mode,
    topTubeAngle: round(g.dims.ttAngle),
    seatTubeExtension: round(numOf(d, 'seatTubeLength') - g.dims.stCC),
  };
}

export const round = (x: number, p = 2) => Math.round(x * 10 ** p) / 10 ** p;

/** Signed distance helper re-exported for callers that need it. */
export { dist };
