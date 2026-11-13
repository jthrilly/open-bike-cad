/**
 * Accessory and lateral (3D) geometry, shared by the side-view drawing and the
 * 3D geometry export, so the two always show the same parts.
 *
 * Side view uses the solver's frame: x forward, y up, BB at the origin.
 * 3D points are [x, y, z] with x forward, y to the rider's LEFT (non-drive
 * side), z up. The drive side (chain) is therefore at negative y.
 */
import { Design, numOf, parseTeeth } from '../model/schema';
import { Geometry } from './solve';
import { Vec, v, add, sub, mul, norm, len, dist, rad, deg, lerp, dot } from './vec';
import { frameTubes, forkBladePts } from './tubes';
import { pointAlong, polyLength, arcPts } from './shapes';

export type P3 = [number, number, number];
export const p3 = (p: Vec, y = 0): P3 => [p.x, y, p.y];
const polar = (c: Vec, r: number, aDeg: number): Vec => v(c.x + r * Math.cos(rad(aDeg)), c.y + r * Math.sin(rad(aDeg)));
const angleFrom = (c: Vec, p: Vec) => deg(Math.atan2(p.y - c.y, p.x - c.x));

export interface Mount {
  name: string;
  at: P3;
  note?: string;
}
export interface Fender {
  centre: Vec;
  radius: number;
  width: number;
  startDeg: number;
  endDeg: number;
  stays: { from: P3; to: P3; od: number }[];
  mounts: Mount[];
}
export interface Rack {
  platformZ: number;
  frontX: number;
  backX: number;
  halfWidth: number;
  tubeOD: number;
  loadKg: number;
  /** Every rack tube as a 3D polyline (rails, cross bars, legs, front stays). */
  tubes: { name: string; pts: P3[] }[];
  mounts: Mount[];
}
export interface Chainguard {
  /** Side-view outline of the outer plate (closed polygon). */
  outline: Vec[];
  /** Lateral position of the outer plate, and of the inner edge of the top lip. */
  plateY: number;
  lipInnerY: number;
  /** Top edge (lip) as a side-view polyline, front to back. */
  lip: Vec[];
  mounts: Mount[];
}
export interface RingLock {
  /** Centre of the tyre cross-section the lock surrounds (side view, wheel plane). */
  centre: Vec;
  /** Unit vector in side view pointing away from the axle through the lock. */
  radial: Vec;
  innerR: number;
  outerR: number;
  /** Body arc covers this many degrees, centred on the outward direction; the shackle closes the rest through the spokes. */
  bodyArcDeg: number;
  bodyLength: number;
  mounts: Mount[];
}
export interface CarrierBlock {
  /** Steel block brazed to the front of the head tube. */
  mountBlock: { centre: P3; alongHT: number; width: number; depth: number; holes: P3[]; thread: string; holeSpacing: number };
  /** Bolt-on carrier block that the luggage frame clips onto. */
  block: { centre: P3; depth: number; width: number; height: number; loadKg: number };
  /** Unit vectors: forward from the head tube, and up the head tube. */
  forward: Vec;
  up: Vec;
}
export interface Box3 {
  /** Centre; the box is aligned with forward (side-view), up (side-view) and the lateral y axis. */
  centre: P3;
  depth: number;
  height: number;
  width: number;
}
export interface EAssist {
  /** Side-view unit vectors the battery boxes are aligned with (same as the carrier block). */
  forward: Vec;
  up: Vec;
  battery?: {
    /** Steel cradle: back plate bolted to the carrier block's front face, side cheeks and a floor. */
    cradle: Box3 & { plate: number };
    /** Slide-in base with key lock and contacts, fixed in the cradle. */
    base: Box3;
    pack: Box3 & { wh: number; kg: number; volts: number };
    controller: Box3;
    keyLock: P3;
    chargePort: P3;
    headlight: P3;
    /** Direction the pack lifts out (side view). */
    removal: Vec;
    blockLoadKg: number;
    blockRatingKg: number;
  };
  motor?: { axle: P3; shellDia: number; shellWidth: number; power: number; cableSide: 'left' | 'right'; torqueWashers: P3[] };
  sensor?: { type: string; at: P3 };
  display?: { at: P3 };
  wiring: { name: string; od: number; pts: P3[]; note?: string }[];
  /** Mass added over the non-assist bike, and the share of it carried by the front wheel. */
  addedKg: number;
  frontShare: number;
}
export interface Kickstand {
  plate: { centre: P3; length: number; width: number };
  pivot: P3;
  feet: P3[];
}
export interface StayLayout {
  chainstays: { side: 'left' | 'right'; pts: P3[] }[];
  seatstays: { side: 'left' | 'right'; pts: P3[] }[];
  /** Wishbone only: single stay from the yoke to the seat tube, and the yoke bar. */
  monoStay?: P3[];
  yoke?: P3[];
  dropoutY: number;
}
export interface Clearance {
  what: string;
  mm: number;
  ok: boolean;
}
export interface Assembly {
  stays: StayLayout;
  fenders: { rear?: Fender; front?: Fender };
  rack?: Rack;
  chainguard?: Chainguard;
  ringLock?: RingLock;
  carrierBlock?: CarrierBlock;
  eAssist?: EAssist;
  kickstand?: Kickstand;
  clearances: Clearance[];
}

/** Lateral offset of a point along a two-point straight run, linearly interpolated. */
function lateralRun(pts: Vec[], y0: number, y1: number): P3[] {
  const L = polyLength(pts);
  let acc = 0;
  return pts.map((p, i) => {
    if (i > 0) acc += dist(pts[i - 1], p);
    const t = L ? acc / L : 0;
    return p3(p, y0 + (y1 - y0) * t);
  });
}

const R3n = (p: P3): P3 => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 10) / 10];

export function chainringRadius(teeth: number) {
  return 12.7 / (2 * Math.sin(Math.PI / teeth));
}

export function buildAssembly(d: Design, g: Geometry): Assembly {
  const { csPts, ssPts } = frameTubes(d, g);
  const clearances: Clearance[] = [];
  const check = (what: string, mm: number, need = 3) => clearances.push({ what, mm: Math.round(mm * 10) / 10, ok: mm >= need });

  // ------------------------------------------------------------- stays
  const old = numOf(d, 'rearSpacing');
  const dropT = 6; // dropout plate thickness
  const dropY = old / 2 + dropT / 2;
  const csR = numOf(d, 'csOD') / 2;
  const ssR = numOf(d, 'ssOD') / 2;
  const stR = numOf(d, 'stOD') / 2;
  const csBB = numOf(d, 'csWidthAtBB') / 2;
  const wishbone = d.seatstayStyle === 'wishbone';
  // csPts and ssPts both run from the rear axle forward/up.
  let ssTwin: Vec[] = ssPts;
  let ssTopY = Math.max(0, stR - ssR);
  let monoStay: P3[] | undefined;
  let yoke: P3[] | undefined;
  if (wishbone) {
    const split = ssPts[ssPts.length - 2];
    ssTwin = ssPts.slice(0, -1);
    ssTopY = numOf(d, 'wishboneSpread') / 2;
    monoStay = [p3(split), p3(g.ssTop)];
    yoke = [p3(split, ssTopY), p3(split, -ssTopY)];
  }
  const twinLen = polyLength(ssTwin);
  const ssYAt = (s: number) => dropY + (ssTopY - dropY) * (s / twinLen); // s from the axle along the twin stay
  const csLen = polyLength(csPts);
  const csYAt = (s: number) => dropY + (csBB - dropY) * (s / csLen);
  const stays: StayLayout = {
    chainstays: [
      { side: 'left', pts: lateralRun(csPts, dropY, csBB) },
      { side: 'right', pts: lateralRun(csPts, -dropY, -csBB) },
    ],
    seatstays: [
      { side: 'left', pts: lateralRun(ssTwin, dropY, ssTopY) },
      { side: 'right', pts: lateralRun(ssTwin, -dropY, -ssTopY) },
    ],
    monoStay,
    yoke,
    dropoutY: dropY,
  };

  const rearR = g.rearWheelR;
  const tyreH = numOf(d, 'rearTyre');
  const tyreW = tyreH; // section width ≈ height for the tyres this app draws
  const rimR = g.rearRimR;
  // Tyre to stays: at each point along a stay, the tyre's half-width at that radius from the axle.
  const tyreHalfWidthAt = (r: number, R = rearR, h = tyreH) => {
    const c = R - h / 2; // section centre radius
    const dz = r - c;
    return Math.abs(dz) >= h / 2 ? 0 : Math.sqrt((h / 2) ** 2 - dz * dz) * (tyreW / h);
  };
  const minStayGap = (pts: Vec[], yAt: (s: number) => number, r: number, extraHalf: (rr: number) => number) => {
    let best = Infinity;
    const L = polyLength(pts);
    for (let s = 0; s <= L; s += 2) {
      const p = pointAlong(pts, s).p;
      const rr = dist(p, g.rearAxle);
      const need = extraHalf(rr);
      if (need <= 0) continue;
      best = Math.min(best, Math.abs(yAt(s)) - r - need);
    }
    return best;
  };
  if (wishbone && d.fenders !== true) check('Wishbone yoke to rear tyre', dist(ssPts[ssPts.length - 2], g.rearAxle) - rearR - ssR, 8);
  check('Rear tyre to seatstays', minStayGap(ssTwin, ssYAt, ssR, (rr) => tyreHalfWidthAt(rr)), 4);
  // Dimpled chainstays: the stay is pressed in by csDimple where it passes the tyre and the chainring.
  const dimple = numOf(d, 'csDimple');
  check(dimple > 0 ? `Rear tyre to chainstays (with ${dimple} mm dimple)` : 'Rear tyre to chainstays', minStayGap(csPts, csYAt, csR - dimple, (rr) => tyreHalfWidthAt(rr)), 4);
  {
    // Chainring (drive side) to the right chainstay: the ring is a disc of radius Rc at y = -chainline.
    const rings = parseTeeth(d.chainrings);
    const Rc = chainringRadius(rings.length ? Math.max(...rings) : 38) + 4;
    const cl = numOf(d, 'chainline');
    let best = Infinity;
    for (let s = 0; s <= csLen; s += 2) {
      const p = pointAlong(csPts, s).p;
      if (len(p) > Rc) continue;
      best = Math.min(best, cl - 2 - (csYAt(s) + csR - dimple));
    }
    if (best < Infinity) check(dimple > 0 ? `Chainring to drive-side chainstay (with ${dimple} mm dimple)` : 'Chainring to drive-side chainstay (dimple the stay if negative)', best, 3);
  }

  // ------------------------------------------------------------- fenders
  const fenders: Assembly['fenders'] = {};
  const fClr = numOf(d, 'fenderClearance');
  if (d.fenders === true) {
    // Rear
    {
      const R = rearR + fClr;
      const width = tyreW + 18;
      const c = g.rearAxle;
      const a0 = numOf(d, 'fenderRearStart');
      const a1 = numOf(d, 'fenderRearEnd');
      const eyelet = polar(c, 24, 225);
      const stayTo = polar(c, R, 160);
      const half = width / 2 + 2;
      // Seatstay bridge sits where the twin stays cross the fender radius (+ a little).
      const sb = pointAlong(ssTwin, Math.min(twinLen, R + 10)).p;
      const cb = pointAlong(csPts, Math.min(csLen, R + 8)).p;
      fenders.rear = {
        centre: c,
        radius: R,
        width,
        startDeg: a0,
        endDeg: a1,
        stays: [1, -1].map((sg) => ({ from: p3(eyelet, sg * (dropY + 5)), to: p3(stayTo, sg * half), od: 5 })),
        mounts: [
          { name: 'chainstay bridge (fender front end bolt)', at: p3(cb) },
          { name: 'seatstay bridge (fender bolt)', at: p3(sb) },
          { name: 'dropout eyelet left (fender stay)', at: p3(eyelet, dropY + 3) },
          { name: 'dropout eyelet right (fender stay)', at: p3(eyelet, -dropY - 3) },
        ],
      };
      if (wishbone) {
        const split = ssPts[ssPts.length - 2];
        check('Wishbone yoke to rear fender', dist(split, c) - R - 2 - ssR, 5);
      }
      check('Rear fender to seatstays', minStayGap(ssTwin, ssYAt, ssR, (rr) => (Math.abs(rr - R) < 6 ? width / 2 : 0)), 3);
      // Fender front end to seat tube (side view).
      const fEnd = polar(c, R + 2, a0);
      const s = g.seatDir;
      const off = sub(fEnd, g.stBottom);
      const perpDist = Math.abs(off.x * s.y - off.y * s.x);
      check('Rear fender front end to seat tube', perpDist - stR, 5);
    }
    // Front
    {
      const R = g.frontWheelR + fClr;
      const width = numOf(d, 'frontTyre') + 18;
      const c = g.frontAxle;
      const u = g.steerDir;
      const n = g.steerNormal;
      const fs = numOf(d, 'frontSpacing');
      // Eyelet on the BACK of each fork end, stay running back and up to the fender.
      const eyelet = add(sub(c, mul(n, 14)), mul(u, 6));
      const stayTo = polar(c, R, 150);
      const crownBot = add(g.crownRace, mul(u, numOf(d, 'forkCrownHeight')));
      const crownAng = angleFrom(c, crownBot);
      fenders.front = {
        centre: c,
        radius: R,
        width,
        startDeg: numOf(d, 'fenderFrontStart'),
        endDeg: numOf(d, 'fenderFrontEnd'),
        stays: [1, -1].map((sg) => ({ from: p3(eyelet, sg * (fs / 2 + 7)), to: p3(stayTo, sg * (width / 2 + 2)), od: 5 })),
        mounts: [
          { name: 'fork crown (fender bolt through crown)', at: p3(polar(c, R + 2, crownAng)) },
          { name: 'fork eyelet left, rear side of fork end', at: p3(eyelet, fs / 2 + 4) },
          { name: 'fork eyelet right, rear side of fork end', at: p3(eyelet, -fs / 2 - 4) },
        ],
      };
      check('Front fender under fork crown', dist(c, crownBot) - (g.frontWheelR + fClr + 2), 0);
    }
  }

  // ------------------------------------------------------------- rear rack
  let rack: Rack | undefined;
  if (d.rearRack === true) {
    const ax = g.rearAxle;
    const od = numOf(d, 'rackTubeOD');
    const platZ = ax.y + rearR + numOf(d, 'rackHeightAboveTyre');
    const tanSA = Math.tan(rad(numOf(d, 'seatAngle')));
    const stXAt = (y: number) => g.stBottom.x - y / tanSA;
    const frontX = Math.min(ax.x + 0.55 * rearR, stXAt(platZ) - numOf(d, 'seatpostDia') / 2 - 40);
    const backX = ax.x - 0.33 * rearR;
    const hw = dropY + 14; // rails run outside the dropouts and eyelet bolts
    const eyelet = polar(ax, 26, 195);
    const legTopBack = v(backX + 20, platZ);
    const legTopMid = v(ax.x + 0.1 * rearR, platZ);
    // Front stays run down to bosses on the twin seatstays, just above the fender (or tyre).
    const bossS = Math.min(twinLen - 15, rearR + (d.fenders === true ? fClr : 0) + 35);
    const boss = pointAlong(ssTwin, bossS).p;
    const bossY = ssYAt(bossS);
    const tubes: Rack['tubes'] = [];
    for (const sg of [1, -1]) {
      const side = sg > 0 ? 'left' : 'right';
      tubes.push({ name: `side rail ${side}`, pts: [p3(v(frontX, platZ), sg * hw), p3(v(backX, platZ), sg * hw)] });
      tubes.push({ name: `rear leg ${side}`, pts: [p3(eyelet, sg * hw), p3(legTopBack, sg * hw)] });
      tubes.push({ name: `front leg ${side}`, pts: [p3(eyelet, sg * hw), p3(legTopMid, sg * hw)] });
      tubes.push({ name: `front stay ${side}`, pts: [p3(v(frontX, platZ), sg * hw), p3(boss, sg * (bossY + ssR + 4))] });
    }
    const nBars = 4;
    for (let i = 0; i < nBars; i++) {
      const x = frontX + ((backX - frontX) * i) / (nBars - 1);
      tubes.push({ name: `cross bar ${i + 1}`, pts: [p3(v(x, platZ), hw), p3(v(x, platZ), -hw)] });
    }
    rack = {
      platformZ: platZ,
      frontX,
      backX,
      halfWidth: hw,
      tubeOD: od,
      loadKg: numOf(d, 'rackLoad'),
      tubes,
      mounts: [
        { name: 'dropout eyelet left (rack legs)', at: p3(eyelet, dropY + 3) },
        { name: 'dropout eyelet right (rack legs)', at: p3(eyelet, -dropY - 3) },
        { name: 'seatstay boss left (rack front stay)', at: p3(boss, bossY + ssR) },
        { name: 'seatstay boss right (rack front stay)', at: p3(boss, -bossY - ssR) },
      ],
    };
    check('Rack platform front to seat tube centreline', stXAt(platZ) - frontX, 30);
    if (d.fenders === true) check('Rack platform to rear fender top', platZ - od / 2 - (ax.y + rearR + fClr + 2), 8);
    check('Rack platform to tyre top', platZ - od / 2 - (ax.y + rearR), 15);
  }

  // ------------------------------------------------------------- chainguard
  let chainguard: Chainguard | undefined;
  if (d.chainguard === true) {
    const rings = parseTeeth(d.chainrings);
    const cogs = parseTeeth(d.cogs);
    const Rc = chainringRadius(rings.length ? Math.max(...rings) : 38);
    const Rs = chainringRadius(cogs.length ? cogs[Math.floor(cogs.length / 2)] : 18);
    const ax = g.rearAxle;
    // Upper chain run: external tangent of the two sprocket circles.
    const dv = sub(ax, g.bb);
    const L = len(dv);
    const phi = Math.asin((Rc - Rs) / L);
    const base = Math.atan2(dv.y, dv.x);
    const cands = [base + (Math.PI / 2 + phi), base - (Math.PI / 2 + phi)];
    const a = Math.sin(cands[0]) > Math.sin(cands[1]) ? cands[0] : cands[1]; // the upper run
    const nrm = v(Math.cos(a), Math.sin(a));
    const t1 = add(g.bb, mul(nrm, Rc));
    const t2 = add(ax, mul(nrm, Rs));
    const runDir = norm(sub(t2, t1));
    const above = 12; // guard top edge above the chain line
    const below = 12; // guard bottom edge below the chain line
    const backEnd = add(t1, mul(runDir, dot(sub(ax, t1), runDir) - Rs - 45));
    const ringTopDeg = deg(a);
    // Outer edge: around the front of the ring from below horizontal up to the tangent point, then along the run.
    const outer = [...arcPts(g.bb, Rc + above, -25, ringTopDeg, 16), add(backEnd, mul(nrm, above))];
    const inner = [add(backEnd, mul(nrm, -below)), add(t1, mul(nrm, -below)), ...arcPts(g.bb, Rc - 22, ringTopDeg, -25, 12)];
    const outline = [...outer, ...inner];
    const lip = [...arcPts(g.bb, Rc + above, 10, ringTopDeg, 8), add(backEnd, mul(nrm, above))];
    const cl = numOf(d, 'chainline');
    const plateY = -(cl + 14);
    const lipInnerY = -(cl - 8);
    // Mounts: a tab on the seat tube where the guard's top edge crosses it, and a tab on the drive chainstay at the back end.
    const s = g.seatDir;
    // Intersect top-edge line with the seat tube line.
    const p0 = add(t1, mul(nrm, above));
    const den = runDir.x * s.y - runDir.y * s.x;
    const tSt = Math.abs(den) > 1e-9 ? ((g.stBottom.x - p0.x) * s.y - (g.stBottom.y - p0.y) * s.x) / den : 0;
    const stTab = add(p0, mul(runDir, tSt - 10));
    const csTabS = csLen - (dist(g.bb, backEnd) - 30);
    const csTab = pointAlong(csPts, Math.max(0, csTabS)).p;
    chainguard = {
      outline,
      plateY,
      lipInnerY,
      lip,
      mounts: [
        { name: 'seat tube tab, drive side', at: p3(stTab, -stR) },
        { name: 'chainstay tab, drive side', at: p3(csTab, -(csYAt(Math.max(0, csTabS)) + csR)) },
      ],
    };
    // Bottom edge to chainstay top, where the plate is laterally outside the stay's inner face.
    let best = Infinity;
    for (let k = 0; k <= 40; k++) {
      const p = lerp(add(t1, mul(nrm, -below)), add(backEnd, mul(nrm, -below)), k / 40);
      // Chainstay centreline height at this x (straight from the BB to the axle).
      const t = Math.max(0, Math.min(1, p.x / g.rearAxle.x));
      const csY = g.bb.y + (g.rearAxle.y - g.bb.y) * t;
      best = Math.min(best, p.y - (csY + csR));
    }
    check('Chainguard bottom edge to chainstay top', best, 6);
  }

  // ------------------------------------------------------------- ring lock
  let ringLock: RingLock | undefined;
  if (d.ringLock === true) {
    const rC = rimR + tyreH / 2;
    const sAt = (() => {
      // Point on the twin stay whose distance from the axle is rC.
      let lo = 0;
      let hi = twinLen;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (dist(pointAlong(ssTwin, mid).p, g.rearAxle) < rC) lo = mid;
        else hi = mid;
      }
      return lo;
    })();
    const onStay = pointAlong(ssTwin, sAt).p;
    const radial = norm(sub(onStay, g.rearAxle));
    const centre = add(g.rearAxle, mul(radial, rC));
    const innerR = tyreW / 2 + 6;
    const outerR = innerR + 14;
    const stayY = ssYAt(sAt);
    const mk = (ds: number, sg: number): Mount => {
      const p = pointAlong(ssTwin, sAt + ds).p;
      return { name: `seatstay lock boss ${sg > 0 ? 'left' : 'right'} ${ds > 0 ? 'upper' : 'lower'}`, at: p3(p, sg * (ssYAt(sAt + ds) + ssR)), note: 'M5; spacing to suit the chosen lock (verify)' };
    };
    ringLock = {
      centre,
      radial,
      innerR,
      outerR,
      bodyArcDeg: 220,
      bodyLength: 30,
      mounts: [mk(-25, 1), mk(25, 1), mk(-25, -1), mk(25, -1)],
    };
    check('Frame lock body to seatstays', stayY - ssR - outerR, 3);
  }

  // ------------------------------------------------------------- carrier block
  let carrierBlock: CarrierBlock | undefined;
  if (d.carrierBlock === true) {
    const u = g.steerDir;
    const n = g.steerNormal;
    const up = mul(u, -1);
    const htR = numOf(d, 'htOD') / 2;
    const mid = lerp(g.htTop, g.htBottom, 0.45);
    const mbDepth = 12;
    const mbCentre = add(mid, mul(n, htR + mbDepth / 2 - 2));
    const holes = [add(mbCentre, mul(up, 13)), add(mbCentre, mul(up, -13))].map((p) => p3(add(p, mul(n, mbDepth / 2))));
    const blkDepth = 65;
    const blkCentre = add(mbCentre, mul(n, mbDepth / 2 + blkDepth / 2));
    carrierBlock = {
      mountBlock: { centre: p3(mbCentre), alongHT: 40, width: 24, depth: mbDepth, holes, thread: 'M5', holeSpacing: 26 },
      block: { centre: p3(blkCentre), depth: blkDepth, width: 60, height: 60, loadKg: 10 },
      forward: n,
      up,
    };
    // The front tyre must not reach the block when steered straight.
    const fr = dist(blkCentre, g.frontAxle) - 30 - g.frontWheelR - (d.fenders === true ? fClr + 3 : 0);
    check('Carrier block to front tyre/fender', fr, 15);
  }


  // ------------------------------------------------------------- e-assist
  let eAssist: EAssist | undefined;
  const wantBatt = d.blockBattery === true && carrierBlock !== undefined;
  const wantMotor = d.frontHubMotor === true;
  if (wantBatt || wantMotor) {
    const fwd = g.steerNormal;
    const up = mul(g.steerDir, -1);
    const wiring: EAssist['wiring'] = [];
    let battery: EAssist['battery'];
    // Front wheel + fender, swept through steering lock, as a cloud of 3D points.
    const steerAxisPt = g.htTop;
    const k: P3 = [g.steerDir.x, 0, g.steerDir.y];
    const rotAboutAxis = (p: P3, th: number): P3 => {
      const vv: P3 = [p[0] - steerAxisPt.x, p[1], p[2] - steerAxisPt.y];
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const kd = k[0] * vv[0] + k[1] * vv[1] + k[2] * vv[2];
      const cr: P3 = [k[1] * vv[2] - k[2] * vv[1], k[2] * vv[0] - k[0] * vv[2], k[0] * vv[1] - k[1] * vv[0]];
      return [steerAxisPt.x + vv[0] * c + cr[0] * sn + k[0] * kd * (1 - c), vv[1] * c + cr[1] * sn + k[1] * kd * (1 - c), steerAxisPt.y + vv[2] * c + cr[2] * sn + k[2] * kd * (1 - c)];
    };
    const frontR = g.frontWheelR + (d.fenders === true ? numOf(d, 'fenderClearance') + 3 : 0);
    const halfW = (d.fenders === true ? numOf(d, 'frontTyre') + 18 : numOf(d, 'frontTyre')) / 2;
    const wheelPts: P3[] = [];
    for (let a = 20; a <= 200; a += 2)
      for (let yy = -halfW; yy <= halfW + 0.01; yy += halfW / 4) wheelPts.push([g.frontAxle.x + frontR * Math.cos(rad(a)), yy, g.frontAxle.y + frontR * Math.sin(rad(a))]);
    const swept: P3[] = [];
    for (let t = -70; t <= 70; t += 5) for (const p of wheelPts) swept.push(rotAboutAxis(p, rad(t)));
    // Handlebar (straight bar through the clamp, radius ~12) swept through the same lock.
    const barW = numOf(d, 'barWidth') || 600;
    const barPts: P3[] = [];
    for (let yy = -barW / 2; yy <= barW / 2; yy += 10) barPts.push([g.barClamp.x, yy, g.barClamp.y]);
    const barSwept: P3[] = [];
    for (let t = -70; t <= 70; t += 5) for (const p of barPts) barSwept.push(rotAboutAxis(p, rad(t)));
    const boxDist = (b: Box3, pts: P3[]) => {
      let m = Infinity;
      for (const p of pts) {
        const rel = v(p[0] - b.centre[0], p[2] - b.centre[2]);
        const ds = Math.max(Math.abs(dot(rel, fwd)) - b.depth / 2, 0);
        const dh = Math.max(Math.abs(dot(rel, up)) - b.height / 2, 0);
        const dw = Math.max(Math.abs(p[1] - b.centre[1]) - b.width / 2, 0);
        m = Math.min(m, Math.hypot(ds, dh, dw));
      }
      return m;
    };
    const at = (base: Vec, f: number, u: number) => add(add(base, mul(fwd, f)), mul(up, u));

    if (wantBatt) {
      const cb = carrierBlock!;
      const blkC = v(cb.block.centre[0], cb.block.centre[2]);
      const face = at(blkC, cb.block.depth / 2, 0);
      const plate = 4;
      const baseT = 16;
      const pd = numOf(d, 'blockBatteryDepth');
      const ph = numOf(d, 'blockBatteryHeight');
      const pw = numOf(d, 'blockBatteryWidth');
      const lift = numOf(d, 'blockBatteryLift');
      const packC = at(face, plate + baseT + pd / 2, lift);
      const baseC = at(face, plate + baseT / 2, lift);
      // Controller: a slim box tucked behind the cradle back plate, beside the carrier block (drive side), out of the tyre's sweep.
      const ctrlH = 90;
      const ctrlC = at(blkC, 5, 0);
      const cradleBottom = lift - ph / 2 - 8;
      const cradleTop = lift + ph / 2 - 40; // cheeks stop short so the pack lifts out
      const cradleC = at(face, (plate + baseT + pd * 0.5) / 2, (cradleTop + cradleBottom) / 2);
      const pack: Box3 = { centre: p3(packC), depth: pd, height: ph, width: pw };
      const ctrl: Box3 = { centre: p3(ctrlC, -(cb.block.width / 2 + 17)), depth: 50, height: ctrlH, width: 30 };
      const kg = numOf(d, 'blockBatteryKg');
      battery = {
        cradle: { centre: p3(cradleC), depth: plate + baseT + pd * 0.5, height: cradleTop - cradleBottom, width: pw + 8, plate },
        base: { centre: p3(baseC), depth: baseT, height: ph, width: pw - 20 },
        pack: { ...pack, wh: numOf(d, 'blockBatteryWh'), kg, volts: 36 },
        controller: ctrl,
        keyLock: p3(at(face, plate + baseT + pd * 0.5, lift - ph / 2 + 15), -(pw / 2 + 4)),
        chargePort: p3(at(face, plate + baseT + pd * 0.6, lift + ph / 2 - 30), pw / 2 + 2),
        headlight: p3(at(face, plate + baseT + pd + 10, lift - ph / 2 + 25)),
        removal: up,
        blockLoadKg: Math.round((kg + 0.9 + 0.4 + 0.2) * 10) / 10,
        blockRatingKg: cb.block.loadKg,
      };
      check('Battery pack to front tyre/fender at full steering lock', boxDist(pack, swept), 25);
      check('Motor controller to front tyre/fender at full steering lock', boxDist(ctrl, swept), 25);
      check('Battery pack to handlebar at full steering lock', boxDist(pack, barSwept) - 12, 30);
      check('Battery pack slid 50 mm up to unlock, to handlebar (bars straight)', boxDist({ ...pack, centre: p3(at(packC, 0, 50)) }, barPts) - 12, 15);
    }

    let motor: EAssist['motor'];
    if (wantMotor) {
      const fs = numOf(d, 'frontSpacing');
      motor = {
        axle: p3(g.frontAxle),
        shellDia: numOf(d, 'motorShellDia'),
        shellWidth: numOf(d, 'motorShellWidth'),
        power: numOf(d, 'motorPower'),
        cableSide: 'right',
        torqueWashers: [p3(g.frontAxle, fs / 2 + 3), p3(g.frontAxle, -fs / 2 - 3)],
      };
      // Motor cable: out of the axle on the left, up the back of the left blade, then a steering loop to the controller.
      const blade = forkBladePts(d, g);
      const tipY = fs / 2 + 2.5;
      const crownHalf = numOf(d, 'frontTyre') / 2 + (d.fenders === true ? numOf(d, 'fenderClearance') : 6) + numOf(d, 'forkBladeDia') / 2;
      const bladeOff = numOf(d, 'forkBladeDia') / 2 + 4;
      const run: P3[] = [p3(add(g.frontAxle, v(-12, 8)), -(tipY + 6))];
      const bl = [...blade].reverse();
      for (let i = 1; i < bl.length - 1; i += Math.max(1, Math.floor(bl.length / 6))) {
        const tt = 1 - i / (bl.length - 1);
        run.push(p3(add(bl[i], mul(fwd, -bladeOff)), -(crownHalf + (tipY - crownHalf) * tt + 4)));
      }
      const crownSide = add(blade[0], mul(fwd, -bladeOff));
      run.push(p3(crownSide, -(crownHalf + 4)));
      if (battery) {
        const c = battery.controller.centre;
        run.push([crownSide.x + 30, c[1] - 10, crownSide.y + 70]);
        run.push([c[0], c[1], c[2] - battery.controller.height / 2]);
      }
      wiring.push({ name: 'motor cable (from controller to hub, right side)', od: 8, pts: run.map(R3n), note: 'Steering loop between head tube and fork crown: leave ~120 mm slack so the bars turn full lock without tugging. Clip to the back of the right blade with 3 brazed cable guides or P-clips; waterproof connector just below the crown.' });
    }

    let sensor: EAssist['sensor'];
    let display: EAssist['display'];
    if (wantMotor) {
      sensor = { type: String(d.pasSensor || 'cadence'), at: p3(v(0, 0), 40) };
      display = { at: p3(g.barClamp, 60) };
      if (battery) {
        const c = battery.controller.centre;
        const { dtPts } = frameTubes(d, g);
        const dtR = numOf(d, 'dtOD') / 2;
        const dtRun = dtPts.filter((_, i) => i % Math.max(1, Math.floor(dtPts.length / 6)) === 0).map((p) => p3(p, dtR * 0.7 + 3));
        wiring.push({ name: 'pedal sensor cable (BB to controller, along down tube)', od: 4, pts: [p3(v(-5, -10), 40), ...dtRun.slice(1), p3(add(g.htBottom, mul(fwd, 25)), 20), [c[0], c[1], c[2] - 20] as P3].map(R3n), note: 'Run under the left side of the down tube on the existing brazed cable guides; zip-tie to the brake housing.' });
        wiring.push({ name: 'display / brake-sensor loom (bar to controller)', od: 6, pts: [p3(g.barClamp, 40), p3(at(g.stemPivot, 60, -10), 30), [c[0], c[1], c[2] + battery.controller.height / 2] as P3].map(R3n), note: 'Bundle with the brake and gear housings; same steering slack as the housings.' });
      }
    }

    // Mass: battery + cradle/controller/loom on the frame, motor at the front axle (less a 0.45 kg normal hub).
    const battKg = battery ? battery.blockLoadKg + 0.3 : 0;
    const motorKg = wantMotor ? 2.4 - 0.45 : 0;
    const added = battKg + motorKg;
    const wb = g.frontAxle.x - g.rearAxle.x;
    const battFront = battery ? (battery.pack.centre[0] - g.rearAxle.x) / wb : 0;
    const frontKg = battKg * battFront + motorKg;
    eAssist = { forward: fwd, up, battery, motor, sensor, display, wiring, addedKg: Math.round(added * 10) / 10, frontShare: added ? Math.round((frontKg / added) * 100) / 100 : 0 };
  }

  // ------------------------------------------------------------- kickstand
  let kickstand: Kickstand | undefined;
  if (d.kickstand === true) {
    const s = csLen - 55;
    const c = pointAlong(csPts, s).p;
    const plateC = v(c.x, c.y - csR - 3);
    const pivot = v(plateC.x, plateC.y - 25);
    kickstand = {
      plate: { centre: p3(plateC), length: 60, width: 2 * (csYAt(s) + csR) },
      pivot: p3(pivot),
      feet: [p3(v(pivot.x + 30, g.groundY), 160), p3(v(pivot.x + 30, g.groundY), -160)],
    };
  }

  return { stays, fenders, rack, chainguard, ringLock, carrierBlock, eAssist, kickstand, clearances };
}

export { arcPts };
