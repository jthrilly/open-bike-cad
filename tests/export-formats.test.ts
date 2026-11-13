import { describe, expect, it } from 'vitest';
import { defaultDesign } from '../src/model/schema';
import { solve } from '../src/geometry/solve';
import { Dxf, dxfText, dxfNum } from '../src/export/dxf';
import { baseName, csvCell, toCsv, specCsv, svgFileName, pdfSafe, resolveCssVars, tileCount, planPages, frameDxf, mitreDxf } from '../src/export/exporters';
import { specTableLayout } from '../src/ui/Sheet';
import { specRows } from '../src/export/spec';
import { v } from '../src/geometry/vec';

describe('CSV', () => {
  it('quotes CR, LF, quotes and commas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('a\rb')).toBe('"a\rb"');
    expect(csvCell('plain')).toBe('plain');
  });
  it('neutralises formula injection but keeps plain numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('\rx')).toBe(`"'\rx"`);
    expect(csvCell('-6')).toBe('-6');
    expect(csvCell('-6.5')).toBe('-6.5');
    expect(csvCell('+1e3')).toBe('+1e3');
    expect(csvCell(-6)).toBe('-6');
  });
  it('has a BOM and CRLF row endings', () => {
    const s = toCsv([['a', 'b'], ['c', 'd']]);
    expect(s).toBe('﻿a,b\r\nc,d\r\n');
    const d = { ...defaultDesign(), title: '=evil,"x"\r\n' };
    const csv = specCsv(d, solve(d));
    expect(csv.startsWith('﻿Section,Item,Value,Unit\r\n')).toBe(true);
    expect(csv.split('\r\n').every((line) => !line.includes('\n') || line.includes('"'))).toBe(true);
  });
});

describe('baseName / file names', () => {
  it('keeps Unicode letters and digits', () => {
    expect(baseName({ title: 'Vélo Ünïcode 自転車 #1' })).toBe('Vélo_Ünïcode_自転車_1');
    expect(baseName({ title: 'Ποδήλατο' })).toBe('Ποδήλατο');
  });
  it('strips path and shell characters and falls back to bike', () => {
    expect(baseName({ title: '../../etc/passwd' })).toBe('etcpasswd');
    expect(baseName({ title: '<>:"/\\|?*' })).toBe('bike');
    expect(baseName({ title: '' })).toBe('bike');
    expect(baseName({ title: 'con' })).toBe('_con');
  });
  it('caps the length', () => {
    expect(Array.from(baseName({ title: 'x'.repeat(500) })).length).toBeLessThanOrEqual(60);
    expect(Array.from(baseName({ title: '自'.repeat(500) })).length).toBeLessThanOrEqual(60);
  });
  it('gives the SVG exports distinct suffixes', () => {
    expect(svgFileName({ title: 'Road' }, 'side')).toBe('Road_side.svg');
    expect(svgFileName({ title: 'Road' }, 'sheet')).toBe('Road_sheet.svg');
  });
});

describe('PDF text', () => {
  it('maps characters outside WinAnsi', () => {
    expect(pdfSafe('29.7→17.0 × 1.20')).toBe('29.7->17.0 × 1.20');
    expect(pdfSafe('a — b – c ° Ø “q” €')).toBe('a — b – c ° Ø “q” €');
    expect(pdfSafe('Łódź ≤ 5')).toBe('Lódz <= 5');
    expect(pdfSafe('自転車')).toBe('???');
    expect(pdfSafe('a\tb')).toBe('a b');
  });
  it('resolves CSS variables to their fallback', () => {
    expect(resolveCssVars('var(--paper, #fff)')).toBe('#fff');
    expect(resolveCssVars('var(--a, var(--b, rgb(1, 2, 3)))')).toBe('rgb(1, 2, 3)');
    expect(resolveCssVars('var(--nope)')).toBe('none');
  });
});

describe('DXF', () => {
  it('sanitises text: control chars, non-ASCII, length', () => {
    expect(dxfText('a\rb\nc\td\u0000e')).toBe('a b c d e');
    expect(dxfText('Vélo → 自')).toBe('V\\U+00E9lo \\U+2192 \\U+81EA');
    expect(dxfText('x'.repeat(400)).length).toBe(255);
    const esc = dxfText('é'.repeat(100));
    expect(esc.length).toBeLessThanOrEqual(255);
    expect(esc.endsWith('\\U+00E9')).toBe(true);
    expect(dxfText('🚲')).toBe('?');
  });
  it('formats numbers and rejects non-finite ones', () => {
    expect(dxfNum(1.23456789)).toBe('1.2346');
    expect(dxfNum(-0.00001)).toBe('0');
    expect(dxfNum(NaN)).toBeNull();
    expect(dxfNum(Infinity)).toBeNull();
  });
  it('skips entities with NaN/Infinity and writes ASCII only', () => {
    const d = new Dxf();
    d.line(v(0, 0), v(NaN, 1), 'A');
    d.circle(v(Infinity, 0), 5, 'A');
    d.polyline([v(0, 0), v(NaN, 0), v(1, 1), v(2, 2)], false, 'A');
    d.text(v(0, 0), 3, 'Title\r\nwith ünïcode', 'TEXT');
    d.line(v(0, 0), v(1, 1), 'A');
    const s = d.toString();
    expect(s).not.toMatch(/NaN|Infinity/);
    expect(/^[\x20-\x7e\n]*$/.test(s)).toBe(true);
    expect(s).toContain('$DWGCODEPAGE');
    expect(s).toContain('ANSI_1252');
    expect(s).toContain('\nLTYPE\n');
    expect(s.match(/\nLINE\n/g)?.length).toBe(1);
    expect(s.match(/\nVERTEX\n/g)?.length).toBe(3);
    expect(s).toContain('Title  with \\U+00FCn\\U+00EFcode');
    expect(d.skipped).toBe(3);
  });
  it('exports frame and mitre DXF for a design with a hostile title', () => {
    const des = { ...defaultDesign(), title: 'Bad\rTitle — 自転車' };
    const g = solve(des);
    for (const s of [frameDxf(des, g), mitreDxf(des, g)]) {
      expect(s).not.toMatch(/NaN|Infinity|\r/);
      expect(/^[\x20-\x7e\n]*$/.test(s)).toBe(true);
    }
  });
});

describe('mitre template tiling', () => {
  it('counts tiles with overlap', () => {
    expect(tileCount(100, 190, 12)).toBe(1);
    expect(tileCount(190, 190, 12)).toBe(1);
    expect(tileCount(191, 190, 12)).toBe(2);
    expect(tileCount(368, 190, 12)).toBe(2); // 190 + 178
    expect(tileCount(369, 190, 12)).toBe(3);
  });
  it('covers the content exactly once tiles are placed step apart', () => {
    for (const content of [50, 200, 377, 999]) {
      const win = 180;
      const ov = 12;
      const n = tileCount(content, win, ov);
      // last tile reaches the end of the content
      expect((n - 1) * (win - ov) + win).toBeGreaterThanOrEqual(content - 1e-9);
      // and one fewer would not
      if (n > 1) expect((n - 2) * (win - ov) + win).toBeLessThan(content);
    }
  });
  it('uses one page when it fits portrait or landscape, keeping a margin', () => {
    const a4: [number, number] = [210, 297];
    const p = planPages(150, 200, a4);
    expect(p).toMatchObject({ orientation: 'portrait', cols: 1, rows: 1, tiled: false });
    expect(p.win.x).toBeGreaterThanOrEqual(6);
    const l = planPages(260, 150, a4);
    expect(l).toMatchObject({ orientation: 'landscape', cols: 1, rows: 1, tiled: false });
    expect(l.win.x + l.win.w).toBeLessThanOrEqual(297 - 6);
  });
  it('tiles content larger than the page at 1:1 with the fewest pages', () => {
    const a4: [number, number] = [210, 297];
    const p = planPages(400, 120, a4);
    expect(p.tiled).toBe(true);
    expect(p.cols * p.rows).toBe(2);
    expect(p.orientation).toBe('landscape');
    // windows stay inside the page with at least a 6 mm margin
    expect(p.win.x).toBeGreaterThanOrEqual(6);
    expect(p.win.y + p.win.h).toBeLessThanOrEqual(p.pageH - 6);
    expect(p.win.x + p.win.w).toBeLessThanOrEqual(p.pageW - 6);
    // tiles cover the content
    expect((p.cols - 1) * p.step.x + p.win.w).toBeGreaterThanOrEqual(400);
    expect((p.rows - 1) * p.step.y + p.win.h).toBeGreaterThanOrEqual(120);
    const tall = planPages(150, 700, a4);
    expect(tall.tiled).toBe(true);
    expect((tall.rows - 1) * tall.step.y + tall.win.h).toBeGreaterThanOrEqual(700);
  });
});

describe('drawing sheet spec table', () => {
  const rows = specRows(defaultDesign(), solve(defaultDesign()));
  it('fits above the title block on A4 and Letter', () => {
    for (const H of [210, 215.9]) {
      const avail = H - 2 * 10 - 34 - 4;
      const t = specTableLayout(rows, avail, 89);
      expect(t.height).toBeLessThanOrEqual(avail + 1e-9);
      expect(t.rowH).toBeGreaterThanOrEqual(2.8);
    }
  });
  it('splits into two columns rather than overflowing', () => {
    const avail = 100;
    const t = specTableLayout(rows, avail, 89);
    expect(t.cols).toBe(2);
    expect(t.height).toBeLessThanOrEqual(avail + 1e-9);
    expect(t.perCol * 2).toBeGreaterThanOrEqual(rows.length);
  });
});
