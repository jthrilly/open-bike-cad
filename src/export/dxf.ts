/**
 * Minimal DXF (R12, ASCII) writer. Units are millimetres. Geometry is written
 * as LWPOLYLINE-free R12 entities (POLYLINE/VERTEX, LINE, CIRCLE, TEXT) for
 * the widest compatibility with CAM software and laser/plasma cutters.
 */
import { Vec } from '../geometry/vec';

export class Dxf {
  private body: string[] = [];
  private layers = new Set<string>(['0']);

  private push(...pairs: (string | number)[]) {
    for (let i = 0; i < pairs.length; i += 2) {
      this.body.push(String(pairs[i]), typeof pairs[i + 1] === 'number' ? fmt(pairs[i + 1] as number) : String(pairs[i + 1]));
    }
  }

  layer(name: string) {
    this.layers.add(name);
    return name;
  }

  line(a: Vec, b: Vec, layer = '0') {
    this.layer(layer);
    this.push(0, 'LINE', 8, layer, 10, a.x, 20, a.y, 30, 0, 11, b.x, 21, b.y, 31, 0);
  }

  circle(c: Vec, r: number, layer = '0') {
    this.layer(layer);
    this.push(0, 'CIRCLE', 8, layer, 10, c.x, 20, c.y, 30, 0, 40, r);
  }

  polyline(pts: Vec[], closed = false, layer = '0') {
    if (pts.length < 2) return;
    this.layer(layer);
    this.push(0, 'POLYLINE', 8, layer, 66, 1, 70, closed ? 1 : 0);
    for (const p of pts) this.push(0, 'VERTEX', 8, layer, 10, p.x, 20, p.y, 30, 0);
    this.push(0, 'SEQEND', 8, layer);
  }

  text(p: Vec, height: number, s: string, layer = '0', rotation = 0) {
    this.layer(layer);
    this.push(0, 'TEXT', 8, layer, 10, p.x, 20, p.y, 30, 0, 40, height, 1, s.replace(/\n/g, ' '), 50, rotation);
  }

  toString(): string {
    const head: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC'];
    const tables: string[] = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(this.layers.size)];
    for (const l of this.layers) tables.push('0', 'LAYER', '2', l, '70', '0', '62', '7', '6', 'CONTINUOUS');
    tables.push('0', 'ENDTAB', '0', 'ENDSEC');
    return [...head, ...tables, '0', 'SECTION', '2', 'ENTITIES', ...this.body, '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
  }
}

function fmt(n: number) {
  return (Math.round(n * 1e4) / 1e4).toString();
}
