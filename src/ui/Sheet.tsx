/**
 * Printable drawing sheet: the bike scaled to fit, plus a title block,
 * specification table and notes. Units in the SVG are millimetres of paper.
 */
import { forwardRef } from 'react';
import { Design, numOf } from '../model/schema';
import { Geometry } from '../geometry/solve';
import { BikeDrawing } from '../render/BikeDrawing';
import { bikeBounds } from './Canvas';
import { SHEETS } from '../export/exporters';
import { specRows, SpecRow } from '../export/spec';

/** Smallest row pitch (mm) before the spec table splits into two columns. */
const MIN_ROW = 2.8;
const MAX_ROW = 4.2;

/** Rough Helvetica width of a string at font size fs (mm). */
const textW = (s: string, fs: number) => s.length * 0.53 * fs;

/**
 * Lay the spec table out in the space above the title block: one column with
 * rows shrunk down to MIN_ROW, else two columns. Never taller than availH.
 */
export function specTableLayout(rows: SpecRow[], availH: number, maxW: number) {
  const fit = (perCol: number) => Math.min(MAX_ROW, (availH - 2) / (perCol + 1));
  let cols = 1;
  let perCol = rows.length;
  let rowH = fit(perCol);
  if (rowH < MIN_ROW) {
    cols = 2;
    perCol = Math.ceil(rows.length / 2);
    rowH = fit(perCol);
  }
  const fs = Math.min(2.6, rowH * 0.72);
  const colWidths: number[] = [];
  for (let c = 0; c < cols; c++) {
    const part = rows.slice(c * perCol, (c + 1) * perCol);
    const need = Math.max(40, ...part.map((r) => textW(r.label, fs) + textW(`${r.value} ${r.unit}`, fs) + 7));
    colWidths.push(cols === 1 ? maxW : Math.min(maxW * 0.75, need));
  }
  const width = colWidths.reduce((a, b) => a + b, 0);
  const headH = rowH + 1;
  const height = headH + perCol * rowH + 1;
  return { cols, perCol, rowH, fs, colWidths, width, headH, height };
}

export const Sheet = forwardRef<SVGSVGElement, { d: Design; g: Geometry }>(function Sheet({ d, g }, ref) {
  const [W, H] = SHEETS[String(d.sheetSize)] ?? SHEETS.A3;
  const m = 10;
  const tbH = 34;
  const rows = specRows(d, g);
  const tableAvailH = H - 2 * m - tbH - 4;
  const tl = specTableLayout(rows, tableAvailH, Math.min(110, W * 0.3));
  const tableW = tl.width;
  const areaW = W - 2 * m - tableW - 6;
  const areaH = H - 2 * m - tbH - 6;
  const b = bikeBounds(d, g);
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  // Choose a "nice" scale like 1:5, 1:6, 1:8, 1:10...
  const raw = Math.max(bw / areaW, bh / areaH);
  const nice = [2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20].find((s) => s >= raw) ?? Math.ceil(raw);
  const k = 1 / nice;
  const ox = m + (areaW - bw * k) / 2 - b.minX * k;
  const oy = m + (areaH - bh * k) / 2 + b.maxY * k;
  const accent = String(d.titleBlockColor);
  const { rowH, fs, headH, perCol, colWidths } = tl;
  const colX = colWidths.map((_, c) => colWidths.slice(0, c).reduce((x, w) => x + w, 0));
  const notes = String(d.notes ?? '').split('\n').slice(0, 6);
  return (
    <svg ref={ref} className="sheet" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width={`${W}mm`} height={`${H}mm`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x={0} y={0} width={W} height={H} fill="#fff" />
      <rect x={m / 2} y={m / 2} width={W - m} height={H - m} fill="none" stroke="#222" strokeWidth={0.5} />
      <g transform={`translate(${ox} ${oy}) scale(${k})`}>
        <BikeDrawing d={{ ...d, dimTextSize: (2.4 * nice) / 1.6, outlineThickness: Math.max(numOf(d, 'outlineThickness'), 0.25 * nice) }} g={g} />
      </g>
      {/* Spec table (kept above the title block; border drawn last so stripes don't cover it) */}
      <g transform={`translate(${W - m - tableW} ${m})`} fontSize={fs}>
        <rect width={tableW} height={headH} fill={accent} />
        <text x={2} y={headH - 0.3 * rowH - 0.3} fill="#fff" fontWeight={700}>
          Specification
        </text>
        {rows.map((r, i) => {
          const c = Math.floor(i / perCol);
          const j = i % perCol;
          const top = headH + j * rowH;
          return (
            <g key={i} transform={`translate(${colX[c]} ${top})`}>
              {j % 2 === 0 && <rect width={colWidths[c]} height={rowH} fill="#f1f3f6" />}
              <text x={2} y={rowH * 0.72}>
                {r.label}
              </text>
              <text x={colWidths[c] - 2} y={rowH * 0.72} textAnchor="end">
                {`${r.value}${r.unit ? ` ${r.unit}` : ''}`}
              </text>
            </g>
          );
        })}
        {colX.slice(1).map((x, c) => (
          <line key={c} x1={x} y1={headH} x2={x} y2={tl.height} stroke="#222" strokeWidth={0.2} />
        ))}
        <rect width={tableW} height={tl.height} fill="none" stroke="#222" strokeWidth={0.3} />
      </g>
      {/* Title block */}
      <g transform={`translate(${m} ${H - m - tbH})`} fontSize={3}>
        <rect width={W - 2 * m} height={tbH} fill="#fff" stroke="#222" strokeWidth={0.4} />
        <rect width={6} height={tbH} fill={accent} />
        <text x={10} y={9} fontSize={7} fontWeight={700}>
          {String(d.title)}
        </text>
        <text x={10} y={16}>
          {[d.size && `Size ${d.size}`, d.material, d.customer && `For ${d.customer}`].filter(Boolean).join('  ·  ')}
        </text>
        <text x={10} y={22}>
          {[d.designer && `Designed by ${d.designer}`, d.drawingDate || new Date().toISOString().slice(0, 10)].filter(Boolean).join('  ·  ')}
        </text>
        <text x={10} y={29} fill="#555">
          Scale 1:{nice} · all dimensions in mm · drawn with Open Bike CAD
        </text>
        <g transform={`translate(${(W - 2 * m) * 0.45} 7)`} fontSize={2.8}>
          {notes.map((n, i) => (
            <text key={i} x={0} y={i * 4}>
              {n}
            </text>
          ))}
        </g>
      </g>
    </svg>
  );
});
