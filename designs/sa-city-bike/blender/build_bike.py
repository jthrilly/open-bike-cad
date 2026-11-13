"""Build a 3D model of an SA City Bike from its *_geometry.json file.

Run headless:
  blender -b -P build_bike.py -- [--no-render] [--samples N] OUT_DIR GEOMETRY.json [GEOMETRY.json ...]

For each geometry file it writes <slug>.blend, <slug>.glb and the renders
<slug>_side.png, <slug>_front34.png and <slug>_rear34.png into OUT_DIR, and
prints a clearance report. Everything is rebuilt from the JSON on each run.

Geometry is in mm in the JSON (origin BB centre, x forward, y left, z up),
which matches Blender's axes; the model is written in metres.
"""

import json
import math
import os
import re
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

S = 0.001  # mm -> m
Y = Vector((0, 1, 0))


# ---------------------------------------------------------------- materials


def hex_rgba(h):
    h = h.lstrip("#")
    srgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, 1.0)


def material(name, color, metallic=0.0, roughness=0.5, coat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = hex_rgba(color) if isinstance(color, str) else color
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in p.inputs:
        p.inputs["Coat Weight"].default_value = coat
    m.diffuse_color = p.inputs["Base Color"].default_value
    return m


# ---------------------------------------------------------------- mesh helpers


class Part:
    """Accumulates geometry for one object in a bmesh, in mm."""

    def __init__(self, name, mat, smooth=True):
        self.name, self.mat, self.smooth = name, mat, smooth
        self.bm = bmesh.new()

    def finish(self, collection):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
        bmesh.ops.scale(bm, vec=(S, S, S), verts=bm.verts)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for f in me.polygons:
            f.use_smooth = self.smooth
        if self.smooth and hasattr(me, "set_sharp_from_angle"):
            me.set_sharp_from_angle(angle=math.radians(40))
        me.materials.append(self.mat)
        ob = bpy.data.objects.new(self.name, me)
        collection.objects.link(ob)
        return ob


def perp(t):
    a = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
    return t.cross(a).normalized()


def sweep(part, pts, r, segs=24, caps=True, radii=None):
    """Tube of radius r (or per-point radii) along a polyline, parallel-transported frames."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    tangents = []
    for i in range(n):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, n - 1)]
        tangents.append((b - a).normalized())
    normal = perp(tangents[0])
    rings = []
    for i, (p, t) in enumerate(zip(pts, tangents)):
        if i:
            normal = tangents[i - 1].rotation_difference(t) @ normal
            normal = (normal - t * normal.dot(t)).normalized()
        bi = t.cross(normal)
        rr = radii[i] if radii else r
        ring = [
            part.bm.verts.new(p + rr * (math.cos(a) * normal + math.sin(a) * bi))
            for a in (2 * math.pi * k / segs for k in range(segs))
        ]
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(segs):
            part.bm.faces.new((r0[k], r0[(k + 1) % segs], r1[(k + 1) % segs], r1[k]))
    if caps:
        part.bm.faces.new(list(reversed(rings[0])))
        part.bm.faces.new(rings[-1])


def lathe(part, profile, centre, axis=Y, segs=72, closed=True):
    """Revolve a (radius, axial) profile around axis through centre."""
    centre = Vector(centre)
    axis = Vector(axis).normalized()
    u = perp(axis)
    v = axis.cross(u)
    rings = []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        d = math.cos(a) * u + math.sin(a) * v
        rings.append([part.bm.verts.new(centre + r * d + h * axis) for r, h in profile])
    m = len(profile)
    for k in range(segs):
        r0, r1 = rings[k], rings[(k + 1) % segs]
        for j in range(m if closed else m - 1):
            j1 = (j + 1) % m
            part.bm.faces.new((r0[j], r1[j], r1[j1], r0[j1]))


def disc_profile(r_in, r_out, w):
    return [(r_in, -w / 2), (r_out, -w / 2), (r_out, w / 2), (r_in, w / 2)]


def circle_profile(rc, hc, rad, n=24):
    return [(rc + rad * math.cos(2 * math.pi * k / n), hc + rad * math.sin(2 * math.pi * k / n)) for k in range(n)]


def box(part, centre, size, rot=Matrix.Identity(3)):
    bm = part.bm
    sx, sy, sz = (s / 2 for s in size)
    c = Vector(centre)
    vs = [
        bm.verts.new(c + rot @ Vector((x * sx, y * sy, z * sz)))
        for x in (-1, 1)
        for y in (-1, 1)
        for z in (-1, 1)
    ]
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([vs[i] for i in f])


def prism(part, outline_xz, y0, y1):
    """Extrude a closed outline in the xz plane between y0 and y1."""
    bm = part.bm
    a = [bm.verts.new((x, y0, z)) for x, z in outline_xz]
    b = [bm.verts.new((x, y1, z)) for x, z in outline_xz]
    n = len(a)
    bm.faces.new(list(reversed(a)))
    bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))


def basis_from(x_axis, z_hint):
    x = Vector(x_axis).normalized()
    y = Vector(z_hint).cross(x).normalized()
    z = x.cross(y)
    return Matrix((x, y, z)).transposed()


def arc_pts(centre, radius, a0, a1, n=48, y=0.0):
    c = Vector(centre)
    return [
        Vector((c.x + radius * math.cos(a), y, c.z + radius * math.sin(a)))
        for a in (a0 + (a1 - a0) * k / n for k in range(n + 1))
    ]


def hull2d(points):
    pts = sorted(set(points))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def point_at_distance(poly, centre, dist):
    """First point on a polyline at a given distance from centre, walking from the end."""
    c = Vector(centre)
    pts = [Vector(p) for p in reversed(poly)]
    for a, b in zip(pts, pts[1:]):
        da, db = (a - c).length, (b - c).length
        if (da - dist) * (db - dist) <= 0 and da != db:
            t = (dist - da) / (db - da)
            return a.lerp(b, t), (b - a).normalized()
    return None, None


def dist_point_segment(p, a, b):
    p, a, b = Vector(p), Vector(a), Vector(b)
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + t * ab)).length


# ---------------------------------------------------------------- the bike


def build(g):
    col = bpy.context.scene.collection
    fr = g["frame"]
    paint = fr["paint"]
    M = {
        "main": material("paint_main", paint["main"], 0.0, 0.25, 0.8),
        "stays": material("paint_stays", paint["stays"], 0.0, 0.25, 0.8),
        "head": material("paint_head_tube", paint["head_tube"], 0.0, 0.25, 0.8),
        "accent": material("paint_accent", paint["accent"], 0.0, 0.3, 0.6),
        "steel": material("steel", "#c9ccd1", 1.0, 0.25),
        "alu": material("alu_satin", "#b7bbc1", 1.0, 0.4),
        "black": material("black_plastic", "#1a1a1a", 0.0, 0.55),
        "rubber": material("tyre_rubber", "#202020", 0.0, 0.8),
        "tan": material("tyre_sidewall", "#9a7650", 0.0, 0.7),
        "chain": material("chain", "#5b5e63", 1.0, 0.45),
        "saddle": material("saddle_leather", "#4a2e1a", 0.0, 0.55, 0.0),
    }
    tubes = {t["name"].split(" (")[0]: t for t in fr["tubes"]}
    parts = {}

    def part(name, mat, smooth=True):
        if name not in parts:
            parts[name] = Part(name, mat, smooth)
        return parts[name]

    # frame tubes
    for t in fr["tubes"]:
        name = t["name"].split(" (")[0]
        mat = M["head"] if name == "head tube" else (M["stays"] if "stay" in name else M["main"])
        key = "frame_head_tube" if name == "head tube" else ("frame_stays" if "stay" in name else "frame_main")
        sweep(part(key, mat), t["centreline"], t["od"] / 2, segs=32)
    # fillet joints: small spheres approximating the bronze fillets where tubes meet
    fillet = part("frame_main", M["main"])
    joints = [tubes["step tube"]["centreline"][0], tubes["step tube"]["centreline"][1], tubes["down tube"]["centreline"][1]]
    for j in joints:
        bmesh.ops.create_uvsphere(fillet.bm, u_segments=24, v_segments=12, radius=18, matrix=Matrix.Translation(j))
    st_top = Vector(tubes["seat tube"]["centreline"][1])
    ss_top = Vector(tubes["seatstay left"]["centreline"][1])
    sweep(part("frame_stays", M["stays"]), [ss_top, Vector((ss_top.x, -ss_top.y, ss_top.z))], 9, segs=16)
    # seat tube top: seat collar
    st_dir = (st_top - Vector(tubes["seat tube"]["centreline"][0])).normalized()
    lathe(part("seat_collar", M["black"]), disc_profile(15.5, 21, 18), st_top - st_dir * 6, st_dir, segs=32)

    # BB shell
    bb = fr["bb_shell"]
    lathe(part("frame_main", M["main"]), disc_profile(17, bb["od"] / 2, bb["width"]), bb["centre"], Y, segs=48)

    # rear dropouts: plates around the axle, slot forward
    rd = fr["rear_dropouts"]
    ps, th = rd["plate_size"], rd["plate_thickness"]
    for ax in rd["axle"]:
        a = Vector(ax)
        side = 1 if a.y > 0 else -1
        y0 = a.y - side * 3 - th / 2
        outline = [
            (a.x - 14, a.z - 12),
            (a.x + rd["slot_length"] + 16, a.z - 14),
            (a.x + ps * 0.9, a.z + 4),
            (a.x + ps * 0.4, a.z + ps * 0.55),
            (a.x - 12, a.z + 16),
        ]
        prism(part("frame_stays", M["stays"]), outline, y0, y0 + th)

    # headset cups
    ht = [Vector(p) for p in tubes["head tube"]["centreline"]]
    ht_dir = (ht[0] - ht[1]).normalized()  # up
    hs = g["headset"]
    lathe(part("headset", M["black"]), disc_profile(14.3, 22, hs["upper_stack"]), ht[0] + ht_dir * hs["upper_stack"] / 2, ht_dir, 32)
    lathe(part("headset", M["black"]), disc_profile(14.3, 22, hs["lower_stack"]), ht[1] - ht_dir * hs["lower_stack"] / 2, ht_dir, 32)

    # fork
    fk = g["fork"]
    st = fk["steerer"]
    sweep(part("fork", M["main"]), [st["from"], st["to"]], st["od"] / 2, segs=24)
    crown_top, crown_bot = Vector(fk["crown"]["top"]), Vector(fk["crown"]["bottom"])
    hw = fk["crown"]["half_width"]
    crown_axis = (crown_top - crown_bot).normalized()
    crown_rot = basis_from(Y, crown_axis)
    cc = (crown_top + crown_bot) / 2
    box(part("fork", M["main"]), cc, (2 * hw + fk["blade_od"], 34, (crown_top - crown_bot).length), crown_rot)
    for key in ("blade_left", "blade_right"):
        pts = fk[key]
        n = len(pts)
        radii = [fk["blade_od"] / 2 * (1 - 0.35 * max(0, i - 1) / (n - 2)) for i in range(n)]
        sweep(part("fork", M["main"]), pts, 0, segs=24, radii=radii)
        tip = Vector(pts[-1])
        prism(
            part("fork", M["main"]),
            [(tip.x - 14, tip.z - 12), (tip.x + 14, tip.z - 12), (tip.x + 12, tip.z + 22), (tip.x - 12, tip.z + 22)],
            tip.y - 2.5,
            tip.y + 2.5,
        )

    # stem, spacers, bar
    ck = g["cockpit"]
    steer_dir = (Vector(st["to"]) - Vector(st["from"])).normalized()
    pivot, clamp = Vector(ck["stem_pivot"]), Vector(ck["bar_clamp"])
    hs_top = ht[0] + ht_dir * hs["upper_stack"]
    stem_clamp_h = 40
    stem_bottom = pivot - steer_dir * stem_clamp_h / 2
    if (stem_bottom - hs_top).dot(steer_dir) > 1:
        lathe(part("spacers", M["black"]), disc_profile(14.3, 17.5, (stem_bottom - hs_top).length), (hs_top + stem_bottom) / 2, steer_dir, 32)
    lathe(part("stem", M["alu"]), disc_profile(14.3, 19, stem_clamp_h), pivot, steer_dir, 32)
    lathe(part("stem", M["alu"]), [(0, -2), (19, -2), (19, 0), (0, 0)], pivot + steer_dir * (stem_clamp_h / 2 + 2), steer_dir, 32, closed=True)
    sweep(part("stem", M["alu"]), [pivot, clamp], 15, segs=24)
    lathe(part("stem", M["alu"]), disc_profile(16, 21, 44), clamp, Y, 32)
    bw = ck["bar"]["width"]
    bar_pts = [clamp + Vector((-30 * (abs(y) / (bw / 2)) ** 2, y, 0)) for y in [bw / 2 * (k / 10 - 1) for k in range(21)]]
    radii = [ck["bar"]["clamp_dia"] / 2 if abs(p.y - clamp.y) < 40 else 11.1 for p in bar_pts]
    sweep(part("handlebar", M["alu"]), bar_pts, 0, segs=24, radii=radii)
    for s in (1, -1):
        end = clamp + Vector((-30, s * bw / 2, 0))
        lathe(part("grips", M["black"]), disc_profile(11, 16, 130), end - Vector((0, s * 65, 0)), Y, 32)
        lever_root = end - Vector((0, s * 150, 0))
        lathe(part("brake_levers", M["black"]), disc_profile(11, 15, 22), lever_root, Y, 24)
        sweep(part("brake_levers", M["alu"]), [lever_root + Vector((10, 0, 0)), lever_root + Vector((45, -s * 15, -10)), lever_root + Vector((55, -s * 85, -14))], 4, segs=12)
        lathe(part("brake_levers", M["black"]), disc_profile(0, 4, 2), lever_root + Vector((55, -s * 85, -14)), Y, 12)

    # seatpost and saddle
    sd = g["saddle"]
    sp_top = Vector(sd["seatpost_top"])
    sweep(part("seatpost", M["alu"]), [st_top - st_dir * 20, sp_top], sd["seatpost_dia"] / 2, segs=32)
    box(part("seatpost", M["alu"]), sp_top + Vector((0, 0, 8)), (60, 24, 18))
    saddle(part, M, Vector(sd["saddle_top"]), sd["saddle_length"], sp_top)

    # wheels
    wheel_info = {}
    for w in g["wheels"]:
        wheel(parts, part, M, w, g)
        wheel_info[w["which"]] = w

    # drivetrain
    drivetrain(part, M, g, wheel_info["rear"])

    # accessories
    accessories(part, M, g, wheel_info, tubes)

    # CITY decal on both sides of the down tube
    decal(col, M["accent"], tubes["down tube"], paint.get("decal", ""))

    for p in parts.values():
        p.finish(col)
    return wheel_info


def saddle_halfwidth(u, length):
    """Plan half-width of an upright urban saddle (sprung leather, ~270 x 225 mm class).

    u runs from 0 at the rear edge to 1 at the nose tip.
    """
    rear_hw = length * 0.43
    nose_hw = 30.0
    if u < 0.22:
        w = rear_hw
    elif u < 0.8:
        t = (u - 0.22) / 0.58
        w = rear_hw + (nose_hw - rear_hw) * (3 * t * t - 2 * t * t * t)
    else:
        w = nose_hw - 6 * (u - 0.8) / 0.2
    rear_cap = 0.1
    if u < rear_cap:
        w *= math.sqrt(max(0.0, 1 - ((rear_cap - u) / rear_cap) ** 2)) * 0.6 + 0.4
    nose_cap = 0.04
    if u > 1 - nose_cap:
        w *= math.sqrt(max(0.0, 1 - ((u - (1 - nose_cap)) / nose_cap) ** 2)) * 0.8 + 0.2
    return w


def saddle(parts_fn, M, top, length, sp_top):
    """Sprung leather city saddle: domed top, rolled edges, a skirt, steel frame and twin coil springs.

    top is the saddle reference point on the top surface; the saddle is placed with it at 45% from the rear.
    """
    shell = parts_fn("saddle", M["saddle"])
    bm = shell.bm
    x_rear = top.x - length * 0.45
    stations, around = 40, 32
    rings = []
    for i in range(stations + 1):
        u = i / stations
        x = x_rear + u * length
        hw = max(saddle_halfwidth(u, length), 1.0)
        # side profile: slight kick at the rear, low middle, nose a touch higher
        crown = top.z + 3 * math.exp(-((u - 0.15) / 0.12) ** 2) - 2 * math.sin(math.pi * u) + 3 * u
        depth = 30 - 12 * u  # skirt depth below the top
        dome = 7 + 6 * u  # how far the edges roll down from the centreline
        ring = []
        for k in range(around):
            a = 2 * math.pi * k / around
            ca, sa = math.cos(a), math.sin(a)
            yy = hw * math.copysign(abs(ca) ** 0.45, ca)
            if sa >= 0:
                z = crown - dome * (yy / hw) ** 2 - (1 - abs(sa) ** 0.35) * 4
            else:
                z = crown - dome - depth * abs(sa) ** 0.6
            ring.append(bm.verts.new((x, yy, z)))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(around):
            bm.faces.new((r0[k], r1[k], r1[(k + 1) % around], r0[(k + 1) % around]))
    # close both ends with a fan around a point pushed slightly outwards, so the ends stay rounded
    for ring, sign in ((rings[0], -1), (rings[-1], 1)):
        centre = sum((v.co for v in ring), Vector()) / len(ring)
        hub = bm.verts.new(centre + Vector((sign * 6, 0, 0)))
        for k in range(around):
            tri = (ring[k], ring[(k + 1) % around], hub)
            bm.faces.new(tri if sign > 0 else tuple(reversed(tri)))

    # rivets along the rear edge
    rivets = parts_fn("saddle_hardware", M["steel"])
    u = 0.035
    hw = saddle_halfwidth(u, length)
    for j in range(-3, 4):
        yy = hw * 0.85 * j / 3
        p = Vector((x_rear + u * length - 3, yy, top.z - 14))
        bmesh.ops.create_uvsphere(rivets.bm, u_segments=10, v_segments=6, radius=3.2, matrix=Matrix.Translation(p))

    # steel frame under the shell: nose clip, two rails, rear cross bar
    frame = parts_fn("saddle_hardware", M["steel"])
    rail_z = sp_top.z + 22  # rails pass through the seatpost clamp
    base_z = min(sp_top.z - 5, top.z - 60)  # rails drop at the rear to the spring bases
    nose = Vector((x_rear + length * 0.95, 0, top.z - 16))
    spring_x = x_rear + 38
    spring_y = length * 0.2
    for s in (1, -1):
        sweep(
            frame,
            [nose, nose + Vector((-40, s * 12, -14)), Vector((sp_top.x + 30, s * 22, rail_z)), Vector((sp_top.x - 40, s * 22, rail_z)), Vector((spring_x + 5, s * spring_y, base_z))],
            3.5,
            segs=10,
        )
        # coil spring between the rear of the rails and the underside of the shell
        c = Vector((spring_x, s * spring_y, base_z))
        top_z = top.z - 26
        turns, coil_r = 6, 13
        pts = []
        for k in range(turns * 16 + 1):
            a = 2 * math.pi * k / 16
            pts.append(c + Vector((coil_r * math.cos(a), coil_r * math.sin(a), (top_z - base_z) * k / (turns * 16))))
        sweep(frame, pts, 2.6, segs=8)
    sweep(frame, [Vector((spring_x + 5, -spring_y, base_z)), Vector((spring_x + 5, spring_y, base_z))], 3.5, segs=10)
    # saddle clamp on the seatpost head
    box(frame, sp_top + Vector((0, 0, 22)), (40, 60, 16))


def wheel(parts, part, M, w, g):
    ax = Vector(w["axle"])
    name = w["which"]
    bsd, tw, od = w["rim_bsd"], w["tyre_width"], w["outer_diameter"]
    r_bead = bsd / 2
    sec_h = (od - bsd) / 2
    # tyre: slightly flattened torus, tread rubber and tan-wall look in one dark material
    prof = []
    for k in range(32):
        a = 2 * math.pi * k / 32
        prof.append((r_bead + sec_h / 2 + sec_h / 2 * math.sin(a), tw / 2 * 0.95 * math.cos(a)))
    lathe(part(f"{name}_tyre", M["rubber"]), prof, ax, Y, 96)
    rim_w = min(30, tw * 0.45)
    lathe(part(f"{name}_rim", M["alu"]), [(r_bead - w["rim_depth"], -rim_w / 4), (r_bead + 2, -rim_w / 2), (r_bead + 4, -rim_w / 2), (r_bead + 4, rim_w / 2), (r_bead + 2, rim_w / 2), (r_bead - w["rim_depth"], rim_w / 4)], ax, Y, 96)
    hub = w["hub"]
    old = hub["old"]
    if "shell_dia" in hub:  # internal gear hub drum
        shell_r = hub["shell_dia"] / 2
        lathe(part(f"{name}_hub", M["alu"]), [(8, -old / 2), (18, -old / 2 + 4), (shell_r - 8, -40), (shell_r, -30), (shell_r, 30), (shell_r - 8, 40), (18, old / 2 - 4), (8, old / 2)], ax, Y, 48)
        flange_r, flange_off = shell_r + 6, 26
    else:
        lathe(part(f"{name}_hub", M["alu"]), [(5, -old / 2), (14, -old / 2 + 4), (16, -30), (16, 30), (14, old / 2 - 4), (5, old / 2)], ax, Y, 32)
        flange_r, flange_off = 27, 34
    for s in (1, -1):
        lathe(part(f"{name}_hub", M["alu"]), disc_profile(10, flange_r + 3, 3), ax + Y * s * flange_off, Y, 48)
    lathe(part(f"{name}_hub", M["steel"]), disc_profile(0, 5, old + 20), ax, Y, 16)
    # spokes, 3-cross
    n = w["spokes"]
    sp = part(f"{name}_spokes", M["steel"])
    cross = 3 if flange_r < 40 else 2
    step = 2 * math.pi / n
    for i in range(n):
        side = 1 if i % 2 else -1
        a_rim = i * step
        direction = 1 if (i // 2) % 2 else -1
        a_hub = a_rim + direction * cross * 2 * step
        rim_pt = ax + Vector((math.cos(a_rim) * (r_bead - w["rim_depth"] + 2), side * 2, math.sin(a_rim) * (r_bead - w["rim_depth"] + 2)))
        hub_pt = ax + Vector((math.cos(a_hub) * flange_r, side * flange_off, math.sin(a_hub) * flange_r))
        sweep(sp, [hub_pt, rim_pt], 1.0, segs=6)


def drivetrain(part, M, g, rear):
    d = g["drivetrain"]
    y = -d["chainline"]
    bb = Vector(d["bb_centre"])
    r_ring = 12.7 / (2 * math.sin(math.pi / d["chainring_teeth"]))
    r_cog = 12.7 / (2 * math.sin(math.pi / d["sprocket_teeth"]))
    rear_ax = Vector(rear["axle"])
    # chainring with teeth
    ring = part("chainring", M["steel"], smooth=False)
    outline = []
    nt = d["chainring_teeth"]
    for k in range(nt * 4):
        a = 2 * math.pi * k / (nt * 4)
        rr = r_ring + (4 if k % 4 in (1, 2) else -3)
        outline.append((bb.x + rr * math.cos(a), bb.z + rr * math.sin(a)))
    prism(ring, outline, y - 1.5, y + 1.5)
    lathe(part("crankset", M["alu"]), disc_profile(0, r_ring * 0.55, 8), bb + Vector((0, y - 6, 0)), Y, 48)
    # cog
    nt = d["sprocket_teeth"]
    outline = []
    for k in range(nt * 4):
        a = 2 * math.pi * k / (nt * 4)
        rr = r_cog + (4 if k % 4 in (1, 2) else -3)
        outline.append((rear_ax.x + rr * math.cos(a), rear_ax.z + rr * math.sin(a)))
    prism(part("sprocket", M["steel"], smooth=False), outline, y - 1.2, y + 1.2)
    # chain: belt around both circles
    samples = []
    for c, r in ((bb, r_ring), (rear_ax, r_cog)):
        for k in range(180):
            a = 2 * math.pi * k / 180
            samples.append((round(c.x + r * math.cos(a), 3), round(c.z + r * math.sin(a), 3)))
    hull = hull2d(samples)
    chain_pts = [Vector((x, y, z)) for x, z in hull]
    chain_pts.append(chain_pts[0])
    sweep(part("chain", M["chain"]), chain_pts, 3.5, segs=8, caps=False)
    # cranks and pedals; drive-side crank forward, 20 degrees below horizontal
    L = d["crank_length"]
    a = math.radians(-20)
    for s, ang in ((-1, a), (1, a + math.pi)):
        yy = s * 62
        end = bb + Vector((L * math.cos(ang), yy, L * math.sin(ang)))
        root = bb + Vector((0, yy, 0))
        sweep(part("crankset", M["alu"]), [root, end], 0, segs=16, radii=[14, 9])
        lathe(part("crankset", M["alu"]), disc_profile(0, 12, 14), end, Y, 24)
        pc = end + Vector((0, s * 60, 0))
        box(part("pedals", M["black"]), pc, (95, 85, 20))
        lathe(part("pedals", M["steel"]), disc_profile(0, 6, 100), end + Vector((0, s * 50, 0)), Y, 16)
    lathe(part("crankset", M["steel"]), disc_profile(0, 12, 124), bb, Y, 24)
    return r_ring, r_cog, hull


def accessories(part, M, g, wheels, tubes):
    acc = g["accessories"]
    fr = g["frame"]
    front, rear = wheels["front"], wheels["rear"]
    fa, ra = Vector(front["axle"]), Vector(rear["axle"])
    d = g["drivetrain"]

    # fenders
    if "fenders" in acc:
        clr = acc["fenders"]["clearance"]
        for w, a0, a1 in ((front, -5, 205), (rear, 15, 195)):
            ax = Vector(w["axle"])
            R = w["outer_diameter"] / 2 + clr + 1
            width = w["tyre_width"] + 14
            fp = part("fenders", M["black"])
            n = 64
            prof_k = 9
            rings = []
            for i in range(n + 1):
                a = math.radians(a0 + (a1 - a0) * i / n)
                radial = Vector((math.cos(a), 0, math.sin(a)))
                ring = []
                for j in range(prof_k):
                    yy = -width / 2 + width * j / (prof_k - 1)
                    drop = 10 * (2 * yy / width) ** 2
                    ring.append(fp.bm.verts.new(ax + radial * (R - drop) + Vector((0, yy, 0))))
                rings.append(ring)
            for r0, r1 in zip(rings, rings[1:]):
                for j in range(prof_k - 1):
                    fp.bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
            # stays
            for s in (1, -1):
                tip = ax + Vector((math.cos(math.radians(a0 + 25)), 0, math.sin(math.radians(a0 + 25)))) * R + Vector((0, s * width / 2, 0))
                sweep(part("fender_stays", M["steel"]), [ax + Vector((0, s * (w["hub"]["old"] / 2 + 4), 0)), tip], 2.5, segs=8)
                if w is rear:
                    tip2 = ax + Vector((math.cos(math.radians(a1 - 20)), 0, math.sin(math.radians(a1 - 20)))) * R + Vector((0, s * width / 2, 0))
                    sweep(part("fender_stays", M["steel"]), [ax + Vector((0, s * (w["hub"]["old"] / 2 + 4), 0)), tip2], 2.5, segs=8)

    # rear rack, from accessories.rear_rack when it carries geometry
    rack = acc.get("rear_rack")
    if isinstance(rack, dict):
        rp = part("rear_rack", M["steel"])
        r = rack.get("tube_od", 12) / 2
        pf = rack["platform"]
        for rail in pf["rails"]:
            sweep(rp, rail, r, segs=12)
        hw = pf["width"] / 2
        for x in pf["cross_bars_x"]:
            sweep(rp, [(x, -hw, pf["z"]), (x, hw, pf["z"])], r * 0.8, segs=12)
        mounts = rack.get("frame_mounts", {})
        for leg, eyelet in zip(rack["legs"], mounts.get("dropout_eyelets", [None] * 2)):
            sweep(rp, leg, r, segs=12)
            if eyelet:
                sweep(rp, [leg[-1], eyelet], r * 0.7, segs=10)
                lathe(rp, disc_profile(2.5, 7, 5), eyelet, Y, 16)
        for stay, boss in zip(rack["front_stays"], mounts.get("seatstay_bosses", [None] * 2)):
            sweep(rp, stay, r * 0.6, segs=10)
            if boss:
                sweep(rp, [stay[-1], boss], r * 0.6, segs=10)
                lathe(rp, disc_profile(2.5, 6, 5), boss, Y, 16)

    # kickstand: two-leg, plate between chainstays behind BB, legs down to the ground
    if "kickstand" in acc:
        gz = g["groundZ"]
        cs = [Vector(p) for p in tubes["chainstay left"]["centreline"]]
        mount = cs[1].lerp(cs[0], 0.12)
        box(part("kickstand", M["black"]), Vector((mount.x, 0, mount.z - 15)), (60, 2 * mount.y + 20, 8))
        for s in (1, -1):
            sweep(part("kickstand", M["black"]), [(mount.x + 10, s * 25, mount.z - 20), (mount.x + 40, s * 150, gz + 15)], 9, segs=12)
            box(part("kickstand", M["black"]), (mount.x + 42, s * 152, gz + 5), (40, 30, 10))

    # V-brakes
    brake_r = front["rim_bsd"] / 2
    brakes = []
    blade_post, blade_dir = point_at_distance(g["fork"]["blade_left"], fa, brake_r)
    if blade_post is not None:
        brakes.append((fa, blade_post))
    ss = tubes["seatstay left"]["centreline"]
    ss_post, _ = point_at_distance(list(reversed(ss)), ra, brake_r)
    if ss_post is not None:
        brakes.append((ra, ss_post))
    for ax, post in brakes:
        radial = (post - Vector((ax.x, post.y, ax.z))).normalized()
        for s in (1, -1):
            p = Vector((post.x, s * abs(post.y), post.z))
            out = Vector((0, s * 14, 0))
            top = p + radial * 105 + out
            sweep(part("brakes", M["alu"]), [p + out * 0.5, p + radial * 30 + out, top], 0, segs=12, radii=[6, 5, 4])
            box(part("brakes", M["black"]), p + radial * 8 + Vector((0, s * 6, 0)) - radial * 0, (8, 8, 30), basis_from(radial.cross(Y), radial))
        sweep(part("brakes", M["steel"]), [post + radial * 100 + Vector((0, 16, 0)), post + radial * 100 + Vector((0, -16, 0))], 2, segs=8)

    # front carrier block
    cb = acc.get("front_carrier_block")
    if cb:
        ht = [Vector(p) for p in tubes["head tube"]["centreline"]]
        up = (ht[0] - ht[1]).normalized()
        fwd = Y.cross(up).normalized() * -1 if Y.cross(up).x < 0 else Y.cross(up).normalized()
        c = Vector(cb["centre"]) + fwd * 12
        box(part("carrier_block", M["black"]), c, (46, 50, 24), basis_from(up, fwd))

    # chainguard: outer plate and top lip over the upper run of the chain
    if acc.get("chainguard"):
        y = -d["chainline"]
        r_ring = 12.7 / (2 * math.sin(math.pi / d["chainring_teeth"]))
        r_cog = 12.7 / (2 * math.sin(math.pi / d["sprocket_teeth"]))
        bb = Vector(d["bb_centre"])
        off = 18
        samples = []
        for c, r in ((bb, r_ring + off), (ra, r_cog + off)):
            for k in range(180):
                a = 2 * math.pi * k / 180
                samples.append((round(c.x + r * math.cos(a), 3), round(c.z + r * math.sin(a), 3)))
        hull = hull2d(samples)
        # keep the part of the hull above the line through both centres, plus a little below at each end
        nrm = Vector((-(bb.z - ra.z), bb.x - ra.x)).normalized()
        if nrm.y < 0:
            nrm = -nrm

        def above(p):
            return (p[0] - ra.x) * nrm.x + (p[1] - ra.z) * nrm.y > -10

        upper = [p for p in hull if above(p)]
        # order the upper points from rear to front along the hull
        i0 = max(range(len(hull)), key=lambda i: (not above(hull[i - 1])) and above(hull[i]))
        ordered = []
        i = i0
        for _ in range(len(hull)):
            if above(hull[i % len(hull)]):
                ordered.append(hull[i % len(hull)])
            i += 1
        ordered = ordered[: len(upper)]
        prism(part("chainguard", M["black"], smooth=False), ordered, y - 16, y - 14)
        lip = [Vector((x, y - 14, z)) for x, z in ordered]
        lp = part("chainguard", M["black"], smooth=False)
        a_row = [lp.bm.verts.new(p) for p in lip]
        b_row = [lp.bm.verts.new(p + Vector((0, 26, 0))) for p in lip]
        for k in range(len(lip) - 1):
            lp.bm.faces.new((a_row[k], a_row[k + 1], b_row[k + 1], b_row[k]))

    # ring lock on the seatstays above the rear rim
    if "ring_lock" in acc:
        ss = [Vector(p) for p in tubes["seatstay left"]["centreline"]]
        post, _ = point_at_distance([list(p) for p in reversed(ss)], ra, rear["outer_diameter"] / 2 + 30)
        if post is not None:
            radial = (Vector((post.x, 0, post.z)) - Vector((ra.x, 0, ra.z))).normalized()
            tangent = Y.cross(radial)
            centre = Vector((post.x, 0, post.z)) - radial * 5
            body = basis_from(tangent, radial)
            box(part("ring_lock", M["black"]), centre + radial * 10, (40, 2 * abs(post.y) + 30, 30), body)
            arc = []
            for k in range(25):
                a = math.pi * k / 24
                arc.append(centre + radial * (10 - 45 * math.sin(a)) + Y * (abs(post.y) + 10) * math.cos(a))
            sweep(part("ring_lock", M["steel"]), arc, 4, segs=10)

    # bottle bosses on the down tube
    dt = [Vector(p) for p in tubes["down tube"]["centreline"]]
    dt_dir = (dt[1] - dt[0]).normalized()
    up = Y.cross(dt_dir)
    if up.z < 0:
        up = -up
    for f in (0.4, 0.4 + 64 / (dt[1] - dt[0]).length):
        p = dt[0].lerp(dt[1], f) + up * tubes["down tube"]["od"] / 2
        lathe(part("bosses", M["steel"]), disc_profile(2.5, 4.5, 6), p, up, 16)


def decal(col, mat, tube, text):
    if not text:
        return
    a, b = (Vector(p) for p in tube["centreline"])
    d = b - a
    ang = math.atan2(d.z, d.x)
    r = tube["od"] / 2
    for side in (1, -1):
        cu = bpy.data.curves.new(f"decal_{side}", "FONT")
        cu.body = text
        cu.size = r * 1.1 * S
        cu.extrude = 0.4 * S
        cu.align_x = "CENTER"
        cu.align_y = "CENTER"
        ob = bpy.data.objects.new(f"decal_{'left' if side > 0 else 'right'}", cu)
        col.objects.link(ob)
        ob.data.materials.append(mat)
        mid = a.lerp(b, 0.55)
        ob.location = Vector((mid.x, side * (r + 0.2), mid.z)) * S
        # text lies in its XY plane; stand it up facing +/-y and run it along the tube
        if side > 0:
            ob.rotation_euler = (math.radians(90), -ang, math.radians(180))
        else:
            ob.rotation_euler = (math.radians(90), ang, 0)
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.convert(target="MESH")
        ob.select_set(False)


# ---------------------------------------------------------------- report


def clearance_report(g):
    fk = g["fork"]
    lines = []
    front = [w for w in g["wheels"] if w["which"] == "front"][0]
    rear = [w for w in g["wheels"] if w["which"] == "rear"][0]
    fa, ra = Vector(front["axle"]), Vector(rear["axle"])
    fR, rR = front["outer_diameter"] / 2, rear["outer_diameter"] / 2
    crown_bot = Vector(fk["crown"]["bottom"])
    c = (crown_bot - fa).length - fR
    lines.append(f"tyre to fork crown underside: {c:.1f} mm")
    fender = g["accessories"].get("fenders")
    if fender:
        need = fender["clearance"] + 2
        ok = "OK" if c >= need else f"TOO TIGHT: fender at {fender['clearance']} mm clearance plus ~2 mm thickness needs {need} mm"
        lines.append(f"  front fender under crown: {ok}")
    tubes = {t["name"].split(" (")[0]: t for t in g["frame"]["tubes"]}
    for name in ("seat tube", "step tube", "down tube"):
        a, b = tubes[name]["centreline"]
        dist = dist_point_segment(Vector((ra.x, 0, ra.z)), a, b) - rR - tubes[name]["od"] / 2
        lines.append(f"rear tyre to {name}: {dist:.1f} mm")
    a, b = tubes["down tube"]["centreline"]
    dist = dist_point_segment(Vector((fa.x, 0, fa.z)), a, b) - fR - tubes["down tube"]["od"] / 2
    lines.append(f"front tyre to down tube (fork straight): {dist:.1f} mm")
    gz = g["groundZ"]
    lines.append(f"wheel ground contact check: front {fa.z - fR - gz:+.1f} mm, rear {ra.z - rR - gz:+.1f} mm from ground plane")
    return lines


# ---------------------------------------------------------------- scene, render, export


def setup_scene(g, wheels, samples):
    scene = bpy.context.scene
    gz = g["groundZ"] * S
    # ground
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, gz))
    ground = bpy.context.active_object
    ground.name = "ground"
    ground.data.materials.append(material("ground", "#e9e6e0", 0.0, 0.9))
    ground.is_shadow_catcher = False
    # world
    world = bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.82, 0.84, 0.88, 1)
    bg.inputs["Strength"].default_value = 0.3
    # lights
    def light(name, kind, loc, energy, size=1.0, rot=None):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        if kind == "AREA":
            ld.size = size
        if kind == "SUN":
            ld.angle = math.radians(8)
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        scene.collection.objects.link(ob)
        if rot:
            ob.rotation_euler = rot
        else:
            target = Vector((0.1, 0, 0.2))
            ob.rotation_euler = (target - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        return ob

    light("sun", "SUN", (2, -3, 5), 1.2, rot=(math.radians(40), math.radians(10), math.radians(30)))
    light("key", "AREA", (1.5, -3.0, 2.2), 220, 2.5)
    light("fill", "AREA", (-2.5, 2.5, 1.8), 120, 3.0)
    light("rim", "AREA", (-0.5, 3.0, 2.5), 150, 2.0)

    # render settings
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
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1100
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"  # keep paint colours true to the hex values

    fa = Vector(wheels["front"]["axle"])
    ra = Vector(wheels["rear"]["axle"])
    fR = wheels["front"]["outer_diameter"] / 2
    rR = wheels["rear"]["outer_diameter"] / 2
    x0, x1 = ra.x - rR, fa.x + fR
    z0, z1 = g["groundZ"], max(g["cockpit"]["bar_clamp"][2], g["saddle"]["saddle_top"][2]) + 20
    centre = Vector(((x0 + x1) / 2, 0, (z0 + z1) / 2)) * S
    length = (x1 - x0) * S

    target = bpy.data.objects.new("camera_target", None)
    target.location = centre
    scene.collection.objects.link(target)

    cams = {}

    def cam(name, direction, ortho=False, lens=60, aim=None, dist=None):
        cd = bpy.data.cameras.new(name)
        ob = bpy.data.objects.new(name, cd)
        scene.collection.objects.link(ob)
        aim = aim or target
        dist = dist or length * 2.6
        ob.location = aim.location + Vector(direction).normalized() * dist
        if ortho:
            cd.type = "ORTHO"
            cd.ortho_scale = length * 1.12
        else:
            cd.lens = lens
        cd.clip_end = 100
        con = ob.constraints.new("TRACK_TO")
        con.target = aim
        con.track_axis = "TRACK_NEGATIVE_Z"
        con.up_axis = "UP_Y"
        cams[name] = ob

    cam("side", (0, -1, 0), ortho=True)
    cam("front34", (1.0, -0.9, 0.45), lens=58)
    cam("rear34", (-1.0, 0.85, 0.4), lens=58)
    saddle_aim = bpy.data.objects.new("saddle_target", None)
    saddle_aim.location = (Vector(g["saddle"]["saddle_top"]) + Vector((0, 0, -35))) * S
    scene.collection.objects.link(saddle_aim)
    cam("saddle", (-0.8, -1.0, 0.35), lens=85, aim=saddle_aim, dist=1.4)
    return cams


def slug_of(g, path):
    base = os.path.basename(path).replace("_geometry.json", "")
    return re.sub(r"[^A-Za-z0-9_]+", "_", base)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    render = True
    samples = 96
    args = []
    it = iter(argv)
    for a in it:
        if a == "--no-render":
            render = False
        elif a == "--samples":
            samples = int(next(it))
        else:
            args.append(a)
    if len(args) < 2:
        print(__doc__)
        sys.exit(2)
    out_dir, files = args[0], args[1:]
    os.makedirs(out_dir, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    for path in files:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.preferences.filepaths.save_version = 0
        with open(path) as f:
            g = json.load(f)
        slug = slug_of(g, path)
        print(f"\n== {g['name']} -> {slug}")
        wheels = build(g)
        for line in clearance_report(g):
            print("  " + line)
        cams = setup_scene(g, wheels, samples)
        for ob in bpy.data.objects:
            ob.select_set(ob.type == "MESH" and ob.name != "ground")
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(out_dir, slug + ".glb"),
            export_format="GLB",
            use_selection=True,
            export_lights=False,
            export_cameras=False,
            export_apply=True,
        )
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(out_dir, slug + ".blend")))
        if render:
            scene = bpy.context.scene
            for name, ob in cams.items():
                scene.camera = ob
                scene.render.filepath = os.path.join(out_dir, f"{slug}_{name}.png")
                bpy.ops.render.render(write_still=True)
                print(f"  rendered {scene.render.filepath}")


main()
