"""
Our own animation clips, authored on KayKit's skeleton (the skeleton and bone names stay, so every game clip and tool keeps working).

  blender-launcher.exe --background --factory-startup --python bl_make_clips.py -- <log.txt> <Rig_Medium_General.glb> <out.glb>

The skeleton comes from KayKit's own animation file (its meshes and clips are dropped). Each clip is authored the same way:
the hands are driven by IK targets that move along a path, the body gets a few joint rotations, and everything is baked to
plain bone keys. Writes one glTF with one animation per clip (armature only, like KayKit's files).

Clips so far:
  Stirring   the right hand circles a spoon over a pot (two turns in 2.5 s, loops), the left hand rests on the hip, the
             body leans a little over the pot and turns with the stir, the head looks down at it.
"""
import bpy, sys, os, math
from mathutils import Vector, Euler, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
LOG = open(argv[0], 'w', encoding='utf-8')
SRC, OUT = argv[1], argv[2]
FPS = 24


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s)
    LOG.write(s + '\n')
    LOG.flush()


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in list(bpy.data.objects):
    if o.type == 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
if arm.animation_data:
    arm.animation_data_clear()
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
PB = arm.pose.bones
for pb in PB:
    pb.rotation_mode = 'QUATERNION'


def world(pb, tail=False):
    return arm.matrix_world @ (pb.tail if tail else pb.head)


def update():
    bpy.context.view_layer.update()


def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'SPHERE'
    e.empty_display_size = 0.04
    scene.collection.objects.link(e)
    e.location = Vector(loc)
    return e


def ik(bone, target, pole, chain):
    c = PB[bone].constraints.new('IK')
    c.target = target
    c.pole_target = pole
    c.chain_count = chain
    return c


def best_pole_angle(c, elbow_bone, prefer):
    """Try pole angles and keep the one that puts the elbow where `prefer(elbow_world)` scores lowest."""
    best = (1e9, 0.0)
    for deg in range(-180, 180, 15):
        c.pole_angle = math.radians(deg)
        update()
        score = prefer(world(PB[elbow_bone]))
        if score < best[0]:
            best = (score, math.radians(deg))
    c.pole_angle = best[1]
    update()
    return best[1]


# ---------------------------------------------------------------------------------------------------------- Stirring
# Blender world: Z up, the character faces -Y, its right hand is at -X. Lengths are the rig's own (a rig 1.49 tall).
FRAMES = 60                      # one loop = 2.5 s at 24 fps, two turns of the spoon
CENTER = Vector((-0.15, -0.40, 0.90))   # where the spoon turns, close in front of the chest (the spoon itself reaches the pot)
RADIUS = 0.075
tgt_r = empty('tgt_r', CENTER)
pole_r = empty('pole_r', (-0.55, 0.20, 0.55))
tgt_l = empty('tgt_l', (0.285, -0.06, 0.66))   # the left hand rests on the hip
pole_l = empty('pole_l', (0.62, 0.30, 0.80))
c_r = ik('wrist.r', tgt_r, pole_r, 3)
c_l = ik('wrist.l', tgt_l, pole_l, 3)

# What is held points where the hand slot points (a tool's handle runs along the slot's own axis; forward at rest). The spoon
# has to point at the pot: about a tile in front of the character and a little below the hand.
aim_r = empty('aim_r', (-0.15, -1.0, 0.72))


def local_axis_name(bone_name, world_dir):
    """Which of a bone's own axes points along `world_dir` in the rest pose, as a Damped Track axis name."""
    rest = arm.data.bones[bone_name].matrix_local.to_3x3()
    d = rest.inverted() @ world_dir
    axis = max(range(3), key=lambda i: abs(d[i]))
    return ('TRACK_' if d[axis] > 0 else 'TRACK_NEGATIVE_') + 'XYZ'[axis], tuple(round(v, 2) for v in d)


slot_dir = (arm.data.bones['handslot.r'].tail_local - arm.data.bones['handslot.r'].head_local).normalized()
track_axis, local_d = local_axis_name('hand.r', slot_dir)
log('slot direction', tuple(round(v, 2) for v in slot_dir), "in the hand bone's own axes", local_d, '->', track_axis)
aim = PB['hand.r'].constraints.new('DAMPED_TRACK')
aim.target = aim_r
aim.track_axis = track_axis
update()
log('rest right shoulder', tuple(round(v, 3) for v in world(PB['upperarm.r'])))
ang_r = best_pole_angle(c_r, 'lowerarm.r', lambda e: e.z - 0.4 * (-e.x))        # elbow low and out
ang_l = best_pole_angle(c_l, 'lowerarm.l', lambda e: e.z - 0.4 * e.x)
log('pole angles (deg)', round(math.degrees(ang_r)), round(math.degrees(ang_l)))
log('elbow R', tuple(round(v, 3) for v in world(PB['lowerarm.r'])), 'hand R', tuple(round(v, 3) for v in world(PB['wrist.r'], True)))
log('elbow L', tuple(round(v, 3) for v in world(PB['lowerarm.l'])), 'hand L', tuple(round(v, 3) for v in world(PB['wrist.l'], True)))


def lean(bone, axis, degrees, frames_fn=None):
    """Rotate a bone about a world axis ('x' or 'z'); the sign is chosen so that +degrees means forward (x) / to the right (z)."""
    return (bone, axis, degrees)


def key_rot(bone, euler):
    pb = PB[bone]
    pb.rotation_quaternion = euler.to_quaternion()


def rest_dir(bone):
    return (world(PB[bone], True) - world(PB[bone])).normalized()


def forward_sign(bone):
    """+1 if rotating the bone about its local X by +angle tips its tip toward -Y (forward), else -1."""
    pb = PB[bone]
    before = rest_dir(bone)
    pb.rotation_quaternion = Euler((math.radians(10), 0, 0)).to_quaternion()
    update()
    after = rest_dir(bone)
    pb.rotation_quaternion = Euler((0, 0, 0)).to_quaternion()
    update()
    return 1.0 if after.y < before.y else -1.0


def turn_sign(bone):
    """+1 if rotating about the bone's local Y (its own axis) by +angle turns the chest toward the character's right (-X side moves to -Y)."""
    pb = PB[bone]
    r_before = world(PB['upperarm.r'])
    pb.rotation_quaternion = Euler((0, math.radians(10), 0)).to_quaternion()
    update()
    r_after = world(PB['upperarm.r'])
    pb.rotation_quaternion = Euler((0, 0, 0)).to_quaternion()
    update()
    return 1.0 if r_after.y > r_before.y else -1.0   # the right shoulder moving back means the chest turned left


fs_spine = forward_sign('spine')
fs_head = forward_sign('head')
ts_chest = turn_sign('chest')
log('signs', fs_spine, fs_head, ts_chest)

scene.frame_start = 1
scene.frame_end = FRAMES
for f in range(1, FRAMES + 1):
    th = 2 * math.pi * 2 * (f - 1) / FRAMES
    # the spoon goes round the pot; a little bob as it drags through
    p = CENTER + Vector((RADIUS * math.cos(th), RADIUS * math.sin(th), 0.012 * math.sin(2 * th)))
    tgt_r.location = p
    tgt_r.keyframe_insert('location', frame=f)
    # the body: leans over the pot and turns a little with the stir; the head keeps looking down at it
    key_rot('spine', Euler((fs_spine * math.radians(9), 0, 0)))
    key_rot('chest', Euler((fs_spine * math.radians(4), ts_chest * math.radians(5) * math.sin(th + 0.6), 0)))
    key_rot('head', Euler((fs_head * math.radians(14), 0, 0)))
    for b in ('spine', 'chest', 'head'):
        PB[b].keyframe_insert('rotation_quaternion', frame=f)
    # hips shift a touch with the stir
    PB['hips'].location = Vector((0.006 * math.cos(th), 0.0, 0.0))
    PB['hips'].keyframe_insert('location', frame=f)

# bake the IK to plain bone keys
scene.frame_set(1)
update()
bpy.ops.pose.select_all(action='SELECT')
before = set(a.name for a in bpy.data.actions)
bpy.ops.nla.bake(frame_start=1, frame_end=FRAMES, step=1, only_selected=True, visual_keying=True,
                 clear_constraints=True, use_current_action=True, bake_types={'POSE'})
log('baked; actions:', [a.name for a in bpy.data.actions])
action = arm.animation_data.action
action.name = 'Stirring'
action.use_fake_user = True
log('action', action.name, 'frames', tuple(action.frame_range))

# check the baked hand path: a circle of the right size around the centre
pts = []
for f in range(1, FRAMES + 1, 5):
    scene.frame_set(f)
    update()
    pts.append(world(PB['wrist.r'], True))
cx = sum(p.x for p in pts) / len(pts)
cy = sum(p.y for p in pts) / len(pts)
rad = [math.hypot(p.x - cx, p.y - cy) for p in pts]
log('hand path centre', round(cx, 3), round(cy, 3), 'radius min/max', round(min(rad), 3), round(max(rad), 3), 'z range', round(min(p.z for p in pts), 3), round(max(p.z for p in pts), 3))

# the empties are not part of the file
for e in (tgt_r, pole_r, tgt_l, pole_l, aim_r):
    bpy.data.objects.remove(e, do_unlink=True)

# one animation per clip: through an NLA track, like the converter that made KayKit's files
ad = arm.animation_data
ad.action = None
for tr in list(ad.nla_tracks):
    ad.nla_tracks.remove(tr)
tr = ad.nla_tracks.new()
tr.name = action.name
st = tr.strips.new(action.name, int(action.frame_range[0]), action)
try:
    if hasattr(st, 'action_slot') and st.action_slot is None and len(action.slots):
        st.action_slot = action.slots[0]
except Exception as e:  # noqa
    log('slot problem', repr(e))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_skins=True,
                          export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
                          export_optimize_animation_size=True, export_cameras=False, export_lights=False)
log('wrote', OUT, '%.1f KB' % (os.path.getsize(OUT) / 1024))
log('DONE')
