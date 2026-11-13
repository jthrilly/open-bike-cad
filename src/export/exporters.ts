import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { Design, PARAMS, numOf } from '../model/schema';
import { Geometry } from '../geometry/solve';
import { tubeCuts, fixtureTable } from './mitre';
import { Dxf } from './dxf';
import { frameTubes } from '../render/BikeDrawing';
import { tubeOutline } from '../geometry/shapes';
import { v } from '../geometry/vec';
import { specRows } from './spec';

export function download(name: string, data: string | Blob, type = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const baseName = (d: Design) => (String(d.title || 'bike').replace(/[^\w\- ]+/g, '').trim() || 'bike').replace(/\s+/g, '_');

/** Serialise an on-screen SVG element to a standalone file. */
export function svgToString(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('class');
  clone.querySelectorAll('[data-ui]').forEach((n) => n.remove());
  // Resolve CSS variables used for text halos.
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone).replace(/var\(--paper, #fff\)/g, '#fff');
}

export const SHEETS: Record<string, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  letter: [279.4, 215.9],
  tabloid: [431.8, 279.4],
};

export async function svgToPdf(svg: SVGSVGElement, widthMm: number, heightMm: number, fileName: string) {
  const doc = new jsPDF({ orientation: widthMm > heightMm ? 'landscape' : 'portrait', unit: 'mm', format: [widthMm, heightMm] });
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-ui]').forEach((n) => n.remove());
  // svg2pdf needs the element in the document to resolve styles.
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.left = '-10000px';
  holder.appendChild(clone);
  document.body.appendChild(holder);
  try {
    await (doc as unknown as { svg: (el: Element, o: object) => Promise<unknown> }).svg(clone, { x: 0, y: 0, width: widthMm, height: heightMm });
  } finally {
    holder.remove();
  }
  doc.save(fileName);
}

// ---------------------------------------------------------------- mitres
const PAPER: Record<string, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  letter: [215.9, 279.4],
  tabloid: [279.4, 431.8],
};

export function mitrePdf(d: Design, g: Geometry) {
  const [pw, ph] = PAPER[String(d.paperSize)] ?? PAPER.A4;
  const doc = new jsPDF({ unit: 'mm', format: [pw, ph], orientation: 'portrait' });
  const cuts = tubeCuts(d, g);
  let first = true;
  const margin = 12;
  for (const t of cuts) {
    for (const e of t.ends) {
      const circ = e.curve[e.curve.length - 1].x;
      const height = Math.max(...e.curve.map((p) => p.y));
      const landscape = circ + 2 * margin > pw;
      const W = landscape ? ph : pw;
      if (!first) doc.addPage([pw, ph], landscape ? 'landscape' : 'portrait');
      else if (landscape) {
        doc.deletePage(1);
        doc.addPage([pw, ph], 'landscape');
      }
      first = false;
      const x0 = (W - circ) / 2;
      const y0 = margin + 38;
      doc.setFontSize(13);
      doc.text(`${String(d.title)} — ${t.name}${t.quantity > 1 ? ` (×${t.quantity})` : ''} → ${e.into}`, margin, margin + 2);
      doc.setFontSize(9);
      doc.text(
        [
          `Tube OD ${t.od.toFixed(2)} mm (+${numOf(d, 'paperThicknessComp').toFixed(2)} paper allowance), wall ${t.wall.toFixed(2)} mm. Into Ø${(e.R * 2).toFixed(2)} at ${e.angle.toFixed(1)}°${e.offset ? `, offset ${e.offset.toFixed(1)} mm` : ''}.`,
          `Cut length (long points) ${t.lengthLongPoints.toFixed(1)} mm; with allowance ${t.cutLength.toFixed(1)} mm. Template depth ${height.toFixed(1)} mm.`,
          'Print at 100% (no "fit to page"). Check the 50 mm scale bar before cutting. Wrap so the ends of the line meet.',
        ],
        margin,
        margin + 9,
      );
      // Scale bar
      doc.setLineWidth(0.4);
      doc.line(margin, margin + 27, margin + 50, margin + 27);
      doc.line(margin, margin + 25, margin, margin + 29);
      doc.line(margin + 50, margin + 25, margin + 50, margin + 29);
      doc.text('50 mm', margin + 52, margin + 28);
      // Template: tube side is below the curve.
      const pts = e.curve.map((p) => [x0 + p.x, y0 + p.y] as [number, number]);
      doc.setLineWidth(0.3);
      for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      // Reference lines at quadrants
      doc.setLineDashPattern([2, 1.5], 0);
      doc.setLineWidth(0.15);
      const bottom = y0 + height + 30;
      for (let q = 0; q <= 4; q++) {
        const x = x0 + (circ * q) / 4;
        doc.line(x, y0 - 4, x, bottom);
        doc.text(['0° (in plane)', '90°', '180° (in plane)', '270°', '360°'][q], x + 1, bottom + 4);
      }
      doc.setLineDashPattern([], 0);
      doc.rect(x0, y0 - 4, circ, bottom - y0 + 4);
      doc.text('Tube side', x0 + 2, bottom - 2);
    }
  }
  doc.save(`${baseNameFromDesign(d)}_mitres.pdf`);
}

const baseNameFromDesign = baseName;

export function mitreDxf(d: Design, g: Geometry): string {
  const dxf = new Dxf();
  let yOff = 0;
  for (const t of tubeCuts(d, g)) {
    for (const e of t.ends) {
      const pts = e.curve.map((p) => v(p.x, yOff - p.y));
      dxf.polyline(pts, false, 'MITRE');
      const circ = e.curve[e.curve.length - 1].x;
      dxf.text(v(0, yOff + 6), 4, `${t.name} -> ${e.into}  OD ${t.od}  ${e.angle.toFixed(1)} deg`, 'TEXT');
      for (let q = 0; q <= 4; q++) dxf.line(v((circ * q) / 4, yOff + 2), v((circ * q) / 4, yOff - Math.max(...e.curve.map((p) => p.y)) - 15), 'REF');
      yOff -= Math.max(...e.curve.map((p) => p.y)) + 45;
    }
  }
  return dxf.toString();
}

export function frameDxf(d: Design, g: Geometry): string {
  const dxf = new Dxf();
  const { ttPts, dtPts, stPts, csPts, ssPts } = frameTubes(d, g);
  const tubes: [string, typeof ttPts, number, number][] = [
    ['TT', ttPts, numOf(d, 'ttOD') / 2, numOf(d, 'ttOD') / 2],
    ['DT', dtPts, numOf(d, 'dtOD') / 2, numOf(d, 'dtOD') / 2],
    ['ST', stPts, numOf(d, 'stODBottom') / 2, numOf(d, 'stOD') / 2],
    ['CS', csPts, numOf(d, 'csODTip') / 2, numOf(d, 'csOD') / 2],
    ['SS', ssPts, numOf(d, 'ssODTip') / 2, numOf(d, 'ssOD') / 2],
    ['HT', [g.htTop, g.htBottom], numOf(d, 'htOD') / 2, numOf(d, 'htOD') / 2],
  ];
  for (const [name, pts, r0, r1] of tubes) {
    dxf.polyline(tubeOutline(pts, r0, r1), true, 'FRAME');
    dxf.polyline(pts, false, 'CENTRELINE');
    void name;
  }
  dxf.circle(g.bb, numOf(d, 'bbShellOD') / 2, 'FRAME');
  dxf.circle(g.rearAxle, g.rearWheelR, 'WHEELS');
  dxf.circle(g.frontAxle, g.frontWheelR, 'WHEELS');
  dxf.circle(g.rearAxle, g.rearRimR, 'WHEELS');
  dxf.circle(g.frontAxle, g.frontRimR, 'WHEELS');
  dxf.line(g.crownRace, g.frontAxle, 'FORK');
  dxf.line(v(g.rearAxle.x - g.rearWheelR, g.groundY), v(g.frontAxle.x + g.frontWheelR, g.groundY), 'GROUND');
  dxf.text(v(g.rearAxle.x, g.groundY - 40), 12, String(d.title), 'TEXT');
  return dxf.toString();
}

// ------------------------------------------------------------------ CSV
const csvCell = (s: string | number) => {
  const t = String(s);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function specCsv(d: Design, g: Geometry): string {
  const rows: (string | number)[][] = [['Section', 'Item', 'Value', 'Unit']];
  for (const r of specRows(d, g)) rows.push([r.section, r.label, r.value, r.unit]);
  for (const r of fixtureTable(d, g)) rows.push(['Fixture', r.label, r.value, '']);
  for (const t of tubeCuts(d, g)) rows.push(['Cut list', `${t.name}${t.quantity > 1 ? ` x${t.quantity}` : ''}`, t.cutLength.toFixed(1), 'mm']);
  rows.push([]);
  rows.push(['Parameter', 'Id', 'Value', 'Unit']);
  for (const p of PARAMS) rows.push([p.label, p.id, String(d[p.id]), p.unit ?? '']);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

/** Compare several designs side by side (used by the bulk/compare export). */
export function compareCsv(designs: { name: string; d: Design; g: Geometry }[]): string {
  if (!designs.length) return '';
  const first = specRows(designs[0].d, designs[0].g);
  const rows: string[][] = [['Item', ...designs.map((x) => x.name)]];
  first.forEach((r, i) => rows.push([`${r.label} (${r.unit})`, ...designs.map((x) => String(specRows(x.d, x.g)[i]?.value ?? ''))]));
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
