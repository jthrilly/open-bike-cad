/**
 * BikeCAD behaviour for head tube extensions and beam (discontinuous seat tube) frames.
 *
 * - BikeCAD's head tube length is the whole tube with the headset cups at its ends; its head
 *   tube "extensions" only place the top/down tube junctions (FrontTriangle: htlength =
 *   htbottomP.distance(htmidtopP), htmidtopP = ttfP + "Head tube upper extension2").
 * - BikeCAD has no beam style; its beam option is the "DISCONTINUOUS" seat tube with sections
 *   J ("ST_TOP_LENGTH", from the seat tube top) and K ("ST_BOTTOM_LENGTH", from the BB shell).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultDesign, Design, PARAM_BY_ID } from '../src/model/schema';
import { solve } from '../src/geometry/solve';
import { upgradeDesign } from '../src/ui/state';
import { migrateHeadTubeExtensions } from '../src/model/migrate';
import { tubeCuts, headTubeRadiusAt } from '../src/export/mitre';
import { exportBcad, importBcad, newBikeFile, NS } from '../src/bcad/io';
import { parseProperties, serializeProperties } from '../src/bcad/properties';
import { frameTubes, seatTubeSections } from '../src/render/BikeDrawing';
import { dist, dot, sub } from '../src/geometry/vec';

const near = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 0.05) => {
  expect(a.x).toBeCloseTo(b.x, 1);
  expect(Math.abs(a.y - b.y)).toBeLessThan(tol);
};

describe('head tube: full length between the headset cups (BikeCAD)', () => {
  it('has no separate extension parameters any more', () => {
    expect(PARAM_BY_ID.htExtTop).toBeUndefined();
    expect(PARAM_BY_ID.htExtBottom).toBeUndefined();
    expect(PARAM_BY_ID.ttHeadOffset.label).toMatch(/extension above top tube/i);
    expect(PARAM_BY_ID.dtHeadOffset.label).toMatch(/extension below down tube/i);
  });

  it('cuts the head tube at head tube length, tapering over that length', () => {
    const d: Design = { ...defaultDesign(), frontEndMode: 'reachHtl', headTubeLength: 160, htProfile: 'tapered', htOD: 36, htODBottom: 44 };
    const g = solve(d);
    const ht = tubeCuts(d, g).find((t) => t.id === 'ht')!;
    expect(ht.lengthLongPoints).toBeCloseTo(160, 6);
    expect(headTubeRadiusAt(d, g, g.htTop)).toBeCloseTo(18, 6);
    expect(headTubeRadiusAt(d, g, g.htBottom)).toBeCloseTo(22, 6);
    // Headset lower cup at the tube's bottom end.
    expect(dist(g.crownRace, g.htBottom)).toBeCloseTo(Number(d.lowerStack), 6);
  });

  for (const mode of ['stackReach', 'reachHtl', 'frontCenter', 'ett', 'bars']) {
    it(`migrates old htExtTop/htExtBottom (${mode}): same tube, headset at its ends, fork fixed`, () => {
      const old: Design = { ...defaultDesign(), frontEndMode: mode, htExtTop: 12, htExtBottom: 5 };
      const g0 = solve(old);
      const oldTubeTop = sub(g0.htTop, { x: g0.steerDir.x * 12, y: g0.steerDir.y * 12 });
      const d = upgradeDesign(old);
      expect('htExtTop' in d).toBe(false);
      expect('htExtBottom' in d).toBe(false);
      const g = solve(d);
      expect(g.dims.headTubeLength).toBeCloseTo(g0.dims.headTubeLength + 17, 1);
      // Fork and front wheel stay put; the lower cup now sits at the tube bottom.
      near(g.frontAxle, g0.frontAxle);
      near(g.htBottom, g0.htBottom);
      // The tube rises along the steering axis by the lower extension.
      const up = dot(sub(oldTubeTop, g.htTop), g.steerDir);
      expect(up).toBeCloseTo(5, 1);
      // Junctions keep their distances from the tube ends.
      expect(Number(d.ttHeadOffset)).toBeCloseTo(Number(old.ttHeadOffset) + 12, 6);
      expect(Number(d.dtHeadOffset)).toBeCloseTo(Number(old.dtHeadOffset) + 5, 6);
      expect(d.frontEndMode).toBe(mode);
    });
  }

  it('leaves designs without the old keys alone', () => {
    const d = defaultDesign();
    expect(migrateHeadTubeExtensions(d)).toBe(d);
    const zero = migrateHeadTubeExtensions({ ...d, htExtTop: 0, htExtBottom: 0 });
    expect({ ...zero }).toEqual(d);
  });

  it('upgrades a .bcad saved by an older version with the extensions, and writes the new head tube', () => {
    const old = { ...defaultDesign(), frontEndMode: 'reachHtl', headTubeLength: 140 };
    const doc = parseProperties(exportBcad(newBikeFile(old)));
    // An old export carried our extension keys; they are ours, so the fingerprint is unchanged.
    doc.entries.set(NS + 'htExtTop', '10.0');
    doc.entries.set(NS + 'htExtBottom', '0.0');
    const f = importBcad(serializeProperties(doc));
    expect(f.design.headTubeLength).toBeCloseTo(150, 6);
    expect('htExtTop' in f.design).toBe(false);
    const out = parseProperties(exportBcad(f));
    expect(Number(out.entries.get('Head tube length textfield'))).toBeCloseTo(150, 6);
    expect(out.entries.has(NS + 'htExtTop')).toBe(false);
  });

  it('ignores our old extension keys once BikeCAD has re-saved the file', () => {
    const old = { ...defaultDesign(), frontEndMode: 'reachHtl', headTubeLength: 140 };
    const doc = parseProperties(exportBcad(newBikeFile(old)));
    doc.entries.set(NS + 'htExtTop', '10.0');
    doc.entries.set('Head tube length textfield', '141.0'); // edited in BikeCAD
    const f = importBcad(serializeProperties(doc));
    expect(f.design.headTubeLength).toBeCloseTo(141, 6);
  });
});

describe('beam frame = BikeCAD discontinuous seat tube', () => {
  const beam = (J: number, K: number): Design => ({ ...defaultDesign(), frameStyle: 'beam', stTopSection: J, stBottomSection: K });

  it('with J = K = 0 has no seat tube at all', () => {
    const d = beam(0, 0);
    const g = solve(d);
    expect(seatTubeSections(d, frameTubes(d, g).stPts)).toEqual([]);
    const cuts = tubeCuts(d, g);
    expect(cuts.some((t) => t.id.startsWith('st'))).toBe(false);
    expect(cuts.find((t) => t.id === 'tt')!.ends.map((e) => e.into)).toEqual(['head tube']);
  });

  it('keeps a section J below the seat tube top and K above the BB shell, and cuts them', () => {
    const d = beam(120, 60);
    const g = solve(d);
    const { stPts } = frameTubes(d, g);
    const secs = seatTubeSections(d, stPts);
    expect(secs.map((s) => s.id)).toEqual(['bottom', 'top']);
    const L = Number(d.seatTubeLength);
    expect(secs[1].to - secs[1].from).toBeCloseTo(120, 6);
    expect(dist(secs[1].pts[secs[1].pts.length - 1], g.stTop)).toBeCloseTo(0, 6);
    const shell = Math.sqrt((Number(d.bbShellOD) / 2) ** 2 - (Number(d.stODBottom) / 2) ** 2);
    expect(secs[0].to).toBeCloseTo(shell + 60, 6);
    expect(secs[0].to).toBeLessThan(L);
    const cuts = tubeCuts(d, g);
    expect(cuts.find((t) => t.id === 'stTop')!.lengthLongPoints).toBeCloseTo(120, 6);
    // K is measured from where the seat tube's edge meets the shell: the BB mitre's short point.
    expect(cuts.find((t) => t.id === 'stBottom')!.lengthLongPoints).toBeCloseTo(60, 6);
    expect(cuts.some((t) => t.id === 'st')).toBe(false);
    // The top section reaches the top tube junction (default extension 20 mm), so the TT copes into it.
    expect(cuts.find((t) => t.id === 'tt')!.ends.map((e) => e.into)).toEqual(['seat tube', 'head tube']);
  });

  it('is a whole seat tube when the sections meet', () => {
    const d = beam(400, 400);
    const g = solve(d);
    const cuts = tubeCuts(d, g);
    expect(cuts.find((t) => t.id === 'st')).toBeDefined();
    expect(cuts.some((t) => t.id === 'stTop' || t.id === 'stBottom')).toBe(false);
  });

  it('reads and writes BikeCAD\'s DISCONTINUOUS, ST_TOP_LENGTH and ST_BOTTOM_LENGTH', () => {
    const xml = readFileSync(new URL('./fixtures/biked-bike10.bcad', import.meta.url), 'utf8');
    const doc = parseProperties(xml);
    expect(doc.entries.get('DISCONTINUOUS')).toBe('false');
    doc.entries.set('DISCONTINUOUS', 'true');
    doc.entries.set('ST_TOP_LENGTH', '90.0');
    doc.entries.set('ST_BOTTOM_LENGTH', '40.0');
    const f = importBcad(serializeProperties(doc));
    expect(f.design.frameStyle).toBe('beam');
    expect(f.design.stTopSection).toBe(90);
    expect(f.design.stBottomSection).toBe(40);

    const plain = importBcad(xml);
    expect(plain.design.frameStyle).toBe('diamond');
    const edited = { ...plain, design: { ...plain.design, frameStyle: 'beam', stTopSection: 100, stBottomSection: 30 } };
    const out = parseProperties(exportBcad(edited));
    expect(out.entries.get('DISCONTINUOUS')).toBe('true');
    expect(Number(out.entries.get('ST_TOP_LENGTH'))).toBe(100);
    expect(Number(out.entries.get('ST_BOTTOM_LENGTH'))).toBe(30);
  });

  it('adds the keys to a file from a BikeCAD without them, and drops beam once BikeCAD makes the tube continuous', () => {
    const xml = readFileSync(new URL('./fixtures/biked-bike11.bcad', import.meta.url), 'utf8');
    const f = importBcad(xml);
    expect(f.source!.entries.has('DISCONTINUOUS')).toBe(false);
    const out = parseProperties(exportBcad({ ...f, design: { ...f.design, frameStyle: 'beam', stTopSection: 80 } }));
    expect(out.entries.get('DISCONTINUOUS')).toBe('true');
    expect(Number(out.entries.get('ST_TOP_LENGTH'))).toBe(80);
    // BikeCAD re-saves it continuous: BikeCAD's value wins over our saved style.
    out.entries.set('DISCONTINUOUS', 'false');
    out.entries.set('Seat angle', '73.1');
    expect(importBcad(serializeProperties(out)).design.frameStyle).toBe('diamond');
  });
});
