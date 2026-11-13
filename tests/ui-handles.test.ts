import { describe, expect, it } from 'vitest';
import { solve } from '../src/geometry/solve';
import { PRESETS } from '../src/model/presets';
import { Design } from '../src/model/schema';
import { handlePos, inverseHandle } from '../src/ui/Canvas';

const KINDS = ['htTop', 'rearAxle', 'saddle', 'bar'] as const;

function designs(): [string, Design][] {
  const out: [string, Design][] = [];
  for (const p of PRESETS) {
    const d = p.make();
    out.push([p.id, d]);
    out.push([`${p.id}+dropper down`, { ...d, seatpostType: 'dropper', dropperTravel: 150, dropperDown: true }]);
  }
  return out;
}

describe('canvas handle inverse', () => {
  for (const [name, d] of designs()) {
    for (const kind of KINDS) {
      it(`${kind} at its own position is a no-op (${name})`, () => {
        const g = solve(d);
        const patch = inverseHandle(kind, d, g, handlePos(kind, g));
        const next = { ...d, ...patch };
        // The handle stays where it was …
        const p0 = handlePos(kind, g);
        const p1 = handlePos(kind, solve(next));
        expect(p1.x).toBeCloseTo(p0.x, 6);
        expect(p1.y).toBeCloseTo(p0.y, 6);
        // … and, apart from integer-rounded stem angle, values are unchanged.
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'stemAngle') expect(Math.abs((v as number) - (d[k] as number))).toBeLessThanOrEqual(0.5);
          else if (kind !== 'htTop' || k === 'stack' || k === 'reach') {
            if (typeof v === 'number' && typeof d[k] === 'number' && (kind !== 'htTop' || d.frontEndMode === 'stackReach')) expect(v).toBeCloseTo(d[k] as number, 6);
          }
        }
      });
    }
  }

  it('saddle handle lands where it is dragged, including setback and dropper drop', () => {
    const d: Design = { ...PRESETS[0].make(), seatpostType: 'dropper', dropperTravel: 125, dropperDown: true };
    const g = solve(d);
    const t = { x: g.saddleTop.x - 12, y: g.saddleTop.y + 20 };
    const patch = inverseHandle('saddle', d, g, t);
    const g2 = solve({ ...d, ...patch });
    expect(g2.saddleTop.x).toBeCloseTo(t.x, 6);
    expect(g2.saddleTop.y).toBeCloseTo(t.y, 6);
  });

  it('only returns the keys a handle controls', () => {
    const d = PRESETS[0].make();
    const g = solve(d);
    expect(Object.keys(inverseHandle('saddle', d, g, g.saddleTop)).sort()).toEqual(['saddleHeight', 'saddleSetback']);
    expect(Object.keys(inverseHandle('rearAxle', d, g, g.rearAxle)).sort()).toEqual(['bbDrop', 'chainstayLength']);
    expect(Object.keys(inverseHandle('bar', d, g, g.barClamp)).sort()).toEqual(['stemAngle', 'stemLength']);
    const ht = inverseHandle('htTop', { ...d, frontEndMode: 'stackReach' }, solve({ ...d, frontEndMode: 'stackReach' }), g.htTop);
    expect(Object.keys(ht).sort()).toEqual(['reach', 'stack']);
  });
});
