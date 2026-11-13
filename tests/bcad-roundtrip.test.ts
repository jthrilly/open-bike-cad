import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseProperties, serializeProperties } from '../src/bcad/properties';
import { exportBcad, importBcad } from '../src/bcad/io';
import { solve } from '../src/geometry/solve';

const xml = readFileSync(new URL('./fixtures/sample.bcad', import.meta.url), 'utf8');
const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd"><properties>${body}</properties>`;

describe('properties XML edge cases', () => {
  it('ignores entries inside comments', () => {
    const d = parseProperties(wrap('<!-- <entry key="ghost">1</entry> --><entry key="a">1</entry>'));
    expect([...d.entries.keys()]).toEqual(['a']);
  });

  it('takes CDATA literally', () => {
    const d = parseProperties(wrap('<entry key="a"><![CDATA[x &amp; y</entry>z]]></entry>'));
    expect(d.entries.get('a')).toBe('x &amp; y</entry>z');
  });

  it('reads the key attribute in any position', () => {
    const d = parseProperties(wrap(`<entry foo="1" key='a'>v</entry><entry key="b"/>`));
    expect(d.entries.get('a')).toBe('v');
    expect(d.entries.get('b')).toBe('');
  });

  it('normalises line endings like an XML reader and keeps CR when written as a reference', () => {
    const d = parseProperties(wrap('<entry key="a">l1\r\nl2</entry>'));
    expect(d.entries.get('a')).toBe('l1\nl2');
    const doc = { comment: null, entries: new Map([['k\tx\ny', 'a\r\nb']]) };
    const back = parseProperties(serializeProperties(doc));
    expect([...back.entries]).toEqual([['k\tx\ny', 'a\r\nb']]);
  });

  it('rejects invalid character references with a parse error', () => {
    expect(() => parseProperties(wrap('<entry key="a">&#x110000;</entry>'))).toThrow(/character reference/);
  });
});

describe('.bcad save keeps BikeCAD values', () => {
  const tapered = xml.replace(
    '</properties>',
    `<entry key="Head tube type">1</entry><entry key="Head tube diameter">45.0</entry><entry key="Head tube d">36.0</entry>
<entry key="Wall thickness Seat stay">0.0</entry><entry key="Saddle angle">19.999999999999996</entry>
<entry key="Top tube angle textfield">7.9</entry><entry key="MODEL_NAME"></entry></properties>`,
  );

  it('changes no BikeCAD value when a file is opened and saved without edits', () => {
    const src = parseProperties(tapered);
    const out = parseProperties(exportBcad(importBcad(tapered, 'x.bcad')));
    for (const [k, v] of src.entries) expect(out.entries.get(k), k).toBe(v);
  });

  it('saves byte-identically the second time', () => {
    const once = exportBcad(importBcad(tapered, 'x.bcad'));
    expect(exportBcad(importBcad(once, 'x.bcad'))).toBe(once);
  });

  it('lets edits made in BikeCAD win over our stored copy', () => {
    const ours = exportBcad(importBcad(tapered, 'x.bcad'));
    const edited = ours
      .replace(/(key="FORK0L">)[^<]*/, '$1400.0')
      .replace(/(key="Wheel diameter rear">)[^<]*/, '$1700')
      .replace(/(key="MODEL_NAME">)[^<]*/, '$1Renamed');
    const d = importBcad(edited, 'x.bcad').design;
    expect(d.forkLength).toBeCloseTo(Math.hypot(400, 45), 1);
    expect(d.rearTyre).toBe(39);
    expect(d.title).toBe('Renamed');
  });

  it('keeps our own settings exactly when the file is untouched', () => {
    const f = importBcad(tapered, 'x.bcad');
    const edited = { ...f, design: { ...f.design, frontEndMode: 'stackReach', fenders: true } };
    const back = importBcad(exportBcad(edited), 'x.bcad').design;
    expect(back.frontEndMode).toBe('stackReach');
    expect(back.fenders).toBe(true);
  });

  it('writes edits to component values into BikeCAD keys', () => {
    const withKeys = tapered.replace(
      '</properties>',
      '<entry key="MATERIAL">STEEL</entry><entry key="Front Fender include">false</entry><entry key="Rear Fender include">false</entry><entry key="DROPPER">false</entry></properties>',
    );
    const f = importBcad(withKeys, 'x.bcad');
    const d = { ...f.design, material: 'Titanium', fenders: true, seatpostType: 'dropper', title: 'Tourer' };
    const out = parseProperties(exportBcad({ ...f, design: d })).entries;
    expect(out.get('MATERIAL')).toBe('TITANIUM');
    expect(out.get('Front Fender include')).toBe('true');
    expect(out.get('DROPPER')).toBe('true');
    expect(out.get('MODEL_NAME')).toBe('Tourer');
  });

  it('writes a tapered head tube back to the keys it came from', () => {
    const f = importBcad(tapered, 'x.bcad');
    expect(f.design.htProfile).toBe('tapered');
    const out = parseProperties(exportBcad({ ...f, design: { ...f.design, htOD: 38 } })).entries;
    expect(out.get('Head tube diameter')).toBe('45.0');
    expect(out.get('Head tube d')).toBe('38.0');
  });

  it('keeps the default fork rake when a file has no fork keys', () => {
    const d = importBcad(wrap('<entry key="Head angle">73.0</entry>'), 'x.bcad').design;
    expect(d.forkRake).toBe(45);
  });
});

describe('.bcad measure styles on save', () => {
  it('writes BB height, not drop, when the file measures BB height', () => {
    const src = xml.replace('</properties>', '<entry key="BB measure style">1</entry></properties>').replace(/(key="BB textfield">)[^<]*/, '$1273.0');
    const f = importBcad(src, 'x.bcad');
    // Bigger tyres with more drop: BB height stays the same.
    const d = { ...f.design, bbDrop: Number(f.design.bbDrop) + 5, rearTyre: Number(f.design.rearTyre) + 5 };
    const out = parseProperties(exportBcad({ ...f, design: d })).entries;
    expect(parseFloat(out.get('BB textfield')!)).toBeCloseTo(273, 0);
  });

  it('keeps the seat tube length in centre-to-centre form for ST measure style 1', () => {
    const src = xml.replace('</properties>', '<entry key="ST measure style">1</entry><entry key="Seat tube extension2">20.0</entry></properties>');
    const f = importBcad(src, 'x.bcad');
    const d = { ...f.design, topTubeMode: 'angle', seatTubeLength: Number(f.design.seatTubeLength) + 20 };
    const out = parseProperties(exportBcad({ ...f, design: d })).entries;
    expect(parseFloat(out.get('Seat tube length')!)).toBeCloseTo(solve(d).dims.stCC, 0);
  });
});
