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


def first(v):
    return v[0] if isinstance(v, list) else v


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
        "fork": material("paint_fork", paint.get("fork", paint["main"]), 0.0, 0.25, 0.8),
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
        "bag": material("bag_fabric", "#c8553d", 0.0, 0.8),
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
        if t["od"] and len(t["centreline"]) >= 2 and name.startswith("seatstay"):
            # round the ends of the stays where they meet (wishbone yoke)
            for end in t["centreline"]:
                bmesh.ops.create_uvsphere(part("frame_stays", M["stays"]).bm, u_segments=16, v_segments=8, radius=t["od"] / 2, matrix=Matrix.Translation(end))
        key = "frame_head_tube" if name == "head tube" else ("frame_stays" if "stay" in name else "frame_main")
        sweep(part(key, mat), t["centreline"], t["od"] / 2, segs=32)
    # fillet joints: small spheres approximating the bronze fillets where tubes meet
    fillet = part("frame_main", M["main"])
    upper = tubes.get("top tube") or tubes["step tube"]
    joints = [upper["centreline"][0], upper["centreline"][1], tubes["down tube"]["centreline"][1]]
    for j in joints:
        bmesh.ops.create_uvsphere(fillet.bm, u_segments=24, v_segments=12, radius=18, matrix=Matrix.Translation(j))
    st_top = Vector(tubes["seat tube"]["centreline"][1])
    # seat tube top: seat collar
    st_dir = (st_top - Vector(tubes["seat tube"]["centreline"][0])).normalized()
    lathe(part("seat_collar", M["black"]), disc_profile(15.5, 21, 18), st_top - st_dir * 6, st_dir, segs=32)

    # BB shell
    bb = fr["bb_shell"]
    lathe(part("frame_main", M["main"]), disc_profile(17, bb["od"] / 2, bb["width"]), bb["centre"], Y, segs=48)

    # rear dropouts: plates around the axle, slot forward
    rd = fr["rear_dropouts"]
    ps, th = rd.get("plate_size", 50), rd["plate_thickness"]
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
    sweep(part("fork", M["fork"]), [st["from"], st["to"]], st["od"] / 2, segs=24)
    crown_top, crown_bot = Vector(fk["crown"]["top"]), Vector(fk["crown"]["bottom"])
    hw = fk["crown"]["half_width"]
    crown_axis = (crown_top - crown_bot).normalized()
    crown_rot = basis_from(Y, crown_axis)
    cc = (crown_top + crown_bot) / 2
    box(part("fork", M["fork"]), cc, (2 * hw + fk["blade_od"], 34, (crown_top - crown_bot).length), crown_rot)
    for key in ("blade_left", "blade_right"):
        pts = fk[key]
        n = len(pts)
        radii = [fk["blade_od"] / 2 * (1 - 0.35 * max(0, i - 1) / (n - 2)) for i in range(n)]
        sweep(part("fork", M["fork"]), pts, 0, segs=24, radii=radii)
        tip = Vector(pts[-1])
        prism(
            part("fork", M["fork"]),
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
    controls = cockpit_controls(part, M, ck, clamp)

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
    cables(part, M, g, tubes, controls, wheel_info)

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
    shell_dia = hub.get("shell_dia") or (hub["flange_dia"] if hub.get("flange_dia", 0) >= 80 else None)
    if shell_dia:  # internal gear hub drum
        shell_r = shell_dia / 2
        lathe(part(f"{name}_hub", M["alu"]), [(8, -old / 2), (18, -old / 2 + 4), (shell_r - 8, -40), (shell_r, -30), (shell_r, 30), (shell_r - 8, 40), (18, old / 2 - 4), (8, old / 2)], ax, Y, 48)
        flange_r, flange_off = shell_r + 6, 26
    else:
        lathe(part(f"{name}_hub", M["alu"]), [(5, -old / 2), (14, -old / 2 + 4), (16, -30), (16, 30), (14, old / 2 - 4), (5, old / 2)], ax, Y, 32)
        flange_r, flange_off = hub.get("flange_dia", 54) / 2, 34
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
    y = d.get("chain_y", -d["chainline"])
    bb = Vector(d.get("bb_centre") or g["frame"]["bb_shell"]["centre"])
    ring_teeth = first(d["chainring_teeth"])
    cog_teeth = first(d["sprocket_teeth"])
    r_ring = first(d.get("chainring_radius")) or 12.7 / (2 * math.sin(math.pi / ring_teeth))
    r_cog = first(d.get("sprocket_radius")) or 12.7 / (2 * math.sin(math.pi / cog_teeth))
    rear_ax = Vector(rear["axle"])
    # chainring with teeth
    ring = part("chainring", M["steel"], smooth=False)
    outline = []
    nt = ring_teeth
    for k in range(nt * 4):
        a = 2 * math.pi * k / (nt * 4)
        rr = r_ring + (4 if k % 4 in (1, 2) else -3)
        outline.append((bb.x + rr * math.cos(a), bb.z + rr * math.sin(a)))
    prism(ring, outline, y - 1.5, y + 1.5)
    lathe(part("crankset", M["alu"]), disc_profile(0, r_ring * 0.55, 8), bb + Vector((0, y - 6, 0)), Y, 48)
    # cog
    nt = cog_teeth
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
    """Accessories, built only from the explicit geometry in accessories.* (no invented shapes)."""
    acc = g["accessories"]
    front, rear = wheels["front"], wheels["rear"]
    fa, ra = Vector(front["axle"]), Vector(rear["axle"])

    def boss(p, r=5, length=8):
        lathe(part("mount_bosses", M["steel"]), disc_profile(0, r, length), p, Y, 16)

    # fenders: an arc around the axle with a slightly crowned section, plus stays
    for which, f in (acc.get("fenders") or {}).items():
        if not isinstance(f, dict):
            continue
        c = Vector((f["centre_xz"][0], 0, f["centre_xz"][1]))
        R, width = f["radius_inner"], f["width"]
        a0, a1 = math.radians(f["start_deg"]), math.radians(f["end_deg"])
        fp = part("fenders", M["black"])
        n = max(16, int(abs(a1 - a0) / math.radians(3)))
        cols = 9
        thick = 1.5
        outer_rows, inner_rows = [], []
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            radial = Vector((math.cos(a), 0, math.sin(a)))
            o_row, i_row = [], []
            for j in range(cols):
                yy = -width / 2 + width * j / (cols - 1)
                drop = 8 * (2 * yy / width) ** 2
                base = c + radial * (R - drop) + Vector((0, yy, 0))
                i_row.append(fp.bm.verts.new(base))
                o_row.append(fp.bm.verts.new(base + radial * thick))
            outer_rows.append(o_row)
            inner_rows.append(i_row)
        for rows, flip in ((outer_rows, False), (inner_rows, True)):
            for r0, r1 in zip(rows, rows[1:]):
                for j in range(cols - 1):
                    q = (r0[j], r1[j], r1[j + 1], r0[j + 1])
                    fp.bm.faces.new(tuple(reversed(q)) if flip else q)
        for j in (0, cols - 1):
            for k in range(n):
                q = (inner_rows[k][j], inner_rows[k + 1][j], outer_rows[k + 1][j], outer_rows[k][j])
                fp.bm.faces.new(q if j == 0 else tuple(reversed(q)))
        for k in (0, n):
            for j in range(cols - 1):
                q = (inner_rows[k][j], outer_rows[k][j], outer_rows[k][j + 1], inner_rows[k][j + 1])
                fp.bm.faces.new(q if k == 0 else tuple(reversed(q)))
        for st in f.get("stays", []):
            sweep(part("fender_stays", M["steel"]), [st["from"], st["to"]], st.get("od", 5) / 2, segs=10)
        for m in f.get("mounts", []):
            boss(Vector(m["at"]), 4, 6)

    # rear rack: exact tube polylines
    rack = acc.get("rear_rack")
    if isinstance(rack, dict):
        r = rack.get("tube_od", 12) / 2
        for t in rack.get("tubes", []):
            sweep(part("rear_rack", M["steel"]), t["pts"], t.get("od", 2 * r) / 2, segs=12)
        for m in rack.get("mounts", []):
            boss(Vector(m["at"]))

    # chainguard: outer plate in y = plate_y, top lip running inward to lip_to_y
    cg = acc.get("chainguard")
    if cg:
        t = cg.get("plate_thickness", 1.5)
        y = cg["plate_y"]
        cp = part("chainguard", M["black"], smooth=False)
        outline = cg["outline_xz"]
        a_ring = [cp.bm.verts.new((x, y - t / 2, z)) for x, z in outline]
        b_ring = [cp.bm.verts.new((x, y + t / 2, z)) for x, z in outline]
        nv = len(outline)
        for i in range(nv):
            j = (i + 1) % nv
            cp.bm.faces.new((a_ring[i], a_ring[j], b_ring[j], b_ring[i]))
        # concave outline: keep each side as one n-gon, Blender's polyfill triangulates it correctly
        cp.bm.faces.new(list(reversed(a_ring)))
        cp.bm.faces.new(b_ring)
        lip = cg.get("lip_xz")
        if lip:
            y0, y1 = cg.get("lip_from_y", y), cg["lip_to_y"]
            ra_ = [cp.bm.verts.new((x, y0, z)) for x, z in lip]
            rb_ = [cp.bm.verts.new((x, y1, z)) for x, z in lip]
            rc_ = [cp.bm.verts.new((x, y1, z + t)) for x, z in lip]
            rd_ = [cp.bm.verts.new((x, y0, z + t)) for x, z in lip]
            for k in range(len(lip) - 1):
                for u, v in ((ra_, rb_), (rb_, rc_), (rc_, rd_), (rd_, ra_)):
                    cp.bm.faces.new((u[k], u[k + 1], v[k + 1], v[k]))
        for m in cg.get("mounts", []):
            boss(Vector(m["at"]), 4, 6)

    # ring (frame) lock: a U-shaped body around the tyre plus the shackle through the spokes
    rl = acc.get("ring_lock")
    if isinstance(rl, dict):
        c = Vector(rl["centre"])
        radial = Vector((rl["radial_xz"][0], 0, rl["radial_xz"][1])).normalized()
        travel = Vector((rl["tangent_xz"][0], 0, rl["tangent_xz"][1])).normalized() if "tangent_xz" in rl else Y.cross(radial).normalized()
        ri, ro, L = rl["inner_radius"], rl["outer_radius"], rl["body_length"]
        half = math.radians(rl["body_arc_deg"]) / 2
        lp = part("ring_lock", M["black"])
        n = 40
        rings = []
        for i in range(n + 1):
            phi = -half + 2 * half * i / n
            d = math.cos(phi) * radial + math.sin(phi) * Y
            rings.append([lp.bm.verts.new(c + d * rr + travel * tt) for rr, tt in ((ri, -L / 2), (ro, -L / 2), (ro, L / 2), (ri, L / 2))])
        for r0, r1 in zip(rings, rings[1:]):
            for k in range(4):
                lp.bm.faces.new((r0[k], r1[k], r1[(k + 1) % 4], r0[(k + 1) % 4]))
        lp.bm.faces.new(list(reversed(rings[0])))
        lp.bm.faces.new(rings[-1])
        shackle = []
        for i in range(25):
            phi = half + (2 * math.pi - 2 * half) * i / 24
            d = math.cos(phi) * radial + math.sin(phi) * Y
            shackle.append(c + d * (ri + ro) / 2)
        sweep(part("ring_lock_shackle", M["steel"]), shackle, 5, segs=12)
        for m in rl.get("mounts", []):
            at = Vector(m["at"])
            boss(at, 4, 6)
            v = at - c
            face = 1 if v.dot(travel) > 0 else -1
            v -= travel * v.dot(travel)
            target = c + v.normalized() * (ri + ro) / 2 + travel * face * L / 2
            sweep(part("ring_lock_brackets", M["steel"]), [at, target], 3, segs=10)

    # Brompton-style front carrier block: brazed mount block plus the bolted-on block
    cb = acc.get("front_carrier_block")
    if isinstance(cb, dict):
        fwd = Vector((cb["forward_xz"][0], 0, cb["forward_xz"][1])).normalized()
        up = Vector((cb["up_xz"][0], 0, cb["up_xz"][1])).normalized()
        rot = Matrix((fwd, Y, up)).transposed()
        mb = cb["mount_block"]
        box(part("frame_head_tube", M["head"]), Vector(mb["centre"]), (mb["depth"], mb["width"], mb["alongHT"]), rot)
        for h in mb.get("holes", []):
            lathe(part("carrier_block_bolts", M["steel"]), disc_profile(0, 4.25, 4), Vector(h) + fwd * (mb["depth"] / 2 + cb["carrier_block"]["depth"] + 2), fwd, 16)
        blk = cb["carrier_block"]
        box(part("carrier_block", M["black"]), Vector(blk["centre"]), (blk["depth"], blk["width"], blk["height"]), rot)

    # Front bag envelope on the carrier block (format v3 'front_bag'): a plain box, back panel vertical
    fb = acc.get("front_bag")
    if isinstance(fb, dict):
        box(part("front_bag", M["bag"]), Vector(fb["centre"]), (fb["depth"], fb["width"], fb["height"]))

    # two-leg centre stand
    ks = acc.get("kickstand")
    if isinstance(ks, dict):
        pl = ks["plate"]
        pc = Vector(pl["centre"])
        box(part("kickstand", M["black"]), pc, (pl["length"], pl["width"], 6))
        pivot = Vector(ks["pivot"])
        box(part("kickstand", M["black"]), (pc + pivot) / 2, (40, 50, (pc - pivot).length + 6))
        for foot in ks["feet"]:
            sweep(part("kickstand", M["black"]), [pivot + Vector((0, math.copysign(15, foot[1]), 0)), foot], 8, segs=12)

    if acc.get("brakes") == "vbrake":
        for vb in vbrakes(g, tubes, wheels):
            for side in vb["arms"]:
                sweep(part("brakes", M["alu"]), side["arm"], 0, segs=12, radii=[6.5, 6, 5, 4.5])
                lathe(part("brake_pads", M["black"]), disc_profile(0, 7, 12), side["arm"][0], Y, 16)
                b0 = side["arm"][0]
                sweep(part("brake_cable", M["steel"]), [Vector((b0.x, b0.y * 0.75, b0.z)), b0], 4, segs=12)
                pad, inward, tang = side["pad"], side["inward"], vb["tangent"]
                box(part("brake_pads", M["black"]), pad, (8, abs(inward.y) * 1 + 10, 34), basis_from(vb["radial"], tang))
            sweep(part("brake_cable", M["steel"]), vb["noodle"], 3.2, segs=10)
            sweep(part("brake_cable", M["steel"]), [vb["noodle"][-1], vb["cable_end"]], 0.9, segs=6, caps=True)


def vbrakes(g, tubes, wheels):
    """V-brake bosses below the braking track on the fork blades and seatstays, arms rising past the tyre."""
    out = []
    mounts = []
    if "blade_left" in g["fork"]:
        mounts.append((wheels["front"], g["fork"]["blade_left"], g["fork"]["blade_od"]))
    mounts.append((wheels["rear"], list(reversed(tubes["seatstay left"]["centreline"])), tubes["seatstay left"]["od"]))
    for w, poly, od in mounts:
        ax = Vector(w["axle"])
        bsd = w["rim_bsd"] / 2
        tyre_r = w["outer_diameter"] / 2
        post, _ = point_at_distance(poly, ax, bsd - 28)
        if post is None:
            continue
        radial = (Vector((post.x, 0, post.z)) - Vector((ax.x, 0, ax.z))).normalized()
        tangent = Y.cross(radial).normalized()
        arm_len = tyre_r + 9 - (bsd - 28)
        arms = []
        for sgn in (1, -1):
            boss_p = Vector((post.x, sgn * (abs(post.y) + od / 2 + 8), post.z))
            top = boss_p + radial * arm_len
            top.y = sgn * max(w["tyre_width"] / 2 + 14, abs(boss_p.y) - 10)
            arm = [boss_p, boss_p + radial * 25 + Vector((0, -sgn * 2, 0)), boss_p + radial * (arm_len - 15), top]
            inward = Vector((0, -sgn * (abs(boss_p.y) - 16), 0))
            pad = boss_p + radial * 36 + inward / 2
            arms.append({"arm": arm, "top": top, "pad": pad, "inward": inward})
        lt, rt = arms[0]["top"], arms[1]["top"]
        noodle = catmull([lt + radial * 45 + Vector((0, 4, 0)), lt + radial * 12 + Vector((0, 2, 0)), lt + Vector((0, -10, 0))], 6)
        out.append({"arms": arms, "radial": radial, "tangent": tangent, "noodle": noodle, "cable_end": rt, "housing_start": noodle[0]})
    return out


def catmull(pts, n=8):
    pts = [Vector(p) for p in pts]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    res = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(n):
            t = k / n
            res.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    res.append(pts[-1])
    return res


def cockpit_controls(part, M, ck, clamp):
    """Bar, grips, V-brake levers and the twist shifter, from cockpit.bar_centreline, grips, brake_levers and shifter."""
    bar = [Vector(p) for p in ck["bar_centreline"]]
    grip_r = ck.get("bar_grip_dia", 22.2) / 2
    clamp_r = ck["bar"]["clamp_dia"] / 2
    clamp_half = abs(bar[1].y - clamp.y) if len(bar) > 2 else 40
    dense = []
    for a, b in zip(bar, bar[1:]):
        n = max(2, int((a - b).length / 10))
        dense += [a.lerp(b, k / n) for k in range(n)]
    dense.append(bar[-1])
    radii = []
    for p in dense:
        off = abs(p.y - clamp.y)
        t = min(1.0, max(0.0, (off - clamp_half) / 20))
        radii.append(clamp_r + (grip_r - clamp_r) * t)
    sweep(part("handlebar", M["alu"]), dense, 0, segs=24, radii=radii)
    ctrl = {}
    for gp in ck.get("grips", []):
        g0, g1 = Vector(gp["from"]), Vector(gp["to"])  # from = bar end
        d = (g0 - g1).normalized()
        r = gp["od"] / 2
        sweep(part("grips", M["black"]), [g1, g0 - d * 6], r, segs=24)
        sweep(part("grips", M["black"]), [g0 - d * 8, g0 + d * 2], r + 2, segs=24)
    for lv in ck.get("brake_levers", []):
        cc, pivot, tip = Vector(lv["clamp_centre"]), Vector(lv["pivot"]), Vector(lv["blade_tip"])
        d = Vector((0, 1 if tip.y > cc.y else -1, 0))
        w = lv.get("clamp_width", 20)
        lathe(part("brake_levers", M["black"]), disc_profile(grip_r, grip_r + 4, w), cc, Y, 24)
        fwd = (pivot - cc)
        fwd.y = 0
        body_len = fwd.length + 8
        fwd.normalize()
        box(part("brake_levers", M["black"]), cc + fwd * body_len / 2, (body_len, w, 20), Matrix((fwd, Y, fwd.cross(Y))).transposed())
        # adjuster barrel on the inboard side of the lever body, where the housing leaves
        barrel = cc + fwd * (body_len - 10) - d * (w / 2 + 6)
        lathe(part("brake_lever_blades", M["alu"]), disc_profile(0, 4, 12), barrel, Y, 16)
        bend = pivot + fwd * 12 + d * 18
        blade = catmull([pivot, bend, bend.lerp(tip, 0.5) + fwd * 2, tip], 6)
        sweep(part("brake_lever_blades", M["alu"]), blade, 0, segs=12, radii=[6 - 2.5 * i / (len(blade) - 1) for i in range(len(blade))])
        ctrl[("brake", lv["brake"])] = barrel - d * 6
    sh = ck.get("shifter")
    if sh:
        s0, s1 = Vector(sh["from"]), Vector(sh["to"])
        d = (s1 - s0).normalized()  # outboard end to inboard end
        r = sh["od"] / 2
        sweep(part("shifter", M["black"]), [s0, s1], r - 2, segs=24)
        n = 10
        for k in range(n):
            p = s0.lerp(s0.lerp(s1, 0.6), (k + 0.5) / n)
            lathe(part("shifter", M["black"]), disc_profile(r - 2, r, 2.5), p, d, 24)
        box(part("shifter", M["black"]), s1 - d * 8 + Vector((0, 0, -r - 4)), (30, 16, 14))
        lathe(part("shifter_paddle", M["alu"]), disc_profile(0, r - 1.5, 3), s0.lerp(s1, 0.75), d, 24)
        ctrl["shift"] = s1 + d * 2 + Vector((6, 0, -r - 8))
    return ctrl


def cables(part, M, g, tubes, controls, wheels):
    """Cable housings: left lever to the front brake, right lever to the rear brake, shifter to the hub."""
    if not controls:
        return
    ht = [Vector(p) for p in tubes["head tube"]["centreline"]]  # top, bottom
    ht_dir = (ht[1] - ht[0]).normalized()
    ht_fwd = Y.cross(ht_dir).normalized()
    if ht_fwd.x < 0:
        ht_fwd = -ht_fwd
    vbs = vbrakes(g, tubes, wheels) if g["accessories"].get("brakes") == "vbrake" else []
    housing = part("cables", M["black"])
    r = 2.6
    upper = tubes.get("top tube") or tubes["step tube"]
    ua, ub = (Vector(p) for p in upper["centreline"])  # rear end, front end
    top_off = Vector((0, 0, upper["od"] / 2 + r + 0.5))
    ht_r = tubes["head tube"]["od"] / 2

    def beside_ht(t, side, extra=0.0):
        return ht[0].lerp(ht[1], t) + Vector((0, side * (ht_r + 18 + extra), 0)) + ht_fwd * 6

    if vbs and controls.get(("brake", "front")):
        fb = vbs[0]
        lv = controls.get(("brake", "front"))
        hs = fb["housing_start"]
        pts = [lv, lv + Vector((15, 15, -50)), beside_ht(-0.1, -1), beside_ht(0.55, -1, 4) + ht_fwd * 10, ht[0].lerp(ht[1], 0.85) + ht_fwd * (ht_r + 30), beside_ht(1.0, 1, 10) + ht_fwd * 14, hs + fb["radial"] * 40, hs]
        sweep(housing, catmull(pts, 10), r, segs=10)
    if len(vbs) > 1 and controls.get(("brake", "rear")):
        rb = vbs[1]
        lv = controls[("brake", "rear")]
        ss = [Vector(p) for p in tubes["seatstay left"]["centreline"]]
        ss_dir = (ss[1] - ss[0]).normalized()
        ss_top = Vector((-ss_dir.z, 0, ss_dir.x)) * (tubes["seatstay left"]["od"] / 2 + r + 0.5)
        if ss_top.z < 0:
            ss_top = -ss_top
        hs = rb["housing_start"]
        pts = [lv, lv + Vector((15, -15, -50)), beside_ht(-0.1, 1, 4), beside_ht(0.3, 1, 4), ub + top_off + Vector((-45, 0, 0)), ub.lerp(ua, 0.5) + top_off, ua + top_off + Vector((25, 0, 0)), ss[1] + ss_top + Vector((0, 0, 4)), ss[1].lerp(ss[0], 0.35) + ss_top, hs + rb["radial"] * 30, hs]
        sweep(housing, catmull(pts, 10), r, segs=10)
    if "shift" in controls:
        lv = controls["shift"]
        dt = [Vector(p) for p in tubes["down tube"]["centreline"]]  # BB, head tube
        dt_dir = (dt[1] - dt[0]).normalized()
        dt_under = Vector((dt_dir.z, 0, -dt_dir.x)) * (tubes["down tube"]["od"] / 2 + r + 0.5)
        cs = [Vector(p) for p in tubes["chainstay right"]["centreline"]]  # dropout, BB
        cs_r = tubes["chainstay right"]["od"] / 2
        rear = wheels["rear"]
        hub = Vector(rear["axle"]) + Vector((22, -(rear["hub"].get("old", 130) / 2) + 8, 18))
        pts = [lv, lv + Vector((15, 20, -50)), beside_ht(-0.1, -1, 8), beside_ht(0.85, -1, 8), dt[1] - dt_dir * 90 + dt_under, dt[0] + dt_dir * 120 + dt_under, dt[0] + Vector((-25, -18, -38)), cs[1].lerp(cs[0], 0.25) + Vector((0, -cs_r - r, 4)), cs[1].lerp(cs[0], 0.85) + Vector((0, -cs_r - r, 4)), hub]
        sweep(housing, catmull(pts, 10), r, segs=10)


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
    lines = []
    for c in g.get("clearances", []):
        flag = "" if c.get("ok", True) else "  << NOT OK"
        lines.append(f"{c['what']}: {c['mm']} mm{flag}")
    gz = g["groundZ"]
    for w in g["wheels"]:
        gap = w["axle"][2] - w["outer_diameter"] / 2 - gz
        lines.append(f"{w['which']} tyre to ground plane: {gap:+.1f} mm")
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
