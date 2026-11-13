/**
 * Geometry checked against BikeCAD's own drawings. The fixtures are files from the public BIKED
 * dataset; the expected points were measured from SVGs that BikeCAD's console exporter drew from
 * the same files (mm, BB at the origin, x forward, y up).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { exportBcad, importBcad } from '../src/bcad/io';
import { parseProperties } from '../src/bcad/properties';
import { solve } from '../src/geometry/solve';

const load = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

type P = [number, number];
const drawn: Record<string, { ttRear: P; ttFront: P; stTop: P; htTop: P; dtFront?: P; ttAngle: number }> = {
  // ST measure style 1 (c-t), "Display SEATTUBEEXTENSION" true, suspension fork with 13 mm sag.
  'biked-bike8.bcad': { ttRear: [-118.3, 387.0], ttFront: [460.3, 595.9], stTop: [-133.6, 437.1], htTop: [453.2, 617.6], dtFront: [468.6, 570.1], ttAngle: 19.85 },
  // ST measure style 1 (c-t), centreline extensions, rigid fork.
  'biked-bike10.bcad': { ttRear: [-162.2, 514.5], ttFront: [399.2, 542.9], stTop: [-177.0, 561.5], htTop: [390.8, 570.6], ttAngle: 2.9 },
  // ST measure style 0 (c-c), edge-measured extensions that disagree with the "…2" keys, 20 mm sag.
  'biked-bike11.bcad': { ttRear: [-173.2, 584.8], ttFront: [418.6, 592.3], stTop: [-185.1, 624.9], htTop: [407.1, 628.9], ttAngle: 0.73 },
};

const near = (got: { x: number; y: number }, want: P, tol = 0.5) => {
  expect(Math.hypot(got.x - want[0], got.y - want[1])).toBeLessThan(tol);
};

describe('imported geometry matches BikeCAD drawings', () => {
  for (const [file, w] of Object.entries(drawn)) {
    it(file, () => {
      const g = solve(importBcad(load(file), file).design);
      near(g.ttRear, w.ttRear);
      near(g.ttFront, w.ttFront);
      near(g.stTop, w.stTop);
      near(g.htTop, w.htTop);
      if (w.dtFront) near(g.dtFront, w.dtFront);
      expect(g.dims.ttAngle).toBeCloseTo(w.ttAngle, 1);
    });
  }

  it('reads tube diameters from the keys BikeCAD draws', () => {
    const d = importBcad(load('biked-bike8.bcad'), 'x.bcad').design;
    expect(d.ttOD).toBe(33); // "Top tube diameter", not "Top tube front diameter" (25.4)
    expect(d.dtOD).toBe(40); // "Down tube diameter" for down tube type 1
    expect(d.htProfile).toBe('straight'); // head tube type 1: "Head tube d" is unused
    expect(d.htOD).toBe(45);
    expect(d.forkSag).toBe(13);
  });
});

describe('saving keeps BikeCAD geometry', () => {
  it('writes both extension key sets so an edited junction reads back the same', () => {
    const f = importBcad(load('biked-bike11.bcad'), 'x.bcad');
    const d = { ...f.design, ttHeadOffset: Number(f.design.ttHeadOffset) + 10, seatTubeLength: Number(f.design.seatTubeLength) + 15 };
    const xml = exportBcad({ ...f, design: d });
    const e = parseProperties(xml).entries;
    // Edge-measured and centreline values agree.
    expect(parseFloat(e.get('Head tube upper extension2')!)).toBeCloseTo(Number(d.ttHeadOffset), 6);
    const back = importBcad(xml, 'x.bcad');
    // Re-read as BikeCAD would (from the BikeCAD keys, ignoring our own copy).
    const bikeCadOnly = xml.replace(/<entry key="OpenBikeCAD\.fingerprint">[^<]*<\/entry>/, '');
    const re = importBcad(bikeCadOnly, 'x.bcad').design;
    const g0 = solve(d);
    const g1 = solve(re);
    expect(Math.hypot(g1.ttFront.x - g0.ttFront.x, g1.ttFront.y - g0.ttFront.y)).toBeLessThan(0.2);
    expect(Math.hypot(g1.stTop.x - g0.stTop.x, g1.stTop.y - g0.stTop.y)).toBeLessThan(0.2);
    expect(back.design.ttHeadOffset).toBeCloseTo(Number(d.ttHeadOffset), 6);
  });

  it('adds the sag back to a suspension fork length', () => {
    const f = importBcad(load('biked-bike8.bcad'), 'x.bcad');
    const e0 = parseProperties(load('biked-bike8.bcad')).entries;
    const d = { ...f.design, forkLength: Number(f.design.forkLength) + 10 };
    const e = parseProperties(exportBcad({ ...f, design: d })).entries;
    const rake = parseFloat(e.get('FORK1R')!);
    const axial = Math.sqrt(Number(d.forkLength) ** 2 - rake * rake) + 13;
    expect(parseFloat(e.get('FORK1L')!)).toBeCloseTo(axial, 0);
    expect(parseFloat(e.get('FORK1L')!)).toBeGreaterThan(parseFloat(e0.get('FORK1L')!) + 9);
  });

  it('declares the seat tube measure style in new files', () => {
    const e = parseProperties(exportBcad({ design: importBcad(load('biked-bike10.bcad'), 'x.bcad').design, source: null, fileName: 'n.bcad', mappedKeys: [] })).entries;
    expect(e.get('ST measure style')).toBe('1');
    expect(parseFloat(e.get('Seat tube length')!)).toBeCloseTo(588.7, 1);
  });
});
