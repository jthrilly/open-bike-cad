"""Concept model of an 18 L children's school bag for a Brompton-style front carrier block.

Run headless from designs/sa-city-bike:
  blender -b -P blender/build_school_bag.py -- [--no-render] [--samples N] OUT_DIR SA_City_Bike_24_kids_geometry.json

It builds the bike with build_bike.py, hangs the bag on accessories.front_carrier_block,
prints a clearance report (fender, tyre, bars, hands and steering lock) and writes into OUT_DIR:
  school_bag.glb / .blend              the bag alone, straps out (backpack mode)
  school_bag_on_bike.glb / .blend      the bike with the bag clipped on, straps stowed
  school_bag_clearance.txt             the clearance report
  school_bag_front34.png, school_bag_back34.png, school_bag_side.png,
  school_bag_on_bike_side.png, school_bag_on_bike_front34.png, school_bag_on_bike_steer.png

The bag hangs with its back vertical. Because the block's faces follow the head tube, the
receiver moulding is a wedge: it wraps the block's front face, sides and top, and its back
is vertical where it bolts through the bag's back panel to the aluminium frame.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))


def load_build_bike():
    """Run build_bike.py's definitions without its trailing main() call."""
    path = os.path.join(HERE, "build_bike.py")
    with open(path) as f:
        src = f.read()
    cut = src.rstrip().rfind("\nmain()")
    ns = {"__name__": "build_bike", "__file__": path}
    exec(compile(src[:cut], path, "exec"), ns)
    return ns


bb = load_build_bike()
Part, sweep, box, prism, material = bb["Part"], bb["sweep"], bb["box"], bb["prism"], bb["material"]
S = bb["S"]
Y = Vector((0, 1, 0))

# Two layouts of the same ~18 L bag. Sizes are as worn: W wide, H tall, D deep from the back.
#  upright: the bag's back panel carries the frame and faces the rider; it rises above the bars.
#  flat: the bag lies on its back (pads down, over the wheel) and its base carries the frame,
#        so it reaches further forward but stays below the bars. With nothing on the back
#        panel, the pads can be thin.
LAYOUTS = {
    "upright": {"prefix": "school_bag", "W": 330, "H": 300, "D": 180, "pocket": 35, "pad": 26},
    "flat": {"prefix": "school_bag_flat", "W": 340, "H": 330, "D": 170, "pocket": 18, "pad": 10},
}
FENDER_GAP = 25  # lowest point of the bag above the front fender's crown
STEER_MAX = 70
HAND = 25  # a child's hand around the grip, beyond the grip surface
RAIL_Y = 70  # frame rails either side of the receiver

COLOURS = {
    "shell": ("#f2b92e", 0.0, 0.75),  # recycled PET Cordura, school yellow
    "trim": ("#1d2b45", 0.0, 0.7),  # navy binding, base, pocket
    "base": ("#1d2b45", 0.0, 0.35),  # welded TPU base
    "mesh": ("#2c3546", 0.0, 0.9),  # 3D spacer mesh back pads
    "reflect": ("#d9dde2", 0.6, 0.35),  # retro-reflective tape
    "frame": ("#b7bbc1", 1.0, 0.35),  # 6061 aluminium frame
    "receiver": ("#202020", 0.0, 0.5),  # glass-filled nylon receiver
    "latch": ("#e2452b", 0.0, 0.4),  # release lever
    "zip": ("#111111", 0.2, 0.4),
}


def mats():
    return {k: material("bag_" + k, c, m, r) for k, (c, m, r) in COLOURS.items()}


# ---------------------------------------------------------------- geometry helpers


def rounded_box(part, lo, hi, radius, segs=5, matrix=Matrix.Identity(4)):
    """Axis-aligned box from lo to hi with all edges rounded (mm)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    lo, hi = Vector(lo), Vector(hi)
    size = hi - lo
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=(lo + hi) / 2, verts=bm.verts)
    r = min(radius, min(size) / 2 - 0.01)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=r, segments=segs, affect="EDGES", profile=0.5)
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    merge(part, bm)


def merge(part, bm):
    me = bpy.data.meshes.new("tmp")
    bm.to_mesh(me)
    bm.free()
    part.bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def section_loop(x0, x1, half_w, radius, n_corner=8):
    """Closed rounded-rectangle loop in the xy plane (for zips and piping)."""
    pts = []
    cs = [(x1 - radius, half_w - radius, 0), (x0 + radius, half_w - radius, 90), (x0 + radius, -half_w + radius, 180), (x1 - radius, -half_w + radius, 270)]
    for cx, cy, a0 in cs:
        for k in range(n_corner + 1):
            a = math.radians(a0 + 90 * k / n_corner)
            pts.append(Vector((cx + radius * math.cos(a), cy + radius * math.sin(a), 0)))
    return pts


def ribbon(part, pts, widths, thick, across):
    """A flat strap along pts; its width lies along `across`, made square to the path."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        wdir = (Vector(across) - t * Vector(across).dot(t)).normalized()
        tdir = t.cross(wdir).normalized()
        w = widths[i] / 2
        rings.append([part.bm.verts.new(p + a * w * wdir + b * thick / 2 * tdir) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(4):
            part.bm.faces.new((r0[k], r0[(k + 1) % 4], r1[(k + 1) % 4], r1[k]))
    part.bm.faces.new(list(reversed(rings[0])))
    part.bm.faces.new(rings[-1])


def smooth_path(ctrl, n=48):
    """Catmull-Rom through control points."""
    c = [Vector(p) for p in ctrl]
    c = [c[0]] + c + [c[-1]]
    out = []
    for i in range(1, len(c) - 2):
        p0, p1, p2, p3 = c[i - 1], c[i], c[i + 1], c[i + 2]
        m = max(2, n // (len(ctrl) - 1))
        for k in range(m):
            t = k / m
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(c[-2])
    return out


# ---------------------------------------------------------------- placement on the block


def placement(g, lay):
    """Where the bag hangs: the frame plane x, the bag's lowest z (world mm), the block frame,
    and T, which takes the bag's own coordinates (x out from the back panel, y across,
    z up from the base, as worn) to the world."""
    cb = g["accessories"]["front_carrier_block"]
    fwd = Vector((cb["forward_xz"][0], 0, cb["forward_xz"][1])).normalized()
    up = Vector((cb["up_xz"][0], 0, cb["up_xz"][1])).normalized()
    blk = cb["carrier_block"]
    c = Vector(blk["centre"])
    plate = 6  # receiver front plate thickness
    face = c + fwd * (blk["depth"] / 2 + 0.5 + plate)  # outer face of the receiver plate
    t_lo, t_hi = -blk["height"] / 2, blk["height"] / 2 + 8
    lo, hi = face + up * t_lo, face + up * t_hi
    xb = math.ceil(max(lo.x, hi.x) + 2)  # bag back panel, vertical
    f = g["accessories"]["fenders"]["front"]
    fender_top = f["centre_xz"][1] + f["radius_inner"] + 1.5
    zb = math.ceil(fender_top + FENDER_GAP)
    if lay["name"] == "upright":
        T = Matrix.Translation((xb, 0, zb))
        frame_z = (zb + 20, zb + 290)
    else:
        # bag x (out from the back) -> world up, bag z (base to top) -> world forward
        R = Matrix(((0, 0, 1, 0), (0, -1, 0, 0), (1, 0, 0, 0), (0, 0, 0, 1)))
        T = Matrix.Translation((xb, 0, zb + lay["pad"])) @ R
        frame_z = (zb + lay["pad"] + 14, zb + lay["pad"] + lay["D"] - 14)
    return {"fwd": fwd, "up": up, "c": c, "blk": blk, "plate": plate, "lo": lo, "hi": hi, "xb": xb, "zb": zb, "fender_top": fender_top, "T": T, "frame_z": frame_z}


# ---------------------------------------------------------------- the bag


def build_bag(g, M, straps_out, lay):
    """Build the bag in world mm on the kids' bike. Returns ({name: Part}, placement)."""
    P = placement(g, lay)
    xb, T = P["xb"], P["T"]
    W, H, D, POCKET_D, PAD = lay["W"], lay["H"], lay["D"], lay["pocket"], lay["pad"]
    flat = lay["name"] == "flat"
    parts = {}

    def part(name, key, smooth=True):
        if name not in parts:
            parts[name] = Part(name, M[key], smooth)
        return parts[name]

    def L(x, y, z):
        return T @ Vector((x, y, z))

    hw = W / 2
    # shell
    rounded_box(part("bag_shell", "shell"), (0, -hw, 0), (D, hw, H), 32, 6, T)
    # welded TPU base tray, 45 mm up the sides, 2 mm proud of the shell
    tray = bmesh.new()
    bmesh.ops.create_cube(tray, size=1.0)
    bmesh.ops.scale(tray, vec=(D + 4, W + 4, H + 4), verts=tray.verts)
    bmesh.ops.translate(tray, vec=(D / 2, 0, H / 2 - 2), verts=tray.verts)
    bmesh.ops.bevel(tray, geom=tray.edges[:], offset=34, segments=6, affect="EDGES", profile=0.5)
    bmesh.ops.bisect_plane(tray, geom=tray.verts[:] + tray.edges[:] + tray.faces[:], plane_co=(0, 0, 45), plane_no=(0, 0, 1), clear_outer=True)
    bmesh.ops.transform(tray, matrix=T, verts=tray.verts)
    merge(part("bag_base", "base"), tray)

    if flat:
        # clamshell: the zip runs round the sides and top 30 mm behind the front face, so the
        # lid opens upwards on the bike
        u = [p for p in section_loop(-H / 2 - 1.2, H / 2 + 1.2, hw + 1.2, 33) if p.x > -H / 2 + 50]
        u.sort(key=lambda p: math.atan2(p.y, p.x))
        sweep(part("bag_zips", "zip"), [L(D - 30, p.y, p.x + H / 2) for p in u], 3.0, segs=8)
        for s in (1, -1):
            box(part("bag_zips", "zip"), L(D - 36, s * (hw + 4), H * 0.7), (22, 3, 14), T.to_3x3())
    else:
        # lid zip: runs round the sides and front 40 mm below the top, ends at the back corners
        loop = section_loop(-1.2, D + 1.2, hw + 1.2, 33)
        zip_pts = [L(p.x, p.y, H - 40) for p in loop if p.x > 25]
        zip_pts.sort(key=lambda p: math.atan2(p.y, p.x - xb - D / 2))
        sweep(part("bag_zips", "zip"), zip_pts, 3.0, segs=8)
        for s in (1, -1):
            box(part("bag_zips", "zip"), L(D * 0.62, s * (hw + 4), H - 46), (14, 3, 22), T.to_3x3())
    # navy piping round the front and back faces
    inset = 32 * (1 - math.sqrt(0.5))  # mid-way round the 32 mm edge radius
    for x in (inset, D - inset):
        ring = [L(x, p.y, p.x + H / 2) for p in section_loop(-H / 2 + inset, H / 2 - inset, hw - inset, 32 - inset)]
        ring.append(ring[0])
        sweep(part("bag_trim", "trim"), ring, 3.0, segs=8, caps=False)

    # front pocket with a reflective band and a name window
    R3 = T.to_3x3()
    pz0, pz1 = (60, H - 70) if flat else (50, 215)
    rounded_box(part("bag_pocket", "trim"), (D - 10, -120, pz0), (D + POCKET_D, 120, pz1), min(20, POCKET_D), 5, T)
    box(part("bag_reflective", "reflect"), L(D + POCKET_D + 0.6, 0, pz1 - 25), (1.5, 200, 22), R3)
    for s in (1, -1):
        box(part("bag_reflective", "reflect"), L(D * 0.5, s * (hw + 0.8), H * 0.4), (110, 1.5, 18), R3)
    box(part("bag_reflective", "reflect"), L(D + POCKET_D + 0.6, 0, (pz0 + pz1) / 2 - 20), (1.2, 90, 50), R3)
    if flat:
        # the top of the bag faces traffic on the bike, so it carries a reflective band too
        box(part("bag_reflective", "reflect"), L(D * 0.45, 0, H + 0.8), (40, 220, 1.5), R3)
    sweep(part("bag_zips", "zip"), [L(D + POCKET_D - 2, -105, pz1 - 7), L(D + POCKET_D - 2, 105, pz1 - 7)], 2.5, segs=8)

    # top grab handle (webbing loop, crosswise)
    hx = 60 if not flat else D * 0.72
    handle = [L(hx, -55 + 110 * k / 16, H + 2 + 32 * math.sin(math.pi * k / 16)) for k in range(17)]
    ribbon(part("bag_handle", "trim"), handle, [26] * 17, 5, R3 @ Vector((1, 0, 0)))
    for s in (1, -1):
        box(part("bag_handle", "trim"), L(hx, s * 55, H + 1), (34, 18, 4), R3)

    # back: two spacer-mesh pads either side of the frame
    padz = (60, H - 25) if flat else (25, 285)
    for s in (1, -1):
        rounded_box(part("bag_back_pads", "mesh"), (-PAD, 85 if s > 0 else -150, padz[0]), (2, 150 if s > 0 else -85, padz[1]), min(10, PAD / 2), 3, T)

    # strap stow pocket between the pads (zip round three sides)
    sz = (120, 290) if flat else (137, 283)
    box(part("bag_back_panel", "trim"), L(-1.0, 0, (sz[0] + sz[1]) / 2 - 2), (2, 128, sz[1] - sz[0] + 4), R3)
    sweep(part("bag_zips", "zip"), [L(-2.5, -62, sz[0]), L(-2.5, -62, sz[1]), L(-2.5, 62, sz[1]), L(-2.5, 62, sz[0])], 2.2, segs=8)

    # aluminium frame: a 10 mm tube loop in the frame plane, half proud of the bag, rails at y = +-70
    fz0, fz1 = P["frame_z"]
    rail_y, rr, fx = RAIL_Y, 26, xb - 3
    frame = [Vector((fx, 0, fz1))]
    for a in range(0, 91, 10):
        r = math.radians(a)
        frame.append(Vector((fx, -rail_y + rr - rr * math.sin(r), fz1 - rr + rr * math.cos(r))))
    for a in range(90, 181, 10):
        r = math.radians(a)
        frame.append(Vector((fx, -rail_y + rr - rr * math.sin(r), fz0 + rr + rr * math.cos(r))))
    frame.append(Vector((fx, 0, fz0)))
    mirror = [Vector((p.x, -p.y, p.z)) for p in reversed(frame[1:-1])]
    loop_pts = frame + mirror + [frame[0]]
    sweep(part("bag_frame", "frame"), loop_pts, 5.0, segs=12, caps=False)

    # receiver moulding: plate on the block's front face, cheeks down its sides, a bridge over
    # its top with the release lever, and a wedge back to the vertical back panel
    fwd, up, c, blk = P["fwd"], P["up"], P["c"], P["blk"]
    rot = Matrix((fwd, Y, up)).transposed()
    bd, bw, bh = blk["depth"], blk["width"], blk["height"]
    pl = P["plate"]
    rec = part("receiver", "receiver")
    box(rec, c + fwd * (bd / 2 + 0.5 + pl / 2) + up * 4, (pl, bw + 12, bh + 8), rot)
    for s in (1, -1):
        box(rec, c + fwd * (bd / 2 - 6) + Y * s * (bw / 2 + 3.5) + up * 4, (14 + pl, 6, bh + 8), rot)
        # lips that ride in the block's side rails
        box(rec, c + fwd * (bd / 2 - 8) + Y * s * (bw / 2 - 0.5), (10, 2.5, 40), rot)
    box(rec, c + fwd * (bd / 2 - 8) + up * (bh / 2 + 0.5 + 3.5), (18 + pl, bw + 12, 7), rot)
    lo, hi = P["lo"], P["hi"]
    prism(rec, [(lo.x, lo.z), (xb + 0.5, lo.z), (xb + 0.5, hi.z), (hi.x, hi.z)], -(bw / 2 + 6), bw / 2 + 6)
    # backplate inside the bag, bolted to both frame rails
    box(rec, Vector((xb - 3, 0, (lo.z + hi.z) / 2)), (6, 2 * RAIL_Y + 14, hi.z - lo.z))
    lever_c = c + fwd * (bd / 2 - 6) + up * (bh / 2 + 9)
    box(part("receiver_lever", "latch"), lever_c, (18, 34, 5), rot)
    box(part("receiver_lever", "latch"), lever_c + fwd * 10 + up * 4, (6, 34, 10), rot)

    # shoulder straps: stowed inside the back pocket on the bike, out for walking
    if straps_out:
        k = H / 300
        for s in (1, -1):
            ctrl = [(-3 - PAD + 10, s * 45, 284 * k), (-24, s * 50, 300 * k), (-70, s * 62, 290 * k), (-100, s * 80, 225 * k), (-104, s * 100, 140 * k), (-80, s * 120, 66 * k), (-34, s * 134, 26 * k), (-4, s * 140, 20 * k)]
            path = [L(*p) for p in smooth_path(ctrl, 60)]
            n = len(path)
            widths = [52 if i < n * 0.62 else 25 for i in range(n)]
            ribbon(part("bag_straps", "trim"), path, widths, 10, R3 @ Vector((0, 1, 0)))
            box(part("bag_strap_buckles", "receiver"), path[int(n * 0.66)], (14, 30, 34), R3)

    return parts, P


# ---------------------------------------------------------------- clearance


STEERED = ("fork", "front_hub", "front_rim", "front_spokes", "front_tyre", "handlebar", "grips", "brake_levers", "stem", "spacers")
STEERED_FRONT_PART = ("fenders", "fender_stays", "brakes")  # objects that also hold rear parts


def world_verts_mm(ob):
    return [ob.matrix_world @ v.co / S for v in ob.data.vertices]


def steered_points(g):
    groups = {}
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        if ob.name in STEERED:
            groups[ob.name] = world_verts_mm(ob)
        elif ob.name in STEERED_FRONT_PART:
            groups[ob.name + " (front)"] = [p for p in world_verts_mm(ob) if p.x > 150]
    return groups


def steer_axis(g):
    st = g["fork"]["steerer"]
    a = Vector(st["to"])
    d = (Vector(st["from"]) - a).normalized()
    return a, d


def rotate_about(p, a, d, ang):
    return a + Matrix.Rotation(ang, 3, d) @ (p - a)


def bag_bvh(objects):
    bm = bmesh.new()
    for ob in objects:
        me = ob.data
        tmp = bmesh.new()
        tmp.from_mesh(me)
        bmesh.ops.transform(tmp, matrix=Matrix.Scale(1 / S, 4) @ ob.matrix_world, verts=tmp.verts)
        m2 = bpy.data.meshes.new("t")
        tmp.to_mesh(m2)
        tmp.free()
        bm.from_mesh(m2)
        bpy.data.meshes.remove(m2)
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def signed_distance(tree, p):
    """Distance to the nearest bag surface. Unsigned: in 1 degree steps a part reaches the
    surface before it can pass through, and the bag's tubes and open trays have no reliable
    inside."""
    hit = tree.find_nearest(p)
    return 1e9 if hit[0] is None else hit[3]


def min_clearance(tree, pts):
    best = (1e9, None)
    for p in pts:
        d = signed_distance(tree, p)
        if d < best[0]:
            best = (d, p)
    return best


def clearance(g, P, lay, bag_objs, receiver_objs):
    lines = []
    tree = bag_bvh(bag_objs)
    groups = steered_points(g)
    a, d = steer_axis(g)
    W, H, D, pk = lay["W"], lay["H"], lay["D"], lay["pocket"]
    zs = [p.z for ob in bag_objs for p in world_verts_mm(ob)]
    xs = [p.x for ob in bag_objs for p in world_verts_mm(ob)]
    lines.append(f"Layout: {lay['name']}. Bag {W} W x {H} H x {D} D mm as worn (+{pk} mm pocket, {lay['pad']} mm back pads)")
    lines.append(f"On the bike it spans x {min(xs):.0f} to {max(xs):.0f} and z {min(zs):.0f} to {max(zs):.0f} (frame plane x = {P['xb']}, bar clamp z = {g['cockpit']['bar_clamp'][2]})")
    lines.append(f"Front fender crown z = {P['fender_top']:.1f}; lowest point of the bag {min(zs) - P['fender_top']:.1f} mm above it")
    pocket_l = (lay['H'] - 130 if lay['name'] == 'flat' else 165) * 240 * pk / 1e6
    lines.append(f"Volume: shell about {W * H * D * 0.92 / 1e6:.1f} L (rounded edges take about 8 %), front pocket {pocket_l:.1f} L")
    blk = P["blk"]
    face = P["c"] + P["fwd"] * blk["depth"] / 2
    cx = (min(xs) + max(xs)) / 2
    lines.append(f"Load centre about {cx - face.x:.0f} mm ahead of the block's front face (block rated {blk['loadKg']} kg)")
    lines.append("")
    lines.append("Straight ahead, nearest steered part to the bag:")
    for name, pts in sorted(groups.items()):
        dist, _ = min_clearance(tree, pts)
        lines.append(f"  {name:22s} {dist:7.1f} mm")
    lines.append("")
    lines.append(f"Steering lock before contact (either way, 1 deg steps up to {STEER_MAX} deg):")
    limits = {}
    for name, pts in sorted(groups.items()):
        thresh = HAND if name == "grips" else 3.0
        hit = {}
        for sign in (1, -1):
            for deg in range(0, STEER_MAX + 1):
                ang = math.radians(deg) * sign
                rp = [rotate_about(p, a, d, ang) for p in pts]
                dist, _ = min_clearance(tree, rp)
                if dist < thresh:
                    hit[sign] = deg
                    break
        worst = min(hit.values()) if hit else None
        limits[name] = worst
        txt = f"contact at {worst} deg" if worst is not None else f"clear to {STEER_MAX} deg"
        extra = f" (a child's hand round the grip, {HAND} mm)" if name == "grips" else ""
        lines.append(f"  {name:22s} {txt}{extra}")
    lines.append("")
    rtree = bag_bvh(receiver_objs)
    blk_ob = bpy.data.objects.get("carrier_block")
    if blk_ob:
        dist = min(rtree.find_nearest(p)[3] for p in world_verts_mm(blk_ob))
        lines.append(f"Receiver to carrier block corners: {dist:.1f} mm (it slides down over the block and wraps its front, sides and top)")
    for name in ("frame_head_tube", "headset", "frame_main"):
        ob = bpy.data.objects.get(name)
        if ob:
            dist, _ = min_clearance(tree, world_verts_mm(ob))
            lines.append(f"Bag to {name}: {dist:.1f} mm")
    return lines, limits


# ---------------------------------------------------------------- scenes


def finish_parts(parts, collection):
    return [p.finish(collection) for p in parts.values()]


def look(scene, name, loc, target, lens=60, ortho=None):
    cd = bpy.data.cameras.new(name)
    ob = bpy.data.objects.new(name, cd)
    scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    else:
        cd.lens = lens
    cd.clip_end = 100
    return ob


def render(scene, cam, path, samples):
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"  rendered {path}")


def export(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_lights=False, export_cameras=False, export_apply=True)


def split_front(name):
    """Split an object holding front and rear parts so the front part can steer."""
    ob = bpy.data.objects.get(name)
    if not ob:
        return None
    me = ob.data.copy()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if (ob.matrix_world @ v.co).x <= 0.15], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    front = bpy.data.objects.new(name + "_front", me)
    ob.users_collection[0].objects.link(front)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if (ob.matrix_world @ v.co).x > 0.15], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    return front


def bag_centre(objs):
    pts = [ob.matrix_world @ v.co for ob in objs for v in ob.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return (lo + hi) / 2, lo, hi


def scene_on_bike(g, lay, out_dir, samples, do_render):
    pre = lay["prefix"]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    wheels = bb["build"](g)
    bike = [ob for ob in bpy.data.objects if ob.type == "MESH"]
    M = mats()
    parts, P = build_bag(g, M, False, lay)
    col = bpy.context.scene.collection
    bag = finish_parts(parts, col)
    receiver = [ob for ob in bag if ob.name.startswith("receiver")]
    body = [ob for ob in bag if not ob.name.startswith("receiver")]
    lines, limits = clearance(g, P, lay, body, receiver)
    print("\n".join("  " + s for s in lines))
    with open(os.path.join(out_dir, pre + "_clearance.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")

    cams = bb["setup_scene"](g, wheels, samples)
    scene = bpy.context.scene
    export(os.path.join(out_dir, pre + "_on_bike.glb"), bike + bag)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(out_dir, pre + "_on_bike.blend")))
    if not do_render:
        return limits
    mid, _, _ = bag_centre(bag)
    render(scene, cams["side"], os.path.join(out_dir, pre + "_on_bike_side.png"), samples)
    c = look(scene, "bag_front34", mid + Vector((1.25, -1.05, 0.55)), mid + Vector((-0.12, 0, -0.12)), lens=45)
    render(scene, c, os.path.join(out_dir, pre + "_on_bike_front34.png"), samples)
    # steer to just short of the first contact and look from above the rider
    hits = [v for v in limits.values() if v is not None]
    steer_deg = max(5, min(hits) - 3) if hits else 45
    steered = [bpy.data.objects[n] for n in STEERED if n in bpy.data.objects] + [o for o in (split_front(n) for n in STEERED_FRONT_PART) if o]
    a, d = steer_axis(g)
    R = Matrix.Translation(a * S) @ Matrix.Rotation(math.radians(steer_deg), 4, d) @ Matrix.Translation(-a * S)
    for ob in steered:
        ob.matrix_world = R @ ob.matrix_world
    c = look(scene, "bag_steer", mid + Vector((-0.95, -0.75, 0.95)), mid + Vector((-0.08, 0, -0.1)), lens=42)
    render(scene, c, os.path.join(out_dir, pre + "_on_bike_steer.png"), samples)
    print(f"  steer render at {steer_deg} deg")
    return limits


def scene_alone(g, lay, out_dir, samples, do_render):
    pre = lay["prefix"]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    M = mats()
    parts, P = build_bag(g, M, True, lay)
    col = bpy.context.scene.collection
    bag = finish_parts(parts, col)
    # stand the bag up as worn: undo T, then put its base on the floor
    T = P["T"]
    Tm = Matrix.Translation(T.translation * S) @ T.to_3x3().to_4x4()
    place = Matrix.Translation((-lay["D"] / 2 * S, 0, 0.002)) @ Tm.inverted()
    for ob in bag:
        ob.matrix_world = place @ ob.matrix_world
    scene = bpy.context.scene
    export(os.path.join(out_dir, pre + ".glb"), bag)
    # studio: floor, world, lights
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    bpy.context.active_object.data.materials.append(material("ground", "#e9e6e0", 0.0, 0.9))
    world = bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.82, 0.84, 0.88, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    for name, loc, e, size in (("key", (1.4, -1.6, 1.6), 140, 1.5), ("fill", (-1.6, 1.2, 1.2), 70, 2.0), ("rim", (-0.6, 1.8, 1.8), 90, 1.2)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size = e, size
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        ob.rotation_euler = (Vector((0, 0, 0.15)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(ob)
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for dev in prefs.devices:
            dev.use = True
        scene.cycles.device = "GPU"
    except Exception:
        scene.cycles.device = "CPU"
    scene.render.resolution_x, scene.render.resolution_y = 1400, 1100
    scene.view_settings.view_transform = "Standard"
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(out_dir, pre + ".blend")))
    if not do_render:
        return
    t = Vector((0, 0, lay["H"] / 2 * S))
    render(scene, look(scene, "front34", t + Vector((0.95, -0.75, 0.45)), t, 50), os.path.join(out_dir, pre + "_front34.png"), samples)
    render(scene, look(scene, "back34", t + Vector((-0.95, -0.8, 0.5)), t, 50), os.path.join(out_dir, pre + "_back34.png"), samples)
    render(scene, look(scene, "side", t + Vector((0, -1.6, 0)), t, ortho=0.62), os.path.join(out_dir, pre + "_side.png"), samples)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    do_render, samples, args, layouts = True, 96, [], list(LAYOUTS)
    it = iter(argv)
    for a in it:
        if a == "--no-render":
            do_render = False
        elif a == "--samples":
            samples = int(next(it))
        elif a == "--layout":
            layouts = [next(it)]
        else:
            args.append(a)
    if len(args) != 2:
        print(__doc__)
        sys.exit(2)
    out_dir, path = args
    os.makedirs(out_dir, exist_ok=True)
    with open(path) as f:
        g = json.load(f)
    if not isinstance(g.get("accessories", {}).get("front_carrier_block"), dict):
        sys.exit("geometry has no accessories.front_carrier_block")
    for name in layouts:
        lay = dict(LAYOUTS[name], name=name)
        scene_on_bike(g, lay, out_dir, samples, do_render)
        scene_alone(g, lay, out_dir, samples, do_render)


main()
