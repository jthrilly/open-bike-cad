/**
 * Checks against real BikeCAD files when they are available locally.
 * Set BCAD_SAMPLES to a folder of .bcad files (searched recursively) to run it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { importBcad, exportBcad } from '../src/bcad/io';
import { parseProperties } from '../src/bcad/properties';
import { solve } from '../src/geometry/solve';

const dir = process.env.BCAD_SAMPLES;
const files: string[] = [];
const walk = (d: string) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.bcad')) files.push(p);
  }
};
if (dir && existsSync(dir)) walk(dir);

describe.skipIf(!files.length)('real .bcad files', () => {
  const bikes = files.filter((f) => /<entry key="Head angle">/.test(readFileSync(f, 'utf8')));

  it.each(bikes)('%s imports, solves and round-trips', (f) => {
    const xml = readFileSync(f, 'utf8');
    const src = parseProperties(xml);
    const bf = importBcad(xml, f);
    const g = solve(bf.design);
    for (const [k, v] of Object.entries(g.dims)) expect(Number.isFinite(v), k).toBe(true);
    const e = src.entries;
    // When the front end is stored as stack & reach, BikeCAD also stores the head tube
    // length it derived. Our solver must reproduce it.
    if (e.get('Top tube front center measure style') === '3') {
      expect(g.dims.headTubeLength).toBeCloseTo(parseFloat(e.get('Head tube length textfield')!), 0);
    }
    const out = parseProperties(exportBcad(bf));
    for (const k of e.keys()) expect(out.entries.has(k), k).toBe(true);
    const again = solve(importBcad(exportBcad(bf), f).design);
    expect(again.dims.stack).toBeCloseTo(g.dims.stack, 0);
    expect(again.dims.reach).toBeCloseTo(g.dims.reach, 0);
    expect(again.dims.headTubeLength).toBeCloseTo(g.dims.headTubeLength, 0);
    expect(again.dims.stCC).toBeCloseTo(g.dims.stCC, 0);
    expect(again.dims.chainstay).toBeCloseTo(g.dims.chainstay, 0);
    // A real bike's rear axle is well behind the BB (catches misread measure styles).
    expect(g.dims.chainstay).toBeGreaterThan(250);
  });
});
