/** Frame tube centrelines in side view, shared by the drawing, cut list and 3D export. */
import { Design, numOf } from '../model/schema';
import { Geometry } from './solve';
import { Vec, add, sub, mul, norm } from './vec';
import { centreline } from './shapes';

export function frameTubes(d: Design, g: Geometry) {
  const ttPts = centreline(g.ttRear, g.ttFront, numOf(d, 'ttBend'));
  const dtPts = centreline(g.dtRear, g.dtFront, -numOf(d, 'dtBend'));
  const stPts = centreline(g.stBottom, g.stTop, -numOf(d, 'stBend'));
  const csPts = centreline(g.rearAxle, g.bb, -numOf(d, 'csBend'));
  let ssPts: Vec[];
  if (d.seatstayStyle === 'wishbone') {
    const wl = numOf(d, 'wishboneLength');
    const dir = norm(sub(g.rearAxle, g.ssTop));
    const split = add(g.ssTop, mul(dir, wl));
    ssPts = [...centreline(g.rearAxle, split, numOf(d, 'ssBend')), g.ssTop];
  } else {
    ssPts = centreline(g.rearAxle, g.ssTop, numOf(d, 'ssBend'));
  }
  return { ttPts, dtPts, stPts, csPts, ssPts };
}

/** Curved fork blade centreline (side view), crown to axle: straight along the steering axis, then a tangent bend to the axle. */
export function forkBladePts(d: Design, g: Geometry): Vec[] {
  const u = g.steerDir;
  const n = g.steerNormal;
  const crownBot = add(g.crownRace, mul(u, numOf(d, 'forkCrownHeight')));
  const axle = g.frontAxle;
  const axisFoot = sub(axle, mul(n, numOf(d, 'forkRake')));
  const bendStart = sub(axisFoot, mul(u, numOf(d, 'forkBladeBendLength')));
  const ctrl = add(mul(bendStart, 0.3), mul(axisFoot, 0.7));
  const pts: Vec[] = [crownBot];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const mt = 1 - t;
    pts.push({ x: mt * mt * bendStart.x + 2 * mt * t * ctrl.x + t * t * axle.x, y: mt * mt * bendStart.y + 2 * mt * t * ctrl.y + t * t * axle.y });
  }
  return pts;
}
