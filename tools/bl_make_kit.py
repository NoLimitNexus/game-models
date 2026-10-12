"""
The body kit: our own characters, built as swappable parts on KayKit's Rig_Medium skeleton, so every animation in
library/animations plays on any mix of parts with no retargeting.

  blender-launcher.exe --background --factory-startup --python bl_make_kit.py -- <log> <outdir> [body] [parts] [tools]

Writes (outdir = library/ours):
  body/Body.glb        the bare body: one skin mesh per region (head, torso, arms, hands, legs, feet) plus the face
  parts/<id>.glb       hair, beards, tops, bottoms, boots, hats, backpack: skinned shells on the same skeleton
  tools/<id>.glb       axe, pickaxe, hammer, net, rod: plain meshes, handle along +Y, origin at the grip
  manifest.json        every file with its slot, the skin regions it hides, its materials and their default colors

How a part fits: its vertices take their bone weights from KayKit's neutral Mannequin (nearest surface), or are rigid to
the head or chest bone. The game attaches a part by rebuilding its skeleton from the character's own bones, and hides the
skin regions a part covers (listed in the manifest) so nothing is drawn twice.

Blender coordinates: Z up, the character faces -Y, arms are out along +/-X (T-pose), left = +X.
Shapes are rounder than the first kit on purpose, and every shape is a few numbers in one function, so the look can be
reshaped later (toward KayKit's polish) without touching the skeleton, the slots or any animation.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

argv = sys.argv[sys.argv.index('--') + 1:]
LOG = open(argv[0], 'w', encoding='utf-8')
OUT = argv[1]
WHAT = set(argv[2:]) or {'body', 'parts', 'tools'}
HERE = os.path.dirname(os.path.abspath(__file__))
RIG_SRC = os.path.join(HERE, 'reference', 'Rig_Medium.glb')
WEIGHT_SRC = os.path.join(HERE, 'reference', 'Mannequin_Medium.glb')


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s)
    LOG.write(s + '\n')
    LOG.flush()


PALETTE = {
    'skin': '#f0c8a0', 'hair': '#5b3a22', 'shirt': '#d9673d', 'trousers': '#3d4250', 'boots': '#3a2a20',
    'belt': '#6b4a30', 'linen': '#f6f1e6', 'hat': '#c9a25a', 'hatband': '#8a3a2a', 'pack': '#7a5a36',
    'eyes': '#241a14', 'eyeshine': '#ffffff', 'mouth': '#a5483a',
    'wood': '#7a5230', 'steel': '#9aa3ad', 'steeldark': '#5d6470', 'rope': '#d8c08a', 'cork': '#b88a55', 'brass': '#c9a24a',
}


def srgb_to_linear(h):
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


# ================================================================ shapes: each returns (verts, faces)
def spow(x, p):
    return math.copysign(abs(x) ** p, x) if x else 0.0


def orient_outward(verts, faces, ref):
    """Flip every face if, on average, the normals point toward the shape's own axis or center (ref(point) -> inside point)."""
    score = 0.0
    for f in faces:
        pts = [Vector(verts[i]) for i in f]
        n = Vector((0, 0, 0))
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        c = sum(pts, Vector((0, 0, 0))) / len(pts)
        score += n.normalized().dot((c - ref(c)).normalized()) if n.length > 1e-12 and (c - ref(c)).length > 1e-9 else 0
    if score < 0:
        faces = [list(reversed(f)) for f in faces]
    return verts, faces


def rotated(vf, center, rx=0.0, ry=0.0, rz=0.0):
    if not (rx or ry or rz):
        return vf
    m = Matrix.Rotation(rz, 3, 'Z') @ Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X')
    c = Vector(center)
    return [tuple(m @ (Vector(v) - c) + c) for v in vf[0]], vf[1]


def moved(vf, d):
    return [(v[0] + d[0], v[1] + d[1], v[2] + d[2]) for v in vf[0]], vf[1]


def mirrored(vf):
    return [(-v[0], v[1], v[2]) for v in vf[0]], [list(reversed(f)) for f in vf[1]]


def ring_faces(rings, closed=True):
    """Quads between consecutive rings; a ring of one vertex is a pole (a fan)."""
    faces = []
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        if len(A) == 1:
            n = len(B)
            for u in range(n):
                faces.append([A[0], B[(u + 1) % n], B[u]])
        elif len(B) == 1:
            n = len(A)
            for u in range(n):
                faces.append([A[u], A[(u + 1) % n], B[0]])
        else:
            n = len(A)
            for u in range(n):
                faces.append([A[u], A[(u + 1) % n], B[(u + 1) % n], B[u]])
    return faces


def ellipsoid(center, radii, n=2.0, m=2.0, segs=16, rings=10, zmin=None, zmax=None, rot=None):
    """A superellipsoid (n = squareness around, m = squareness up; 2 and 2 is a plain ellipsoid), optionally cut to a z band."""
    cx, cy, cz = center
    rx, ry, rz = radii
    tmax = 1.0 if zmax is None else max(-1.0, min(1.0, (zmax - cz) / rz))
    tmin = -1.0 if zmin is None else max(-1.0, min(1.0, (zmin - cz) / rz))
    v0, v1 = math.asin(spow(tmax, m / 2.0)), math.asin(spow(tmin, m / 2.0))
    verts, ring_idx = [], []
    for k in range(rings + 1):
        v = v0 + (v1 - v0) * k / rings
        rad = spow(math.cos(v), 2.0 / m)
        z = cz + rz * spow(math.sin(v), 2.0 / m)
        if rad < 1e-6:
            verts.append((cx, cy, z))
            ring_idx.append([len(verts) - 1])
        else:
            idx = []
            for u in range(segs):
                a = 2 * math.pi * u / segs
                verts.append((cx + rx * rad * spow(math.cos(a), 2.0 / n), cy + ry * rad * spow(math.sin(a), 2.0 / n), z))
                idx.append(len(verts) - 1)
            ring_idx.append(idx)
    faces = ring_faces(ring_idx)
    vf = orient_outward(verts, faces, lambda p: Vector(center))
    return rotated(vf, center, *(rot or (0, 0, 0)))


def closest_on_polyline(pts, p):
    best, bd = pts[0], 1e18
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared)) if ab.length_squared > 0 else 0.0
        q = a + ab * t
        d = (p - q).length_squared
        if d < bd:
            best, bd = q, d
    return best


def tube(points, radii, segs=12, caps=(True, True), cap_rings=3, ellip=(1.0, 1.0)):
    """A tube along a polyline, radius per point, rounded caps (or open ends)."""
    P = [Vector(p) for p in points]
    R = list(radii)
    T = []
    for i in range(len(P)):
        t = (P[1] - P[0]) if i == 0 else (P[-1] - P[-2]) if i == len(P) - 1 else (P[i + 1] - P[i - 1])
        T.append(t.normalized())
    up = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = T[0].cross(up).normalized()
    frames = []
    for t in T:
        nrm = (nrm - t * nrm.dot(t)).normalized()
        frames.append((nrm.copy(), t.cross(nrm)))
    verts, rings = [], []

    def ring(center, nn, bb, rad):
        idx = []
        for u in range(segs):
            a = 2 * math.pi * u / segs
            verts.append(tuple(center + nn * (math.cos(a) * rad * ellip[0]) + bb * (math.sin(a) * rad * ellip[1])))
            idx.append(len(verts) - 1)
        return idx

    if caps[0]:
        verts.append(tuple(P[0] - T[0] * R[0]))
        rings.append([len(verts) - 1])
        for k in range(cap_rings, 0, -1):
            phi = (math.pi / 2) * k / (cap_rings + 1)
            rings.append(ring(P[0] - T[0] * (R[0] * math.sin(phi)), frames[0][0], frames[0][1], R[0] * math.cos(phi)))
    for i in range(len(P)):
        rings.append(ring(P[i], frames[i][0], frames[i][1], R[i]))
    if caps[1]:
        for k in range(1, cap_rings + 1):
            phi = (math.pi / 2) * k / (cap_rings + 1)
            rings.append(ring(P[-1] + T[-1] * (R[-1] * math.sin(phi)), frames[-1][0], frames[-1][1], R[-1] * math.cos(phi)))
        verts.append(tuple(P[-1] + T[-1] * R[-1]))
        rings.append([len(verts) - 1])
    faces = ring_faces(rings)
    return orient_outward(verts, faces, lambda p: closest_on_polyline(P, p))


def lerp_profile(profile, z):
    """Smooth (rx, ry) at height z from a list of (z, rx, ry) control points (Catmull-Rom between them)."""
    pts = profile
    if z <= pts[0][0]:
        return pts[0][1], pts[0][2]
    if z >= pts[-1][0]:
        return pts[-1][1], pts[-1][2]
    for i in range(len(pts) - 1):
        if pts[i][0] <= z <= pts[i + 1][0]:
            p0 = pts[max(i - 1, 0)]
            p1, p2 = pts[i], pts[i + 1]
            p3 = pts[min(i + 2, len(pts) - 1)]
            t = (z - p1[0]) / (p2[0] - p1[0])
            out = []
            for k in (1, 2):
                a, b, c, d = p0[k], p1[k], p2[k], p3[k]
                out.append(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3))
            return max(out[0], 0.0), max(out[1], 0.0)
    return pts[-1][1], pts[-1][2]


def lathe(profile, grow=0.0, zmin=None, zmax=None, segs=20, n=2.4, rings=24, cx=0.0, cy=0.0, close_top=True, close_bottom=True):
    """A body of revolution (elliptical rings) following a profile; with grow it becomes a clothing shell, with zmin/zmax a band."""
    z0 = profile[0][0] if zmin is None else zmin
    z1 = profile[-1][0] if zmax is None else zmax
    verts, rings_idx = [], []
    for k in range(rings + 1):
        z = z1 - (z1 - z0) * k / rings
        rx, ry = lerp_profile(profile, z)
        rx, ry = (rx + grow, ry + grow) if (rx > 1e-6 or grow) else (rx, ry)
        pole = (rx < 1e-6 and ry < 1e-6) or (k == 0 and close_top and zmax is None) or (k == rings and close_bottom and zmin is None)
        if pole and (rx < 0.02 or ry < 0.02):
            verts.append((cx, cy, z))
            rings_idx.append([len(verts) - 1])
        else:
            idx = []
            for u in range(segs):
                a = 2 * math.pi * u / segs
                verts.append((cx + rx * spow(math.cos(a), 2.0 / n), cy + ry * spow(math.sin(a), 2.0 / n), z))
                idx.append(len(verts) - 1)
            rings_idx.append(idx)
    faces = ring_faces(rings_idx)
    mid = (z0 + z1) / 2
    return orient_outward(verts, faces, lambda p: Vector((cx, cy, p.z)))


def prism(poly, half, flat=False):
    """A polygon in the XZ plane (convex), pushed through Y. half(x, z) = half thickness at that point."""
    verts, front, back = [], [], []
    for (x, z) in poly:
        h = half(x, z)
        verts.append((x, -h, z)); front.append(len(verts) - 1)
        verts.append((x, h, z)); back.append(len(verts) - 1)
    n = len(poly)
    faces = [[2 * i for i in range(n)], [2 * i + 1 for i in reversed(range(n))]]
    for i in range(n):
        j = (i + 1) % n
        faces.append([2 * i, 2 * j, 2 * j + 1, 2 * i + 1])
    cx = sum(p[0] for p in poly) / n
    cz = sum(p[1] for p in poly) / n
    return orient_outward(verts, faces, lambda p: Vector((cx, 0, cz)))


# ================================================================ the kit being built
class Kit:
    """Shapes grouped into meshes: one group becomes one mesh, with one material, and each vertex remembers which skin source
    gives it bone weights ('head', 'torso', 'armL', 'armR', 'legL', 'legR' or 'rigid:<bone>')."""

    def __init__(self):
        self.g = {}

    def add(self, group, mat, src, vf, smooth=True):
        v, f = vf
        d = self.g.setdefault(group, {'mat': mat, 'smooth': smooth, 'v': [], 'f': [], 'src': []})
        base = len(d['v'])
        d['v'].extend(v)
        d['src'].extend([src] * len(v))
        d['f'].extend([[i + base for i in face] for face in f])

    def lr(self, group_base, mat, src_base, make, smooth=True):
        """make() builds the left (+X) shape; the right is its mirror image. Groups are <group_base>L and <group_base>R."""
        vf = make()
        self.add(group_base + 'L', mat, src_base + 'L', vf, smooth)
        self.add(group_base + 'R', mat, src_base + 'R', mirrored(vf), smooth)

    def lr_same(self, group, mat, src_base, make, smooth=True):
        """Same, but both sides go into ONE mesh (clothing)."""
        vf = make()
        self.add(group, mat, src_base + 'L', vf, smooth)
        self.add(group, mat, src_base + 'R', mirrored(vf), smooth)


# ---------------------------------------------------------------- the body's measurements (Blender units, same skeleton as KayKit)
HEAD_C = (0.0, 0.0, 1.68)
HEAD_R = (0.50, 0.47, 0.47)
# (z, half width, half depth) of the torso from the hips to the shoulders: the one profile both skin and clothes follow
TORSO = [(0.30, 0.10, 0.09), (0.36, 0.22, 0.18), (0.44, 0.31, 0.24), (0.52, 0.335, 0.255), (0.62, 0.30, 0.235), (0.76, 0.31, 0.24),
         (0.92, 0.345, 0.26), (1.06, 0.365, 0.27), (1.18, 0.33, 0.25), (1.26, 0.22, 0.19), (1.31, 0.09, 0.08)]
ARM_UP = [(0.19, 0.0, 1.107), (0.33, 0.007, 1.107), (0.47, 0.012, 1.107)]
ARM_LO = [(0.44, 0.012, 1.107), (0.58, 0.006, 1.107), (0.72, 0.0, 1.107)]
LEG_UP = [(0.171, 0.0, 0.58), (0.171, -0.004, 0.43), (0.171, -0.006, 0.29)]
LEG_LO = [(0.171, -0.006, 0.30), (0.171, 0.01, 0.20), (0.171, 0.02, 0.10)]


def rigid(bone):
    return 'rigid:' + bone


def build_body(kit):
    head = ellipsoid(HEAD_C, HEAD_R, n=2.3, m=2.3, segs=28, rings=18)
    kit.add('skin_head', 'skin', rigid('head'), head)
    bvh = BVHTree.FromPolygons([Vector(v) for v in head[0]], head[1])

    def front(x, z):
        hit = bvh.ray_cast(Vector((x, -2.0, z)), Vector((0, 1, 0)))
        return hit[0].y if hit[0] is not None else -HEAD_R[1]

    def side(y, z, sign):
        hit = bvh.ray_cast(Vector((sign * 2.0, y, z)), Vector((-sign, 0, 0)))
        return hit[0].x if hit[0] is not None else sign * HEAD_R[0]

    ex, ez = 0.19, 1.70
    for s in (1, -1):
        y = front(s * ex, ez)
        kit.add('face_eyes', 'eyes', rigid('head'), ellipsoid((s * ex, y + 0.012, ez), (0.052, 0.04, 0.083), segs=14, rings=8, rot=(0, 0, s * 0.2)))
        kit.add('face_eyeshine', 'eyeshine', rigid('head'), ellipsoid((s * ex - s * 0.015, y - 0.022, ez + 0.035), (0.017, 0.012, 0.023), segs=10, rings=6))
        by = front(s * ex, 1.86)
        kit.add('face_brows', 'hair', rigid('head'), tube([(s * (ex - 0.075), by + 0.01, 1.855), (s * (ex + 0.075), by + 0.012, 1.875)], [0.02, 0.02], segs=8, cap_rings=2))
        sx = side(0.0, 1.62, s)
        kit.add('skin_head', 'skin', rigid('head'), ellipsoid((sx - s * 0.012, 0.0, 1.62), (0.04, 0.072, 0.095), segs=12, rings=8))
    kit.add('skin_head', 'skin', rigid('head'), ellipsoid((0, front(0, 1.56) - 0.012, 1.56), (0.056, 0.07, 0.06), segs=12, rings=8))
    mouth = [(x, front(x, 1.40 + 0.9 * x * x) + 0.006, 1.40 + 0.9 * x * x) for x in (-0.085, -0.04, 0.0, 0.04, 0.085)]
    kit.add('face_mouth', 'mouth', rigid('head'), tube(mouth, [0.016] * 5, segs=8, cap_rings=2))

    kit.add('skin_torso', 'skin', 'torso', lathe(TORSO, segs=24, n=2.4, rings=30))
    kit.lr('skin_armUpper', 'skin', 'arm', lambda: tube(ARM_UP, [0.125, 0.13, 0.115], segs=12))
    kit.lr('skin_armLower', 'skin', 'arm', lambda: tube(ARM_LO, [0.112, 0.108, 0.10], segs=12))

    def hand():
        v, f = ellipsoid((0.84, 0.0, 1.08), (0.105, 0.088, 0.098), n=2.2, m=2.2, segs=14, rings=9)
        t = ellipsoid((0.815, -0.075, 1.11), (0.04, 0.045, 0.05), segs=10, rings=6)
        base = len(v)
        return v + t[0], f + [[i + base for i in face] for face in t[1]]
    kit.lr('skin_hand', 'skin', 'arm', hand)
    kit.lr('skin_legUpper', 'skin', 'leg', lambda: tube(LEG_UP, [0.145, 0.14, 0.122], segs=12))
    kit.lr('skin_legLower', 'skin', 'leg', lambda: tube(LEG_LO, [0.118, 0.112, 0.10], segs=12))
    kit.lr('skin_foot', 'skin', 'leg', lambda: ellipsoid((0.171, -0.075, 0.07), (0.115, 0.235, 0.075), n=2.3, m=2.2, segs=14, rings=9))


# ---------------------------------------------------------------- parts
def hair_base(kit, mat='hair', back=True, top=True, sides=True, fringe=True):
    if top:
        kit.add('hair', mat, rigid('head'), ellipsoid((0, 0.0, 2.03), (0.535, 0.505, 0.27), n=2.2, m=2.2, segs=22, rings=12))
    if back:
        kit.add('hair', mat, rigid('head'), ellipsoid((0, 0.27, 1.82), (0.51, 0.27, 0.36), n=2.2, m=2.2, segs=20, rings=12))
    if sides:
        for s in (1, -1):
            kit.add('hair', mat, rigid('head'), ellipsoid((s * 0.47, 0.10, 1.85), (0.115, 0.29, 0.25), segs=14, rings=9))
    if fringe:
        kit.add('hair', mat, rigid('head'), ellipsoid((0, -0.37, 2.04), (0.43, 0.13, 0.115), segs=18, rings=9))


def p_hair_short(kit):
    hair_base(kit)


def p_hair_tousled(kit):
    hair_base(kit)
    for (x, y, z, r) in ((0.2, 0.0, 2.27, 0.13), (-0.2, 0.02, 2.26, 0.13), (0.0, 0.12, 2.31, 0.14), (0.0, -0.2, 2.26, 0.11), (0.3, 0.12, 2.2, 0.1)):
        kit.add('hair', 'hair', rigid('head'), ellipsoid((x, y, z), (r, r, r * 1.3), segs=10, rings=6))


def p_hair_long(kit):
    hair_base(kit)
    kit.add('hair', 'hair', rigid('chest'), ellipsoid((0, 0.36, 1.32), (0.47, 0.2, 0.62), n=2.2, m=2.4, segs=18, rings=12))
    for s in (1, -1):
        kit.add('hair', 'hair', rigid('chest'), ellipsoid((s * 0.5, 0.14, 1.48), (0.1, 0.22, 0.36), segs=12, rings=8))


def p_hair_bun(kit):
    hair_base(kit)
    kit.add('hair', 'hair', rigid('head'), ellipsoid((0, 0.2, 2.36), (0.2, 0.2, 0.2), segs=14, rings=9))


def p_hair_ponytail(kit):
    hair_base(kit)
    kit.add('hair', 'hair', rigid('head'), tube([(0, 0.4, 2.0), (0, 0.6, 1.78), (0, 0.68, 1.4)], [0.13, 0.12, 0.05], segs=10))
    kit.add('hair', 'hatband', rigid('head'), ellipsoid((0, 0.43, 1.97), (0.1, 0.07, 0.08), segs=10, rings=6))


def p_hair_balding(kit):
    hair_base(kit, top=False, fringe=False)
    kit.add('hair', 'hair', rigid('head'), ellipsoid((0, 0.22, 1.9), (0.5, 0.3, 0.22), segs=18, rings=10, zmax=1.97))


def p_beard_short(kit):
    kit.add('beard', 'hair', rigid('head'), ellipsoid((0, -0.2, 1.31), (0.40, 0.3, 0.2), n=2.2, m=2.2, segs=20, rings=10, zmax=1.46))
    kit.add('beard', 'hair', rigid('head'), ellipsoid((0, front_y(1.47) - 0.01, 1.47), (0.2, 0.06, 0.05), segs=12, rings=6))


def front_y(z):
    return -HEAD_R[1] * 0.95


def p_beard_long(kit):
    p_beard_short(kit)
    kit.add('beard', 'hair', rigid('chest'), ellipsoid((0, -0.28, 1.0), (0.3, 0.13, 0.42), n=2.2, m=2.2, segs=16, rings=12))


def sleeve(x0, x1, r0, r1, caps=(False, False)):
    return tube([(x0, 0.0, 1.107), ((x0 + x1) / 2, 0.006, 1.107), (x1, 0.01, 1.107)], [r0, (r0 + r1) / 2, r1], segs=14, caps=caps)


def collar(kit, mat='linen'):
    kit.add('collar', mat, 'torso', lathe(TORSO, grow=0.045, zmin=1.205, zmax=1.285, segs=24, n=2.4, rings=4, close_top=False, close_bottom=False))


def p_top_tee(kit):
    kit.add('shirt', 'shirt', 'torso', lathe(TORSO, grow=0.03, zmin=0.58, zmax=1.285, segs=24, n=2.4, rings=26, close_top=False, close_bottom=False))
    kit.lr_same('shirt', 'shirt', 'arm', lambda: sleeve(0.15, 0.45, 0.158, 0.145))
    collar(kit)


def p_top_long(kit):
    kit.add('shirt', 'shirt', 'torso', lathe(TORSO, grow=0.03, zmin=0.58, zmax=1.285, segs=24, n=2.4, rings=26, close_top=False, close_bottom=False))
    kit.lr_same('shirt', 'shirt', 'arm', lambda: sleeve(0.15, 0.68, 0.158, 0.125))
    kit.lr_same('cuff', 'linen', 'arm', lambda: sleeve(0.65, 0.73, 0.133, 0.13))
    collar(kit)


def p_top_tunic(kit):
    kit.add('shirt', 'shirt', 'torso', lathe(TORSO, grow=0.03, zmin=0.58, zmax=1.285, segs=24, n=2.4, rings=26, close_top=False, close_bottom=False))
    kit.add('shirt', 'shirt', 'torso', tube([(0, 0, 0.66), (0, 0, 0.46), (0, 0, 0.27)], [0.355, 0.395, 0.45], segs=24, caps=(False, False), ellip=(1.0, 0.8)))
    kit.lr_same('shirt', 'shirt', 'arm', lambda: sleeve(0.15, 0.68, 0.158, 0.125))
    kit.lr_same('cuff', 'linen', 'arm', lambda: sleeve(0.65, 0.73, 0.133, 0.13))
    kit.add('belt', 'belt', 'torso', tube([(0, 0, 0.585), (0, 0, 0.655)], [0.345, 0.345], segs=24, caps=(False, False), ellip=(1.0, 0.8)))
    collar(kit)


def belt(kit):
    kit.add('belt', 'belt', 'torso', tube([(0, 0, 0.575), (0, 0, 0.645)], [0.335, 0.335], segs=24, caps=(False, False), ellip=(1.0, 0.8)))
    kit.add('belt', 'brass', 'torso', ellipsoid((0, -0.272, 0.61), (0.045, 0.02, 0.05), n=3, m=3, segs=10, rings=6))


def p_bottom_trousers(kit):
    kit.add('trousers', 'trousers', 'torso', lathe(TORSO, grow=0.03, zmin=0.34, zmax=0.65, segs=24, n=2.4, rings=14, close_top=False, close_bottom=False))
    kit.lr_same('trousers', 'trousers', 'leg', lambda: tube([(0.171, 0, 0.60), (0.171, -0.004, 0.43), (0.171, -0.006, 0.295)], [0.178, 0.17, 0.152], segs=14, caps=(False, False)))
    kit.lr_same('trousers', 'trousers', 'leg', lambda: tube([(0.171, -0.006, 0.31), (0.171, 0.01, 0.20), (0.171, 0.02, 0.105)], [0.15, 0.142, 0.128], segs=14, caps=(False, False)))
    belt(kit)


def p_bottom_shorts(kit):
    kit.add('trousers', 'trousers', 'torso', lathe(TORSO, grow=0.03, zmin=0.34, zmax=0.65, segs=24, n=2.4, rings=14, close_top=False, close_bottom=False))
    kit.lr_same('trousers', 'trousers', 'leg', lambda: tube([(0.171, 0, 0.60), (0.171, -0.004, 0.45), (0.171, -0.005, 0.345)], [0.178, 0.172, 0.16], segs=14, caps=(False, False)))
    belt(kit)


def foot_shell(grow):
    return ellipsoid((0.171, -0.075, 0.07), (0.115 + grow, 0.235 + grow, 0.075 + grow), n=2.3, m=2.2, segs=16, rings=10)


def p_boots_tall(kit):
    kit.lr_same('boots', 'boots', 'leg', lambda: foot_shell(0.025))
    kit.lr_same('boots', 'boots', 'leg', lambda: tube([(0.171, 0.012, 0.25), (0.171, 0.016, 0.16), (0.171, 0.02, 0.07)], [0.158, 0.148, 0.14], segs=14, caps=(False, False)))
    kit.lr_same('cuff', 'linen', 'leg', lambda: tube([(0.171, 0.012, 0.245), (0.171, 0.012, 0.275)], [0.16, 0.16], segs=14, caps=(False, False)))


def p_boots_low(kit):
    kit.lr_same('boots', 'boots', 'leg', lambda: foot_shell(0.022))
    kit.lr_same('boots', 'boots', 'leg', lambda: tube([(0.171, 0.018, 0.14), (0.171, 0.02, 0.085)], [0.135, 0.14], segs=14, caps=(False, False)))


def p_hat_straw(kit):
    kit.add('hat', 'hat', rigid('head'), ellipsoid((0, 0.0, 2.1), (0.6, 0.575, 0.38), n=2.2, m=2.2, segs=26, rings=12, zmin=1.98))
    kit.add('hat', 'hat', rigid('head'), ellipsoid((0, 0.0, 1.985), (1.0, 0.96, 0.05), n=2.0, m=2.0, segs=32, rings=6))
    kit.add('hatband', 'hatband', rigid('head'), tube([(0, 0, 1.99), (0, 0, 2.09)], [0.605, 0.605], segs=26, caps=(False, False), ellip=(1.0, 0.96)))


def p_hat_cap(kit):
    kit.add('hat', 'hat', rigid('head'), ellipsoid((0, 0.0, 2.07), (0.58, 0.55, 0.3), n=2.2, m=2.2, segs=24, rings=11, zmin=1.96))
    kit.add('hat', 'hat', rigid('head'), ellipsoid((0, -0.5, 1.99), (0.34, 0.3, 0.035), segs=18, rings=6, rot=(-0.12, 0, 0)))


def p_hat_beanie(kit):
    kit.add('hat', 'hat', rigid('head'), ellipsoid((0, 0.0, 2.05), (0.57, 0.545, 0.42), n=2.2, m=2.2, segs=24, rings=12, zmin=1.9))
    kit.add('hatband', 'hatband', rigid('head'), tube([(0, 0, 1.9), (0, 0, 1.98)], [0.575, 0.575], segs=24, caps=(False, False), ellip=(1.0, 0.955)))
    kit.add('hatband', 'hatband', rigid('head'), ellipsoid((0, 0.0, 2.46), (0.12, 0.12, 0.12), segs=12, rings=7))


def p_back_pack(kit):
    kit.add('pack', 'pack', 'torso', ellipsoid((0, 0.36, 0.93), (0.25, 0.14, 0.3), n=3.0, m=3.0, segs=18, rings=12))
    kit.add('pack', 'pack', 'torso', ellipsoid((0, 0.36, 1.18), (0.25, 0.145, 0.07), n=3.0, m=2.4, segs=18, rings=8))
    kit.add('pack', 'hatband', 'torso', ellipsoid((0, 0.45, 0.88), (0.13, 0.03, 0.12), n=3.0, m=3.0, segs=12, rings=6))
    for s in (1, -1):
        kit.add('pack', 'belt', 'torso', tube([(s * 0.17, 0.3, 1.2), (s * 0.18, -0.05, 1.28), (s * 0.19, -0.27, 1.12), (s * 0.18, -0.26, 0.82)], [0.03] * 4, segs=8, cap_rings=2))


PARTS = {
    # id: (slot, display name, skin regions it hides, builder)
    'hair_short': ('hair', 'Short hair', [], p_hair_short),
    'hair_tousled': ('hair', 'Tousled hair', [], p_hair_tousled),
    'hair_long': ('hair', 'Long hair', [], p_hair_long),
    'hair_bun': ('hair', 'Hair bun', [], p_hair_bun),
    'hair_ponytail': ('hair', 'Ponytail', [], p_hair_ponytail),
    'hair_balding': ('hair', 'Balding', [], p_hair_balding),
    'beard_short': ('beard', 'Short beard', [], p_beard_short),
    'beard_long': ('beard', 'Long beard', [], p_beard_long),
    'top_tee': ('top', 'T-shirt', ['skin_torso', 'skin_armUpperL', 'skin_armUpperR'], p_top_tee),
    'top_long': ('top', 'Long sleeves', ['skin_torso', 'skin_armUpperL', 'skin_armUpperR', 'skin_armLowerL', 'skin_armLowerR'], p_top_long),
    'top_tunic': ('top', 'Tunic', ['skin_torso', 'skin_armUpperL', 'skin_armUpperR', 'skin_armLowerL', 'skin_armLowerR'], p_top_tunic),
    'bottom_trousers': ('bottom', 'Trousers', ['skin_legUpperL', 'skin_legUpperR', 'skin_legLowerL', 'skin_legLowerR'], p_bottom_trousers),
    'bottom_shorts': ('bottom', 'Shorts', ['skin_legUpperL', 'skin_legUpperR'], p_bottom_shorts),
    'boots_tall': ('boots', 'Tall boots', ['skin_footL', 'skin_footR'], p_boots_tall),
    'boots_low': ('boots', 'Shoes', ['skin_footL', 'skin_footR'], p_boots_low),
    'hat_straw': ('hat', 'Straw hat', [], p_hat_straw),
    'hat_cap': ('hat', 'Flat cap', [], p_hat_cap),
    'hat_beanie': ('hat', 'Beanie', [], p_hat_beanie),
    'back_pack': ('back', 'Backpack', [], p_back_pack),
}
DEFAULT_COLORS = {'hat_straw': {'hat': '#d9b866'}, 'hat_cap': {'hat': '#5b6b8a'}, 'hat_beanie': {'hat': '#b8452e', 'hatband': '#f6f1e6'}}


# ---------------------------------------------------------------- tools (Y up in the game: handle along +Z here; the edge side is +X)
# (+X leads: KayKit's Chopping clip swings the head forward and down with the tool's +X in front, so an edge on +X strikes first;
#  measured 2026-10-12 after the owner saw the axe blade backwards in the game.)
def handle(z0, z1, r0, r1):
    return tube([(0, 0, z0), (0, 0, (z0 + z1) / 2), (0, 0, z1)], [r0, (r0 + r1) / 2, r1], segs=10, cap_rings=2)


def t_axe(kit):
    kit.add('wood', 'wood', None, handle(-0.27, 0.86, 0.036, 0.03))
    kit.add('wood', 'cork', None, tube([(0, 0, -0.1), (0, 0, 0.2)], [0.042, 0.042], segs=10, cap_rings=2))
    poly = [(-0.13, 0.62), (-0.13, 0.92), (-0.02, 0.97), (0.3, 1.07), (0.58, 1.12), (0.63, 0.74), (0.3, 0.64), (-0.02, 0.66)]
    kit.add('steel', 'steel', None, prism(poly, lambda x, z: 0.035 if x < 0.22 else max(0.008, 0.035 - 0.027 * (x - 0.22) / 0.4)), smooth=False)
    kit.add('steeldark', 'steeldark', None, tube([(0, 0, 0.6), (0, 0, 1.0)], [0.052, 0.052], segs=8, caps=(True, True), cap_rings=1))


def t_pickaxe(kit):
    kit.add('wood', 'wood', None, handle(-0.43, 1.22, 0.04, 0.034))
    kit.add('wood', 'cork', None, tube([(0, 0, -0.2), (0, 0, 0.25)], [0.046, 0.046], segs=10, cap_rings=2))
    for s in (1, -1):
        pts = [(s * 0.04, 0, 1.22), (s * 0.28, 0, 1.25), (s * 0.5, 0, 1.18), (s * 0.66, 0, 1.04)]
        kit.add('steel', 'steel', None, tube(pts, [0.06, 0.05, 0.034, 0.008], segs=8, caps=(False, True), cap_rings=1), smooth=True)
    kit.add('steeldark', 'steeldark', None, ellipsoid((0, 0, 1.22), (0.085, 0.075, 0.1), segs=10, rings=6))


def t_hammer(kit):
    kit.add('wood', 'wood', None, handle(-0.27, 0.78, 0.036, 0.03))
    kit.add('wood', 'cork', None, tube([(0, 0, -0.1), (0, 0, 0.2)], [0.042, 0.042], segs=10, cap_rings=2))
    kit.add('steel', 'steel', None, ellipsoid((0, 0, 0.86), (0.2, 0.09, 0.1), n=3.2, m=3.2, segs=14, rings=8), smooth=True)
    kit.add('steeldark', 'steeldark', None, ellipsoid((0.2, 0, 0.86), (0.04, 0.095, 0.105), n=3, m=3, segs=10, rings=6))
    kit.add('steeldark', 'steeldark', None, ellipsoid((-0.2, 0, 0.86), (0.04, 0.095, 0.105), n=3, m=3, segs=10, rings=6))


def t_net(kit):
    kit.add('wood', 'wood', None, handle(-0.3, 1.02, 0.034, 0.028))
    kit.add('wood', 'cork', None, tube([(0, 0, -0.12), (0, 0, 0.2)], [0.04, 0.04], segs=10, cap_rings=2))
    # the hoop lies flat (XY plane) at the top of the handle; the bag hangs below it
    pts = [(0.26 * math.cos(a), 0.26 * math.sin(a), 1.1) for a in [i * math.pi / 10 for i in range(21)]]
    kit.add('wood', 'wood', None, tube(pts, [0.02] * len(pts), segs=6, cap_rings=1))
    for k in range(8):
        a = k * math.pi * 2 / 8
        strand = [(0.26 * math.cos(a) * (1 - t * 0.85), 0.26 * math.sin(a) * (1 - t * 0.85), 1.1 - 0.42 * t * (1.0 + 0.3 * t)) for t in (0, 0.25, 0.5, 0.75, 1.0)]
        kit.add('rope', 'rope', None, tube(strand, [0.009] * 5, segs=5, cap_rings=1))
    for t, rr in ((0.33, 0.26 * 0.62), (0.66, 0.26 * 0.33)):
        circ = [(rr * math.cos(i * math.pi / 5), rr * math.sin(i * math.pi / 5), 1.1 - 0.42 * t * (1.0 + 0.3 * t)) for i in range(11)]
        kit.add('rope', 'rope', None, tube(circ, [0.008] * 11, segs=5, cap_rings=1))


def t_rod(kit):
    kit.add('cork', 'cork', None, tube([(0, 0, -0.28), (0, 0, 0.1), (0, 0, 0.3)], [0.034, 0.038, 0.034], segs=10, cap_rings=2))
    kit.add('wood', 'wood', None, tube([(0, 0, 0.28), (0, 0, 0.8), (0.0, 0.0, 1.3), (0.0, -0.06, 1.7)], [0.026, 0.02, 0.013, 0.006], segs=8, cap_rings=1))
    kit.add('steeldark', 'steeldark', None, ellipsoid((0.0, 0.07, 0.18), (0.05, 0.035, 0.05), segs=10, rings=6))
    kit.add('brass', 'brass', None, ellipsoid((0.0, 0.11, 0.18), (0.012, 0.012, 0.045), segs=8, rings=5))


def t_spoon(kit):
    # a long wooden spoon for stirring the pot: a handle, a worn grip, a flat bowl at the end
    kit.add('wood', 'wood', None, handle(-0.25, 0.95, 0.032, 0.026))
    kit.add('wood', 'cork', None, tube([(0, 0, -0.1), (0, 0, 0.2)], [0.04, 0.04], segs=10, cap_rings=2))
    kit.add('wood', 'wood', None, ellipsoid((0, 0, 1.06), (0.085, 0.03, 0.15), n=2.4, m=2.4, segs=14, rings=8))


# tools are drawn a little oversize so they read from the game's high camera (scaled about the grip)
TOOL_SCALE = {'axe': 1.2, 'pickaxe': 1.2, 'hammer': 1.2, 'net': 1.15, 'rod': 1.1, 'spoon': 1.15}

TOOLS = {
    'axe': ('Axe', t_axe), 'pickaxe': ('Pickaxe', t_pickaxe), 'hammer': ('Hammer', t_hammer), 'net': ('Fishing net', t_net),
    'rod': ('Fishing rod', t_rod), 'spoon': ('Wooden spoon', t_spoon),
}


# ================================================================ Blender side
def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_weight_sources():
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=WEIGHT_SRC)
    region = {'torso': 'Body', 'armL': 'ArmLeft', 'armR': 'ArmRight', 'legL': 'LegLeft', 'legR': 'LegRight'}
    out = {}
    for key, part in region.items():
        obj = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith('_' + part))
        me = obj.data
        names = {g.index: g.name for g in obj.vertex_groups}
        verts = [obj.matrix_world @ v.co for v in me.vertices]
        weights = [{names[g.group]: g.weight for g in v.groups if g.weight > 1e-4} for v in me.vertices]
        tris = []
        for p in me.polygons:
            idx = list(p.vertices)
            for i in range(1, len(idx) - 1):
                tris.append((idx[0], idx[i], idx[i + 1]))
        out[key] = {'bvh': BVHTree.FromPolygons(verts, tris), 'verts': verts, 'tris': tris, 'w': weights}
    log('weight sources ready', sorted(out))
    return out


def weights_at(src, co):
    loc, nrm, fi, dist = src['bvh'].find_nearest(co)
    tri = src['tris'][fi]
    bary = poly_3d_calc([src['verts'][i] for i in tri], loc)
    acc = {}
    for bw, vi in zip(bary, tri):
        for name, w in src['w'][vi].items():
            acc[name] = acc.get(name, 0.0) + w * bw
    return acc


def top_influences(acc, n=4):
    items = sorted(acc.items(), key=lambda kv: -kv[1])[:n]
    total = sum(w for _, w in items) or 1.0
    return [(k, w / total) for k, w in items if w / total > 0.01]


def new_material(name, hexcolor):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = srgb_to_linear(hexcolor)
    b.inputs['Roughness'].default_value = 0.85
    b.inputs['Metallic'].default_value = 0.0
    m.diffuse_color = srgb_to_linear(hexcolor)
    return m


def build_scene(kit, name, skinned, sources, colors):
    """Fresh scene with the skeleton (when skinned), one object per group, weights, materials. Returns (arm, tris, materials used)."""
    clear_scene()
    arm = None
    if skinned:
        bpy.ops.import_scene.gltf(filepath=RIG_SRC)
        arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
        for o in list(bpy.data.objects):
            if o.type == 'MESH':
                bpy.data.objects.remove(o, do_unlink=True)
        arm.name = 'Rig_Medium'
    mats, tris = {}, 0
    for gname, d in kit.g.items():
        me = bpy.data.meshes.new(gname)
        me.from_pydata([tuple(v) for v in d['v']], [], d['f'])
        me.update()
        for p in me.polygons:
            p.use_smooth = d['smooth']
        mname = d['mat']
        if mname not in mats:
            mats[mname] = new_material(mname, colors.get(mname, PALETTE[mname]))
        me.materials.append(mats[mname])
        obj = bpy.data.objects.new(gname, me)
        bpy.context.scene.collection.objects.link(obj)
        tris += sum(len(p.vertices) - 2 for p in me.polygons)
        if not skinned:
            continue
        for bone in arm.data.bones:
            obj.vertex_groups.new(name=bone.name)
        for i, (co, src) in enumerate(zip(d['v'], d['src'])):
            if src.startswith('rigid:'):
                infl = [(src[6:], 1.0)]
            else:
                infl = top_influences(weights_at(sources[src], Vector(co)))
            for bone_name, w in infl:
                obj.vertex_groups[bone_name].add([i], w, 'REPLACE')
        obj.parent = arm
        mod = obj.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
    return arm, tris, {k: colors.get(k, PALETTE[k]) for k in mats}


def export(path, skinned):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False, export_skins=skinned,
                              export_animations=False, export_materials='EXPORT', export_cameras=False, export_lights=False)
    return os.path.getsize(path)


manifest = {'body': None, 'parts': [], 'tools': []}
mpath = os.path.join(OUT, 'manifest.json')
if os.path.exists(mpath):
    try:
        manifest.update({k: v for k, v in json.load(open(mpath, encoding='utf-8')).items() if k in manifest})
    except Exception:
        pass

sources = load_weight_sources() if ({'body', 'parts'} & WHAT) else None

if 'body' in WHAT:
    kit = Kit()
    build_body(kit)
    arm, tris, mats = build_scene(kit, 'Body', True, sources, {})
    size = export(os.path.join(OUT, 'body', 'Body.glb'), True)
    manifest['body'] = {'id': 'Body', 'file': 'body/Body.glb', 'tris': tris, 'materials': mats, 'meshes': sorted(kit.g)}
    log('body', size // 1024, 'KB', tris, 'tris', len(kit.g), 'meshes')

if 'parts' in WHAT:
    manifest['parts'] = []
    for pid, (slot, label, hides, fn) in PARTS.items():
        try:
            kit = Kit()
            fn(kit)
            arm, tris, mats = build_scene(kit, pid, True, sources, DEFAULT_COLORS.get(pid, {}))
            size = export(os.path.join(OUT, 'parts', pid + '.glb'), True)
            manifest['parts'].append({'id': pid, 'slot': slot, 'name': label, 'hides': hides, 'file': f'parts/{pid}.glb', 'tris': tris, 'materials': mats})
            log('part', pid, size // 1024, 'KB', tris, 'tris')
        except Exception as e:
            import traceback
            log('FAILED part', pid, repr(e))
            log(traceback.format_exc())

if 'tools' in WHAT:
    manifest['tools'] = []
    for tid, (label, fn) in TOOLS.items():
        try:
            kit = Kit()
            fn(kit)
            arm, tris, mats = build_scene(kit, tid, False, None, {})
            size = export(os.path.join(OUT, 'tools', tid + '.glb'), False)
            manifest['tools'].append({'id': tid, 'name': label, 'file': f'tools/{tid}.glb', 'tris': tris, 'materials': mats, 'bone': 'handslot.r', 'scale': TOOL_SCALE.get(tid, 1.0)})
            log('tool', tid, size // 1024, 'KB', tris, 'tris')
        except Exception as e:
            import traceback
            log('FAILED tool', tid, repr(e))
            log(traceback.format_exc())

json.dump(manifest, open(mpath, 'w', encoding='utf-8'), indent=1)
log('DONE')
