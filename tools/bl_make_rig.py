"""One-off: makes tools/reference/Rig_Medium.glb, the 23-bone skeleton every part is built on.
It is KayKit's Rig_Medium (same bone names and rest pose as every animation file), cut out of one of their characters,
plus a one-triangle stub mesh so Blender's importer recognises it as an armature when the kit is built.

  blender-launcher.exe --background --factory-startup --python bl_make_rig.py -- <log> <source character.glb> <out Rig_Medium.glb>
"""
import bpy, sys, os

argv = sys.argv[sys.argv.index('--') + 1:]
LOG = open(argv[0], 'w', encoding='utf-8')
SRC, OUT = argv[1], argv[2]


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s)
    LOG.write(s + '\n')
    LOG.flush()


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in list(bpy.data.objects):
    if o.type == 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.materials):
    bpy.data.materials.remove(m)

me = bpy.data.meshes.new('RigStub')
me.from_pydata([(0, 0, 0), (0.001, 0, 0), (0, 0.001, 0)], [], [(0, 1, 2)])
stub = bpy.data.objects.new('RigStub', me)
bpy.context.scene.collection.objects.link(stub)
g = stub.vertex_groups.new(name='root')
g.add([0, 1, 2], 1.0, 'REPLACE')
stub.parent = arm
mod = stub.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
arm.name = 'Rig_Medium'

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_skins=True,
                          export_animations=False, export_materials='NONE', export_cameras=False, export_lights=False)
log('wrote', OUT, os.path.getsize(OUT), 'bytes; bones:', len(arm.data.bones))
log('DONE')
