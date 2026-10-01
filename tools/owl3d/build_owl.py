# The 3D Sagax owl: modeled, rigged and animated in Blender, headless.
#
#   blender -b --factory-startup --python tools/owl3d/build_owl.py -- \
#       --out node_modules/.cache/owl3d/owl-raw.glb [--render DIR --palettes FILE --ref DIR]
#
# Then `pnpm gen:owl3d` compresses the raw export into
# src/components/floating-bots/owl3d/owl.glb (tools/owl3d/compress.mjs).
#
# The SAME character as the 2D owl (src/lib/owl/owl-art.ts): a chibi owl with a
# big round head (about 55% of its height), large round eyes (a dark socket, a
# colored iris, a black pupil and a white highlight), a small hooked beak, ear
# tufts, a cream facial disc and belly with small feather marks, rounded wings
# and short legs with toes. Our own original work (docs/NOTICE.md).
#
# Every palette region has its own material, named after the palette slot the
# runtime paints it with (Owl3D.tsx): plumage, wing, cream, spots, beak, feet,
# socket, iris, pupil, highlight, lid. Shape keys: the lids (blink, happy, sad,
# sleepy, surprised, squint) and the beak (open). Clips are actions exported as
# glTF animations, in place (the window moves the mascot).
#
# Blender axes: Z up, the owl faces -Y, its left side is +X (.L). The glTF
# export turns that into three.js's Y up with the owl facing +Z (the camera).

import bpy
import bmesh
import math
import os
import sys
import json
from mathutils import Vector, Matrix, Euler, Quaternion
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

ARGV = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default


FPS = 24

# ------------------------------------------------------------------ helpers


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def env(t, a, b, c, d):
    """0 before a, eases up to 1 by b, holds, eases back to 0 from c to d."""
    if t <= a or t >= d:
        return 0.0
    if t < b:
        return smooth((t - a) / (b - a))
    if t <= c:
        return 1.0
    return 1.0 - smooth((t - c) / (d - c))


def ramp(t, a, b):
    return smooth((t - a) / (b - a)) if b > a else float(t >= a)


def lerp(a, b, k):
    return a + (b - a) * k


TAU = math.tau

# the reference palette (owl-art's OWL_REFERENCE, with the green bot's plumage)
DEFAULT_COLORS = {
    "plumage": "#009957",
    "lid": "#009957",
    "wing": "#006B3D",
    "cream": "#F6F1E8",
    "spots": "#ACA09C",
    "beak": "#464147",
    "feet": "#464147",
    "socket": "#002E1A",
    "iris": "#F8CA48",
    "pupil": "#0E0B0E",
    "highlight": "#FBF8F2",
}

MAT = {}


def make_materials():
    for name, color in DEFAULT_COLORS.items():
        m = bpy.data.materials.new(name)
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = hex_rgba(color)
        # distinct values: the export's dedup would merge two identical materials (the lid into the plumage)
        rough = {"iris": 0.35, "pupil": 0.3, "highlight": 0.3, "socket": 0.45, "beak": 0.5, "lid": 0.79, "feet": 0.55}.get(name, 0.8)
        bsdf.inputs["Roughness"].default_value = rough
        m.diffuse_color = hex_rgba(color)
        MAT[name] = m


def set_colors(colors):
    for name, color in colors.items():
        m = MAT.get(name)
        if m:
            m.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = hex_rgba(color)
            m.diffuse_color = hex_rgba(color)


COL = None


def to_object(bm, name, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(MAT[m])
    ob = bpy.data.objects.new(name, me)
    COL.objects.link(ob)
    me.shade_smooth()
    return ob


def quad_sphere(cuts):
    """A sphere of quads (a subdivided cube pushed out): no poles, even topology."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        # an even spread over the sphere (the cube-to-sphere mapping), not a plain normalize
        x, y, z = v.co
        v.co = Vector(
            (
                x * math.sqrt(max(0.0, 1 - y * y / 2 - z * z / 2 + y * y * z * z / 3)),
                y * math.sqrt(max(0.0, 1 - z * z / 2 - x * x / 2 + z * z * x * x / 3)),
                z * math.sqrt(max(0.0, 1 - x * x / 2 - y * y / 2 + x * x * y * y / 3)),
            )
        )
    return bm


def deform(bm, fn):
    for v in bm.verts:
        v.co = fn(v.co.copy())


def subdivide(ob, levels=1):
    """Subdivision surface, applied (the export keeps only the armature)."""
    mod = ob.modifiers.new("subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    me.name = ob.name
    me.shade_smooth()


def tube(center, axis, radius, n=40):
    """A round region around an axis: the planes of a prism (a smooth enough circle once cut)."""
    a = axis.normalized()
    t1 = a.orthogonal().normalized()
    t2 = a.cross(t1)
    planes = []
    for k in range(n):
        d = t1 * math.cos(TAU * k / n) + t2 * math.sin(TAU * k / n)
        planes.append((center + d * radius, -d))
    # and only on the face's side of the eye's center (a clean edge where the tube would run back)
    planes.append((center - a * 0.12, a))
    return {"planes": planes, "all": True, "near": (center, a, radius + 0.08)}


def half(planes, every=False):
    return {"planes": planes, "all": every, "near": None}


def paint_regions(ob, rules):
    """Cut the surface along each region's planes and give the faces inside its material: clean,
    curved region edges. rules: [(material index, region)] in order, a later one paints over; a
    region holds planes and whether a face must be in front of all of them or any. Only the
    front of the face (y < 0) is painted."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _, region in rules:
        near = region["near"]
        for p, n in region["planes"]:
            if near:
                center, axis, reach = near
                faces = [f for f in bm.faces if ((f.calc_center_median() - center) - axis * (f.calc_center_median() - center).dot(axis)).length < reach and (f.calc_center_median() - center).dot(axis) > -0.3]
                edges = list({e for f in faces for e in f.edges})
                verts = list({v for f in faces for v in f.verts})
                geom = verts + edges + faces
            else:
                geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=p, plane_no=n.normalized(), dist=1e-5)
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = 0
        for idx, region in rules:
            test = all if region["all"] else any
            if c.y < 0 and test((c - p).dot(n) > 0 for p, n in region["planes"]):
                f.material_index = idx
    bm.to_mesh(ob.data)
    bm.free()


def bvh_of(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def surface_hit(tree, origin, direction):
    loc, normal, _, _ = tree.ray_cast(Vector(origin), Vector(direction).normalized())
    return loc, normal


# ------------------------------------------------------------- the shape
#
# Heights (Blender units; the art's 256-unit box is 2.56): feet on 0, body
# about 0.14..1.26, head about 0.94..2.30, tufts to about 2.42.

HEAD_C = Vector((0.0, 0.0, 1.62))
HEAD_R = Vector((0.80, 0.70, 0.68))
BODY_C = Vector((0.0, 0.02, 0.70))
BODY_R = Vector((0.60, 0.54, 0.56))
EYE_R = 0.25
EYE_POKE = 0.075  # how far an eyeball stands out of the face
SOCKET_R = 0.235  # the dark socket painted around it
DISC_R = 0.415  # the cream facial disc around each eye
EYE_X = 0.315
EYE_Z = 1.64

GEO = {}


def build_head():
    bm = quad_sphere(10)

    def shape(p):
        # a round head, a little flatter in front (the facial disc) and fuller at the cheeks
        x, y, z = p
        cheek = 1 + 0.06 * math.exp(-((z + 0.05) ** 2) / 0.18)
        face = 0.86 if y < 0 else 1.0
        y = y * (face + (1 - face) * min(1.0, (x * x + z * z) * 1.2))
        return Vector((x * HEAD_R.x * cheek, y * HEAD_R.y, z * HEAD_R.z * (1.0 if z < 0 else 0.97))) + HEAD_C

    deform(bm, shape)
    ob = to_object(bm, "head", ["plumage", "cream", "socket"])
    subdivide(ob, 1)
    tree = bvh_of(ob)
    eyes = []
    for side in (1, -1):
        hit, normal = surface_hit(tree, (side * EYE_X, -3.0, EYE_Z), (0, 1, 0))
        axis = (normal.normalized() + Vector((0, -1.6, 0))).normalized()
        eyes.append((side, hit, axis))
    GEO["eyes"] = eyes
    # the facial disc: cream around each eye, joined under the beak by a chin cap; the plumage
    # comes down between the eyes in a V (the 2D owl's "patch"); a dark socket rings each eye
    rules = []
    for side, hit, axis in eyes:
        c = hit - axis * (EYE_R - EYE_POKE)
        rules.append((1, tube(c + Vector((side * 0.02, 0, 0.03)), axis, DISC_R)))
    rules.append((1, half([(HEAD_C + Vector((0, -0.42, -0.42)), Vector((0, -0.6, -0.8)))])))
    apex = Vector((0, -0.6, 1.50))
    rules.append((0, half([(apex, Vector((-1, 0, 0.36))), (apex, Vector((1, 0, 0.36)))], every=True)))
    for side, hit, axis in eyes:
        c = hit - axis * (EYE_R - EYE_POKE)
        rules.append((2, tube(c, axis, SOCKET_R)))
    paint_regions(ob, rules)
    return ob


def build_body():
    bm = quad_sphere(9)

    def shape(p):
        x, y, z = p
        # an egg: wider low down, narrowing into the neck
        w = 1.0 + 0.10 * (-z) - 0.06 * max(0.0, z) ** 2
        return Vector((x * BODY_R.x * w, y * BODY_R.y * w, z * BODY_R.z)) + BODY_C

    deform(bm, shape)
    ob = to_object(bm, "body", ["plumage", "cream"])
    subdivide(ob, 1)
    # the cream belly: the front of the egg
    paint_regions(ob, [(1, half([(BODY_C + Vector((0, -0.30, -0.02)), Vector((0, -1, -0.12)))]))])
    return ob


def build_spots(body):
    """Small feather marks on the belly, laid on its surface (drop shapes pointing down)."""
    tree = bvh_of(body)
    bm = bmesh.new()
    marks = [(-0.20, 0.82), (0.0, 0.86), (0.20, 0.82), (-0.11, 0.63), (0.11, 0.63), (0.0, 0.44)]
    for x, z in marks:
        hit, normal = surface_hit(tree, (x, -3.0, z), (0, 1, 0))
        if hit is None:
            continue
        sph = quad_sphere(3)
        # a drop: round at the bottom, pointed at the top (as the 2D owl's marks)
        def drop(p):
            px, py, pz = p
            taper = 1 - 0.55 * max(0.0, pz)
            return Vector((px * 0.042 * taper, py * 0.012, pz * 0.072))

        deform(sph, drop)
        n = normal.normalized()
        up = (Vector((0, 0, 1)) - n * n.z).normalized()
        right = up.cross(n)
        basis = Matrix((right, -n, up)).transposed()
        for v in sph.verts:
            v.co = hit + n * 0.006 + basis @ v.co
        tmp = bmesh.new()
        me = bpy.data.meshes.new("tmp")
        sph.to_mesh(me)
        sph.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        tmp.free()
    return to_object(bm, "spots", ["spots"])


def eye_frame(side, axis):
    f = axis.normalized()
    r = Vector((0, 0, 1)).cross(f).normalized() * -1  # +X-ish (the owl's left on screen right)
    if r.x < 0:
        r = -r
    u = f.cross(r).normalized() * -1
    if u.z < 0:
        u = -u
    return f, r, u


def sph(c, R, f, r, u, alpha, beta):
    """A point on a sphere around an eye: alpha up from the eye's axis, beta toward +X."""
    a, b = math.radians(alpha), math.radians(beta)
    return c + R * (math.cos(a) * math.cos(b) * f + math.cos(a) * math.sin(b) * r + math.sin(a) * u)


def cap_grid(c, R, f, r, u, center, radius, rings=6, segs=24):
    """A round patch on the sphere, centered at (alpha, beta), angular radius `radius` (degrees)."""
    bm = bmesh.new()
    ca, cb = center
    # the patch's own axis
    axis = (sph(Vector(), 1, f, r, u, ca, cb)).normalized()
    t1 = axis.cross(u if abs(axis.dot(u)) < 0.9 else r).normalized()
    t2 = axis.cross(t1).normalized()
    center_v = bm.verts.new(c + axis * R)
    rings_v = []
    for i in range(1, rings + 1):
        ang = math.radians(radius) * i / rings
        ring = []
        for j in range(segs):
            phi = TAU * j / segs
            d = axis * math.cos(ang) + (t1 * math.cos(phi) + t2 * math.sin(phi)) * math.sin(ang)
            ring.append(bm.verts.new(c + d * R))
        rings_v.append(ring)
    for j in range(segs):
        bm.faces.new((center_v, rings_v[0][j], rings_v[0][(j + 1) % segs]))
    for i in range(rings - 1):
        a, b = rings_v[i], rings_v[i + 1]
        for j in range(segs):
            bm.faces.new((a[j], b[j], b[(j + 1) % segs], a[(j + 1) % segs]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # facing outward
    for fc in bm.faces:
        if fc.normal.dot(fc.calc_center_median() - c) < 0:
            fc.normal_flip()
    return bm


def join_bms(bms):
    out = bmesh.new()
    for b in bms:
        me = bpy.data.meshes.new("tmp")
        b.to_mesh(me)
        b.free()
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
    return out


def build_eyes():
    balls, irises, pupils, lights = [], [], [], []
    GEO["eye_centers"] = []
    for side, hit, axis in GEO["eyes"]:
        f, r, u = eye_frame(side, axis)
        c = hit - f * (EYE_R - EYE_POKE)
        GEO["eye_centers"].append((side, c, f, r, u))
        ball = quad_sphere(6)
        deform(ball, lambda p, c=c: c + p * EYE_R)
        balls.append(ball)
        irises.append(cap_grid(c, EYE_R + 0.004, f, r, u, (0, 0), 35, rings=5, segs=32))
        pupils.append(cap_grid(c, EYE_R + 0.007, f, r, u, (0, 0), 21, rings=3, segs=28))
        lights.append(cap_grid(c, EYE_R + 0.010, f, r, u, (15, 12), 7.5, rings=2, segs=16))
    return (
        to_object(join_bms(balls), "eyeball", ["socket"]),
        to_object(join_bms(irises), "iris", ["iris"]),
        to_object(join_bms(pupils), "pupil", ["pupil"]),
        to_object(join_bms(lights), "highlight", ["highlight"]),
    )


# lid edges (degrees up from each eye's axis) per shape key; beta is -1..1 across the eye
# toward +X; `out` is +1 on the eye's outer side.
LID_ROWS, LID_COLS, LID_SPAN = 9, 22, 78
UPPER_TOP, LOWER_BOTTOM = 100, -100


def lid_edges(key, b, out):
    """(upper edge, lower edge) in degrees for a shape key at a point across the eye."""
    rest = (84, -84)
    if key == "Basis":
        return rest
    if key == "blink":
        return (-6, -8)
    if key == "happy":
        # the cheeks push the lower lid up into an arc: a smiling eye
        return (84, 30 - 46 * b * b)
    if key == "sad":
        # the outer corners droop
        return (34 - 26 * out * b, -60)
    if key == "sleepy":
        return (12, -50)
    if key == "surprised":
        return (90, -90)
    if key == "squint":
        return (24, -26)
    raise KeyError(key)


LID_KEYS = ["blink", "happy", "sad", "sleepy", "surprised", "squint"]


def lid_points(key):
    pts = []
    for side, c, f, r, u in GEO["eye_centers"]:
        R = EYE_R + 0.016
        for which in ("upper", "lower"):
            for i in range(LID_ROWS + 1):
                for j in range(LID_COLS + 1):
                    b = -1 + 2 * j / LID_COLS
                    out = 1 if side > 0 else -1
                    # out is +1 where beta points away from the face's middle
                    edges = lid_edges(key, b, out)
                    edge = edges[0] if which == "upper" else edges[1]
                    far = UPPER_TOP if which == "upper" else LOWER_BOTTOM
                    alpha = lerp(edge, far, i / LID_ROWS)
                    beta = b * LID_SPAN * math.cos(math.radians(min(85, abs(alpha))) * 0.35)
                    # a rounded lip: the very edge tucks in toward the eye
                    lip = 0.006 if i == 0 else 0.0
                    pts.append(sph(c, R - lip, f, r, u, alpha, beta))
    return pts


def build_lids():
    bm = bmesh.new()
    verts = [bm.verts.new(p) for p in lid_points("Basis")]
    stride = LID_COLS + 1
    block = (LID_ROWS + 1) * stride
    for k in range(4):
        base = k * block
        for i in range(LID_ROWS):
            for j in range(LID_COLS):
                a = base + i * stride + j
                q = (verts[a], verts[a + 1], verts[a + stride + 1], verts[a + stride])
                bm.faces.new(q if k % 2 == 0 else tuple(reversed(q)))
    ob = to_object(bm, "lids", ["lid"])
    ob.shape_key_add(name="Basis", from_mix=False)
    for key in LID_KEYS:
        kb = ob.shape_key_add(name=key, from_mix=False)
        for i, p in enumerate(lid_points(key)):
            kb.data[i].co = p
    # face normals outward
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for fc in bm.faces:
        side_c = min(GEO["eye_centers"], key=lambda e: (e[1] - fc.calc_center_median()).length)[1]
        if fc.normal.dot(fc.calc_center_median() - side_c) < 0:
            fc.normal_flip()
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def build_beak():
    tree = GEO["head_tree"]
    hit, normal = surface_hit(tree, (0, -3.0, 1.43), (0, 1, 0))
    base = hit + Vector((0, 0.03, 0))
    GEO["beak_base"] = base

    def upper(p):
        x, y, z = p
        # depth d: 0 at the face, 1 at the tip; a hooked point
        d = (-y + 1) / 2
        w = 0.12 * (1 - 0.78 * d ** 1.3)
        h = 0.15 * (1 - 0.5 * d)
        v = Vector((x * w, -d * 0.26, z * h + 0.05 * d))
        # the hook: the tip curls down
        bend = math.radians(80) * d ** 2.0
        pivot = Vector((0, -0.05, 0.05))
        q = v - pivot
        rot = Matrix.Rotation(bend, 3, "X")
        return base + pivot + rot @ q

    up_bm = quad_sphere(5)
    deform(up_bm, upper)

    hinge = base + Vector((0, 0.0, -0.06))

    def lower(p):
        x, y, z = p
        d = (-y + 1) / 2
        w = 0.06 * (1 - 0.7 * d)
        return hinge + Vector((x * w, -d * 0.11, z * 0.03 - 0.01 - 0.03 * d))

    lo_bm = quad_sphere(4)
    deform(lo_bm, lower)
    n_up = len(up_bm.verts)
    bm = join_bms([up_bm, lo_bm])
    ob = to_object(bm, "beak", ["beak"])
    ob.shape_key_add(name="Basis", from_mix=False)
    kb = ob.shape_key_add(name="open", from_mix=False)
    rot_lo = Matrix.Rotation(math.radians(32), 3, "X")
    rot_up = Matrix.Rotation(math.radians(-7), 3, "X")
    for i, v in enumerate(ob.data.vertices):
        if i < n_up:
            kb.data[i].co = base + rot_up @ (v.co - base)
        else:
            kb.data[i].co = hinge + rot_lo @ (v.co - hinge)
    return ob


def build_tufts():
    bms = []
    GEO["tufts"] = []
    for side in (1, -1):
        tip_dir = Vector((side * 0.55, 0.05, 1.0)).normalized()
        root = HEAD_C + Vector((side * 0.50, -0.06, 0.50))

        def tuft(p, side=side, root=root):
            x, y, z = p
            s = (z + 1) / 2  # 0 at the root, 1 at the tip
            w = 0.12 * (1 - s) ** 1.1 + 0.004
            t = 0.045 * (1 - s) ** 1.1 + 0.003
            v = Vector((x * w, y * t, s * 0.40))
            # lean outward and curl a little back
            ang = math.radians(18 + 26 * s) * side
            v = Matrix.Rotation(-ang, 3, "Y") @ v
            v = Matrix.Rotation(math.radians(-12 * s), 3, "X") @ v
            return root + v

        b = quad_sphere(5)
        deform(b, tuft)
        bms.append(b)
        GEO["tufts"].append((side, root))
    return to_object(join_bms(bms), "tufts", ["plumage"])


WING_LEN = 0.86
SHOULDER = Vector((0.40, 0.08, 1.16))


def body_half_width(z, y):
    """Where the body's surface is along x at a height and depth (the egg of build_body)."""
    zn = max(-1.0, min(1.0, (z - BODY_C.z) / BODY_R.z))
    w = 1.0 + 0.10 * (-zn) - 0.06 * max(0.0, zn) ** 2
    rho = math.sqrt(max(0.0, 1 - zn * zn))
    ry = BODY_R.y * w * rho
    if ry <= 1e-4:
        return 0.0
    k = max(0.0, 1 - ((y - BODY_C.y) / ry) ** 2)
    return BODY_R.x * w * rho * math.sqrt(k)


def wing_point(p, side):
    """A folded wing lying on the body's side, as in the 2D owl: rounded at the shoulder
    (tucked under the head), pointed at the tip, with a few rounded feather tips."""
    x, y, z = p
    s = (1 - z) / 2  # 0 at the shoulder, 1 at the tip
    width = 0.30 * math.sin(math.pi * min(1.0, s ** 0.7 * 0.97 + 0.03)) ** 0.6
    scallop = 1 + (0.08 * math.cos(y * 10) if s > 0.5 and y > 0.1 else 0)
    zw = SHOULDER.z - s * WING_LEN
    yw = SHOULDER.y + y * width * scallop + 0.16 * s * s
    thick = 0.075 * (1 - 0.45 * s) + 0.012
    xw = body_half_width(zw, yw) * 0.97 + 0.025 + x * thick
    return Vector((side * xw, yw, zw))


def build_wings():
    bms = []
    for side in (1, -1):
        b = quad_sphere(8)
        deform(b, lambda p, side=side: wing_point(p, side))
        if side < 0:
            bmesh.ops.reverse_faces(b, faces=b.faces[:])
        bms.append(b)
    return to_object(join_bms(bms), "wings", ["wing"])


def build_tail():
    b = quad_sphere(5)

    def tail(p):
        x, y, z = p
        s = (z + 1) / 2
        w = 0.20 * (0.55 + 0.45 * s) * (1 + 0.08 * math.cos(x * 10) * s)
        v = Vector((x * w, y * 0.05, s * 0.34))
        v = Matrix.Rotation(math.radians(-128), 3, "X") @ v
        return Vector((0, 0.42, 0.52)) + v

    deform(b, tail)
    return to_object(b, "tail", ["wing"])


FOOT = {1: Vector((0.22, -0.20, 0.05)), -1: Vector((-0.22, -0.20, 0.05))}


def build_legs():
    """Feathered thighs (plumage) and the feet: three toes ahead, one behind."""
    thighs, feet = [], []
    for side in (1, -1):
        t = quad_sphere(5)
        deform(t, lambda p, side=side: Vector((side * 0.22, -0.02, 0.24)) + Vector((p.x * 0.16, p.y * 0.16, p.z * 0.17)))
        thighs.append(t)
        ankle = FOOT[side] + Vector((0, 0.06, 0.04))
        shin = quad_sphere(3)
        deform(shin, lambda p, ankle=ankle: ankle + Vector((p.x * 0.045, p.y * 0.045, p.z * 0.09 + 0.07)))
        feet.append(shin)
        for ang, length in ((-30, 0.17), (0, 0.20), (30, 0.17), (180, 0.10)):
            toe = quad_sphere(3)

            def toe_fn(p, ang=ang, length=length, ankle=ankle, side=side):
                x, y, z = p
                s = (-y + 1) / 2
                r = 0.05 * (1 - 0.45 * s)
                v = Vector((x * r, -s * length, z * r * 0.85 - 0.025 * s * s))
                return ankle + Vector((0, 0, -0.035)) + Matrix.Rotation(math.radians(ang * side * -1 + 0), 3, "Z") @ v

            deform(toe, toe_fn)
            feet.append(toe)
    return to_object(join_bms(thighs), "thighs", ["plumage"]), to_object(join_bms(feet), "feet", ["feet"])


# ------------------------------------------------------------------- rig

BONES = [
    # name, head, tail, parent
    ("root", (0, 0, 0), (0, 0, 0.25), None),
    ("hips", (0, 0.02, 0.30), (0, 0.02, 0.62), "root"),
    ("spine", (0, 0.02, 0.62), (0, 0.02, 0.88), "hips"),
    ("chest", (0, 0.02, 0.88), (0, 0.02, 1.10), "spine"),
    ("neck", (0, 0.0, 1.10), (0, 0.0, 1.30), "chest"),
    ("head", (0, 0.0, 1.30), (0, 0.0, 2.05), "neck"),
    ("tuft.L", (0.50, -0.06, 2.12), (0.66, -0.04, 2.40), "head"),
    ("tuft.R", (-0.50, -0.06, 2.12), (-0.66, -0.04, 2.40), "head"),
    ("wing.L", (0.40, 0.08, 1.14), (0.60, 0.12, 0.88), "chest"),
    ("wing_mid.L", (0.60, 0.12, 0.88), (0.64, 0.17, 0.60), "wing.L"),
    ("wing_tip.L", (0.64, 0.17, 0.60), (0.52, 0.26, 0.32), "wing_mid.L"),
    ("wing.R", (-0.40, 0.08, 1.14), (-0.60, 0.12, 0.88), "chest"),
    ("wing_mid.R", (-0.60, 0.12, 0.88), (-0.64, 0.17, 0.60), "wing.R"),
    ("wing_tip.R", (-0.64, 0.17, 0.60), (-0.52, 0.26, 0.32), "wing_mid.R"),
    ("leg.L", (0.21, -0.02, 0.32), (0.21, -0.04, 0.09), "hips"),
    ("foot.L", (0.21, -0.04, 0.09), (0.21, -0.22, 0.04), "leg.L"),
    ("leg.R", (-0.21, -0.02, 0.32), (-0.21, -0.04, 0.09), "hips"),
    ("foot.R", (-0.21, -0.04, 0.09), (-0.21, -0.22, 0.04), "leg.R"),
    ("tail", (0, 0.40, 0.52), (0, 0.62, 0.30), "hips"),
]


def build_armature():
    arm_data = bpy.data.armatures.new("rig")
    arm = bpy.data.objects.new("rig", arm_data)
    COL.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, h, t, parent in BONES:
        eb = arm_data.edit_bones.new(name)
        eb.head = h
        eb.tail = t
        eb.roll = 0
        if parent:
            eb.parent = arm_data.edit_bones[parent]
            eb.use_connect = False
    # the eyes turn around their own centers, so the gaze moves the iris on the eyeball
    for side, c, f, r, u in GEO["eye_centers"]:
        eb = arm_data.edit_bones.new("eye.L" if side > 0 else "eye.R")
        eb.head = c
        eb.tail = c + f * 0.2
        eb.roll = 0
        eb.parent = arm_data.edit_bones["head"]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


def bind(ob, arm, weights):
    """weights: a function of a vertex position returning {bone: weight}."""
    ob.parent = arm
    mod = ob.modifiers.new("rig", "ARMATURE")
    mod.object = arm
    groups = {}
    for v in ob.data.vertices:
        w = weights(v.co)
        total = sum(w.values()) or 1
        for bone, value in w.items():
            if value <= 0.001:
                continue
            g = groups.get(bone) or ob.vertex_groups.new(name=bone)
            groups[bone] = g
            g.add([v.index], value / total, "REPLACE")


def rigid(bone):
    return lambda co: {bone: 1.0}


def auto_bind(obs, arm, bones):
    """Blender's automatic (bone heat) weights for the body shells over the trunk bones,
    then cleaned: tiny weights dropped, at most 4 per vertex, normalized."""
    keep = {}
    for b in arm.data.bones:
        keep[b.name] = b.use_deform
        b.use_deform = b.name in bones
    bpy.ops.object.select_all(action="DESELECT")
    for ob in obs:
        ob.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    for b in arm.data.bones:
        b.use_deform = keep[b.name]
    for ob in obs:
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        ok = all(any(g.weight > 0 for g in v.groups) for v in ob.data.vertices)
        bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.02)
        bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
        bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
        if not ok:
            print(f"owl3d: bone heat left vertices of {ob.name} unweighted; using the trunk falloff")
            return False
    return True


def trunk_weights(co):
    """The trunk's falloff along its height (the fallback when bone heat fails)."""
    z = co.z
    w = {}

    def band(lo, hi):
        return smooth((z - lo) / (hi - lo)) if hi > lo else 0

    hips = 1 - band(0.45, 0.70)
    spine = band(0.45, 0.70) * (1 - band(0.80, 1.00))
    chest = band(0.80, 1.00) * (1 - band(1.08, 1.22))
    head = band(1.08, 1.30)
    neck = band(1.08, 1.22) * (1 - band(1.22, 1.32))
    for k, v in (("hips", hips), ("spine", spine), ("chest", chest), ("neck", neck), ("head", head)):
        if v > 0:
            w[k] = v
    return w


def head_weights(co):
    # the head is one piece; its lowest part follows the neck so a turn never tears it off the body
    k = smooth((co.z - 1.0) / 0.25)
    return {"head": k, "neck": 1 - k} if k < 1 else {"head": 1.0}


def wing_weights(side):
    suf = ".L" if side > 0 else ".R"

    def w(co):
        s = (SHOULDER.z - co.z) / WING_LEN
        a = 1 - smooth((s - 0.25) / 0.25)
        c = smooth((s - 0.55) / 0.25)
        b = max(0.0, 1 - a - c)
        return {"wing" + suf: a, "wing_mid" + suf: b, "wing_tip" + suf: c}

    return w


def by_side(left, right):
    return lambda co: left(co) if co.x > 0 else right(co)


def copy_weights(target, source):
    """A shell lying on another mesh takes the weights of the nearest vertex under it."""
    kd = KDTree(len(source.data.vertices))
    for v in source.data.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    names = {g.index: g.name for g in source.vertex_groups}

    def w(co):
        _, idx, _ = kd.find(co)
        return {names[g.group]: g.weight for g in source.data.vertices[idx].groups}

    return w


# ------------------------------------------------------------- the clips
#
# A pose: {bone: {"r": (x, y, z) degrees about the armature's axes, "t": (x, y, z), "s": (x, y, z)}}
# plus shape key values. Armature axes: +Z rotation turns the face toward +X (the owl's
# left); +X rotation pitches the face down; +Y rotation rolls toward +X. A wing spreads
# (rises out) with a negative Y rotation on the left, positive on the right.

FLY_Z = 0.30


def P():
    return {}


def add(pose, bone, r=None, t=None, s=None):
    e = pose.setdefault(bone, {"r": [0.0, 0.0, 0.0], "t": [0.0, 0.0, 0.0], "s": [1.0, 1.0, 1.0]})
    if r:
        e["r"] = [a + b for a, b in zip(e["r"], r)]
    if t:
        e["t"] = [a + b for a, b in zip(e["t"], t)]
    if s:
        e["s"] = [a * b for a, b in zip(e["s"], s)]
    return pose


def wings(pose, spread=0.0, fwd=0.0, mid=0.0, tip=0.0, side=0, wrap=0.0):
    """Both wings (side 0) or one (+1 left, -1 right): spread rises out (degrees), fwd swings forward."""
    for s in (1, -1):
        if side and s != side:
            continue
        suf = ".L" if s > 0 else ".R"
        # a wing unfolds as it opens: bigger spread out than folded on the body
        grow = 1 + 0.3 * smooth(spread / 90)
        add(pose, "wing" + suf, r=(-fwd, -s * spread, -s * wrap), s=(grow, grow, grow))
        add(pose, "wing_mid" + suf, r=(0, -s * mid, 0))
        add(pose, "wing_tip" + suf, r=(0, -s * tip, 0))
    return pose


def tufts(pose, perk=0.0, out=0.0):
    """perk > 0 stands them up and forward, < 0 lays them back; out tips them outward."""
    for s in (1, -1):
        add(pose, "tuft" + (".L" if s > 0 else ".R"), r=(perk, s * out, 0))
    return pose


def squash(pose, k, bone="hips"):
    """Squash (k < 1) or stretch (k > 1), keeping the volume."""
    side = 1 / math.sqrt(k)
    return add(pose, bone, s=(side, side, k))


def breathe(pose, t, period, amount=1.0):
    b = math.sin(TAU * t / period)
    add(pose, "chest", r=(-1.6 * b * amount, 0, 0), s=(1 + 0.012 * b * amount, 1 + 0.012 * b * amount, 1))
    add(pose, "head", r=(1.6 * b * amount, 0, 0), t=(0, 0, 0.006 * b * amount))
    wings(pose, spread=1.5 + 1.5 * b * amount)
    return pose


def clip_idle(t, D):
    p = breathe(P(), t, D)
    tufts(p, out=2.5 * math.sin(TAU * 2 * t / D))
    return p, {}


def clip_blink(t, D):
    p = breathe(P(), t, D * 6)
    k = t / D
    return p, {"blink": math.sin(math.pi * min(1, k * 1.15)) ** 0.7 if k < 0.87 else 0}


def look(sign):
    def clip(t, D):
        p = breathe(P(), t, D)
        k = env(t, 0.05, 0.42, D - 0.55, D - 0.08)
        add(p, "head", r=(-3 * k, 0, sign * 55 * k))
        add(p, "neck", r=(0, 0, sign * 6 * k))
        add(p, "chest", r=(0, 0, sign * 6 * k))
        add(p, "eye.L", r=(0, 0, sign * 10 * k))
        add(p, "eye.R", r=(0, 0, sign * 10 * k))
        tufts(p, perk=6 * k)
        return p, {}

    return clip


def clip_tilt(t, D):
    p = breathe(P(), t, D)
    k = env(t, 0.05, 0.38, D - 0.5, D - 0.05)
    wob = math.sin(TAU * (t - 0.38) / 0.9) * 4 * env(t, 0.38, 0.5, D - 0.5, D - 0.2)
    add(p, "head", r=(-8 * k, 24 * k + wob, 6 * k))
    tufts(p, perk=10 * k, out=-4 * k)
    return p, {"surprised": 0.25 * k}


def clip_walk(t, D):
    ph = TAU * t / D
    p = P()
    add(p, "hips", r=(4, 7 * math.sin(ph), 4 * math.sin(ph)), t=(0, 0, 0.028 * (0.5 - 0.5 * math.cos(2 * ph))))
    add(p, "chest", r=(0, -3 * math.sin(ph), 0))
    add(p, "head", r=(-3 + 2 * math.cos(2 * ph), -4 * math.sin(ph), -3 * math.sin(ph)))
    for s, off in ((1, 0.0), (-1, math.pi)):
        suf = ".L" if s > 0 else ".R"
        swing = math.sin(ph + off)
        lift = max(0.0, -math.cos(ph + off))
        add(p, "leg" + suf, r=(24 * swing - 7 * s * math.sin(ph) * 0, -7 * math.sin(ph), 0), t=(0, 0, 0.06 * lift))
        add(p, "foot" + suf, r=(-22 * lift + 6 * swing, 0, 0))
    wings(p, spread=7 + 5 * math.sin(2 * ph), fwd=4 * math.sin(ph))
    add(p, "tail", r=(-4, 0, 12 * math.sin(ph)))
    tufts(p, perk=2 * math.cos(2 * ph))
    return p, {}


def hop_arc(t, t0, t1, height):
    if t <= t0 or t >= t1:
        return 0.0
    k = (t - t0) / (t1 - t0)
    return height * 4 * k * (1 - k)


def clip_hop(t, D, height=0.36):
    p = P()
    crouch = env(t, 0.0, 0.14, 0.16, 0.24)
    land = env(t, 0.5, 0.56, 0.58, D)
    air = hop_arc(t, 0.2, 0.52, height)
    squash(p, 1 - 0.14 * crouch - 0.12 * land + 0.08 * env(t, 0.2, 0.28, 0.4, 0.52))
    add(p, "hips", t=(0, 0, -0.07 * crouch - 0.05 * land))
    add(p, "root", t=(0, 0, air))
    k = env(t, 0.18, 0.3, 0.42, 0.56)
    wings(p, spread=38 * k, mid=10 * k)
    for s in (".L", ".R"):
        add(p, "leg" + s, r=(14 * k, 0, 0))
        add(p, "foot" + s, r=(-25 * k, 0, 0))
    add(p, "head", r=(6 * crouch - 6 * k, 0, 0))
    tufts(p, perk=-12 * k)
    return p, {"happy": 0.5 * k}


def clip_turn(t, D):
    p, sh = clip_hop(t / D * 0.7, 0.7, height=0.12)
    return p, {}


def fly_pose(t, period, amp=1.0, hover=FLY_Z):
    ph = TAU * t / period
    p = P()
    beat = math.sin(ph)
    add(p, "root", t=(0, 0, hover + 0.045 * math.sin(ph + math.pi * 0.6) * amp))
    add(p, "hips", r=(16, 0, 0))
    add(p, "head", r=(-14, 0, 0))
    wings(p, spread=58 + 52 * beat * amp, fwd=8 * math.cos(ph) * amp, mid=-16 * math.sin(ph - 0.7) * amp, tip=-22 * math.sin(ph - 1.3) * amp)
    for s in (".L", ".R"):
        add(p, "leg" + s, r=(52, 0, 0))
        add(p, "foot" + s, r=(35, 0, 0))
    add(p, "tail", r=(-12 + 4 * math.sin(ph), 0, 0))
    tufts(p, perk=-16)
    return p


def clip_fly(t, D):
    return fly_pose(t, D), {}


def mix_poses(a, b, k):
    out = {}
    for bone in set(a) | set(b):
        ea = a.get(bone, {"r": [0, 0, 0], "t": [0, 0, 0], "s": [1, 1, 1]})
        eb = b.get(bone, {"r": [0, 0, 0], "t": [0, 0, 0], "s": [1, 1, 1]})
        out[bone] = {key: [lerp(x, y, k) for x, y in zip(ea[key], eb[key])] for key in ("r", "t", "s")}
    return out


def mix_shapes(a, b, k):
    return {key: lerp(a.get(key, 0), b.get(key, 0), k) for key in set(a) | set(b)}


def clip_takeoff(t, D):
    crouch = env(t, 0.0, 0.22, 0.26, 0.38)
    p = P()
    squash(p, 1 - 0.16 * crouch)
    add(p, "hips", t=(0, 0, -0.08 * crouch))
    lift = ramp(t, 0.3, 0.75)
    wings(p, spread=95 * ramp(t, 0.05, 0.3), mid=-10 * ramp(t, 0.05, 0.3))
    add(p, "head", r=(10 * crouch, 0, 0))
    tufts(p, perk=-10 * ramp(t, 0.1, 0.3))
    # the flight pose takes over as it leaves the ground, flapping hard
    fly = fly_pose(t - 0.3, 0.3, amp=1.2, hover=FLY_Z * lift + 0.08 * lift * (1 - lift) * 4)
    return mix_poses(p, fly, ramp(t, 0.3, 0.55)), {}


def clip_glide(t, D):
    ph = TAU * t / D
    p = P()
    add(p, "root", t=(0, 0, FLY_Z + 0.03 * math.sin(ph)))
    add(p, "hips", r=(14, 5 * math.sin(ph), 0))
    add(p, "head", r=(-12, -4 * math.sin(ph), 0))
    wings(p, spread=94 + 4 * math.sin(ph), mid=-6, tip=-10 + 3 * math.sin(ph + 1))
    for s in (".L", ".R"):
        add(p, "leg" + s, r=(55, 0, 0))
        add(p, "foot" + s, r=(35, 0, 0))
    add(p, "tail", r=(-14, 0, 6 * math.sin(ph)))
    tufts(p, perk=-18)
    return p, {}


def clip_land(t, D):
    down = ramp(t, 0.0, 0.42)
    fly = fly_pose(t, 0.28, amp=0.8, hover=FLY_Z * (1 - down))
    p = P()
    touch = env(t, 0.38, 0.45, 0.48, D)
    squash(p, 1 - 0.14 * touch)
    add(p, "hips", t=(0, 0, -0.06 * touch))
    wings(p, spread=40 * (1 - ramp(t, 0.42, D)))
    out = mix_poses(fly, p, ramp(t, 0.25, 0.45))
    return out, {}


def clip_wave(t, D):
    p = breathe(P(), t, D)
    k = env(t, 0.0, 0.3, D - 0.35, D)
    w = math.sin(TAU * 3 * (t - 0.3) / (D - 0.65)) * env(t, 0.28, 0.4, D - 0.45, D - 0.3)
    # the right wing (the one toward the camera when it faces right) waves
    wings(p, side=-1, spread=118 * k, fwd=22 * k, mid=-20 * k + 28 * w, tip=-12 * k + 18 * w)
    add(p, "hips", r=(0, -4 * k, 0))
    add(p, "head", r=(-6 * k, 10 * k, -8 * k))
    tufts(p, perk=8 * k)
    return p, {"happy": 0.9 * k, "open": 0.35 * k}


def clip_spread(t, D):
    p = breathe(P(), t, D)
    k = env(t, 0.0, 0.35, D - 0.4, D)
    flutter = 5 * math.sin(TAU * 6 * t) * env(t, 0.3, 0.45, D - 0.5, D - 0.4)
    wings(p, spread=(108 + flutter) * k, mid=-14 * k, tip=-18 * k)
    squash(p, 1 + 0.05 * k, "chest")
    add(p, "head", r=(-10 * k, 0, 0))
    tufts(p, perk=12 * k)
    return p, {"open": 0.5 * k}


def clip_ruffle(t, D):
    p = P()
    k = env(t, 0.0, 0.12, 0.6, D)
    shake = math.sin(TAU * 7.5 * t) * k
    add(p, "hips", r=(0, 0, 12 * shake), s=(1 + 0.07 * k, 1 + 0.07 * k, 1 - 0.03 * k))
    add(p, "head", r=(0, 4 * shake, -18 * shake))
    wings(p, spread=16 * k + 8 * shake, mid=6 * shake)
    tufts(p, perk=14 * shake, out=8 * k)
    add(p, "tail", r=(0, 0, -20 * shake))
    return p, {"squint": 0.8 * k}


def clip_preen(t, D):
    p = breathe(P(), t, D)
    k = env(t, 0.0, 0.45, D - 0.45, D)
    mid = env(t, 0.45, 0.6, D - 0.6, D - 0.45)
    nib = math.sin(TAU * 5 * t) * mid
    add(p, "head", r=(26 * k + 7 * nib, 6 * k, -62 * k))
    add(p, "neck", r=(6 * k, 0, -10 * k))
    add(p, "chest", r=(4 * k, 0, -6 * k))
    wings(p, side=-1, spread=22 * k, fwd=-10 * k)
    tufts(p, perk=-6 * k)
    return p, {"open": 0.5 * abs(nib), "squint": 0.6 * k}


def clip_peck(t, D):
    p = breathe(P(), t, D)
    k = env(t, 0.0, 0.3, D - 0.3, D)
    pecks = sum(env(t, c - 0.08, c - 0.02, c, c + 0.1) for c in (0.5, 0.78))
    add(p, "hips", r=(26 * k, 0, 0))
    add(p, "head", r=(26 * k + 18 * pecks, 0, 0))
    add(p, "tail", r=(-24 * k, 0, 0))
    wings(p, spread=10 * k)
    return p, {"open": 0.8 * sum(env(t, c - 0.16, c - 0.1, c - 0.06, c) for c in (0.5, 0.78))}


def sleep_pose(t, D):
    p = P()
    b = math.sin(TAU * t / D)
    add(p, "hips", t=(0, 0, -0.03), s=(1.03, 1.03, 0.97))
    add(p, "chest", r=(-2 * b, 0, 0), s=(1 + 0.018 * b, 1 + 0.018 * b, 1))
    add(p, "head", r=(26 + 2 * b, -8, -22))
    add(p, "neck", r=(6, 0, -6))
    wings(p, spread=-2, fwd=-4)
    tufts(p, perk=-28, out=18)
    add(p, "tail", r=(6, 0, 0))
    return p


def clip_sleep(t, D):
    return sleep_pose(t, D), {"blink": 1.0}


def clip_wake(t, D):
    p = P()
    awake = ramp(t, 0.0, 0.35)
    stretch = env(t, 0.3, 0.75, 1.05, 1.5)
    base = mix_poses(sleep_pose(0, 3.0), breathe(P(), t, 2.4), awake)
    squash(p, 1 + 0.09 * stretch)
    add(p, "head", r=(-22 * stretch, 0, 0))
    wings(p, spread=125 * stretch, mid=-18 * stretch, tip=-20 * stretch)
    tufts(p, perk=14 * stretch)
    out = mix_poses(base, P(), 0)
    for bone, e in p.items():
        add(out, bone, r=e["r"], t=e["t"], s=e["s"])
    yawn = env(t, 0.45, 0.65, 1.0, 1.2)
    return out, {"blink": 1 - ramp(t, 0.2, 0.45), "sleepy": 0.7 * (1 - ramp(t, 0.6, 1.4)) * ramp(t, 0.2, 0.3), "open": yawn, "squint": 0.6 * yawn}


def clip_dance(t, D):
    p = P()
    k = env(t, 0.0, 0.2, D - 0.25, D)
    beat = TAU * t / (D / 4)
    sway = math.sin(beat / 2)
    add(p, "hips", r=(0, 12 * sway * k, 6 * sway * k), t=(0, 0, 0.05 * abs(math.sin(beat / 2)) * k))
    add(p, "head", r=(-4 * k, -14 * sway * k, 0))
    for s in (1, -1):
        up = max(0.0, math.sin(beat / 2 * s))
        wings(p, side=s, spread=(25 + 45 * up) * k, mid=-10 * up * k)
    for s, ph in ((".L", 0), (".R", math.pi)):
        add(p, "leg" + s, t=(0, 0, 0.04 * max(0.0, math.sin(beat / 2 + ph)) * k))
    tufts(p, perk=10 * math.sin(beat) * k)
    add(p, "tail", r=(0, 0, 18 * sway * k))
    return p, {"happy": k}


def clip_sad(t, D):
    p = P()
    k = env(t, 0.0, 0.5, D - 0.5, D)
    sigh = env(t, 0.9, 1.25, 1.35, 1.8)
    add(p, "hips", t=(0, 0, -0.03 * k))
    add(p, "chest", r=(9 * k - 5 * sigh, 0, 0), s=(1 + 0.03 * sigh, 1 + 0.03 * sigh, 1))
    add(p, "head", r=(20 * k, 7 * k, 0))
    wings(p, spread=-3 * k, fwd=-8 * k)
    tufts(p, perk=-30 * k, out=24 * k)
    add(p, "tail", r=(14 * k, 0, 0))
    return p, {"sad": k}


def clip_startled(t, D):
    p = P()
    jump = hop_arc(t, 0.0, 0.3, 0.16)
    k = env(t, 0.0, 0.06, 0.3, D)
    add(p, "root", t=(0, 0, jump))
    squash(p, 1 + 0.1 * env(t, 0.0, 0.05, 0.15, 0.3) - 0.08 * env(t, 0.3, 0.36, 0.4, D))
    wings(p, spread=62 * k, mid=-12 * k, tip=-16 * k)
    tufts(p, perk=22 * k, out=-12 * k)
    add(p, "head", r=(-8 * k, 0, 0))
    return p, {"surprised": k, "open": 0.6 * k}


def clip_celebrate(t, D):
    p = P()
    crouch = env(t, 0.0, 0.2, 0.22, 0.32)
    air = hop_arc(t, 0.28, 1.0, 0.5)
    spin = 360 * ramp(t, 0.32, 0.95)
    land = env(t, 0.98, 1.05, 1.1, 1.35)
    squash(p, 1 - 0.15 * crouch - 0.13 * land + 0.06 * env(t, 0.3, 0.4, 0.8, 0.98))
    add(p, "hips", t=(0, 0, -0.07 * crouch - 0.05 * land))
    add(p, "root", r=(0, 0, spin), t=(0, 0, air))
    up = env(t, 0.25, 0.4, D - 0.4, D)
    flutter = math.sin(TAU * 4 * t) * env(t, 1.1, 1.25, D - 0.45, D - 0.3)
    wings(p, spread=(130 + 14 * flutter) * up, mid=-16 * up, tip=-12 * up)
    tufts(p, perk=-10 * up)
    add(p, "head", r=(-10 * up, 8 * flutter, 0))
    return p, {"happy": env(t, 0.2, 0.35, D - 0.3, D), "open": 0.6 * up}


def clip_hug(t, D):
    p = breathe(P(), t, D)
    k = env(t, 0.0, 0.42, D - 0.42, D)
    sway = math.sin(TAU * (t - 0.42) / 1.0) * env(t, 0.42, 0.6, D - 0.6, D - 0.42)
    wings(p, spread=34 * k, wrap=78 * k, mid=-26 * k, tip=-22 * k)
    add(p, "hips", r=(0, 6 * sway, 0))
    add(p, "chest", s=(1 - 0.03 * k, 1 - 0.03 * k, 1))
    add(p, "head", r=(4 * k, 12 * k + 4 * sway, 0))
    tufts(p, perk=-8 * k, out=6 * k)
    return p, {"happy": k}


# name: (function, seconds, loops)
CLIPS = {
    "idle": (clip_idle, 2.4, True),
    "blink": (clip_blink, 0.3, False),
    "lookLeft": (look(1), 1.8, False),
    "lookRight": (look(-1), 1.8, False),
    "tilt": (clip_tilt, 1.5, False),
    "walk": (clip_walk, 0.6, True),
    "hop": (clip_hop, 0.7, False),
    "turn": (clip_turn, 0.5, False),
    "takeoff": (clip_takeoff, 1.0, False),
    "fly": (clip_fly, 0.45, True),
    "glide": (clip_glide, 1.6, True),
    "land": (clip_land, 0.65, False),
    "wave": (clip_wave, 1.6, False),
    "spread": (clip_spread, 1.5, False),
    "ruffle": (clip_ruffle, 1.1, False),
    "preen": (clip_preen, 2.0, False),
    "peck": (clip_peck, 1.2, False),
    "sleep": (clip_sleep, 3.0, True),
    "wake": (clip_wake, 1.8, False),
    "dance": (clip_dance, 2.4, False),
    "sad": (clip_sad, 2.6, False),
    "startled": (clip_startled, 0.7, False),
    "celebrate": (clip_celebrate, 2.0, False),
    "hug": (clip_hug, 1.8, False),
}

SHAPES = {"lids": LID_KEYS, "beak": ["open"]}


def apply_pose(arm, pose, shapes, prev=None):
    """Set the armature (and the shape keys) to a pose. Returns the quaternions set, for continuity."""
    out = {}
    for pb in arm.pose.bones:
        e = pose.get(pb.name)
        B = pb.bone.matrix_local.to_3x3()
        Bi = B.inverted()
        if e:
            R = Euler([math.radians(a) for a in e["r"]], "XYZ").to_matrix()
            q = (Bi @ R @ B).to_quaternion()
            t = Bi @ Vector(e["t"])
            sx, sy, sz = e["s"]
            sc = Vector([math.sqrt(sum((B[j][i] * (sx, sy, sz)[j]) ** 2 for j in range(3))) for i in range(3)])
        else:
            q, t, sc = Quaternion(), Vector(), Vector((1, 1, 1))
        if prev and pb.name in prev:
            q.make_compatible(prev[pb.name])
        pb.rotation_quaternion = q
        pb.location = t
        pb.scale = sc
        out[pb.name] = q.copy()
    for ob_name, keys in SHAPES.items():
        kbs = bpy.data.objects[ob_name].data.shape_keys.key_blocks
        for key in keys:
            kbs[key].value = max(0.0, min(1.0, shapes.get(key, 0.0)))
    return out


def bake_clips(arm):
    keyed = [bpy.data.objects[name].data.shape_keys for name in SHAPES]
    for target in [arm] + keyed:
        target.animation_data_create()
    for name, (fn, seconds, loops) in CLIPS.items():
        action = bpy.data.actions.new(name)
        for target in [arm] + keyed:
            target.animation_data.action = action
        frames = max(2, round(seconds * FPS))
        prev = None
        for i in range(frames + 1):
            t = seconds * i / frames
            if loops and i == frames:
                t = 0.0  # a loop ends exactly where it starts
            pose, shapes = fn(t, seconds)
            prev = apply_pose(arm, pose, shapes, prev)
            for pb in arm.pose.bones:
                pb.keyframe_insert("rotation_quaternion", frame=i)
                pb.keyframe_insert("location", frame=i)
                pb.keyframe_insert("scale", frame=i)
            for key in keyed:
                for kb in key.key_blocks[1:]:
                    kb.keyframe_insert("value", frame=i)
        action.use_fake_user = True
        action.frame_range = (0, frames)
        action.use_frame_range = True
        for target in [arm] + keyed:
            ad = target.animation_data
            track = ad.nla_tracks.new()
            track.name = name
            strip = track.strips.new(name, 0, action)
            if hasattr(strip, "action_slot") and hasattr(ad, "action_slot") and ad.action_slot:
                strip.action_slot = ad.action_slot
            track.mute = True
            ad.action = None
    # rest pose for the export's bind
    apply_pose(arm, {}, {})


# ---------------------------------------------------------------- render


def setup_render(size):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    try:
        sc.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    world = bpy.data.worlds.new("world")
    sc.world = world
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.9, 0.9, 0.92, 1)
    bg.inputs["Strength"].default_value = 0.42
    for name, rot, energy, color in (
        ("key", (50, 0, -35), 1.0, (1, 0.98, 0.95)),
        ("fill", (60, 0, 50), 0.3, (0.9, 0.94, 1)),
        ("rim", (-55, 0, 160), 1.2, (0.95, 0.97, 1)),
    ):
        light = bpy.data.lights.new(name, "SUN")
        light.energy = energy
        light.color = color
        light.angle = math.radians(12)
        ob = bpy.data.objects.new(name, light)
        ob.rotation_euler = [math.radians(a) for a in rot]
        COL.objects.link(ob)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 3.3
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0, -10, 1.2)
    cam.rotation_euler = (math.radians(90), 0, 0)
    COL.objects.link(cam)
    sc.camera = cam


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def load_pixels(path, size):
    import numpy as np

    img = bpy.data.images.load(path)
    if img.size[0] != size:
        img.scale(size, size)
    a = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
    bpy.data.images.remove(img)
    return a


def sheet(tiles, cols, size, path):
    """Tiles (RGBA arrays, bottom-up rows as Blender stores them) on a light ground."""
    import numpy as np

    rows = (len(tiles) + cols - 1) // cols
    out = np.ones((rows * size, cols * size, 4), dtype=np.float32)
    out[..., :3] = 0.965
    for i, tile in enumerate(tiles):
        r, c = divmod(i, cols)
        y0 = (rows - 1 - r) * size
        x0 = c * size
        alpha = tile[..., 3:4]
        out[y0 : y0 + size, x0 : x0 + size, :3] = tile[..., :3] * alpha + out[y0 : y0 + size, x0 : x0 + size, :3] * (1 - alpha)
    img = bpy.data.images.new("sheet", cols * size, rows * size, alpha=True)
    img.pixels = out.ravel()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


POSES = [("walk", 0.15), ("fly", 0.1), ("wave", 0.75), ("sleep", 0.0), ("dance", 0.95), ("sad", 1.3), ("celebrate", 1.4), ("hug", 0.9), ("startled", 0.12)]


def render_previews(arm, holder, out_dir, palettes, ref_dir, size=320):
    import numpy as np

    os.makedirs(out_dir, exist_ok=True)
    setup_render(size)
    pose_names = [p for p in POSES if p[0] in (arg("--poses") or ",".join(n for n, _ in POSES)).split(",")]
    all_rows = []
    for pal_name, colors in palettes.items():
        set_colors(colors)
        tiles = []
        ref = os.path.join(ref_dir, f"owl2d-{pal_name}.svg.png") if ref_dir else None
        if ref and os.path.exists(ref):
            tiles.append(load_pixels(ref, size))
        apply_pose(arm, {}, {})
        for view, yaw in (("front", 0), ("34", 35), ("side", 90), ("back", 180)):
            holder.rotation_euler = (0, 0, math.radians(yaw))
            path = os.path.join(out_dir, f"{pal_name}-{view}.png")
            render_to(path)
            tiles.append(load_pixels(path, size))
        holder.rotation_euler = (0, 0, math.radians(35))
        for name, t in pose_names:
            fn, seconds, _ = CLIPS[name]
            pose, shapes = fn(t, seconds)
            apply_pose(arm, pose, shapes)
            path = os.path.join(out_dir, f"{pal_name}-pose-{name}.png")
            render_to(path)
            tiles.append(load_pixels(path, size))
        apply_pose(arm, {}, {})
        sheet(tiles, 5, size, os.path.join(out_dir, f"sheet-{pal_name}.png"))
        all_rows.extend(tiles[:5])
    sheet(all_rows, 5, size, os.path.join(out_dir, "sheet-views.png"))
    holder.rotation_euler = (0, 0, 0)


# ------------------------------------------------------------------ main


def main():
    global COL
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    COL = bpy.context.scene.collection
    make_materials()

    head = build_head()
    GEO["head_tree"] = bvh_of(head)
    body = build_body()
    spots = build_spots(body)
    eyeball, iris, pupil, highlight = build_eyes()
    lids = build_lids()
    beak = build_beak()
    tufts_ob = build_tufts()
    wings_ob = build_wings()
    tail = build_tail()
    thighs, feet = build_legs()

    arm = build_armature()
    # the trunk: automatic weights, cleaned (a falloff if bone heat cannot solve it)
    if not auto_bind([body], arm, {"hips", "spine", "chest", "neck"}):
        body.vertex_groups.clear()
        body.modifiers.clear()
        bind(body, arm, trunk_weights)
    bind(head, arm, head_weights)
    bind(spots, arm, copy_weights(spots, body))
    for ob in (eyeball, lids, beak):
        bind(ob, arm, rigid("head"))
    for ob in (iris, pupil, highlight):
        bind(ob, arm, by_side(rigid("eye.L"), rigid("eye.R")))
    bind(tufts_ob, arm, by_side(rigid("tuft.L"), rigid("tuft.R")))
    bind(wings_ob, arm, by_side(wing_weights(1), wing_weights(-1)))
    bind(tail, arm, rigid("tail"))
    bind(thighs, arm, by_side(lambda co: {"leg.L": 0.6, "hips": 0.4}, lambda co: {"leg.R": 0.6, "hips": 0.4}))

    def foot_w(side):
        suf = ".L" if side > 0 else ".R"
        return lambda co: {"foot" + suf: 1.0} if co.z < 0.07 else {"leg" + suf: 1.0}

    bind(feet, arm, by_side(foot_w(1), foot_w(-1)))

    # the whole owl hangs from one node the runtime turns and recolors
    holder = bpy.data.objects.new("owl", None)
    COL.objects.link(holder)
    arm.parent = holder
    holder["sagax"] = {"model": "owl", "version": 2, "fps": FPS, "clips": {n: [round(s, 3), int(l)] for n, (f, s, l) in CLIPS.items()}}

    stats = {ob.name: len(ob.data.vertices) for ob in COL.objects if ob.type == "MESH"}
    print("owl3d: vertices", sum(stats.values()), stats)

    render_dir = arg("--render")
    if render_dir:
        palettes = json.load(open(arg("--palettes"))) if arg("--palettes") else {"green": DEFAULT_COLORS}
        render_previews(arm, holder, render_dir, palettes, arg("--ref"), int(arg("--size", "320")))
        set_colors(DEFAULT_COLORS)

    out = arg("--out")
    if out:
        bake_clips(arm)
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(
            filepath=out,
            export_format="GLB",
            use_selection=False,
            export_yup=True,
            export_apply=True,
            export_texcoords=False,
            export_normals=True,
            export_materials="EXPORT",
            export_image_format="NONE",
            export_extras=True,
            export_skins=True,
            export_def_bones=False,
            export_leaf_bone=False,
            export_morph=True,
            export_morph_normal=False,
            export_animations=True,
            export_animation_mode="NLA_TRACKS",
            export_force_sampling=True,
            export_optimize_animation_size=True,
            export_frame_step=1,
            export_reset_pose_bones=True,
        )
        print("owl3d: wrote", out, os.path.getsize(out))
    if arg("--blend"):
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(arg("--blend")))


main()
