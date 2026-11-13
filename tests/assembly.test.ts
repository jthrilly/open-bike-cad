import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/model/presets';
import { solve } from '../src/geometry/solve';
import { buildAssembly } from '../src/geometry/assembly';
import { geometry3d } from '../src/export/geometry3d';
import { tubeCuts } from '../src/export/mitre';

const city = () => ({ ...PRESETS.find((p) => p.id === 'city')!.make(), chainguard: true, ringLock: true, carrierBlock: true, kickstand: true, chainrings: '38', cogs: '20' });

describe('accessory assembly', () => {
  it('puts the rear rack platform behind the seat tube and above the fender', () => {
    const d = city();
    const g = solve(d);
    const a = buildAssembly(d, g);
    expect(a.rack).toBeDefined();
    const stXAtPlat = -a.rack!.platformZ / Math.tan((Number(d.seatAngle) * Math.PI) / 180);
    expect(a.rack!.frontX).toBeLessThan(stXAtPlat - 30);
    expect(a.rack!.platformZ).toBeGreaterThan(g.rearAxle.y + g.rearWheelR + Number(d.fenderClearance));
  });
  it('keeps the front fender from reaching far ahead of the wheel and stays on the back of the fork', () => {
    const d = city();
    const g = solve(d);
    const f = buildAssembly(d, g).fenders.front!;
    expect(f.startDeg).toBeGreaterThanOrEqual(30);
    // Stay starts behind the axle (fork eyelet on the rear side) and runs back to the fender.
    expect(f.stays[0].from[0]).toBeLessThan(g.frontAxle.x);
    expect(f.stays[0].to[0]).toBeLessThan(f.stays[0].from[0]);
  });
  it('builds a chainguard on the drive side, above the upper chain run', () => {
    const d = city();
    const g = solve(d);
    const a = buildAssembly(d, g);
    expect(a.chainguard!.plateY).toBeLessThan(-Number(d.chainline));
    const gap = a.clearances.find((c) => c.what.startsWith('Chainguard bottom edge'))!;
    expect(gap.mm).toBeGreaterThan(0);
  });
  it('places the carrier block bolt holes 26 mm apart on the front of the head tube', () => {
    const d = city();
    const g = solve(d);
    const cb = buildAssembly(d, g).carrierBlock!;
    const [h1, h2] = cb.mountBlock.holes;
    expect(Math.hypot(h1[0] - h2[0], h1[2] - h2[2])).toBeCloseTo(26, 5);
    // In front of the head tube: its offset from the head tube axis along the forward normal exceeds the tube radius.
    const off = (cb.mountBlock.centre[0] - g.htTop.x) * g.steerNormal.x + (cb.mountBlock.centre[2] - g.htTop.y) * g.steerNormal.y;
    expect(off).toBeGreaterThan(Number(d.htOD) / 2);
  });
  it('exports every accessory in the 3D geometry', () => {
    const d = city();
    const j = geometry3d(d, solve(d));
    expect(j.accessories.rear_rack!.tubes.length).toBeGreaterThan(8);
    expect(j.accessories.chainguard!.outline_xz.length).toBeGreaterThan(10);
    expect(j.accessories.ring_lock).not.toBeNull();
    expect(j.accessories.front_carrier_block).not.toBeNull();
    expect(j.accessories.fenders!.front!.start_deg).toBe(Number(d.fenderFrontStart));
  });
  it('cuts wishbone seatstays as two stays, a mono stay and a yoke bar', () => {
    const d = { ...city(), seatstayStyle: 'wishbone', wishboneLength: 50, wishboneSpread: 120 };
    const cuts = tubeCuts(d, solve(d));
    expect(cuts.find((c) => c.id === 'ss')!.quantity).toBe(2);
    expect(cuts.find((c) => c.id === 'ssMono')!.quantity).toBe(1);
    expect(cuts.find((c) => c.id === 'ssYoke')!.cc).toBeGreaterThan(120);
  });
});

describe('e-assist on the carrier block', () => {
  const ebike = () => ({ ...city(), fenders: true, blockBattery: true, frontHubMotor: true });
  it('places the battery pack ahead of the carrier block and clear of the steered front wheel and the bars', () => {
    const d = ebike();
    const g = solve(d);
    const a = buildAssembly(d, g);
    const b = a.eAssist!.battery!;
    const off = (p: number[]) => (p[0] - g.htTop.x) * g.steerNormal.x + (p[2] - g.htTop.y) * g.steerNormal.y;
    expect(off(b.pack.centre)).toBeGreaterThan(off(a.carrierBlock!.block.centre));
    for (const c of a.clearances.filter((c) => /Battery|controller/.test(c.what))) expect(c.ok, c.what).toBe(true);
    expect(b.blockLoadKg).toBeLessThan(b.blockRatingKg);
  });
  it('exports the hub motor, battery and wiring in the 3D geometry', () => {
    const d = ebike();
    const j = geometry3d(d, solve(d));
    const e = j.accessories.e_assist!;
    expect(e.battery!.pack.wh).toBe(360);
    expect(e.motor!.power_w).toBe(250);
    expect(e.wiring.length).toBe(3);
    expect(j.wheels[1].hub).toHaveProperty('shell_dia', 130);
  });
});
