"""
Blender headless converter for the game-models library.

Run (Blender from the Microsoft Store, headless, no window):
  blender-launcher.exe --background --factory-startup --python bl_convert.py -- <job.json>

job.json = { "log": "path", "jobs": [ {kind, ...}, ... ] }
kinds:
  animations : import an FBX, drop its meshes, export every action as one glTF animation (armature only)
  character  : import a glTF/FBX, shrink textures to `tex` px, export one GLB
"""
import bpy, sys, json, os

argv = sys.argv[sys.argv.index('--') + 1:]
job = json.load(open(argv[0], encoding='utf-8-sig'))
LOG = open(job['log'], 'w', encoding='utf-8')


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s)
    LOG.write(s + '\n')
    LOG.flush()


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def clean_action_name(n):
    return n.split('|')[-1]


def export_glb(path, animations):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_animations=animations,
        export_image_format='AUTO',
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
    )
    if animations:
        kw.update(export_animation_mode='ACTIONS', export_force_sampling=True,
                  export_optimize_animation_size=True)
    bpy.ops.export_scene.gltf(**kw)
    log('  wrote', path, '%.2f MB' % (os.path.getsize(path) / 1048576))


def do_animations(j):
    reset()
    if j['src'].lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=j['src'])
    else:
        bpy.ops.import_scene.gltf(filepath=j['src'])
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    log('armatures', [a.name for a in arms], 'actions', len(bpy.data.actions))
    for a in bpy.data.actions:
        a.name = clean_action_name(a.name)
        a.use_fake_user = True
    # put every action on the armature as its own NLA strip so none is lost
    arm = arms[0]
    arm.animation_data_create()
    ad = arm.animation_data
    for tr in list(ad.nla_tracks):
        ad.nla_tracks.remove(tr)
    ad.action = None
    slot_missing = 0
    for act in sorted(bpy.data.actions, key=lambda a: a.name):
        tr = ad.nla_tracks.new()
        tr.name = act.name
        st = tr.strips.new(act.name, int(act.frame_range[0]), act)
        try:
            if hasattr(st, 'action_slot') and st.action_slot is None and len(act.slots):
                st.action_slot = act.slots[0]
        except Exception as e:  # noqa
            slot_missing += 1
    log('nla tracks', len(ad.nla_tracks), 'slot problems', slot_missing)
    # export through NLA tracks: each track becomes one named animation
    os.makedirs(os.path.dirname(j['out']), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=j['out'], export_format='GLB', export_yup=True, export_apply=False,
        export_skins=True, export_animations=True, export_animation_mode='NLA_TRACKS',
        export_force_sampling=True, export_optimize_animation_size=True,
        export_cameras=False, export_lights=False)
    log('  wrote', j['out'], '%.2f MB' % (os.path.getsize(j['out']) / 1048576))


def do_character(j):
    reset()
    ext = os.path.splitext(j['src'])[1].lower()
    if ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=j['src'])
    else:
        bpy.ops.import_scene.gltf(filepath=j['src'])
    tex = int(j.get('tex', 1024))
    shrunk = 0
    for img in bpy.data.images:
        if img.size[0] > tex or img.size[1] > tex:
            img.scale(tex, tex)
            shrunk += 1
    log('character', os.path.basename(j['src']), 'images', len(bpy.data.images), 'shrunk', shrunk)
    export_glb(j['out'], animations=False)


def do_head(j):
    """Keep only the head of a base character: the body mesh loses every face that is not mostly weighted
    to the head and neck bones. The eyes and brows (separate meshes) stay. Skinned to the full rig, so it
    attaches to any outfit that uses the same 65-bone skeleton."""
    import bmesh
    reset()
    bpy.ops.import_scene.gltf(filepath=j['src'])
    tex = int(j.get('tex', 1024))
    for img in bpy.data.images:
        if img.size[0] > tex or img.size[1] > tex:
            img.scale(tex, tex)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    body = max(meshes, key=lambda o: len(o.data.polygons))
    keep = {g.index for g in body.vertex_groups if g.name in set(j.get('groups', ['Head', 'neck_01']))}
    bm = bmesh.new()
    bm.from_mesh(body.data)
    dl = bm.verts.layers.deform.verify()
    def w(v):
        return sum(wt for gi, wt in v[dl].items() if gi in keep)
    kill = [f for f in bm.faces if sum(w(v) for v in f.verts) / len(f.verts) < float(j.get('min', 0.5))]
    log('head: body', body.name, 'faces', len(bm.faces), 'removing', len(kill))
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    export_glb(j['out'], animations=False)

for j in job['jobs']:
    log('JOB', j['kind'], os.path.basename(j.get('src', '')))
    try:
        {'animations': do_animations, 'character': do_character, 'head': do_head}[j['kind']](j)
    except Exception as e:
        import traceback
        log('FAILED', repr(e))
        log(traceback.format_exc())
log('DONE')
