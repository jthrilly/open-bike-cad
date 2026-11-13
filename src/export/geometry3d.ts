/**
 * 3D geometry export: every tube, wheel, component and accessory as explicit
 * 3D points, for building a 3D model (e.g. in Blender). Accessories come from
 * the same buildAssembly() the side-view drawing uses, so the two match.
 */
import { Design, numOf, parseTeeth } from '../model/schema';
import { Geometry } from '../geometry/solve';
import { Vec, add, mul } from '../geometry/vec';
import { frameTubes, forkBladePts } from '../geometry/tubes';
import { buildAssembly, chainringRadius, P3, p3 } from '../geometry/assembly';

const r1 = (n: number) => Math.round(n * 10) / 10;
const R3 = (p: P3): P3 => [r1(p[0]), r1(p[1]), r1(p[2])];
const R3s = (ps: P3[]) => ps.map(R3);
const V = (p: Vec) => [r1(p.x), r1(p.y)];

export const GEOMETRY_3D_VERSION = 3;

/**
 * Bar, grips, brake levers and shifter as explicit 3D parts (flat-type bars).
 * Order from each bar end inward: grip, then (right side, twist shifter) the
 * shifter, then the brake lever clamp; a trigger shifter sits just inboard of
 * the right brake lever, under the bar.
 */
function cockpitParts(d: Design, g: Geometry) {
  if (d.barType === 'drop' || d.barType === 'aero' || d.barType === 'bullhorn') return {};
  const w = numOf(d, 'barWidth');
  const c = g.barClamp;
  const h = g.hands;
  const at = (y: number): P3 => {
    // Clamp section (|y| <= 40) at the clamp; then a straight run to the bar end at the hand position.
    const t = Math.max(0, Math.min(1, (Math.abs(y) - 40) / (w / 2 - 40)));
    return [c.x + (h.x - c.x) * t, y, c.y + (h.y - c.y) * t];
  };
  const gripLen = numOf(d, 'gripLength');
  const shifter = String(d.shifter);
  const twistW = 60;
  const sides = ([1, -1] as const).map((sg) => {
    const end = w / 2;
    const gripLenSide = sg < 0 && shifter === 'twist' ? Math.max(70, gripLen - twistW) : gripLen;
    const gripIn = end - gripLenSide;
    const twistIn = sg < 0 && shifter === 'twist' ? gripIn - twistW : gripIn;
    const leverY = twistIn - 12; // centre of the 20 mm lever clamp band
    const clamp = at(sg * leverY);
    // Lever blade: pivot just ahead of the bar, blade runs outward in front of the grip, slightly below it.
    const pivot: P3 = [clamp[0] + 28, sg * leverY, clamp[2] - 4];
    const tip: P3 = [clamp[0] + 32, sg * (end - 25), clamp[2] - 22];
    return { sg, end, gripIn, twistIn, leverY, clamp, pivot, tip };
  });
  const Rt = sides[1];
  return {
    bar_centreline: R3s([at(w / 2), at(40), at(0), at(-40), at(-w / 2)]),
    bar_grip_dia: 22.2,
    grips: sides.map((s) => ({ side: s.sg > 0 ? 'left' : 'right', from: R3(at(s.sg * s.end)), to: R3(at(s.sg * s.gripIn)), od: 32 })),
    brake_levers: sides.map((s) => ({
      side: s.sg > 0 ? 'left' : 'right',
      brake: s.sg > 0 ? 'rear' : 'front', // right-hand front brake, as usual in South Africa and the UK
      clamp_centre: R3(s.clamp),
      clamp_width: 20,
      pivot: R3(s.pivot),
      blade_tip: R3(s.tip),
      note: 'Flat-bar V-brake lever (long pull). Blade runs from pivot to blade_tip, in front of the grip.',
    })),
    shifter:
      shifter === 'twist'
        ? { type: 'twist grip (e.g. Shimano Revoshift for Nexus)', side: 'right', from: R3(at(-Rt.gripIn)), to: R3(at(-Rt.twistIn)), od: 36 }
        : shifter === 'trigger'
          ? { type: 'trigger, under the bar', side: 'right', clamp_centre: R3(at(-(Rt.leverY - 25))), pod_centre: R3([at(-(Rt.leverY - 25))[0] - 10, -(Rt.leverY - 25), at(-(Rt.leverY - 25))[2] - 25]) }
          : null,
  };
}

export function geometry3d(d: Design, g: Geometry) {
  const a = buildAssembly(d, g);
  const { ttPts, dtPts, stPts } = frameTubes(d, g);
  const u = g.steerDir;
  const fs = numOf(d, 'frontSpacing');
  const blade = forkBladePts(d, g);
  const tyreF = numOf(d, 'frontTyre');
  const crownHalf = tyreF / 2 + (d.fenders === true ? numOf(d, 'fenderClearance') : 6) + numOf(d, 'forkBladeDia') / 2;
  const tipY = fs / 2 + 2.5;
  const bladeSide = (sg: number) =>
    blade.map((p, i) => p3(p, sg * (i === 0 ? crownHalf : crownHalf + (tipY - crownHalf) * ((i - 1) / (blade.length - 2)))));
  const tube = (name: string, odKey: string, wallKey: string, pts: P3[], extra: object = {}) => ({ name, od: numOf(d, odKey), wall: numOf(d, wallKey), centreline: R3s(pts), ...extra });
  const rings = parseTeeth(d.chainrings);
  const cogs = parseTeeth(d.cogs);
  const fender = (f: NonNullable<typeof a.fenders.rear>) => ({
    centre_xz: V(f.centre),
    axis: 'y',
    radius_inner: r1(f.radius),
    width: r1(f.width),
    start_deg: f.startDeg,
    end_deg: f.endDeg,
    angle_convention: 'degrees around the axle in the side (x-z) plane: 0 = forward (+x), 90 = up (+z), 180 = back',
    stays: f.stays.map((s) => ({ from: R3(s.from), to: R3(s.to), od: s.od })),
    mounts: f.mounts.map((m) => ({ ...m, at: R3(m.at) })),
  });

  return {
    format: 'open-bike-cad 3D geometry',
    version: GEOMETRY_3D_VERSION,
    name: d.title,
    size: d.size,
    material: d.material,
    units: 'mm',
    coordinates:
      "Origin at BB centre. x forward (towards the front wheel), y to the rider's LEFT (non-drive side), z up. The chain is on the right (negative y). Ground is z = groundZ. Side-view (x, z) pairs are given as [x, z].",
    groundZ: r1(g.groundY),
    key_dims: Object.fromEntries(Object.entries(g.dims).map(([k, val]) => [k, r1(val as number)])),
    clearances: a.clearances,
    frame: {
      joint_style: String(d.jointStyle),
      tubes: [
        tube('head tube', 'htOD', 'htWall', [p3(g.htTop), p3(g.htBottom)]),
        tube('down tube', 'dtOD', 'dtWall', dtPts.map((p) => p3(p))),
        tube('top tube (step tube on step-through designs)', 'ttOD', 'ttWall', ttPts.map((p) => p3(p))),
        tube('seat tube', 'stOD', 'stWall', stPts.map((p) => p3(p))),
        ...a.stays.chainstays.map((s) => tube(`chainstay ${s.side}`, 'csOD', 'csWall', s.pts)),
        ...a.stays.seatstays.map((s) => tube(`seatstay ${s.side}`, 'ssOD', 'ssWall', s.pts)),
        ...(a.stays.monoStay ? [tube('seatstay mono stay (wishbone)', 'ssMonoOD', 'ssMonoWall', a.stays.monoStay)] : []),
        ...(a.stays.yoke ? [tube('seatstay yoke (wishbone bridge)', 'ssOD', 'ssWall', a.stays.yoke)] : []),
      ],
      bb_shell: { centre: R3(p3(g.bb)), axis: 'y', od: numOf(d, 'bbShellOD'), width: numOf(d, 'bbShellWidth') },
      rear_dropouts: {
        style: String(d.dropoutStyle),
        axle: R3s([p3(g.rearAxle, a.stays.dropoutY), p3(g.rearAxle, -a.stays.dropoutY)]),
        plate_thickness: 6,
        slot_length: numOf(d, 'dropoutSlotLength'),
        slot_width: 10,
      },
      paint: { main: d.paintMain, stays: d.paintStays, fork: d.paintFork, head_tube: d.paintHeadTube, accent: d.paintAccent, decal: d.decalText },
    },
    fork: {
      type: String(d.forkType),
      steerer: { od: numOf(d, 'steererDia'), from: R3(p3(g.crownRace)), to: R3(p3(g.steererTop)) },
      crown: { top: R3(p3(g.crownRace)), bottom: R3(p3(add(g.crownRace, mul(u, numOf(d, 'forkCrownHeight'))))), half_width: r1(crownHalf) },
      blade_od: numOf(d, 'forkBladeDia'),
      blade_left: R3s(bladeSide(1)),
      blade_right: R3s(bladeSide(-1)),
      axle: R3(p3(g.frontAxle)),
      length_axle_to_crown: numOf(d, 'forkLength'),
      rake: numOf(d, 'forkRake'),
    },
    headset: { lower_stack: numOf(d, 'lowerStack'), upper_stack: numOf(d, 'upperStack'), steering_axis_down: [Math.round(u.x * 1e4) / 1e4, 0, Math.round(u.y * 1e4) / 1e4], head_angle: numOf(d, 'headAngle') },
    wheels: (['rear', 'front'] as const).map((w) => ({
      which: w,
      axle: R3(p3(w === 'rear' ? g.rearAxle : g.frontAxle)),
      axis: 'y',
      rim_bsd: numOf(d, w + 'BSD'),
      tyre_width: numOf(d, w + 'Tyre'),
      outer_diameter: r1(2 * (w === 'rear' ? g.rearWheelR : g.frontWheelR)),
      rim_depth: numOf(d, 'rimDepth'),
      spokes: numOf(d, w === 'rear' ? 'spokesRear' : 'spokesFront'),
      hub:
        w === 'front' && a.eAssist?.motor
          ? { old: numOf(d, 'frontSpacing'), flange_dia: a.eAssist.motor.shellDia - 10, shell_dia: a.eAssist.motor.shellDia, shell_width: a.eAssist.motor.shellWidth, type: `geared hub motor, ${a.eAssist.motor.power} W` }
          : { old: numOf(d, w === 'rear' ? 'rearSpacing' : 'frontSpacing'), flange_dia: numOf(d, w === 'rear' ? 'hubFlangeRear' : 'hubFlangeFront') },
    })),
    drivetrain: {
      crank_length: numOf(d, 'crankLength'),
      chainring_teeth: rings,
      chainring_radius: rings.map((t) => r1(chainringRadius(t))),
      sprocket_teeth: cogs,
      sprocket_radius: cogs.map((t) => r1(chainringRadius(t))),
      chainline: numOf(d, 'chainline'),
      chain_y: -numOf(d, 'chainline'),
    },
    cockpit: {
      spacers: numOf(d, 'spacers'),
      stem_length: numOf(d, 'stemLength'),
      stem_angle: numOf(d, 'stemAngle'),
      stem_pivot: R3(p3(g.stemPivot)),
      bar_clamp: R3(p3(g.barClamp)),
      bar: { type: String(d.barType), width: numOf(d, 'barWidth'), clamp_dia: numOf(d, 'barDia') },
      grips_at: R3(p3(g.hands)),
      ...cockpitParts(d, g),
    },
    saddle: {
      seatpost_dia: numOf(d, 'seatpostDia'),
      seatpost_top: R3(p3(g.seatpostTop)),
      saddle_top: R3(p3(g.saddleTop)),
      saddle_length: numOf(d, 'saddleLength'),
      saddle_height_bb_to_top: numOf(d, 'saddleHeight'),
    },
    accessories: {
      brakes: String(d.brakeType),
      fenders: a.fenders.rear || a.fenders.front ? { clearance: numOf(d, 'fenderClearance'), rear: a.fenders.rear && fender(a.fenders.rear), front: a.fenders.front && fender(a.fenders.front) } : null,
      rear_rack: a.rack
        ? {
            platform_z: r1(a.rack.platformZ),
            front_x: r1(a.rack.frontX),
            back_x: r1(a.rack.backX),
            half_width: r1(a.rack.halfWidth),
            tube_od: a.rack.tubeOD,
            load_kg: a.rack.loadKg,
            tubes: a.rack.tubes.map((t) => ({ name: t.name, pts: R3s(t.pts) })),
            mounts: a.rack.mounts.map((m) => ({ ...m, at: R3(m.at) })),
          }
        : null,
      chainguard: a.chainguard
        ? {
            outline_xz: a.chainguard.outline.map(V),
            plate_y: r1(a.chainguard.plateY),
            plate_thickness: 1.5,
            lip_xz: a.chainguard.lip.map(V),
            lip_from_y: r1(a.chainguard.plateY),
            lip_to_y: r1(a.chainguard.lipInnerY),
            note: 'Outer plate in the plane y = plate_y, outline given in side view; a top lip runs along lip_xz from the plate inward to lip_to_y, covering the top of the chainring and upper chain run.',
            mounts: a.chainguard.mounts.map((m) => ({ ...m, at: R3(m.at) })),
          }
        : null,
      ring_lock: a.ringLock
        ? {
            centre: R3(p3(a.ringLock.centre)),
            radial_xz: V(a.ringLock.radial),
            inner_radius: r1(a.ringLock.innerR),
            outer_radius: r1(a.ringLock.outerR),
            tangent_xz: V(a.ringLock.tangent),
            body_arc_deg: a.ringLock.bodyArcDeg,
            body_length: a.ringLock.bodyLength,
            note: "A ring in the plane spanned by the lateral axis (y) and radial_xz, centred on 'centre'; tangent_xz is the ring's normal. inner_radius encloses the tyre, rim and fender cross-section with clearance (see clearances), so nothing passes through the ring. The body covers body_arc_deg centred on the outward radial direction; a round shackle (about 10 mm) closes the rest of the circle through the spokes, below the rim. body_length is the body's thickness along tangent_xz. The body sits just behind the seatstays and bolts to the stay bosses with short brackets.",
            mounts: a.ringLock.mounts.map((m) => ({ ...m, at: R3(m.at) })),
          }
        : null,
      front_carrier_block: a.carrierBlock
        ? {
            forward_xz: V(a.carrierBlock.forward),
            up_xz: V(a.carrierBlock.up),
            mount_block: { ...a.carrierBlock.mountBlock, centre: R3(a.carrierBlock.mountBlock.centre), holes: R3s(a.carrierBlock.mountBlock.holes) },
            carrier_block: { ...a.carrierBlock.block, centre: R3(a.carrierBlock.block.centre) },
            note: 'Brompton-style. A steel mounting block is brazed to the front of the head tube with two M5 threaded holes 26 mm apart along the head tube (Brompton fixes its block with 2 x M5x16 socket head screws at 4 Nm, data sheet ds-fcba). The carrier block is a box about 65 deep x 60 wide x 60 high (Brompton ColourLab block listing; units assumed mm) bolted to it, with a latch the luggage frame clips onto. Brompton rate it at 10 kg. Hole spacing comes from a third-party block listing: measure a real block before brazing.',
          }
        : null,
      e_assist: a.eAssist
        ? (() => {
            const e = a.eAssist!;
            const bx = (b: { centre: P3; depth: number; height: number; width: number }) => ({ centre: R3(b.centre), depth: r1(b.depth), height: r1(b.height), width: r1(b.width) });
            return {
              forward_xz: V(e.forward),
              up_xz: V(e.up),
              note: 'Boxes are aligned with forward_xz (depth), up_xz (height) and y (width), centred on centre. 36 V pedal-assist, 250 W, assist cut-off 25 km/h.',
              battery: e.battery
                ? {
                    cradle: { ...bx(e.battery.cradle), plate: e.battery.cradle.plate, note: 'Steel cradle: back plate bolted to the carrier block front face, side cheeks and floor; cheeks stop 40 mm below the pack top so it lifts out.' },
                    slide_base: { ...bx(e.battery.base), note: 'Slide-in battery base with key lock and contacts, bolted to the cradle back plate.' },
                    pack: { ...bx(e.battery.pack), wh: e.battery.pack.wh, kg: e.battery.pack.kg, volts: e.battery.pack.volts },
                    controller: bx(e.battery.controller),
                    key_lock: R3(e.battery.keyLock),
                    charge_port: R3(e.battery.chargePort),
                    headlight: R3(e.battery.headlight),
                    removal_xz: V(e.battery.removal),
                    brace: { boss: R3(e.battery.brace.boss), from: R3(e.battery.brace.from), bar: e.battery.brace.bar, note: 'M5 boss brazed to the front of the head tube; flat-bar stay up to the cradle floor.' },
                    block_load_kg: e.battery.blockLoadKg,
                    block_rating_kg: e.battery.blockRatingKg,
                  }
                : null,
              motor: e.motor ? { axle: R3(e.motor.axle), shell_dia: e.motor.shellDia, shell_width: e.motor.shellWidth, power_w: e.motor.power, cable_side: e.motor.cableSide, torque_washers: R3s(e.motor.torqueWashers) } : null,
              pedal_sensor: e.sensor ? { type: e.sensor.type, at: R3(e.sensor.at) } : null,
              display: e.display ? { at: R3(e.display.at) } : null,
              wiring: e.wiring,
              added_mass_kg: e.addedKg,
              added_mass_front_share: e.frontShare,
            };
          })()
        : null,
      kickstand: a.kickstand ? { plate: { ...a.kickstand.plate, centre: R3(a.kickstand.plate.centre) }, pivot: R3(a.kickstand.pivot), feet: R3s(a.kickstand.feet), type: 'two-leg centre stand' } : null,
    },
  };
}

