"""
Our own characters on KayKit's Rig_Medium skeleton, so all 132 KayKit animations play on them unchanged.

  blender-launcher.exe --background --factory-startup --python bl_make_character.py -- <log> <outdir> <spec.json> [...]

How it works
  1. The skeleton comes from KayKit's Knight.glb (23 bones, same names and rest pose as every animation file).
  2. The body is built from simple shapes (boxes and tubes, bevelled) in a spec's colors, one mesh per material.
  3. Skin weights are copied from KayKit's neutral Mannequin by nearest surface (head parts are rigid to the head
     bone), so the joints bend the way KayKit's own characters do.
  4. Exported as GLB: skeleton + one skinned mesh per material (skin, shirt, trousers, ...), no textures, so the
     game can recolor any part by material name.

Blender coordinates here: Z up, the character faces -Y, arms are out along +/-X (T-pose), left = +X.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

argv = sys.argv[sys.argv.index('--') + 1:]
LOG = open(argv[0], 'w', encoding='utf-8')
OUT_DIR = argv[1]
SPECS = argv[2:]
HERE = os.path.dirname(os.path.abspath(__file__))
ARMATURE_SRC = os.path.join(HERE, '..', 'library', 'kaykit', 'characters', 'Knight.glb')
WEIGHT_SRC = os.path.join(HERE, 'reference', 'Mannequin_Medium.glb')


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s)
    LOG.write(s + '\n')
    LOG.flush()


def srgb_to_linear(h):
    h = h.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (out[0], out[1], out[2], 1.0)


DEFAULT_COLORS = {
    'skin': '#f0c8a0', 'shirt': '#d9673d', 'trousers': '#3d4250', 'boots': '#3a2a20', 'belt': '#6b4a30',
    'linen': '#f6f1e6', 'hair': '#4a3222', 'eyes': '#241a14', 'eyeshine': '#ffffff', 'mouth': '#a5483a',
}

# ---------------------------------------------------------------- shape helpers (each builds into its own bmesh)


def finish_bevel(bm, edges, offset, seg=2):
    if offset > 0 and edges:
        bmesh.ops.bevel(bm, geom=list(edges), offset=offset, offset_type='OFFSET', profile=0.5, segments=seg, affect='EDGES')


def box(size, center, bevel=0.05, seg=2, taper=None):
    """Rounded box. taper=(z_low_factor,) narrows the bottom (x and y scaled by that factor at the lowest verts)."""
    def build(bm):
        r = bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=size, verts=r['verts'])
        if taper is not None:
            half = size[2] / 2
            for v in r['verts']:
                if v.co.z < 0:
                    v.co.x *= taper
                    v.co.y *= taper
        finish_bevel(bm, list(bm.edges), bevel, seg)
        bmesh.ops.translate(bm, vec=center, verts=list(bm.verts))
    return build


def tube_x(x0, x1, r0, r1, y=0.0, z=1.107, seg=10, bevel=0.025, bevel_start=True, bevel_end=True):
    """A tube along +X from x0 to x1 (x0 < x1), radius r0 at x0 and r1 at x1."""
    def build(bm):
        depth = x1 - x0
        res = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=depth)
        caps = []
        for e in bm.edges:
            zs = [v.co.z for v in e.verts]
            if all(abs(z + depth / 2) < 1e-5 for z in zs) and bevel_start:
                caps.append(e)
            elif all(abs(z - depth / 2) < 1e-5 for z in zs) and bevel_end:
                caps.append(e)
        finish_bevel(bm, caps, bevel, 2)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'Y'), verts=list(bm.verts))
        bmesh.ops.translate(bm, vec=((x0 + x1) / 2, y, z), verts=list(bm.verts))
    return build


def tube_z(z0, z1, r0, r1, x=0.0, y=0.0, seg=10, bevel=0.025):
    """A tube along +Z from z0 (radius r0) to z1 (radius r1)."""
    def build(bm):
        depth = z1 - z0
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=depth)
        caps = [e for e in bm.edges if all(abs(abs(v.co.z) - depth / 2) < 1e-5 for v in e.verts)]
        finish_bevel(bm, caps, bevel, 2)
        bmesh.ops.translate(bm, vec=(x, y, (z0 + z1) / 2), verts=list(bm.verts))
    return build


def blob(radius, center, scale=(1, 1, 1)):
    def build(bm):
        r = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=radius)
        bmesh.ops.scale(bm, vec=scale, verts=r['verts'])
        bmesh.ops.translate(bm, vec=center, verts=r['verts'])
    return build


# ---------------------------------------------------------------- the character


class Builder:
    def __init__(self):
        self.mats = {}   # material name -> {'v': [co...], 'f': [[idx...]], 'src': [code...]}

    def add(self, mat, src, build, mirror=False):
        bm = bmesh.new()
        build(bm)
        if mirror:
            bmesh.ops.scale(bm, vec=(-1, 1, 1), verts=list(bm.verts))
            bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        m = self.mats.setdefault(mat, {'v': [], 'f': [], 'src': []})
        base = len(m['v'])
        vi = {}
        for v in bm.verts:
            vi[v] = base + len(vi)
            m['v'].append(v.co.copy())
            m['src'].append(src)
        for f in bm.faces:
            m['f'].append([vi[v] for v in f.verts])
        bm.free()

    def both(self, mat, src_base, build):
        self.add(mat, src_base + 'L', build, mirror=False)
        self.add(mat, src_base + 'R', build, mirror=True)


def build_character(spec):
    b = Builder()
    hair = spec.get('hair', 'short')
    sleeves = spec.get('sleeves', 'long')
    legs = spec.get('trousers', 'long')

    # --- head (rigid to the head bone)
    HZ = 1.68
    b.add('skin', 'head', box((0.95, 0.90, 0.92), (0, 0, HZ), bevel=0.2, seg=3))
    b.add('skin', 'head', box((0.10, 0.10, 0.13), (0, -0.475, 1.56), bevel=0.035))                       # nose
    b.add('skin', 'head', box((0.07, 0.12, 0.20), (0.49, 0.0, 1.60), bevel=0.025), mirror=False)          # ears
    b.add('skin', 'head', box((0.07, 0.12, 0.20), (-0.49, 0.0, 1.60), bevel=0.025))
    for sx in (1, -1):
        b.add('eyes', 'head', box((0.10, 0.05, 0.16), (sx * 0.20, -0.455, 1.70), bevel=0.02))
        b.add('eyeshine', 'head', box((0.04, 0.02, 0.05), (sx * 0.20 - 0.02, -0.482, 1.745), bevel=0.008))
        b.add('hair', 'head', box((0.19, 0.04, 0.05), (sx * 0.20, -0.455, 1.88), bevel=0.012))             # brows
    b.add('mouth', 'head', box((0.17, 0.04, 0.04), (0, -0.455, 1.39), bevel=0.012))

    if hair != 'bald':
        top = (1.0, 0.99, 0.28)
        b.add('hair', 'head', box(top, (0, 0.0, 2.07), bevel=0.1, seg=2))                                  # cap
        b.add('hair', 'head', box((0.96, 0.10, 0.20), (0, -0.44, 1.97), bevel=0.04))                       # fringe
        for sx in (1, -1):
            b.add('hair', 'head', box((0.07, 0.62, 0.30), (sx * 0.485, 0.17, 1.80), bevel=0.03))           # sides
        b.add('hair', 'head', box((0.98, 0.12, 0.58), (0, 0.45, 1.78), bevel=0.05))                        # back
        if hair == 'long':
            b.add('hair', 'head', box((0.98, 0.14, 0.62), (0, 0.46, 1.28), bevel=0.05))
            for sx in (1, -1):
                b.add('hair', 'head', box((0.07, 0.40, 0.50), (sx * 0.485, 0.28, 1.35), bevel=0.03))
        elif hair == 'bun':
            b.add('hair', 'head', blob(0.21, (0, 0.18, 2.34)))

    # --- torso
    b.add('shirt', 'torso', box((0.70, 0.50, 0.74), (0, 0, 0.89), bevel=0.11, seg=3, taper=0.88))
    b.add('belt', 'torso', box((0.66, 0.53, 0.075), (0, 0, 0.58), bevel=0.02))
    b.add('linen', 'torso', box((0.50, 0.40, 0.07), (0, 0, 1.25), bevel=0.025))                            # collar
    b.add('trousers', 'torso', box((0.62, 0.46, 0.30), (0, 0, 0.47), bevel=0.09, seg=2))                   # pelvis

    # --- arms (built on the left, +X, and mirrored for the right)
    if sleeves == 'long':
        b.both('shirt', 'arm', tube_x(0.20, 0.66, 0.135, 0.12, bevel=0.03))
    else:
        b.both('shirt', 'arm', tube_x(0.20, 0.46, 0.135, 0.125, bevel=0.03))
        b.both('skin', 'arm', tube_x(0.44, 0.70, 0.105, 0.095, bevel=0.02))
    b.both('linen', 'arm', tube_x(0.64, 0.72, 0.13, 0.13, bevel=0.015))                                    # cuff
    b.both('skin', 'arm', box((0.20, 0.17, 0.19), (0.835, 0, 1.09), bevel=0.05, seg=2))                   # hand

    # --- legs
    LX = 0.171
    if legs == 'long':
        b.both('trousers', 'leg', tube_z(0.20, 0.60, 0.125, 0.15, x=LX, bevel=0.02))
    else:
        b.both('trousers', 'leg', tube_z(0.36, 0.60, 0.13, 0.15, x=LX, bevel=0.02))
        b.both('skin', 'leg', tube_z(0.18, 0.38, 0.095, 0.10, x=LX, bevel=0.02))
    b.both('boots', 'leg', tube_z(0.0, 0.24, 0.145, 0.14, x=LX, y=0.0, bevel=0.025))                       # shaft
    b.both('boots', 'leg', box((0.27, 0.46, 0.15), (LX, -0.07, 0.075), bevel=0.06, seg=2))                  # foot
    return b


# ---------------------------------------------------------------- skeleton, weights, export


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_weight_sources():
    """Reads KayKit's mannequin once: per body region, a BVH of its surface and each vertex's bone weights."""
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
        log('weight source', key, obj.name, len(verts), 'verts')
    return out


def weights_at(src, co):
    loc, nrm, fi, dist = src['bvh'].find_nearest(co)
    tri = src['tris'][fi]
    pts = [src['verts'][i] for i in tri]
    bary = poly_3d_calc(pts, loc)
    acc = {}
    for bw, vi in zip(bary, tri):
        for name, w in src['w'][vi].items():
            acc[name] = acc.get(name, 0.0) + w * bw
    return acc


def top_influences(acc, n=4):
    items = sorted(acc.items(), key=lambda kv: -kv[1])[:n]
    total = sum(w for _, w in items) or 1.0
    return [(k, w / total) for k, w in items if w / total > 0.01]


def make(spec_path, sources):
    spec = json.load(open(spec_path, encoding='utf-8-sig'))
    name = spec['name']
    colors = dict(DEFAULT_COLORS)
    colors.update(spec.get('colors', {}))
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=ARMATURE_SRC)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)   # the knight's own meshes and a helper icosphere
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    bpy.data.images.clear() if hasattr(bpy.data.images, 'clear') else None

    builder = build_character(spec)
    total_tris = 0
    for mat_name, d in builder.mats.items():
        me = bpy.data.meshes.new(f'{name}_{mat_name}')
        me.from_pydata([tuple(v) for v in d['v']], [], d['f'])
        me.update()
        for p in me.polygons:
            p.use_smooth = True
        material = bpy.data.materials.new(mat_name)
        material.use_nodes = True
        bsdf = material.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = srgb_to_linear(colors[mat_name])
        bsdf.inputs['Roughness'].default_value = 0.85
        bsdf.inputs['Metallic'].default_value = 0.0
        material.diffuse_color = srgb_to_linear(colors[mat_name])
        me.materials.append(material)
        obj = bpy.data.objects.new(f'{name}_{mat_name}', me)
        bpy.context.scene.collection.objects.link(obj)
        for bone in arm.data.bones:
            obj.vertex_groups.new(name=bone.name)
        # skin weights
        cache = {}
        for i, (co, src) in enumerate(zip(d['v'], d['src'])):
            if src == 'head':
                infl = [('head', 1.0)]
            else:
                key = src
                infl = top_influences(weights_at(sources[key], Vector(co)))
            for bone_name, w in infl:
                obj.vertex_groups[bone_name].add([i], w, 'REPLACE')
        obj.parent = arm
        mod = obj.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
        total_tris += sum(len(p.vertices) - 2 for p in me.polygons)
    arm.name = 'Rig_Medium'

    out = os.path.join(OUT_DIR, name + '.glb')
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_apply=False,
                              export_skins=True, export_animations=False, export_materials='EXPORT',
                              export_cameras=False, export_lights=False)
    log('wrote', out, '%.0f KB' % (os.path.getsize(out) / 1024), 'tris~%d' % total_tris, 'materials', sorted(builder.mats))


sources = load_weight_sources()
for sp in SPECS:
    try:
        make(sp, sources)
    except Exception as e:
        import traceback
        log('FAILED', sp, repr(e))
        log(traceback.format_exc())
log('DONE')
