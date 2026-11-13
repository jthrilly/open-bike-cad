import { describe, expect, it } from 'vitest';
import { defaultDesign, Design } from '../src/model/schema';
import { solve, switchFrontEndMode, footModel, BALL_TO_TOE } from '../src/geometry/solve';
import { PRESETS } from '../src/model/presets';
import { tubeCuts, mitreCurve, cutListWarnings, headTubeRadiusAt } from '../src/export/mitre';
import { poseRider } from '../src/fit/rider';
import { frameTubes } from '../src/render/BikeDrawing';
import { angleBetween, sub, dist } from '../src/geometry/vec';
import { centreline, endTangent } from '../src/geometry/shapes';

const D = (p: Partial<Design> = {}) => ({ ...defaultDesign(), ...p }) as Design;
const cut = (d: Design, id: string) => tubeCuts(d, solve(d)).find((t) => t.id === id)!;
const mtb = () => PRESETS.find((p) => p.id === 'mtb')!.make();

describe('mitre: receiving radius at the junction (bug 1)', () => {
  it('MTB down tube copes into the local radius of the tapered head tube', () => {
    const d = mtb();
    const g = solve(d);
    const dt = cut(d, 'dt');
    const ht = dt.ends[1];
    // Linear taper 44 → 56 from HT top to bottom (no extensions in the preset).
    const t = dist(g.dtFront, g.htTop) / g.dims.headTubeLength;
    const localR = (44 + 12 * t) / 2;
    expect(ht.R).toBeCloseTo(localR, 6);
    const expected = dt.cc - dt.ends[0].zMin - mitreCurve(38.1 / 2, localR, ht.angle).zMin;
    expect(dt.lengthLongPoints).toBeCloseTo(expected, 6);
    // Reviewer's 708.8 included the old +0.2 paper radius (bug 3); with the true radius it is 708.0.
    expect(dt.lengthLongPoints).toBeCloseTo(708.0, 0);
    expect(Math.abs(dt.lengthLongPoints - 716.2)).toBeGreaterThan(7);
    // Top tube uses the local radius too.
    expect(cut(d, 'tt').ends[1].R).toBeCloseTo((44 + 12 * (dist(g.ttFront, g.htTop) / g.dims.headTubeLength)) / 2, 6);
  });

  it('hourglass head tube: ends at htODBottom, waist at htOD', () => {
    const d = D({ htProfile: 'hourglass', htOD: 36, htODBottom: 44 });
    const g = solve(d);
    const mid = { x: (g.htTop.x + g.htBottom.x) / 2, y: (g.htTop.y + g.htBottom.y) / 2 };
    expect(headTubeRadiusAt(d, g, g.htTop)).toBeCloseTo(22, 6);
    expect(headTubeRadiusAt(d, g, mid)).toBeCloseTo(18, 6);
    expect(headTubeRadiusAt(d, g, g.htBottom)).toBeCloseTo(22, 6);
    expect(headTubeRadiusAt(D(), solve(D()), g.htBottom)).toBe(18);
  });
});

describe('mitre: stays stop at the dropouts (bug 2)', () => {
  it('chainstay and seatstay long-point lengths subtract the dropout offsets', () => {
    const d = D();
    const cs = cut(d, 'cs');
    const ss = cut(d, 'ss');
    expect(cs.lengthLongPoints).toBeCloseTo(cs.cc - 35 - cs.ends[0].zMin, 6);
    expect(ss.lengthLongPoints).toBeCloseTo(ss.cc - 35 - ss.ends[0].zMin, 6);
    const d2 = D({ csDropoutOffset: 80, ssDropoutOffset: 80 });
    expect(cut(d2, 'cs').lengthLongPoints).toBeCloseTo(cs.lengthLongPoints - 45, 6);
    expect(cut(d2, 'ss').lengthLongPoints).toBeCloseTo(ss.lengthLongPoints - 45, 6);
  });
});

describe('mitre: paper thickness only widens the template (bug 3)', () => {
  it('cope shape and cut lengths do not change; circumference is π·(OD + t)', () => {
    const base = tubeCuts(D({ paperThicknessComp: 0 }), solve(D({ paperThicknessComp: 0 })));
    for (const t of [0.2, 1]) {
      const d = D({ paperThicknessComp: t });
      const cuts = tubeCuts(d, solve(d));
      for (const c of cuts) {
        const b = base.find((x) => x.id === c.id)!;
        expect(c.lengthLongPoints, c.id).toBeCloseTo(b.lengthLongPoints, 9);
        expect(c.cutLength, c.id).toBeCloseTo(b.cutLength, 9);
        c.ends.forEach((e, i) => {
          expect(e.zMax - e.zMin).toBeCloseTo(b.ends[i].zMax - b.ends[i].zMin, 9);
          expect(e.curve[e.curve.length - 1].x).toBeCloseTo(Math.PI * (c.id === 'st' ? 28.6 : c.od) + Math.PI * t, 6);
        });
      }
    }
  });
});

describe('mitre: offsets and oversized branches (bug 4)', () => {
  it('seatstay sits inside the seat tube and its long point is within c-c', () => {
    for (const d of [D(), ...PRESETS.map((p) => p.make())]) {
      const ss = cut(d, 'ss');
      const e = ss.ends[0];
      expect(8 + e.offset).toBeLessThanOrEqual(e.R + 1e-9);
      expect(ss.lengthLongPoints).toBeLessThan(ss.cc);
      expect(ss.warnings).toEqual([]);
    }
  });

  it('a branch larger than the receiving tube warns and ignores the overhanging points', () => {
    const d = D({ dtOD: 38.1, htOD: 36 });
    const dt = cut(d, 'dt');
    const ht = dt.ends[1];
    expect(ht.warnings.length).toBe(1);
    expect(dt.warnings.some((w) => /larger than the head tube/.test(w))).toBe(true);
    expect(cutListWarnings(d, solve(d)).some((w) => w.startsWith('Down tube:'))).toBe(true);
    // zMin/zMax from the points that touch the head tube only.
    const r = 19.05;
    const th = (ht.angle * Math.PI) / 180;
    const zs: number[] = [];
    for (let i = 0; i <= 180; i++) {
      const phi = (i / 180) * 2 * Math.PI;
      const k = r * Math.sin(phi);
      if (Math.abs(k) <= 18) zs.push(Math.sqrt(18 * 18 - k * k) / Math.sin(th) - (r * Math.cos(phi)) / Math.tan(th));
    }
    expect(ht.zMin).toBeCloseTo(Math.min(...zs), 9);
    expect(ht.zMax).toBeCloseTo(Math.max(...zs), 9);
    // The default (fits) has no warnings.
    expect(cut(D(), 'dt').warnings).toEqual([]);
  });
});

describe('seatpost exposure is signed (bug 5)', () => {
  it('saddle below the seat tube top gives negative exposure and a warning', () => {
    const d = D({ saddleHeight: 500 });
    const g = solve(d);
    // seatpost top 450 along the seat tube, seat tube top 580.
    expect(g.dims.seatpostExposed).toBeCloseTo(450 - 580, 6);
    expect(g.warnings).toContain('Saddle height is lower than the top of the seat tube.');
    expect(g.dims.seatpostMinLength).toBeCloseTo(80, 6);
    const g2 = solve(D());
    expect(g2.dims.seatpostExposed).toBeGreaterThan(0);
    expect(g2.dims.seatpostMinLength).toBeCloseTo(g2.dims.seatpostExposed + 80, 6);
  });
});

describe('unreachable front-end targets warn (bug 6)', () => {
  it('ttLength out of range', () => {
    for (const t of [100, 3000]) {
      const g = solve(D({ frontEndMode: 'ttLength', ttLengthCC: t }));
      expect(g.warnings.some((w) => /Top tube length .*can't be met/.test(w))).toBe(true);
      expect(g.dims.reach).toBeCloseTo(385, 6); // unchanged fallback
    }
  });
  it('frontCenter shorter than the axle height', () => {
    const g = solve(D({ frontEndMode: 'frontCenter', frontCenter: 50 }));
    expect(g.warnings.some((w) => /Front centre .*can't be met/.test(w))).toBe(true);
  });
  it('reachable targets do not warn', () => {
    for (const m of ['ttLength', 'frontCenter']) {
      const g = solve(switchFrontEndMode(D(), m));
      expect(g.warnings.some((w) => /can't be met/.test(w))).toBe(false);
    }
  });
});

describe('one foot model (bug 7)', () => {
  it('positive cleat setback moves the ball and toe forward by the same amount', () => {
    const g0 = solve(D({ cleatSetback: 0, crankAngle: 0 }));
    const g1 = solve(D({ cleatSetback: 20, crankAngle: 0 }));
    const p0 = poseRider(D({ cleatSetback: 0, crankAngle: 0 }), g0);
    const p1 = poseRider(D({ cleatSetback: 20, crankAngle: 0 }), g1);
    expect(g1.toe.x - g0.toe.x).toBeCloseTo(20, 6);
    expect(p1.ball.x - p0.ball.x).toBeCloseTo(20, 6);
    expect(g1.dims.toeOverlap).toBeGreaterThan(g0.dims.toeOverlap);
    // Toe check and rider share the ball position and ball-to-toe ratio.
    const f = footModel(D({ cleatSetback: 20 }), g1.pedalForward);
    expect(f.toe.x - f.ball.x).toBeCloseTo(280 * BALL_TO_TOE, 6);
    expect(p1.ball.x).toBeCloseTo(f.ball.x, 6);
    expect(p1.ball.y).toBeCloseTo(f.ball.y, 6);
  });
});

describe('curved tubes (bug 8)', () => {
  it('endTangent is exact for centreline() curves', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 500, y: 100 };
    const pts = centreline(a, b, 40);
    // Quadratic Bézier: start tangent toward control point, end tangent from it.
    const c = { x: 2 * pts[12].x - (a.x + b.x) / 2, y: 2 * pts[12].y - (a.y + b.y) / 2 };
    expect(angleBetween(endTangent(pts), sub(c, a))).toBeLessThan(1e-6);
    expect(angleBetween(endTangent(pts, true), sub(b, c))).toBeLessThan(1e-6);
  });

  it('top/down tube mitres use the end tangents; standover follows the curve', () => {
    const d = D({ ttBend: 50, dtBend: 40 });
    const g = solve(d);
    const { ttPts, dtPts } = frameTubes(d, g);
    const cuts = tubeCuts(d, g);
    const tt = cuts.find((t) => t.id === 'tt')!;
    const dt = cuts.find((t) => t.id === 'dt')!;
    expect(tt.ends[0].angle).toBeCloseTo(180 - angleBetween(g.seatDir, endTangent(ttPts)), 6);
    expect(tt.ends[0].angle).toBeGreaterThan(90); // the chord gave the seat angle, 73.5
    const tF = endTangent(dtPts, true);
    expect(dt.ends[1].angle).toBeCloseTo(angleBetween(sub(g.htBottom, g.dtFront), { x: -tF.x, y: -tF.y }), 6);
    const straight = solve(D({ dtBend: 40 }));
    // ttBend 50 raises the mid-span by the sagitta.
    expect(g.dims.standover - straight.dims.standover).toBeCloseTo(50, 0);
  });
});

describe('presets are self-consistent (bug 9)', () => {
  it('top tube meets the seat tube at least 10 mm below its top, and only toe overlap warns', () => {
    const all: [string, Design][] = [['default', D()], ...PRESETS.map((p) => [p.id, p.make()] as [string, Design])];
    for (const [id, d] of all) {
      const g = solve(d);
      const other = g.warnings.filter((w) => !w.startsWith('Toe overlap'));
      expect(other, id).toEqual([]);
      if (d.frameStyle !== 'stepThrough') expect(g.dims.stCT - g.dims.stCC, id).toBeGreaterThanOrEqual(10);
      expect(cutListWarnings(d, g).filter((w) => !/Step-through tube/.test(w)), id).toEqual([]);
    }
  });
});

describe('cut list follows the frame style (bug 10)', () => {
  it('step-through has no top tube; beam has no seat tube', () => {
    const st = D({ frameStyle: 'stepThrough' });
    const ids = tubeCuts(st, solve(st)).map((t) => t.id);
    expect(ids).not.toContain('tt');
    expect(ids).toContain('st');
    expect(cutListWarnings(st, solve(st)).some((w) => /Step-through tube/.test(w))).toBe(true);
    const beam = D({ frameStyle: 'beam' });
    const bc = tubeCuts(beam, solve(beam));
    expect(bc.map((t) => t.id)).not.toContain('st');
    expect(bc.find((t) => t.id === 'tt')!.ends.map((e) => e.into)).toEqual(['head tube']);
    expect(bc.find((t) => t.id === 'ss')!.ends).toEqual([]);
    expect(tubeCuts(D(), solve(D())).map((t) => t.id)).toEqual(['tt', 'dt', 'st', 'cs', 'ss', 'ht']);
    const mx = D({ frameStyle: 'mixte' });
    expect(cutListWarnings(mx, solve(mx)).some((w) => /Mixte stays/.test(w))).toBe(true);
  });
});

describe('no negative lengths (bug 11)', () => {
  it('very low stack gives a warning and a zero head tube cut', () => {
    const d = D({ stack: 300 });
    const g = solve(d);
    expect(g.dims.headTubeLength).toBeLessThan(0);
    expect(g.warnings.some((w) => /Head tube length is -/.test(w))).toBe(true);
    const cuts = tubeCuts(d, g);
    for (const c of cuts) {
      expect(c.lengthLongPoints, c.id).toBeGreaterThanOrEqual(0);
      expect(c.cutLength, c.id).toBeGreaterThanOrEqual(0);
      expect(c.cc, c.id).toBeGreaterThanOrEqual(0);
    }
    const ht = cuts.find((t) => t.id === 'ht')!;
    expect(ht.cutLength).toBe(0);
    expect(ht.warnings.length).toBe(1);
  });
});
