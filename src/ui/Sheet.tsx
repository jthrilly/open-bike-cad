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
import { specRows } from '../export/spec';

export const Sheet = forwardRef<SVGSVGElement, { d: Design; g: Geometry }>(function Sheet({ d, g }, ref) {
  const [W, H] = SHEETS[String(d.sheetSize)] ?? SHEETS.A3;
  const m = 10;
  const tableW = Math.min(110, W * 0.3);
  const tbH = 34;
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
  const rows = specRows(d, g);
  const accent = String(d.titleBlockColor);
  const fs = 2.6;
  const rowH = Math.min(4.2, (H - 2 * m - 10) / (rows.length + 2));
  const notes = String(d.notes ?? '').split('\n').slice(0, 6);
  return (
    <svg ref={ref} className="sheet" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width={`${W}mm`} height={`${H}mm`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x={0} y={0} width={W} height={H} fill="#fff" />
      <rect x={m / 2} y={m / 2} width={W - m} height={H - m} fill="none" stroke="#222" strokeWidth={0.5} />
      <g transform={`translate(${ox} ${oy}) scale(${k})`}>
        <BikeDrawing d={{ ...d, dimTextSize: (2.4 * nice) / 1.6, outlineThickness: Math.max(numOf(d, 'outlineThickness'), 0.25 * nice) }} g={g} />
      </g>
      {/* Spec table */}
      <g transform={`translate(${W - m - tableW} ${m})`} fontSize={fs}>
        <rect width={tableW} height={rowH * (rows.length + 1) + 2} fill="none" stroke="#222" strokeWidth={0.3} />
        <rect width={tableW} height={rowH + 1} fill={accent} />
        <text x={2} y={rowH - 0.6} fill="#fff" fontWeight={700}>
          Specification
        </text>
        {rows.map((r, i) => (
          <g key={i} transform={`translate(0 ${(i + 2) * rowH})`}>
            {i % 2 === 0 && <rect y={-rowH + 1} width={tableW} height={rowH} fill="#f1f3f6" />}
            <text x={2} y={0}>
              {r.label}
            </text>
            <text x={tableW - 2} y={0} textAnchor="end">
              {r.value} {r.unit}
            </text>
          </g>
        ))}
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
