"""Slide-in battery pack, steel cradle and brace for the e-assist SA city bike.

Run headless from designs/sa-city-bike:
  blender -b --factory-startup -P blender/build_battery.py -- [--no-render] [--samples N] OUT_DIR SA_City_Bike_700C_eassist_geometry.json

Everything is placed from accessories.e_assist.battery and accessories.front_carrier_block, in the
bike's coordinates (origin at the BB, metres in the GLB), so battery.glb overlays the bike's GLB.

The pack (360 Wh, 36 V 10 Ah) is a 10S2P block of twenty 21700 cells in an aluminium extrusion
with glass-filled nylon end caps. It stands upright in the cradle, follows the head tube's lean,
and hangs on three pairs of T-head lugs on the slide base. To remove it: turn the key, which
retracts the lock bolt from the notch in the right cheek; slide the pack 50 mm up the lugs, which
parts the contacts; then pull it forward off the lugs through the open front of the cradle.

Writes into OUT_DIR:
  battery.glb / .blend            pack, slide base, cradle, brace, controller (bike coordinates)
  battery_on_bike.glb / .blend    the e-assist bike with all of the above
  battery_report.txt              fit checks and nearest bike parts
  battery_front34.png, battery_rear34.png, battery_side.png, battery_exploded.png,
  battery_pack_back.png, battery_cutaway.png,
  battery_on_bike_front34.png, battery_on_bike_left34.png, battery_on_bike_side.png
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
Part, lathe, sweep, material = bb["Part"], bb["lathe"], bb["sweep"], bb["material"]
S = bb["S"]
FX, FY, FZ = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

SLIDE = 50  # travel up the lugs that parts the contacts and frees the pack
LUG_Y = 22  # lug rows either side of the centreline
# Pack build-up, as in pack.build_up: 21700 cells across the bike, 4 deep x 5 high
CELL_D, CELL_L, CELL_PITCH = 21.7, 70.8, 22.2
CORE_W = 74.5  # cells, holders and nickel across the bike
SERIES, PARALLEL = 10, 2
CELL_AH, CELL_V, CELL_G = 5.0, 3.6, 69
WALL, WRAP, FOAM = 2.5, 1.0, 1.5
BMS_ZONE = 12  # BMS and leads between the back wall and the core
LOCK_ZONE, TOP_CAP = 18, 12  # lock and contacts under the core; bail and gauge in the top cap


def disc(r, w):
    return [(0, 0), (r, 0), (r, w), (0, w)]


# ---------------------------------------------------------------- local-frame building


class Frame:
    """Local frame of the e-assist boxes: f forward (depth), y left (width), u up (height), origin at the carrier block centre."""

    def __init__(self, e, cb):
        self.F = Vector((e["forward_xz"][0], 0, e["forward_xz"][1])).normalized()
        self.U = Vector((e["up_xz"][0], 0, e["up_xz"][1])).normalized()
        self.C = Vector(cb["carrier_block"]["centre"])
        self.R = Matrix((self.F, FY, self.U)).transposed()
        self.W = Matrix.Translation(self.C) @ self.R.to_4x4()

    def loc(self, p):
        v = Vector(p) - self.C
        return Vector((v.dot(self.F), v.y, v.dot(self.U)))

    def world(self, p):
        return self.W @ Vector(p)


class Kit:
    """Parts built in the local frame (mm); finish() moves them to the bike's frame in metres."""

    def __init__(self, fr):
        self.fr, self.parts, self.cutters = fr, {}, {}

    def part(self, name, mat, smooth=True):
        if name not in self.parts:
            self.parts[name] = Part(name, mat, smooth)
        return self.parts[name]

    def cut(self, target, name):
        key = (target, name)
        if key not in self.cutters:
            self.cutters[key] = Part(f"cut_{target}_{name}", self.parts[target].mat if name == "same" else CUTMAT[0])
        return self.cutters[key]

    def finish(self, col):
        obs = {}
        for name, p in self.parts.items():
            bmesh.ops.transform(p.bm, matrix=self.fr.W, verts=p.bm.verts)
            obs[name] = p.finish(col)
        for (target, name), p in self.cutters.items():
            bmesh.ops.transform(p.bm, matrix=self.fr.W, verts=p.bm.verts)
            c = p.finish(col)
            ob = obs[target]
            m = ob.modifiers.new(name, "BOOLEAN")
            m.object, m.operation, m.solver = c, "DIFFERENCE", "EXACT"
            m.material_mode = "TRANSFER"
            c.hide_render = True
        dg = bpy.context.evaluated_depsgraph_get()
        for ob in obs.values():
            if ob.modifiers:
                me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
                ob.modifiers.clear()
                old = ob.data
                ob.data = me
                bpy.data.meshes.remove(old)
                me.name = ob.name
                for f in me.polygons:
                    f.use_smooth = True
                me.set_sharp_from_angle(angle=math.radians(35))
        for p in list(bpy.data.objects):
            if p.name.startswith("cut_"):
                bpy.data.objects.remove(p)
        return obs


CUTMAT = [None]


def block(part, lo, hi, radius=0.0, along=None, segs=4):
    """Box from lo to hi in the local frame; edges rounded by radius (all, or only those parallel to `along`)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    lo, hi = Vector(lo), Vector(hi)
    size = hi - lo
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=(lo + hi) / 2, verts=bm.verts)
    if radius > 0:
        edges = bm.edges[:]
        if along is not None:
            a = Vector(along)
            edges = [e for e in edges if abs((e.verts[1].co - e.verts[0].co).normalized().dot(a)) > 0.99]
        r = min(radius, min(size) / 2 - 0.01)
        bmesh.ops.bevel(bm, geom=edges, offset=r, segments=segs, affect="EDGES", profile=0.5)
    me = bpy.data.meshes.new("tmp")
    bm.to_mesh(me)
    bm.free()
    part.bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def slab(part, outline_fu, y0, y1):
    """Extrude a closed outline in the (f, u) plane between y0 and y1."""
    bm = part.bm
    a = [bm.verts.new((f, y0, u)) for f, u in outline_fu]
    b = [bm.verts.new((f, y1, u)) for f, u in outline_fu]
    n = len(a)
    bm.faces.new(list(reversed(a)))
    bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))


def flatbar(part, pts, width, thick):
    """Flat bar along a polyline in the (f, u) plane; width lies along y."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        nrm = t.cross(FY).normalized()
        rings.append([part.bm.verts.new(p + a * width / 2 * FY + b * thick / 2 * nrm) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(4):
            part.bm.faces.new((r0[k], r0[(k + 1) % 4], r1[(k + 1) % 4], r1[k]))
    part.bm.faces.new(list(reversed(rings[0])))
    part.bm.faces.new(rings[-1])


def fillet(a, corner, b, r, n=6):
    """Points rounding the corner between segments a-corner and corner-b."""
    a, corner, b = Vector(a), Vector(corner), Vector(b)
    da, db = (a - corner).normalized(), (b - corner).normalized()
    p0, p1 = corner + da * r, corner + db * r
    return [((1 - t) ** 2) * p0 + 2 * (1 - t) * t * corner + t * t * p1 for t in (k / n for k in range(n + 1))]


def shell(kit, name, mat, lo, hi, t, radius):
    """Hollow box: lo..hi with walls t thick."""
    block(kit.part(name, mat), lo, hi, radius)
    block(kit.cut(name, "same"), Vector(lo) + Vector((t, t, t)), Vector(hi) - Vector((t, t, t)), max(radius - t, 0.5))


def rotate_verts(bm, verts, pivot, axis, deg):
    M = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-Vector(pivot))
    bmesh.ops.transform(bm, matrix=M, verts=verts)


# ---------------------------------------------------------------- materials


def mats(g):
    paint = g["frame"]["paint"]
    return {
        "case": material("bat_case", "#3a3e44", 0.85, 0.32),
        "cap": material("bat_cap", "#17181a", 0.0, 0.55),
        "accent": material("bat_accent", paint["accent"], 0.0, 0.35),
        "recess": material("bat_recess", "#0c0c0d", 0.0, 0.7),
        "rubber": material("bat_rubber", "#1c1c1c", 0.0, 0.85),
        "brass": material("bat_brass", "#c9a24a", 1.0, 0.3),
        "steel": material("steel", "#c9ccd1", 1.0, 0.25),
        "cradle": material("paint_main", paint["main"], 0.0, 0.25, 0.8),
        "head": material("paint_head_tube", paint["head_tube"], 0.0, 0.25, 0.8),
        "black": material("black_plastic", "#1a1a1a", 0.0, 0.55),
        "base": material("bat_base", "#232427", 0.0, 0.5),
        "alu": material("alu_satin", "#b7bbc1", 1.0, 0.4),
        "label": material("bat_label", "#e6e6e6", 0.0, 0.4),
        "led": material("bat_led", "#39d353", 0.0, 0.3),
        "cell": material("bat_cell", "#2f6fb5", 0.0, 0.35),
        "cell_end": material("bat_cell_end", "#8e9196", 1.0, 0.35),
        "wrap": material("bat_fishpaper", "#c9b98c", 0.0, 0.7),
        "foam": material("bat_eva_foam", "#4b5057", 0.0, 0.95),
        "holder": material("bat_holder", "#2a2a2a", 0.0, 0.6),
        "nickel": material("bat_nickel", "#a9adb2", 1.0, 0.35),
        "pcb": material("bat_pcb", "#1f6b3a", 0.0, 0.45),
        "chip": material("bat_chip", "#111111", 0.0, 0.4),
        "wire_red": material("bat_wire_red", "#b3261e", 0.0, 0.5),
        "wire_black": material("bat_wire_black", "#111111", 0.0, 0.5),
    }


# ---------------------------------------------------------------- the build


def dims(g):
    e = g["accessories"]["e_assist"]
    cb = g["accessories"]["front_carrier_block"]
    fr = Frame(e, cb)
    bat = e["battery"]

    def boxdims(d):
        c = fr.loc(d["centre"])
        return {"c": c, "f0": c.x - d["depth"] / 2, "f1": c.x + d["depth"] / 2, "u0": c.z - d["height"] / 2, "u1": c.z + d["height"] / 2, "hw": d["width"] / 2, "d": d}

    D = {
        "fr": fr,
        "e": e,
        "cb": cb,
        "bat": bat,
        "blk": boxdims(cb["carrier_block"]),
        "cr": boxdims(bat["cradle"]),
        "base": boxdims(bat["slide_base"]),
        "pk": boxdims(bat["pack"]),
        "ctl": boxdims(bat["controller"]),
        "lock": fr.loc(bat["key_lock"]),
        "port_json": fr.loc(bat["charge_port"]),
    }
    pk = D["pk"]
    # The charge port sits in the BMS zone behind the cells (the JSON point is over the cell ends), above the cheeks.
    D["port"] = Vector((pk["f0"] + WALL + 7.5, pk["hw"], pk["u1"] - 28.5))
    D["ctl"]["c"].y = bat["controller"]["centre"][1]
    return D


def build_battery(g, M, key_in=True, flap_open=False, bail_up=False, with_block=True):
    """Return ({group: Kit}, dims). Groups: pack, internals, mount (base, cradle, brace, controller), block."""
    D = dims(g)
    fr = D["fr"]
    pk, base, cr, blk = D["pk"], D["base"], D["cr"], D["blk"]
    kits = {k: Kit(fr) for k in ("pack", "internals", "mount", "block")}
    CUTMAT[0] = M["recess"]
    P, I, Mt, B = kits["pack"], kits["internals"], kits["mount"], kits["block"]
    p0, p1, u0, u1, hw = pk["f0"], pk["f1"], pk["u0"], pk["u1"], pk["hw"]
    R = 7  # case corner radius
    ub, ut = u0 + LOCK_ZONE, u1 - TOP_CAP  # extrusion body runs ub..ut

    # ---- case: extrusion body, end caps, accent band
    block(P.part("pack_case", M["case"]), (p0, -hw, ub), (p1, hw, ut), R, along=FZ)
    block(P.part("pack_caps", M["cap"]), (p0, -hw, u0), (p1, hw, ub + 0.5), R, segs=5)
    block(P.part("pack_caps", M["cap"]), (p0, -hw, ut - 0.5), (p1, hw, u1), R, segs=5)
    block(P.part("pack_accent", M["accent"]), (p0 - 0.4, -hw - 0.4, ut - 6), (p1 + 0.4, hw + 0.4, ut - 3), R + 0.4, along=FZ)
    for side in (1, -1):  # extrusion grooves along the sides
        for f in (p0 + 30, p1 - 22):
            y = side * hw
            block(P.cut("pack_case", "grooves"), (f - 1.2, y - 1.0, ub + 8), (f + 1.2, y + 1.0, ut - 10))

    # ---- fold-down carry bail in a recess in the top cap
    bf0, bf1, bwy = p0 + 30, p1 - 12, 36
    block(P.cut("pack_caps", "bail_recess"), (bf0 - 6, -bwy - 6, u1 - 4.5), (bf1 + 5, bwy + 6, u1 + 1), 3)
    bail = P.part("pack_bail", M["steel"])
    pivot_u = u1 - 2.5
    pts = [Vector((bf0, -bwy, pivot_u))] + fillet((bf0, -bwy, pivot_u), (bf1, -bwy, pivot_u), (bf1, bwy, pivot_u), 9) + fillet((bf1, -bwy, pivot_u), (bf1, bwy, pivot_u), (bf0, bwy, pivot_u), 9) + [Vector((bf0, bwy, pivot_u))]
    before = set(bail.bm.verts)
    sweep(bail, pts, 2.5, segs=12)
    grip = P.part("pack_bail_grip", M["rubber"])
    gbefore = set(grip.bm.verts)
    sweep(grip, [(bf1, -bwy + 12, pivot_u), (bf1, bwy - 12, pivot_u)], 4.2, segs=16)
    for y in (-bwy, bwy):
        lathe(P.part("pack_bail_pivots", M["black"]), disc(5, 4), Vector((bf0, y - 2 if y > 0 else y - 2, pivot_u)), FY, 20)
    if bail_up:
        rotate_verts(bail.bm, [v for v in bail.bm.verts if v not in before], Vector((bf0, 0, pivot_u)), FY, -80)
        rotate_verts(grip.bm, [v for v in grip.bm.verts if v not in gbefore], Vector((bf0, 0, pivot_u)), FY, -80)

    # ---- back: two pairs of T-head lug slots, each with an entry window SLIDE above its lug
    lug_us = [u0 + 20, u0 + 80]
    for s in (1, -1):
        y = s * LUG_Y
        top = lug_us[-1] + SLIDE + 7.5
        block(P.cut("pack_case", "slots"), (p0 - 1, y - 4.5, lug_us[0] - 9), (p0 + 3.2, y + 4.5, top))
        block(P.cut("pack_case", "undercut"), (p0 + 3, y - 7, lug_us[0] - 9), (p0 + 6.5, y + 7, top))
        for lu in lug_us:
            block(P.cut("pack_case", "entries"), (p0 - 1, y - 7, lu + SLIDE - 7.5), (p0 + 6.5, y + 7, lu + SLIDE + 7.5), 2)
        block(P.cut("pack_caps", "slots"), (p0 - 1, y - 4.5, lug_us[0] - 9), (p0 + 3.2, y + 4.5, ub + 1))
        block(P.cut("pack_caps", "undercut"), (p0 + 3, y - 7, lug_us[0] - 9), (p0 + 6.5, y + 7, ub + 1))

    # ---- contacts: pocket in the bottom cap, open at the back and bottom, three brass sockets
    cp_top = u0 + 15
    block(P.cut("pack_caps", "contacts"), (p0 - 1, -16, u0 - 1), (p0 + 14, 16, cp_top), 1.5)
    for y in (-9, 0, 9):
        block(P.part("pack_contacts", M["brass"]), (p0 + 3.5, y - 3.5, cp_top - 3), (p0 + 8.5, y + 3.5, cp_top))
        block(P.part("pack_contacts", M["recess"]), (p0 + 5.2, y - 2.6, cp_top - 3.2), (p0 + 6.8, y + 2.6, cp_top - 2.5))

    # ---- key lock in the bottom zone, right side; its bolt engages the right cheek's notch
    lk = D["lock"]
    ly = -hw
    lathe(P.part("pack_lock", M["steel"]), disc(9, 1.6), Vector((lk.x, ly, lk.z)), -FY, 40)
    lathe(P.part("pack_lock", M["steel"]), disc(6.5, 2.2), Vector((lk.x, ly, lk.z)), -FY, 40)
    block(P.part("pack_lock", M["recess"]), (lk.x - 0.8, ly - 2.4, lk.z - 4), (lk.x + 0.8, ly - 2.0, lk.z + 4))
    block(P.part("pack_lock_bolt", M["steel"]), (lk.x - 4, ly + 1, lk.z + 10), (lk.x + 4, lk.y + 0.5, lk.z + 14), 0.8)
    if key_in:
        kp = P.part("pack_key", M["steel"])
        block(kp, (lk.x - 0.9, ly - 9, lk.z - 3.5), (lk.x + 0.9, ly - 2, lk.z + 3.5))
        block(P.part("pack_key_bow", M["black"]), (lk.x - 2.5, ly - 30, lk.z - 12), (lk.x + 2.5, ly - 9, lk.z + 12), 5)
        lathe(P.part("pack_key", M["steel"]), [(3.2, 0), (5.5, 0), (5.5, 5), (3.2, 5)], Vector((lk.x - 2.5, ly - 24, lk.z + 6)), FX, 24)

    # ---- charge port: left side, in the BMS zone behind the cells, above the cheek
    pt = D["port"]
    py = hw
    lathe(P.cut("pack_case", "port"), disc(6, 9), Vector((pt.x, py + 1, pt.z)), -FY, 32)
    lathe(P.part("pack_port", M["rubber"]), [(6, 0), (8.5, 0), (8.5, 1.6), (6, 1.6)], Vector((pt.x, py, pt.z)), FY, 32)
    lathe(P.part("pack_port", M["black"]), disc(5, 2), Vector((pt.x, py - 7, pt.z)), FY, 32)
    for k in range(3):
        a = math.radians(90 + 120 * k)
        lathe(P.part("pack_port_pins", M["brass"]), disc(0.9, 3.5), Vector((pt.x + 2.6 * math.cos(a), py - 5, pt.z + 2.6 * math.sin(a))), FY, 12)
    flap = P.part("pack_port_flap", M["rubber"])
    before = set(flap.bm.verts)
    lathe(flap, disc(8.5, 2), Vector((pt.x, py + 1.6, pt.z)), FY, 32)
    block(flap, (pt.x - 3.5, py + 1.6, pt.z + 7), (pt.x + 3.5, py + 3.6, pt.z + 12), 1)
    if flap_open:
        rotate_verts(flap.bm, [v for v in flap.bm.verts if v not in before], Vector((pt.x, py + 1.6, pt.z + 11)), FX, 105)

    # ---- charge gauge and button on the top cap, behind the bail, over the BMS
    for i in range(5):
        lathe(P.part("pack_gauge", M["led"] if i < 4 else M["black"]), disc(1.7, 0.6), Vector((p0 + 13, -26 + 7 * i, u1)), FZ, 16)
    lathe(P.part("pack_gauge", M["black"]), disc(4.2, 1.0), Vector((p0 + 13, 22, u1)), FZ, 24)
    lathe(P.part("pack_gauge", M["label"]), disc(2, 1.2), Vector((p0 + 13, 22, u1)), FZ, 16)

    # ---- internals: 10S2P of 21700 lying across the bike, BMS on the back face, wrap and foam around the core
    core_f0 = p0 + WALL + BMS_ZONE + WRAP + FOAM
    core_u0 = u0 + LOCK_ZONE + WALL + WRAP + FOAM
    core = (core_f0, core_f0 + 4 * CELL_PITCH, core_u0, core_u0 + 5 * CELL_PITCH)
    cy = CORE_W / 2
    cols_f = [core[0] + CELL_PITCH * (i + 0.5) for i in range(4)]
    rows_u = [core[2] + CELL_PITCH * (j + 0.5) for j in range(5)]
    for f in cols_f:
        for u in rows_u:
            c = Vector((f, -CELL_L / 2, u))
            lathe(I.part("cells", M["cell"]), [(CELL_D / 2 - 0.5, 0), (CELL_D / 2, 0.6), (CELL_D / 2, CELL_L - 0.6), (CELL_D / 2 - 0.5, CELL_L)], c, FY, 28, closed=False)
            lathe(I.part("cell_ends", M["cell_end"]), disc(CELL_D / 2 - 0.5, 0.3), c - FY * 0.3, FY, 24)
            lathe(I.part("cell_ends", M["cell_end"]), disc(CELL_D / 2 - 0.5, 0.3), c + FY * CELL_L, FY, 24)
    for f in cols_f:  # holder collars over both ends of every cell
        for u in rows_u:
            for sgn in (1, -1):
                lathe(I.part("cell_holders", M["holder"]), [(CELL_D / 2 - 1.2, 0), (CELL_D / 2 + 0.55, 0), (CELL_D / 2 + 0.55, 6), (CELL_D / 2 - 1.2, 6)], Vector((f, sgn * (cy - 6.6), u)), FY, 28)
    for sgn in (1, -1):  # nickel: each parallel pair (same row, columns 2i and 2i+1) joined, then to the next row in series
        ys = sgn * (cy - 0.6)
        for i in (0, 2):
            for j in range(5):
                block(I.part("nickel", M["nickel"]), (cols_f[i] - 3.5, ys - 0.3, rows_u[j] - 3.5), (cols_f[i + 1] + 3.5, ys + 0.3, rows_u[j] + 3.5))
                if j < 4 and (j % 2 == (0 if sgn > 0 else 1)):
                    block(I.part("nickel", M["nickel"]), (cols_f[i] + 4, ys - 0.3 + sgn * 0.5, rows_u[j]), (cols_f[i] + 11, ys + 0.3 + sgn * 0.5, rows_u[j + 1]))
    shell(I, "wrap", M["wrap"], (core[0] - WRAP, -cy - WRAP, core[2] - WRAP), (core[1] + WRAP, cy + WRAP, core[3] + WRAP), WRAP, 1)
    shell(I, "foam", M["foam"], (core[0] - WRAP - FOAM, -cy - WRAP - FOAM, core[2] - WRAP - FOAM), (core[1] + WRAP + FOAM, cy + WRAP + FOAM, core[3] + WRAP + FOAM), FOAM, 2.5)
    bms_f0 = p0 + WALL + BMS_ZONE - 8
    bms_u = (core[2] + 8, core[2] + 8 + 60)
    block(I.part("bms", M["pcb"]), (bms_f0 + 6.4, -22.5, bms_u[0]), (bms_f0 + 8, 22.5, bms_u[1]), 1)
    for k in range(5):
        block(I.part("bms_parts", M["chip"]), (bms_f0 + 1.5, -18 + 8 * k, bms_u[0] + 6), (bms_f0 + 6.4, -13 + 8 * k, bms_u[0] + 14))
    for k in range(3):
        block(I.part("bms_parts", M["alu"]), (bms_f0 + 0.5, -16 + 12 * k, bms_u[0] + 22), (bms_f0 + 6.4, -8 + 12 * k, bms_u[0] + 44))
    block(I.part("bms_parts", M["chip"]), (bms_f0 + 3, -12, bms_u[1] - 9), (bms_f0 + 6.4, 12, bms_u[1] - 3))
    lead_f = bms_f0 + 9.5
    sweep(I.part("wire_pos", M["wire_red"]), [(core[0] - 1, cy - 2, core[3] - 4), (lead_f, cy - 6, core[3] - 6), (lead_f, 18, bms_u[1] - 4)], 2.2, segs=10)
    sweep(I.part("wire_neg", M["wire_black"]), [(core[0] - 1, -cy + 2, core[2] + 4), (lead_f, -cy + 6, core[2] + 2), (lead_f, -18, bms_u[0] + 4)], 2.2, segs=10)
    sweep(I.part("wire_pos", M["wire_red"]), [(bms_f0 + 3, 9, bms_u[0]), (bms_f0 + 3, 9, u0 + 20), (p0 + 9, 9, cp_top + 1)], 2.2, segs=10)
    sweep(I.part("wire_neg", M["wire_black"]), [(bms_f0 + 3, -9, bms_u[0]), (bms_f0 + 3, -9, u0 + 20), (p0 + 9, -9, cp_top + 1)], 2.2, segs=10)
    sweep(I.part("wire_pos", M["wire_red"]), [(pt.x, py - 8, pt.z), (pt.x, 28, pt.z - 2), (bms_f0 + 4, 20, bms_u[1] - 2)], 1.4, segs=8)
    for k in range(11):  # balance ribbon from the strips to the BMS
        sweep(I.part("balance", M["wire_black"] if k % 2 else M["label"]), [(core[0] - 1.5, -30 + 6 * k, core[2] + 3 + 9 * k), (lead_f - 2, -30 + 6 * k, bms_u[1] - 6), (bms_f0 + 6, -10 + 2 * k, bms_u[1] - 6)], 0.6, segs=6)
    D["core"] = core
    D["lugs"] = lug_us

    # ---- slide base: nylon plate, T-head lugs, contact block
    b0, b1 = base["f0"], base["f1"]
    block(Mt.part("slide_base", M["base"]), (b0, -base["hw"], base["u0"]), (b1 - 2, base["hw"], base["u1"]), 4)
    for s in (1, -1):
        for lu in lug_us:
            c = Vector((b1 - 2, s * LUG_Y, lu))
            lathe(Mt.part("slide_lugs", M["steel"]), disc(3.5, 3.5), c, FX, 24)
            lathe(Mt.part("slide_lugs", M["steel"]), [(0, 0), (6, 0), (6, 2), (4.6, 3.2), (0, 3.2)], c + FX * 3.5, FX, 24)
    block(Mt.part("slide_contacts", M["base"]), (b1 - 3, -15, u0 + 0.5), (p0 + 12.5, 15, cp_top - 9), 1.5)
    for y in (-9, 0, 9):
        block(Mt.part("slide_contacts_blades", M["brass"]), (p0 + 4.8, y - 2.6, cp_top - 9.5), (p0 + 7.2, y + 2.6, cp_top - 0.8), 0.3)

    # ---- cradle: back plate with a hook over the block, floor, side cheeks; brace to the head tube boss
    t = cr["d"]["plate"]
    c0, c1, cu0, cu1, chw = cr["f0"], cr["f1"], cr["u0"], cr["u1"], cr["hw"]
    cp = Mt.part("cradle", M["cradle"])
    block(cp, (c0, -chw, cu0), (c0 + t, chw, cu1), 1.5)
    block(cp, (c0, -chw, cu0), (c1, chw, cu0 + t), 1.5)
    blk_top = blk["u1"]
    block(cp, (blk["f0"] + 6, -24, blk_top), (c0 + 1, 24, blk_top + t), 1.5)  # hook resting on the block's top
    block(cp, (blk["f0"] + 6, -24, blk_top - 8), (blk["f0"] + 6 + t, 24, blk_top + t), 1.0)  # lip down the block's back
    rnd = 18
    for s in (1, -1):
        y0, y1 = (chw - t, chw) if s > 0 else (-chw, -chw + t)
        out = [(c0 + t, cu0 + t), (c1, cu0 + t)]
        if s < 0:
            nu0, nu1 = lk.z - 13, lk.z + 18
            out += [(c1, nu0), (lk.x - 13, nu0), (lk.x - 13, nu1), (c1, nu1)]
        out += [(c1, cu1 - rnd)]
        out += [(c1 - rnd + rnd * math.cos(math.radians(a)), cu1 - rnd + rnd * math.sin(math.radians(a))) for a in range(10, 91, 10)]
        out += [(c0 + t, cu1)]
        slab(cp, out, y0, y1)
    for f in (c0 + 18, c1 - 14):  # rubber pads under the pack
        block(Mt.part("cradle_pads", M["rubber"]), (f - 8, -35, cu0 + t), (f + 8, 35, u0), 1)
    for y in (-20, 20):  # countersunk M5 into the carrier block, flush in the plate's front
        for u in (-18, 18):
            lathe(Mt.part("cradle_screws", M["steel"]), disc(4.8, 0.3), Vector((c0 + t, y, u)), FX, 20)
            block(Mt.part("cradle_screws", M["recess"]), (c0 + t + 0.1, y - 1.6, u - 1.6), (c0 + t + 0.4, y + 1.6, u + 1.6))
    for y in (-20, 20):  # base screws' heads on the back of the plate, above and below the block
        for u in (base["u0"] + 6, blk["u1"] + 15):
            lathe(Mt.part("cradle_screws", M["steel"]), [(0, 0), (4.8, 0), (4.8, 1.2), (3.4, 2.8), (0, 2.8)], Vector((c0, y, u)), -FX, 20)

    # brace: 20 x 4 flat, L-bent: a tab bolted to the head tube boss, then forward under the cradle floor
    br = D["bat"]["brace"]
    ht = next(tb for tb in g["frame"]["tubes"] if tb["name"].startswith("head tube"))
    ha, hb = (fr.loc(p) for p in ht["centreline"])
    boss = fr.loc(br["boss"])
    axis = (hb - ha).normalized()
    foot = ha + axis * (boss - ha).dot(axis)
    n = (boss - foot).normalized()
    lathe(Mt.part("brace_boss", M["head"]), disc(6, (boss - foot).length - ht["od"] / 2 + 1.5), foot + n * (ht["od"] / 2 - 1.5), n, 24)
    ub_ = cu0 - 2
    tab_f = boss.x + 2
    end = fr.loc(br["from"])
    pts = [Vector((tab_f, 0, boss.z + 10))]
    pts += fillet((tab_f, 0, boss.z), (tab_f, 0, ub_), (end.x, 0, ub_), 7)
    pts += [Vector((end.x + 12, 0, ub_))]
    flatbar(Mt.part("brace", M["cradle"]), pts, 20, 4)
    lathe(Mt.part("brace_bolts", M["steel"]), [(0, 0), (4.3, 0), (4.3, 3.5), (0, 3.5)], Vector((tab_f + 2, 0, boss.z)), FX, 6)
    lathe(Mt.part("brace_bolts", M["steel"]), [(0, 0), (4.6, 0), (4.6, 4), (0, 4)], Vector((end.x, 0, ub_ - 2)), -FZ, 6)
    lathe(Mt.part("brace_bolts", M["steel"]), disc(4.8, 0.3), Vector((end.x, 0, cu0 + t)), FZ, 20)

    # controller: finned aluminium box on spacer tabs behind the plate's right wing
    ct = D["ctl"]
    cc, cd = ct["c"], ct["d"]
    cy0, cy1 = cc.y - cd["width"] / 2, cc.y + cd["width"] / 2
    block(Mt.part("controller", M["alu"]), (ct["f0"], cy0 + 4, ct["u0"]), (ct["f1"], cy1, ct["u1"]), 3)
    for k in range(6):
        f = ct["f0"] + 5 + k * (cd["depth"] - 10) / 5
        block(Mt.part("controller", M["alu"]), (f - 0.8, cy0, ct["u0"] + 6), (f + 0.8, cy0 + 4.5, ct["u1"] - 6))
    for u in (ct["u0"] + 15, ct["u1"] - 15):
        block(Mt.part("controller_tabs", M["steel"]), (ct["f1"] - 1, cc.y, u - 6), (c0, cc.y + 12, u + 6))
    for k, f in enumerate((ct["f0"] + 10, cc.x, ct["f1"] - 10)):
        lathe(Mt.part("controller_glands", M["black"]), [(0, 0), (4.5, 0), (4.5, 6), (3.5, 9), (0, 9)], Vector((f, cc.y, ct["u0"])), -FZ, 16)
    sweep(Mt.part("battery_lead", M["wire_black"]), [(b0 + 2, -8, base["u0"] + 14), (c0 - 3, -14, base["u0"] + 14), (c0 - 10, -30, base["u0"] + 12), (cc.x, cc.y, ct["u0"] - 9)], 3, segs=10)

    # headlight: the JSON point is on the cradle floor's front lip; the lamp hangs below it, clear of the pack
    hl = fr.loc(D["bat"]["headlight"])
    xl = fr.R.transposed() @ FX
    lamp_c = Vector((hl.x, 0, cu0 - 22))
    block(Mt.part("headlight_bracket", M["cradle"]), (hl.x - 12, -10, cu0 - 10), (hl.x + 4, 10, cu0), 1)
    lathe(Mt.part("headlight", M["black"]), [(0, -16), (11, -16), (14, -10), (14, 12), (0, 12)], lamp_c + Vector((0, 0, 4)), xl, 32)
    lathe(Mt.part("headlight_lens", M["label"]), [(0, 0), (12, 0), (12, 2), (0, 3)], lamp_c + Vector((0, 0, 4)) + xl * 12, xl, 32)
    D["lamp"] = lamp_c

    # carrier block and its brazed mount block (the bike builds these itself)
    if with_block:
        mb = D["cb"]["mount_block"]
        m = fr.loc(mb["centre"])
        block(B.part("mount_block", M["head"]), (m.x - mb["depth"] / 2, -mb["width"] / 2, m.z - mb["alongHT"] / 2), (m.x + mb["depth"] / 2, mb["width"] / 2, m.z + mb["alongHT"] / 2), 1)
        block(B.part("carrier_block", M["black"]), (blk["f0"], -blk["hw"], blk["u0"]), (blk["f1"], blk["hw"], blk["u1"]), 3)
        sweep(B.part("head_tube", M["head"]), [ha, hb], ht["od"] / 2, segs=40)
    return kits, D


def finish(kits, col, groups=None):
    out = {}
    for name, kit in kits.items():
        if groups and name not in groups:
            continue
        out[name] = list(kit.finish(col).values())
    return out


# ---------------------------------------------------------------- checks


def bvh(obs):
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for ob in obs:
        me = ob.evaluated_get(dg).to_mesh()
        off = len(verts)
        verts += [ob.matrix_world @ v.co for v in me.vertices]
        polys += [[off + i for i in p.vertices] for p in me.polygons]
        ob.evaluated_get(dg).to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys), verts


def nearest(a_obs, b_ob):
    tree, _ = bvh([b_ob])
    _, verts = bvh(a_obs)
    best = 1e9
    for v in verts:
        hit = tree.find_nearest(v)
        if hit[0] is not None:
            best = min(best, hit[3])
    return best / S


def report(D, g):
    pk, cr, base = D["pk"], D["cr"], D["base"]
    f0, f1, u0c, u1c = D["core"]
    wh = SERIES * CELL_V * PARALLEL * CELL_AH
    pj, pt = D["port_json"], D["port"]
    return [
        f"Pack {pk['d']['depth']} D x {pk['d']['width']} W x {pk['d']['height']} H mm; {SERIES}S{PARALLEL}P 21700 {CELL_AH} Ah = "
        f"{SERIES * CELL_V:.0f} V {PARALLEL * CELL_AH:.0f} Ah {wh:.0f} Wh (spec {pk['d']['volts']} V {pk['d']['wh']} Wh)",
        f"Cells {SERIES * PARALLEL} x {CELL_G} g = {SERIES * PARALLEL * CELL_G / 1000:.2f} kg (spec pack {pk['d']['kg']} kg)",
        f"Core {f1 - f0:.1f} D x {CORE_W} W x {u1c - u0c:.1f} H mm",
        f"Behind the core: {f0 - pk['f0']:.1f} mm (wall {WALL} + BMS {BMS_ZONE} + wrap {WRAP} + foam {FOAM}); in front: {pk['f1'] - f1:.1f} mm",
        f"Across: {pk['hw'] - CORE_W / 2:.1f} mm a side (wrap, foam, wall)",
        f"Under the core: {u0c - pk['u0']:.1f} mm (lock and contacts {LOCK_ZONE} + {WALL + WRAP + FOAM}); above: {pk['u1'] - u1c:.1f} mm (top cap {TOP_CAP} + {WALL + WRAP + FOAM})",
        f"Pack back to slide base front: {pk['f0'] - base['f1']:.1f} mm",
        f"Pack bottom above cradle floor: {pk['u0'] - (cr['u0'] + cr['d']['plate']):.1f} mm (rubber pads)",
        f"Play between the cradle cheeks: {2 * (cr['hw'] - cr['d']['plate']) - 2 * pk['hw']:.1f} mm",
        f"Cheeks stop {pk['u1'] - cr['u1']:.1f} mm below the pack top; pack overhangs the cradle floor by {pk['f1'] - cr['f1']:.1f} mm",
        f"Cradle back plate to carrier block front face: {cr['f0'] - D['blk']['f1']:.1f} mm",
        f"Charge port moved from the JSON point (over the cell ends, {pj.x - pk['f0']:.0f} mm from the pack back) to the BMS zone, "
        f"{pt.x - pk['f0']:.0f} mm from the back and {pk['u1'] - pt.z:.0f} mm below the top",
        f"Headlight hangs {D['bat']['headlight'] and (cr['u0'] - D['lamp'].z):.0f} mm below the cradle floor's front lip, clear of the pack",
    ]


# ---------------------------------------------------------------- scenes


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


def render(scene, cam, path):
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"  rendered {path}")


def export(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_lights=False, export_cameras=False, export_apply=True)


def cycles(scene, samples, res):
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
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.view_settings.view_transform = "Standard"


def studio(scene, floor_z, target):
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, floor_z))
    bpy.context.active_object.name = "floor"
    bpy.context.active_object.data.materials.append(material("studio_floor", "#bdbab4", 0.0, 0.9))
    world = bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.64, 0.68, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.5
    for name, off, e, size in (("key", (1.2, -1.3, 1.1), 38, 1.2), ("fill", (-1.3, 1.1, 0.8), 18, 1.6), ("rim", (-0.5, 1.4, 1.3), 25, 1.0), ("front", (1.4, 0.6, 0.5), 14, 1.2)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size = e, size
        ob = bpy.data.objects.new(name, ld)
        ob.location = target + Vector(off)
        ob.rotation_euler = (target - ob.location).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(ob)


def section(objs, fr, lo, hi):
    """Cut the box lo..hi (local frame) out of each object, as a live modifier for the cutaway render."""
    k = Kit(fr)
    block(k.part("section", CUTMAT[0]), lo, hi)
    c = k.parts["section"]
    bmesh.ops.transform(c.bm, matrix=fr.W, verts=c.bm.verts)
    cut = c.finish(bpy.context.scene.collection)
    cut.hide_render = True
    mods = []
    for o in objs:
        m = o.modifiers.new("section", "BOOLEAN")
        m.object, m.operation, m.solver = cut, "DIFFERENCE", "EXACT"
        mods.append((o, m))
    return cut, mods


def scene_alone(g, out_dir, samples, do_render):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene
    col = scene.collection
    M = mats(g)
    kits, D = build_battery(g, M, key_in=True, flap_open=True)
    obs = finish(kits, col)
    lines = report(D, g)
    fr = D["fr"]
    pk = D["pk"]
    allobs = [o for grp in obs.values() for o in grp]
    export(os.path.join(out_dir, "battery.glb"), [o for k in ("pack", "internals", "mount") for o in obs[k]])

    pc = fr.world(pk["c"]) * S
    tgt = fr.world((pk["c"].x - 30, 0, pk["c"].z - 25)) * S
    low = min((o.matrix_world @ Vector(c)).z for o in allobs for c in o.bound_box)
    studio(scene, low - 0.05, tgt)
    cycles(scene, samples, (1600, 1300))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(out_dir, "battery.blend")))
    if do_render:
        render(scene, look(scene, "front34", tgt + Vector((0.5, -0.44, 0.24)), tgt, 75), os.path.join(out_dir, "battery_front34.png"))
        render(scene, look(scene, "rear34", tgt + Vector((-0.34, 0.56, 0.22)), tgt, 75), os.path.join(out_dir, "battery_rear34.png"))
        render(scene, look(scene, "side", tgt + Vector((0, -1.2, 0)), tgt, ortho=0.36), os.path.join(out_dir, "battery_side.png"))

    # cutaway: the pack alone, its left half cut away through the case, caps, foam and wrap
    keep = set(o.name for o in obs["pack"] + obs["internals"])
    for o in allobs:
        o.hide_render = o.name not in keep or o.name in ("pack_key", "pack_key_bow", "pack_port_flap")
    shells = [o for o in obs["pack"] + obs["internals"] if o.name in ("pack_case", "pack_caps", "pack_accent", "foam", "wrap", "pack_bail", "pack_bail_grip", "pack_bail_pivots", "pack_gauge")]
    big = 400
    cut, mods = section(shells, fr, (pk["f0"] - 20, 0, pk["u0"] - 20), (pk["f1"] + 20, big, pk["u1"] + 20))
    cut2, mods2 = section([o for o in shells if o.name == "pack_case"], fr, (pk["f0"] - 20, -big, pk["u0"] + LOCK_ZONE + 1), (pk["f0"] + WALL + 0.2, big, pk["u1"] - TOP_CAP - 1))
    mods += mods2
    if do_render:
        render(scene, look(scene, "cutaway", pc + Vector((-0.36, 0.4, 0.2)), pc + Vector((-0.012, 0, -0.008)), 85), os.path.join(out_dir, "battery_cutaway.png"))
    for o, m in mods:
        o.modifiers.remove(m)
    bpy.data.objects.remove(cut)
    bpy.data.objects.remove(cut2)
    for o in allobs:
        o.hide_render = False

    # exploded: pack slid SLIDE up the lugs, then pulled forward off them, bail up
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    M = mats(g)
    kits, D = build_battery(g, M, key_in=False, flap_open=False, bail_up=True)
    obs = finish(kits, scene.collection, groups=("pack", "mount", "block"))
    move = (fr.U * (SLIDE + 25) + fr.F * 140) * S
    for o in obs["pack"]:
        o.location += move
    studio(scene, low - 0.05, tgt)
    cycles(scene, samples, (1600, 1300))
    if do_render:
        mid = tgt + move * 0.5
        render(scene, look(scene, "exploded", mid + Vector((0.55, -0.62, 0.3)), mid, 62), os.path.join(out_dir, "battery_exploded.png"))
        pm = pc + move
        render(scene, look(scene, "pack_back", pm + Vector((-0.42, 0.3, 0.05)), pm + Vector((0.0, 0, -0.01)), 80), os.path.join(out_dir, "battery_pack_back.png"))
    return lines


def scene_on_bike(g, out_dir, samples, do_render):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    wheels = bb["build"](g)
    bike = [ob for ob in bpy.data.objects if ob.type == "MESH"]
    col = bpy.context.scene.collection
    M = mats(g)
    kits, D = build_battery(g, M, key_in=False, flap_open=False, with_block=False)
    obs = finish(kits, col, groups=("pack", "internals", "mount"))
    mine = obs["pack"] + obs["mount"]
    wiring = Part("e_assist_wiring", M["wire_black"])
    for w in D["e"].get("wiring", []):
        sweep(wiring, w["pts"], w["od"] / 2, segs=10)
    wob = wiring.finish(col)

    lines = []
    hits = []
    for b in bike:
        for o in mine:
            d = nearest([o], b)
            if d < 15:
                hits.append((d, f"{b.name} to {o.name}"))
    for d, n in sorted(hits):
        lines.append(f"Nearest {n}: {d:.1f} mm")
    shell = [o for o in obs["pack"] if o.name in ("pack_case", "pack_caps")]
    for o in shell:
        o.location += D["fr"].U * SLIDE * S
    for b in bike:
        if b.name in ("handlebar", "stem", "brake_levers", "grips"):
            lines.append(f"Pack slid {SLIDE} mm up, to {b.name}: {nearest(shell, b):.1f} mm (bars straight)")
    for o in shell:
        o.location -= D["fr"].U * SLIDE * S

    cams = bb["setup_scene"](g, wheels, samples)
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
    export(os.path.join(out_dir, "battery_on_bike.glb"), bike + mine + obs["internals"] + [wob])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(out_dir, "battery_on_bike.blend")))
    if do_render:
        pc = D["fr"].world(D["pk"]["c"]) * S
        tgt = pc + Vector((-0.06, 0, -0.12))
        render(scene, look(scene, "on_bike_front34", tgt + Vector((0.85, -0.8, 0.3)), tgt, 50), os.path.join(out_dir, "battery_on_bike_front34.png"))
        render(scene, look(scene, "on_bike_left34", tgt + Vector((0.55, 1.05, 0.35)), tgt + Vector((-0.04, 0, -0.03)), 50), os.path.join(out_dir, "battery_on_bike_left34.png"))
        scene.render.resolution_x, scene.render.resolution_y = 1800, 1100
        render(scene, cams["side"], os.path.join(out_dir, "battery_on_bike_side.png"))
    return lines


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    do_render, samples, args = True, 96, []
    it = iter(argv)
    for a in it:
        if a == "--no-render":
            do_render = False
        elif a == "--samples":
            samples = int(next(it))
        else:
            args.append(a)
    if len(args) != 2:
        print(__doc__)
        sys.exit(2)
    out_dir, path = args
    os.makedirs(out_dir, exist_ok=True)
    with open(path) as f:
        g = json.load(f)
    if not isinstance(g.get("accessories", {}).get("e_assist"), dict):
        sys.exit("geometry has no accessories.e_assist")
    lines = scene_alone(g, out_dir, samples, do_render)
    lines += scene_on_bike(g, out_dir, samples, do_render)
    print("\n".join("  " + s for s in lines))
    with open(os.path.join(out_dir, "battery_report.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")


main()
