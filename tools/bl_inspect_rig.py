"""Prints a rig's bones (world space), each mesh's bounds and skin-weight stats. Read-only.
   blender-launcher.exe --background --factory-startup --python bl_inspect_rig.py -- <out.txt> <file.glb> [...]"""
import bpy, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
out = open(argv[0], 'w', encoding='utf-8')


def log(*a):
    s = ' '.join(str(x) for x in a)
    out.write(s + '\n')
    out.flush()


for path in argv[1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    log('=' * 70)
    log(path)
    for o in bpy.data.objects:
        if o.type == 'ARMATURE':
            log('ARMATURE', o.name, 'scale', tuple(round(x, 4) for x in o.scale), 'rot', tuple(round(x, 3) for x in o.rotation_euler))
            for b in o.data.bones:
                h = o.matrix_world @ b.head_local
                t = o.matrix_world @ b.tail_local
                log('  bone %-14s parent=%-10s head=(%.3f,%.3f,%.3f) tail=(%.3f,%.3f,%.3f) deform=%s' % (
                    b.name, b.parent.name if b.parent else '-', h.x, h.y, h.z, t.x, t.y, t.z, b.use_deform))
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        me = o.data
        vg = {g.index: g.name for g in o.vertex_groups}
        multi = 0
        maxinf = 0
        used = {}
        for v in me.vertices:
            gs = [g for g in v.groups if g.weight > 0.001]
            maxinf = max(maxinf, len(gs))
            if len(gs) > 1:
                multi += 1
            for g in gs:
                used[vg.get(g.group, '?')] = used.get(vg.get(g.group, '?'), 0) + 1
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        mn = Vector((min(p.x for p in bb), min(p.y for p in bb), min(p.z for p in bb)))
        mx = Vector((max(p.x for p in bb), max(p.y for p in bb), max(p.z for p in bb)))
        log('MESH %-28s verts=%d tris~%d multiInfluence=%d maxInfluences=%d mats=%s uv=%s' % (
            o.name, len(me.vertices), sum(len(p.vertices) - 2 for p in me.polygons), multi, maxinf,
            [m.name for m in me.materials], [u.name for u in me.uv_layers]))
        log('     bbox min=(%.3f,%.3f,%.3f) max=(%.3f,%.3f,%.3f)' % (mn.x, mn.y, mn.z, mx.x, mx.y, mx.z))
        log('     groups used:', dict(sorted(used.items(), key=lambda kv: -kv[1])[:6]))
    for im in bpy.data.images:
        log('IMAGE', im.name, tuple(im.size))
log('DONE')
