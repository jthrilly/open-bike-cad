/**
 * Minimal DXF (R12, ASCII) writer. Units are millimetres. Geometry is written
 * as LWPOLYLINE-free R12 entities (POLYLINE/VERTEX, LINE, CIRCLE, TEXT) for
 * the widest compatibility with CAM software and laser/plasma cutters.
 *
 * The output is pure 7-bit ASCII: text is declared as ANSI_1252 and any
 * non-ASCII character is written as a `\U+XXXX` escape, which AutoCAD,
 * ezdxf, LibreCAD and most CAM packages decode. Entities with non-finite
 * coordinates (NaN/Infinity from a degenerate design) are skipped rather than
 * written, since a single "NaN" makes many readers reject the whole file.
 */
import { Vec } from '../geometry/vec';

/** Make a string safe for a DXF group-code value (one line, ASCII, at most `max` bytes). */
export function dxfText(s: string, max = 255): string {
  // Control characters (CR, LF, tab, NUL, DEL, C1) would end or corrupt the value line.
  const clean = String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
  let out = '';
  for (const ch of clean) {
    const cp = ch.codePointAt(0)!;
    let piece: string;
    if (cp < 0x80) piece = ch;
    else if (cp <= 0xffff) piece = `\\U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    else piece = '?'; // outside the BMP: \U+ only takes four hex digits
    // Cap the encoded value (not the source) so an escape is never cut in half.
    if (out.length + piece.length > max) break;
    out += piece;
  }
  return out;
}

/** Format a number for DXF; non-finite numbers are reported as null. */
export function dxfNum(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n * 1e4) / 1e4;
  return (Object.is(r, -0) ? 0 : r).toString();
}

const finite = (p: Vec) => Number.isFinite(p.x) && Number.isFinite(p.y);

export class Dxf {
  private body: string[] = [];
  private layers = new Set<string>(['0']);
  /** Number of entities dropped because of non-finite values. */
  skipped = 0;

  /** Add one entity's group-code pairs; drops the whole entity if any number is not finite. */
  private entity(...pairs: (string | number)[]): boolean {
    const out: string[] = [];
    for (let i = 0; i < pairs.length; i += 2) {
      const val = pairs[i + 1];
      let s: string;
      if (typeof val === 'number') {
        const f = dxfNum(val);
        if (f === null) {
          this.skipped++;
          return false;
        }
        s = f;
      } else s = val;
      out.push(String(pairs[i]), s);
    }
    this.body.push(...out);
    return true;
  }

  layer(name: string) {
    const n = dxfLayerName(name);
    this.layers.add(n);
    return n;
  }

  line(a: Vec, b: Vec, layer = '0') {
    const l = this.layer(layer);
    this.entity(0, 'LINE', 8, l, 10, a.x, 20, a.y, 30, 0, 11, b.x, 21, b.y, 31, 0);
  }

  circle(c: Vec, r: number, layer = '0') {
    const l = this.layer(layer);
    if (!(r > 0)) {
      this.skipped++;
      return;
    }
    this.entity(0, 'CIRCLE', 8, l, 10, c.x, 20, c.y, 30, 0, 40, r);
  }

  polyline(pts: Vec[], closed = false, layer = '0') {
    const good = pts.filter(finite);
    if (good.length !== pts.length) this.skipped++;
    if (good.length < 2) return;
    const l = this.layer(layer);
    this.entity(0, 'POLYLINE', 8, l, 66, 1, 10, 0, 20, 0, 30, 0, 70, closed ? 1 : 0);
    for (const p of good) this.entity(0, 'VERTEX', 8, l, 10, p.x, 20, p.y, 30, 0);
    this.entity(0, 'SEQEND', 8, l);
  }

  text(p: Vec, height: number, s: string, layer = '0', rotation = 0) {
    const l = this.layer(layer);
    const t = dxfText(s);
    if (!t.trim()) return;
    this.entity(0, 'TEXT', 8, l, 10, p.x, 20, p.y, 30, 0, 40, height, 1, t, 50, rotation);
  }

  toString(): string {
    const head: string[] = [
      '0', 'SECTION', '2', 'HEADER',
      '9', '$ACADVER', '1', 'AC1009',
      '9', '$DWGCODEPAGE', '3', 'ANSI_1252',
      '9', '$INSUNITS', '70', '4',
      '0', 'ENDSEC',
    ];
    const tables: string[] = [
      '0', 'SECTION', '2', 'TABLES',
      '0', 'TABLE', '2', 'LTYPE', '70', '1',
      '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0',
      '0', 'ENDTAB',
      '0', 'TABLE', '2', 'LAYER', '70', String(this.layers.size),
    ];
    for (const l of this.layers) tables.push('0', 'LAYER', '2', l, '70', '0', '62', '7', '6', 'CONTINUOUS');
    tables.push('0', 'ENDTAB', '0', 'ENDSEC');
    return [...head, ...tables, '0', 'SECTION', '2', 'ENTITIES', ...this.body, '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
  }
}

/** Layer names: ASCII letters, digits, _ - $ only (R12 rules), upper-cased. */
export function dxfLayerName(name: string): string {
  const n = String(name).toUpperCase().replace(/[^A-Z0-9_\-$]/g, '_').slice(0, 31);
  return n || '0';
}
