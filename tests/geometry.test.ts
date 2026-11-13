import { describe, expect, it } from 'vitest';
import { defaultDesign } from '../src/model/schema';
import { solve, switchFrontEndMode } from '../src/geometry/solve';
import { mitreCurve, tubeCuts } from '../src/export/mitre';
import { PRESETS } from '../src/model/presets';
import { fitAdvice, gearTable, poseRider } from '../src/fit/rider';

describe('geometry solver', () => {
  it('honours stack and reach', () => {
    const d = { ...defaultDesign(), frontEndMode: 'stackReach', stack: 570, reach: 390 };
    const g = solve(d);
    expect(g.dims.stack).toBeCloseTo(570);
    expect(g.dims.reach).toBeCloseTo(390);
    // Front axle sits at the height the wheels and BB drop require.
    expect(g.frontAxle.y).toBeCloseTo(g.rearAxle.y, 6);
  });

  it('places the rear axle from chainstay and drop', () => {
    const g = solve({ ...defaultDesign(), chainstayLength: 420, bbDrop: 70 });
    expect(Math.hypot(g.rearAxle.x, g.rearAxle.y)).toBeCloseTo(420);
    expect(g.rearAxle.y).toBeCloseTo(70);
  });

  it('computes trail with the usual formula', () => {
    const d = { ...defaultDesign(), headAngle: 73, forkRake: 45, rearTyre: 25, frontTyre: 25 };
    const g = solve(d);
    const R = 622 / 2 + 25;
    const expected = (R * Math.cos((73 * Math.PI) / 180) - 45) / Math.sin((73 * Math.PI) / 180);
    expect(g.dims.trail).toBeCloseTo(expected, 6);
  });

  it('switching front-end mode does not move the bike', () => {
    const base = { ...defaultDesign(), frontEndMode: 'stackReach', stack: 580, reach: 380 };
    const g0 = solve(base);
    for (const mode of ['reachHtl', 'frontCenter', 'ett', 'ttLength', 'bars']) {
      const g1 = solve(switchFrontEndMode(base, mode));
      expect(g1.htTop.x).toBeCloseTo(g0.htTop.x, 1);
      expect(g1.htTop.y).toBeCloseTo(g0.htTop.y, 1);
    }
  });

  it('every preset solves without NaN', () => {
    for (const p of PRESETS) {
      const d = p.make();
      const g = solve(d);
      for (const [k, v] of Object.entries(g.dims)) expect(Number.isFinite(v), `${p.id}.${k}`).toBe(true);
      const pose = poseRider({ ...d, showRider: true }, g);
      expect(Number.isFinite(pose.knee.x)).toBe(true);
      expect(fitAdvice(d, g).length).toBeGreaterThan(3);
      expect(gearTable(d, g).length).toBeGreaterThan(0);
    }
  });
});

describe('mitres', () => {
  it('equal tubes at 90° give a saddle as deep as the radius', () => {
    const c = mitreCurve(15, 15, 90);
    expect(c.zMax - c.zMin).toBeCloseTo(15, 3);
    expect(c.pts[c.pts.length - 1].x).toBeCloseTo(2 * Math.PI * 15, 6);
  });

  it('cut list is shorter than centre-to-centre', () => {
    const d = defaultDesign();
    const cuts = tubeCuts(d, solve(d));
    const tt = cuts.find((t) => t.id === 'tt')!;
    expect(tt.lengthLongPoints).toBeLessThan(tt.cc);
    expect(tt.lengthLongPoints).toBeGreaterThan(tt.cc - 60);
  });
});

describe('rider fit', () => {
  it('a road bike with the suggested saddle height gives a sensible knee angle', async () => {
    const { fitMetrics } = await import('../src/fit/rider');
    const d = { ...PRESETS[0].make(), inseam: 840 };
    d.saddleHeight = 840 * 0.883;
    const m = fitMetrics(d, solve(d));
    expect(m.kneeAngleBottom).toBeGreaterThan(132);
    expect(m.kneeAngleBottom).toBeLessThan(158);
    expect(m.torsoAngle).toBeGreaterThan(20);
    expect(m.torsoAngle).toBeLessThan(65);
  });
});
