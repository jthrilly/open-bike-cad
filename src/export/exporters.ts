import { jsPDF } from 'jspdf';
import { Design, PARAMS, numOf } from '../model/schema';
import { Geometry } from '../geometry/solve';
import { tubeCuts, fixtureTable } from './mitre';
import { Dxf } from './dxf';
import { frameTubes } from '../render/BikeDrawing';
import { tubeOutline } from '../geometry/shapes';
import { v } from '../geometry/vec';
import { specRows } from './spec';
import { bikeBounds } from '../ui/Canvas';

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

const RESERVED_WIN = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * File-name stem from the design title: Unicode letters, marks and digits are
 * kept (so "Vélo Ünïcode 自転車" survives), anything else is dropped, spaces
 * become underscores and the result is capped at 60 characters.
 */
export const baseName = (d: { title?: unknown }): string => {
  const cleaned = String(d.title ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N}_\- ]+/gu, '')
    .trim()
    .replace(/\s+/g, '_');
  let s = Array.from(cleaned).slice(0, 60).join('').replace(/^[-_]+|[-_]+$/g, '');
  if (RESERVED_WIN.test(s)) s = `_${s}`;
  return s || 'bike';
};

/** Suggested file names for the two SVG exports. */
export const svgFileName = (d: { title?: unknown }, kind: 'side' | 'sheet') => `${baseName(d)}_${kind}.svg`;

/** Replace `var(--name, fallback)` with its fallback (or `fallbackAll`) so files don't depend on page CSS. */
export function resolveCssVars(value: string, fallbackAll = 'none'): string {
  let out = value;
  // Repeat to unwrap nested var() fallbacks.
  for (let i = 0; i < 4 && /var\(/.test(out); i++) {
    out = out.replace(/var\(\s*--[\w-]+\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_m, fb: string | undefined) => (fb ?? fallbackAll).trim());
  }
  return out;
}

function resolveVarsInTree(root: Element) {
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.includes('var(')) el.setAttribute(attr.name, resolveCssVars(attr.value));
    }
  }
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Serialise an on-screen SVG element to a standalone file. With `bounds`
 * (world mm, y up) the viewBox is set to those bounds and width/height are
 * given in mm, so the file is 1 unit = 1 mm whatever the on-screen pan/zoom.
 */
export function svgToString(svg: SVGSVGElement, opts: { bounds?: Bounds } = {}): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.removeAttribute('class');
  clone.removeAttribute('style');
  clone.querySelectorAll('[data-ui]').forEach((n) => n.remove());
  const b = opts.bounds;
  if (b && [b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite) && b.maxX > b.minX && b.maxY > b.minY) {
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const r = (n: number) => String(Math.round(n * 100) / 100);
    clone.setAttribute('viewBox', `${r(b.minX)} ${r(-b.maxY)} ${r(w)} ${r(h)}`);
    clone.setAttribute('width', `${r(w)}mm`);
    clone.setAttribute('height', `${r(h)}mm`);
    clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }
  // Resolve CSS variables (text halos use var(--paper, #fff)).
  resolveVarsInTree(clone);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

/** Side-view SVG at 1:1 (mm), framed on the bike rather than the on-screen view. */
export function sideViewSvgString(svg: SVGSVGElement, d: Design, g: Geometry, marginMm = 20): string {
  const b = bikeBounds(d, g);
  return svgToString(svg, { bounds: { minX: b.minX - marginMm, maxX: b.maxX + marginMm, minY: b.minY - marginMm, maxY: b.maxY + marginMm } });
}

export const SHEETS: Record<string, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  letter: [279.4, 215.9],
  tabloid: [431.8, 279.4],
};

// ------------------------------------------------------------ PDF text
/** Characters the PDF standard fonts (WinAnsiEncoding) can show, beyond Latin-1. */
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const PDF_MAP: Record<string, string> = {
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=', '↑': '^', '↓': 'v',
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '∼': '~', '−': '-', '‐': '-', '‑': '-', '‒': '-', '―': '-',
  '′': "'", '″': '"', '⌀': 'Ø', '∅': 'Ø', '∞': 'inf', '√': 'sqrt', '∆': 'delta', 'Δ': 'delta', 'θ': 'theta', 'φ': 'phi', 'π': 'pi',
  '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  'ı': 'i', 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ħ': 'h', 'ŀ': 'l', 'ō': 'o',
};
const winAnsiOk = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.has(ch);
};

/**
 * Make a string drawable with jsPDF's standard fonts. jsPDF garbles the whole
 * string if any one character is outside WinAnsiEncoding, so map common
 * symbols to ASCII, strip accents that WinAnsi lacks, and fall back to "?".
 */
export function pdfSafe(s: string): string {
  let out = '';
  for (const ch of String(s ?? '')) {
    if (winAnsiOk(ch)) out += ch;
    else if (ch in PDF_MAP) out += PDF_MAP[ch];
    else if (/[\u0000-\u001f\u007f-\u009f]/.test(ch)) out += ' ';
    else {
      // e.g. "ő" → "o" + combining mark → "o"
      const base = ch.normalize('NFKD').replace(/\p{M}/gu, '');
      out += base && Array.from(base).every(winAnsiOk) ? base : '?';
    }
  }
  return out;
}

/**
 * Prepare a cloned SVG for svg2pdf: resolve var(), replace paint-order text
 * halos with a paper-coloured box behind the label (svg2pdf ignores
 * paint-order, so a stroked text paints its halo over the glyphs), and make
 * all text WinAnsi-safe. Must be called on an element attached to the document.
 */
export function prepareSvgForPdf(root: SVGSVGElement) {
  root.querySelectorAll('[data-ui]').forEach((n) => n.remove());
  resolveVarsInTree(root);
  root.querySelectorAll('text').forEach((t) => {
    const paintOrder = t.getAttribute('paint-order') ?? t.style?.paintOrder ?? '';
    if (!/stroke/.test(paintOrder)) return;
    const stroke = t.getAttribute('stroke');
    if (stroke && stroke !== 'none') {
      // svg2pdf draws text strokes without the group scale, so a stroked halo
      // comes out many times too thick. Mask with a tight box behind the
      // label instead (it must be in the document for getBBox to work).
      let box: DOMRect | null = null;
      try {
        box = t.getBBox();
      } catch {
        box = null;
      }
      if (box && box.width > 0 && box.height > 0) {
        const pad = (parseFloat(t.getAttribute('stroke-width') ?? '0') || 0) / 2;
        const rect = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(box.x - pad));
        rect.setAttribute('y', String(box.y + box.height * 0.1));
        rect.setAttribute('width', String(box.width + 2 * pad));
        rect.setAttribute('height', String(box.height * 0.8));
        rect.setAttribute('fill', stroke);
        rect.setAttribute('stroke', 'none');
        const tf = t.getAttribute('transform');
        if (tf) rect.setAttribute('transform', tf);
        t.parentNode?.insertBefore(rect, t);
      }
    }
    // The text itself is fill-only (and must not inherit the group's stroke).
    t.setAttribute('stroke', 'none');
    t.removeAttribute('stroke-width');
    t.removeAttribute('paint-order');
  });
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue) n.nodeValue = pdfSafe(n.nodeValue);
  }
}

export async function svgToPdf(svg: SVGSVGElement, widthMm: number, heightMm: number, fileName: string) {
  const doc = new jsPDF({ orientation: widthMm > heightMm ? 'landscape' : 'portrait', unit: 'mm', format: [widthMm, heightMm] });
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // svg2pdf needs the element in the document to resolve styles.
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.left = '-10000px';
  holder.appendChild(clone);
  document.body.appendChild(holder);
  try {
    // Loaded on demand: svg2pdf.js needs a browser at import time.
    const { svg2pdf } = await import('svg2pdf.js');
    prepareSvgForPdf(clone);
    await svg2pdf(clone, doc, { x: 0, y: 0, width: widthMm, height: heightMm });
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

/** How many tiles of size `win` cover `content` with `overlap` between neighbours. */
export function tileCount(content: number, win: number, overlap: number): number {
  if (!(content > 0)) return 1;
  if (content <= win + 1e-6) return 1;
  const step = win - overlap;
  if (!(step > 0)) throw new Error('overlap must be smaller than the tile window');
  return Math.ceil((content - overlap) / step - 1e-9);
}

export interface PagePlan {
  orientation: 'portrait' | 'landscape';
  /** Page size in mm as laid out (width, height). */
  pageW: number;
  pageH: number;
  cols: number;
  rows: number;
  /** Printable window that shows content, page mm. */
  win: { x: number; y: number; w: number; h: number };
  overlap: number;
  /** Content offset between neighbouring tiles (window size minus overlap). */
  step: { x: number; y: number };
  tiled: boolean;
}

export const MITRE_MARGIN = 10;
export const TILE_OVERLAP = 12;
/** Header band on tiled pages (page label and a scale bar). */
const TILE_BAND = 13;

/**
 * Choose page orientation and tiling for content of contentW × contentH mm
 * on paper [w, h] (portrait size). A single page is used when the content
 * fits inside the margins in either orientation; otherwise the content is
 * tiled at 1:1 with `overlap` mm shared by neighbouring tiles, choosing the
 * orientation that needs the fewest pages (portrait on a tie).
 */
export function planPages(contentW: number, contentH: number, paper: [number, number], margin = MITRE_MARGIN, overlap = TILE_OVERLAP): PagePlan {
  const [pw, ph] = paper[0] <= paper[1] ? paper : [paper[1], paper[0]];
  const orients: ['portrait' | 'landscape', number, number][] = [
    ['portrait', pw, ph],
    ['landscape', ph, pw],
  ];
  for (const [orientation, W, H] of orients) {
    const win = { x: margin, y: margin, w: W - 2 * margin, h: H - 2 * margin };
    if (contentW <= win.w + 1e-6 && contentH <= win.h + 1e-6) return { orientation, pageW: W, pageH: H, cols: 1, rows: 1, win, overlap: 0, step: { x: win.w, y: win.h }, tiled: false };
  }
  let best: PagePlan | null = null;
  for (const [orientation, W, H] of orients) {
    const win = { x: margin, y: margin + TILE_BAND, w: W - 2 * margin, h: H - 2 * margin - TILE_BAND };
    const cols = tileCount(contentW, win.w, overlap);
    const rows = tileCount(contentH, win.h, overlap);
    const plan: PagePlan = { orientation, pageW: W, pageH: H, cols, rows, win, overlap, step: { x: win.w - overlap, y: win.h - overlap }, tiled: true };
    if (!best || cols * rows < best.cols * best.rows) best = plan;
  }
  return best!;
}

type Pdf = InstanceType<typeof jsPDF>;

function scaleBar(doc: Pdf, x: number, y: number) {
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([], 0);
  doc.line(x, y, x + 50, y);
  doc.line(x, y - 2, x, y + 2);
  doc.line(x + 50, y - 2, x + 50, y + 2);
  doc.setFontSize(9);
  doc.text('50 mm', x + 52, y + 1);
}

/** Registration mark: circle with a cross, centred on (x, y). */
function regMark(doc: Pdf, x: number, y: number) {
  doc.setLineDashPattern([], 0);
  doc.setLineWidth(0.15);
  doc.circle(x, y, 2.5, 'S');
  doc.line(x - 4, y, x + 4, y);
  doc.line(x, y - 4, x, y + 4);
}

/** Crop marks just outside each corner of a rectangle. */
function cropMarks(doc: Pdf, r: { x: number; y: number; w: number; h: number }) {
  doc.setLineDashPattern([], 0);
  doc.setLineWidth(0.15);
  const gap = 1;
  const len = 4;
  for (const [cx, sx] of [[r.x, -1], [r.x + r.w, 1]] as const)
    for (const [cy, sy] of [[r.y, -1], [r.y + r.h, 1]] as const) {
      doc.line(cx + sx * gap, cy, cx + sx * (gap + len), cy);
      doc.line(cx, cy + sy * gap, cx, cy + sy * (gap + len));
    }
}

export function mitrePdf(d: Design, g: Geometry) {
  const paper = PAPER[String(d.paperSize)] ?? PAPER.A4;
  let doc: Pdf | null = null;
  const title = pdfSafe(String(d.title ?? ''));
  for (const t of tubeCuts(d, g)) {
    for (const e of t.ends) {
      const circ = e.curve[e.curve.length - 1]?.x;
      const height = Math.max(0, ...e.curve.map((p) => p.y));
      if (!Number.isFinite(circ) || !(circ > 0) || !Number.isFinite(height)) continue;
      const label = pdfSafe(`${t.name} → ${e.into}`);

      // Lay the content out in its own mm coordinates, then place it on pages.
      const wrapW = Math.min(paper[0], paper[1]) - 2 * MITRE_MARGIN;
      const measure = doc ?? new jsPDF({ unit: 'mm' });
      measure.setFontSize(9);
      const info: string[] = measure.splitTextToSize(
        pdfSafe(
          [
            `Tube OD ${t.od.toFixed(2)} mm (+${numOf(d, 'paperThicknessComp').toFixed(2)} paper allowance), wall ${t.wall.toFixed(2)} mm. Into Ø${(e.R * 2).toFixed(2)} at ${e.angle.toFixed(1)}°${e.offset ? `, offset ${e.offset.toFixed(1)} mm` : ''}.`,
            `Cut length (long points) ${t.lengthLongPoints.toFixed(1)} mm; with allowance ${t.cutLength.toFixed(1)} mm. Template depth ${height.toFixed(1)} mm.`,
            'Print at 100% (no "fit to page"). Check the 50 mm scale bar before cutting. Wrap so the ends of the line meet.',
          ].join('\n'),
        ),
        wrapW,
      );
      measure.setFontSize(13);
      const heading: string[] = measure.splitTextToSize(pdfSafe(`${title} — ${t.name}${t.quantity > 1 ? ` (×${t.quantity})` : ''} → ${e.into}`), wrapW);
      const infoY = 5 + heading.length * 5.5 + 1;
      const barY = infoY + info.length * 4 + 3;
      const rectTop = barY + 8;
      const y0 = rectTop + 4;
      const bottom = y0 + height + 30;
      const contentH = bottom + 6;
      const contentW = circ;
      const plan = planPages(contentW, contentH, paper);
      const n = plan.cols * plan.rows;
      const tplX = plan.cols === 1 ? Math.max(0, (plan.win.w - circ) / 2) : 0;

      const drawContent = (doc: Pdf, ox: number, oy: number) => {
        doc.setTextColor(0);
        doc.setDrawColor(0);
        doc.setFontSize(13);
        doc.text(heading, ox, oy + 5, { lineHeightFactor: 5.5 / (13 * 0.3528) });
        doc.setFontSize(9);
        doc.text(info, ox, oy + infoY, { lineHeightFactor: 4 / (9 * 0.3528) });
        scaleBar(doc, ox, oy + barY);
        const x0 = ox + tplX;
        const yy0 = oy + y0;
        doc.setLineWidth(0.3);
        doc.setLineDashPattern([], 0);
        const pts = e.curve.map((p) => [x0 + p.x, yy0 + p.y] as [number, number]);
        for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
        doc.setLineDashPattern([2, 1.5], 0);
        doc.setLineWidth(0.15);
        const yb = oy + bottom;
        for (let q = 0; q <= 4; q++) {
          const x = x0 + (circ * q) / 4;
          doc.line(x, yy0 - 4, x, yb);
          const s = ['0° (in plane)', '90°', '180° (in plane)', '270°', '360°'][q];
          if (q === 4) doc.text(s, x - 1, yb + 4, { align: 'right' });
          else doc.text(s, x + 1, yb + 4);
        }
        doc.setLineDashPattern([], 0);
        doc.rect(x0, yy0 - 4, circ, yb - yy0 + 4);
        doc.text('Tube side', x0 + 2, yb - 2);
        if (plan.tiled) {
          // Registration marks in the middle of every overlap strip, so the
          // same mark appears on both neighbouring tiles.
          for (let c = 1; c < plan.cols; c++) {
            const xm = ox + c * plan.step.x + plan.overlap / 2;
            for (let r = 0; r < plan.rows; r++) for (const f of [0.25, 0.75]) regMark(doc, xm, oy + r * plan.step.y + plan.win.h * f);
          }
          for (let r = 1; r < plan.rows; r++) {
            const ym = oy + r * plan.step.y + plan.overlap / 2;
            for (let c = 0; c < plan.cols; c++) for (const f of [0.25, 0.75]) regMark(doc, ox + c * plan.step.x + plan.win.w * f, ym);
          }
        }
      };

      let k = 0;
      for (let r = 0; r < plan.rows; r++) {
        for (let c = 0; c < plan.cols; c++) {
          k++;
          if (!doc) doc = new jsPDF({ unit: 'mm', format: [paper[0], paper[1]], orientation: plan.orientation });
          else doc.addPage([paper[0], paper[1]], plan.orientation);
          const { win } = plan;
          if (plan.tiled) {
            doc.setFontSize(11);
            doc.setTextColor(0);
            doc.text(`${label}  ${k}/${n}`, win.x + 7, MITRE_MARGIN + 4);
            doc.setFontSize(7.5);
            doc.text(
              `Row ${r + 1} of ${plan.rows}, column ${c + 1} of ${plan.cols}. Trim at the crop marks, overlap neighbouring sheets by ${plan.overlap} mm and align the (+) marks.`,
              win.x + 7,
              MITRE_MARGIN + 8.5,
            );
            scaleBar(doc, win.x + win.w - 70, MITRE_MARGIN + 4);
            cropMarks(doc, win);
          }
          // Clip to the window so tiles cut cleanly at the same place.
          doc.saveGraphicsState();
          doc.rect(win.x, win.y, win.w, win.h, null);
          doc.clip();
          doc.discardPath();
          drawContent(doc, win.x - c * plan.step.x, win.y - r * plan.step.y);
          doc.restoreGraphicsState();
        }
      }
    }
  }
  (doc ?? new jsPDF({ unit: 'mm' })).save(`${baseName(d)}_mitres.pdf`);
}

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
const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/**
 * One CSV field. Cells a spreadsheet would treat as a formula (= + - @ tab
 * CR at the start) get a leading apostrophe, except plain numbers such as
 * "-6". Fields with a quote, comma, CR or LF are quoted.
 */
export function csvCell(s: string | number | null | undefined): string {
  let t = s === null || s === undefined ? '' : String(s);
  if (/^[=+\-@\t\r]/.test(t) && !NUMBER_RE.test(t)) t = `'${t}`;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Rows to CSV text: UTF-8 BOM (so Excel reads non-ASCII correctly) and CRLF line endings. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function specCsv(d: Design, g: Geometry): string {
  const rows: (string | number)[][] = [['Section', 'Item', 'Value', 'Unit']];
  for (const r of specRows(d, g)) rows.push([r.section, r.label, r.value, r.unit]);
  for (const r of fixtureTable(d, g)) rows.push(['Fixture', r.label, r.value, '']);
  for (const t of tubeCuts(d, g)) rows.push(['Cut list', `${t.name}${t.quantity > 1 ? ` x${t.quantity}` : ''}`, t.cutLength.toFixed(1), 'mm']);
  rows.push([]);
  rows.push(['Parameter', 'Id', 'Value', 'Unit']);
  for (const p of PARAMS) rows.push([p.label, p.id, String(d[p.id]), p.unit ?? '']);
  return toCsv(rows);
}

/** Compare several designs side by side (used by the bulk/compare export). */
export function compareCsv(designs: { name: string; d: Design; g: Geometry }[]): string {
  if (!designs.length) return '';
  const first = specRows(designs[0].d, designs[0].g);
  const rows: string[][] = [['Item', ...designs.map((x) => x.name)]];
  first.forEach((r, i) => rows.push([`${r.label} (${r.unit})`, ...designs.map((x) => String(specRows(x.d, x.g)[i]?.value ?? ''))]));
  return toCsv(rows);
}
