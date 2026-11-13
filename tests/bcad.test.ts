import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseProperties, serializeProperties } from '../src/bcad/properties';
import { exportBcad, importBcad, formatJavaNumber } from '../src/bcad/io';
import { solve } from '../src/geometry/solve';

const xml = readFileSync(new URL('./fixtures/sample.bcad', import.meta.url), 'utf8');

describe('properties XML', () => {
  it('parses entries in order and decodes entities', () => {
    const doc = parseProperties(xml);
    expect(doc.comment).toContain('Synthetic');
    expect(doc.entries.get('Head angle')).toBe('72.0');
    expect(doc.entries.get('Some unknown & key')).toBe('keep <me>');
    expect([...doc.entries.keys()][0]).toBe('Head angle');
  });

  it('round-trips without loss', () => {
    const doc = parseProperties(xml);
    const again = parseProperties(serializeProperties(doc));
    expect([...again.entries]).toEqual([...doc.entries]);
    expect(again.comment).toBe(doc.comment);
  });

  it('rejects non-properties files', () => {
    expect(() => parseProperties('<html></html>')).toThrow();
  });

  it('formats numbers like Java', () => {
    expect(formatJavaNumber(74)).toBe('74.0');
    expect(formatJavaNumber(74.25)).toBe('74.25');
    expect(formatJavaNumber(686, '686')).toBe('686');
  });
});

describe('.bcad import/export', () => {
  const f = importBcad(xml, 'sample.bcad');

  it('maps geometry keys', () => {
    const d = f.design;
    expect(d.headAngle).toBe(72);
    expect(d.seatAngle).toBe(73.5);
    expect(d.headTubeLength).toBe(150);
    expect(d.frontCenter).toBe(600);
    expect(d.bbDrop).toBe(70);
    expect(d.chainstayLength).toBe(425);
    // BikeCAD's fork length is axial; ours is straight-line axle to crown.
    expect(d.forkLength).toBeCloseTo(Math.hypot(375, 45), 1);
    expect(d.forkRake).toBe(45);
    expect(d.rearTyre).toBe(32);
    expect(d.frontEndMode).toBe('frontCenter');
    expect(d.chainrings).toBe('50,34');
    expect(d.cogs).toBe('11,28');
    expect(d.title).toBe('sample');
  });

  it('writes the fork length back in BikeCAD\'s axial form', () => {
    const out = parseProperties(exportBcad(f));
    expect(parseFloat(out.entries.get('FORK0L')!)).toBeCloseTo(375, 1);
  });

  it('reads stack & reach files (measure style 3) and reproduces BikeCAD\'s head tube length', () => {
    // Values from a stock BikeCAD road example: stack 565.6, reach 392.3, HA 73, fork 375/45,
    // lower stack 12, 674 mm wheels, BB drop 70. BikeCAD stores HTL 145.0 for these.
    const sr = xml
      .replace('<entry key="Head angle">72.0</entry>', '<entry key="Head angle">73.0</entry><entry key="Stack">565.6</entry><entry key="Top tube front center measure style">3</entry>')
      .replace('<entry key="FCD textfield">600.0</entry>', '<entry key="FCD textfield">392.3</entry>')
      .replace(/Wheel diameter (rear|front)">686/g, 'Wheel diameter $1">674');
    const b = importBcad(sr, 'road.bcad');
    expect(b.design.frontEndMode).toBe('stackReach');
    const g = solve(b.design);
    expect(g.dims.reach).toBeCloseTo(392.3, 6);
    expect(g.dims.headTubeLength).toBeCloseTo(145.0, 1);
  });

  it('solves to the stored front centre and head tube length', () => {
    const g = solve(f.design);
    expect(g.dims.frontCenter).toBeCloseTo(600, 6);
    expect(g.dims.headTubeLength).toBeCloseTo(150, 6);
  });

  it('keeps unknown keys and writes edits back', () => {
    const edited = { ...f, design: { ...f.design, headAngle: 71.5, chainstayLength: 430 } };
    const out = parseProperties(exportBcad(edited));
    expect(out.entries.get('Some unknown & key')).toBe('keep <me>');
    expect(out.entries.get('Display FORK')).toBe('true');
    expect(out.entries.get('Head angle')).toBe('71.5');
    expect(out.entries.get('CS textfield')).toBe('430.0');
    expect(out.entries.get('Wheel diameter rear')).toBe('686');
    // Our extra settings live in a namespace.
    expect(out.entries.get('OpenBikeCAD.paintMain')).toBeDefined();
    // Re-import gives the same design.
    const back = importBcad(exportBcad(edited), 'sample.bcad');
    expect(back.design.headAngle).toBe(71.5);
    expect(back.design.paintMain).toBe(f.design.paintMain);
  });

  it('does not invent uncertain keys in an existing file', () => {
    const out = parseProperties(exportBcad(f));
    expect(out.entries.has('Wall thickness Head tube')).toBe(false);
    expect(out.entries.has('Top tube rear diameter')).toBe(false);
  });
});
