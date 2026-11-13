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
  it('sizes the ring lock to enclose the tyre, rim and fender, and sits it behind the seatstays', () => {
    const d = city();
    const g = solve(d);
    const a = buildAssembly(d, g);
    const l = a.ringLock!;
    const rC = Math.hypot(l.centre.x - g.rearAxle.x, l.centre.y - g.rearAxle.y);
    // Inner edge below the rim's inner edge (shackle through the spokes) and above the fender top.
    expect(rC - l.innerR).toBeLessThan(g.rearRimR - Number(d.rimDepth));
    expect(rC + l.innerR).toBeGreaterThan(g.rearWheelR + Number(d.fenderClearance) + 2);
    for (const what of ['Ring lock inside to tyre, rim and fender', 'Ring lock body to seatstays', 'Ring lock to rear rack']) {
      expect(a.clearances.find((c) => c.what === what)?.ok).toBe(true);
    }
  });
  it('extends the rack platform the set distance behind the rear axle', () => {
    const d = { ...city(), rackRearOverhang: 200 };
    const g = solve(d);
    expect(g.rearAxle.x - buildAssembly(d, g).rack!.backX).toBeCloseTo(200, 5);
  });
  it('exports grips, brake levers and a twist shifter for flat bars', () => {
    const d = { ...city(), barType: 'flat', barWidth: 600, shifter: 'twist' };
    const ck = geometry3d(d, solve(d)).cockpit as any;
    expect(ck.grips).toHaveLength(2);
    expect(Math.abs(ck.grips[0].from[1])).toBe(300);
    expect(ck.brake_levers.map((b: any) => b.brake)).toEqual(['rear', 'front']);
    expect(ck.shifter.side).toBe('right');
    expect(ck.shifter.from[1]).toBeLessThan(0);
  });
  it('exports motor-ready fork dropouts, torque arm and blade cable guides', () => {
    const d = { ...city(), forkType: 'rigid', forkDropoutPlate: 6, forkDropoutSlotWidth: 10, forkTorqueArm: true, forkCableGuides: 3 };
    const g = solve(d);
    const f = geometry3d(d, g).fork as any;
    expect(f.dropouts.slot_width).toBe(10);
    expect(f.torque_arm.side).toBe('right');
    expect(f.torque_arm.from_axle[1]).toBeLessThan(0);
    expect(f.cable_guides).toHaveLength(3);
    // Guides run up the blade from near the dropout towards the crown, all on the right.
    expect(f.cable_guides[2][2]).toBeGreaterThan(f.cable_guides[0][2]);
    for (const p of f.cable_guides) expect(p[1]).toBeLessThan(0);
  });
  it('places front V-brake bosses 26 mm inside the bead seat, about 80 mm apart, and uses a hub brake at the rear', () => {
    const d = { ...city(), brakeType: 'vbrake', forkType: 'rigid', frontTyre: 56, rearTyre: 56, fenderWidthExtra: 8, rearHubBrake: 'roller' };
    const g = solve(d);
    const a = buildAssembly(d, g);
    expect(a.vbrakes.map((b) => b.which)).toEqual(['front']);
    const f = a.vbrakes[0];
    expect(f.bossRadius).toBe(Number(d.frontBSD) / 2 - 26);
    expect(Math.abs(f.bossSpacing - 80)).toBeLessThanOrEqual(8);
    // Boss faces forward on the fork, pads touch the rim inside the bead seat.
    expect(f.bosses[0].tip[0]).toBeGreaterThan(f.bosses[0].base[0]);
    const r = Math.hypot(f.pads[0].contact[0] - g.frontAxle.x, f.pads[0].contact[2] - g.frontAxle.y);
    expect(r).toBeCloseTo(Number(d.frontBSD) / 2 - 4, 1);
    expect(a.hubBrake?.type).toBe('roller');
    expect(a.hubBrake!.clamp[0]).toBeGreaterThan(g.rearAxle.x);
    const j = geometry3d(d, g).accessories.brakes as any;
    expect(j.v_brakes).toHaveLength(1);
    expect(j.hub_brake.type).toBe('roller');
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

describe('low carrier-block mount and front bag', () => {
  const small = () => ({ ...city(), rearBSD: 406, frontBSD: 406, rearTyre: 54, frontTyre: 54, bbDrop: -23, forkLength: 310, forkRake: 32, headAngle: 70, frontEndMode: 'reachHtl', reach: 370, headTubeLength: 390, frontBag: true, frontBagHeight: 300 });
  it('puts the low mounting block near the head tube bottom and leaves room for a taller bag', () => {
    const std = small();
    const low = { ...small(), carrierBlockPosition: 'low', carrierBlockLowPos: 60 };
    const gs = solve(std);
    const aStd = buildAssembly(std, gs);
    const aLow = buildAssembly(low, solve(low));
    expect(aLow.carrierBlock!.position).toBe('low');
    expect(aLow.carrierBlock!.block.centre[2]).toBeLessThan(aStd.carrierBlock!.block.centre[2] - 100);
    const mb = aLow.carrierBlock!.mountBlock.centre;
    expect(Math.hypot(mb[0] - gs.htBottom.x, mb[2] - gs.htBottom.y)).toBeLessThan(70);
    expect(aLow.frontBag!.maxHeight).toBeGreaterThan(aStd.frontBag!.maxHeight + 100);
    for (const what of ['Front bag to front tyre/fender at full steering lock', 'Front bag top to handlebar/stem at full steering lock (room for hands)']) {
      expect(aLow.clearances.find((c) => c.what === what)?.ok).toBe(true);
    }
    expect(geometry3d(low, solve(low)).accessories.front_bag?.max_height).toBe(aLow.frontBag!.maxHeight);
  });
});

describe('single main tube frame', () => {
  it('drops the top tube from the cut list and 3D export and measures standover over the down tube', () => {
    const d = { ...city(), frameStyle: 'diamond' };
    const s = { ...d, frameStyle: 'single' };
    const gd = solve(d);
    const gs = solve(s);
    expect(tubeCuts(s, gs).some((c) => c.id === 'tt')).toBe(false);
    expect(tubeCuts(d, gd).some((c) => c.id === 'tt')).toBe(true);
    expect(geometry3d(s, gs).frame.tubes.some((t: { name: string }) => t.name.startsWith('top tube'))).toBe(false);
    expect(gs.dims.standover).toBeLessThan(gd.dims.standover);
  });
});

describe('telescopic handlepost', () => {
  it('puts the bar clamp up the steering axis by the extension and offsets it by the head', () => {
    const base = { ...city(), stemKind: 'handlepost', handlepostCollar: 50, handlepostLength: 330, handlepostExtension: 40, handlepostHeadOffset: -60 };
    const lo = solve(base);
    const hi = solve({ ...base, handlepostExtension: 230, handlepostHeadOffset: 60 });
    expect(hi.stemPivot.y - lo.stemPivot.y).toBeCloseTo(190 * Math.sin((70 * Math.PI) / 180), 0);
    expect(lo.barClamp.x - lo.stemPivot.x).toBeCloseTo(-60, 5);
    expect(hi.barClamp.x - hi.stemPivot.x).toBeCloseTo(60, 5);
    expect(solve({ ...base, handlepostExtension: 250 }).warnings.some((w) => w.includes('only'))).toBe(true);
    expect(geometry3d(base, lo).cockpit.handlepost?.extension).toBe(40);
  });
});
