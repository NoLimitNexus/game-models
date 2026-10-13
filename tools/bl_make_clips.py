"""
Our own animation clips, authored on KayKit's skeleton (the skeleton and bone names stay, so every game clip and tool keeps working).

  blender-launcher.exe --background --factory-startup --python bl_make_clips.py -- <log.txt> <Rig_Medium_General.glb> <out.glb>

The skeleton comes from KayKit's own animation file (its meshes and clips are dropped). Each clip is authored the same way:
the hands are driven by IK targets that move along a path, the body gets a few joint rotations, and everything is baked to
plain bone keys. Writes one glTF with one animation per clip (armature only, like KayKit's files).

Clips so far:
  Stirring   the right hand circles a spoon over a pot (two turns in 2.5 s, loops), the left hand rests on the hip, the
             body leans a little over the pot and turns with the stir, the head looks down at it.
  NetCast    throwing a cast net and bringing it in (3.0 s, loops; one fishing attempt): both hands gather the net at the
             right hip, the body winds up and throws it out over the water, holds the rope while it sinks, hauls it in hand
             over hand, lifts it out (2.45 s: the moment the game decides the catch) and tips it into the bag at the left
             hip. The net itself is drawn by the game (it flies, opens on the water and comes back), not part of the clip.
             His ask, 2026-10-12: "look like they're actually throwing a net into the water ... even bagging it back up".
  Rummage    picking through a pile by hand (beach stones, grass, reeds; 1.79 s, loops; one try): down on the right knee with the
             left foot planted, leaning over the pile in front, both hands working through it in turn; the right hand lifts
             something up to look at it (0.92 s: the moment the game decides the find). His ask, 2026-10-13: "get down on a knee
             and rummage through the rocks ... make it look like he's actually doing something the entire time".
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


def local_axis_name(bone_name, world_dir):
    """Which of a bone's own axes points along `world_dir` in the rest pose, as a Damped Track axis name."""
    rest = arm.data.bones[bone_name].matrix_local.to_3x3()
    d = rest.inverted() @ world_dir
    axis = max(range(3), key=lambda i: abs(d[i]))
    return ('TRACK_' if d[axis] > 0 else 'TRACK_NEGATIVE_') + 'XYZ'[axis], tuple(round(v, 2) for v in d)


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


def rest_pose():
    for pb in PB:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    update()


fs_spine = forward_sign('spine')
fs_head = forward_sign('head')
ts_chest = turn_sign('chest')
log('signs', fs_spine, fs_head, ts_chest)
log('rest right shoulder', tuple(round(v, 3) for v in world(PB['upperarm.r'])), 'left', tuple(round(v, 3) for v in world(PB['upperarm.l'])))


def bake(name, frames, empties):
    """Bake the IK and the keys to plain bone keys in a new action called `name`; the helpers are removed."""
    scene.frame_start = 1
    scene.frame_end = frames
    scene.frame_set(1)
    update()
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=1, frame_end=frames, step=1, only_selected=True, visual_keying=True,
                     clear_constraints=True, use_current_action=True, bake_types={'POSE'})
    action = arm.animation_data.action
    action.name = name
    action.use_fake_user = True
    log('baked', name, 'frames', tuple(action.frame_range))
    for e in empties:
        bpy.data.objects.remove(e, do_unlink=True)
    for pb in PB:  # anything the bake left behind
        for c in list(pb.constraints):
            pb.constraints.remove(c)
    arm.animation_data.action = None
    rest_pose()
    return action


# ---------------------------------------------------------------------------------------------------------- Stirring
# Blender world: Z up, the character faces -Y, its right hand is at -X. Lengths are the rig's own (a rig 1.49 tall).
def make_stirring():
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
    slot_dir = (arm.data.bones['handslot.r'].tail_local - arm.data.bones['handslot.r'].head_local).normalized()
    track_axis, local_d = local_axis_name('hand.r', slot_dir)
    log('slot direction', tuple(round(v, 2) for v in slot_dir), "in the hand bone's own axes", local_d, '->', track_axis)
    aim = PB['hand.r'].constraints.new('DAMPED_TRACK')
    aim.target = aim_r
    aim.track_axis = track_axis
    update()
    ang_r = best_pole_angle(c_r, 'lowerarm.r', lambda e: e.z - 0.4 * (-e.x))        # elbow low and out
    ang_l = best_pole_angle(c_l, 'lowerarm.l', lambda e: e.z - 0.4 * e.x)
    log('stirring pole angles (deg)', round(math.degrees(ang_r)), round(math.degrees(ang_l)))

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

    action = bake('Stirring', FRAMES, [tgt_r, pole_r, tgt_l, pole_l, aim_r])
    return action


# ---------------------------------------------------------------------------------------------------------- NetCast
# One fishing attempt, 3.0 s: 72 frames. Each row: frame, right hand, left hand (where the wrists go), chest turn (+ = to the
# right, toward -X), spine lean (+ = forward), head tilt (+ = down), hips drop (metres). The frames in between are smooth.
# A frame-1 pose equal to the last one makes it loop.
NET_KEYS = [
    # frame  right hand              left hand               turn  lean  head  drop
    (1,  (-0.10, -0.32, 0.88), (0.06, -0.30, 0.90),     0,    6,    8,  0.00),   # ready: the gathered net in both hands
    (10, (-0.32, -0.06, 0.82), (-0.12, -0.18, 0.92),   24,    8,    4,  0.03),   # swing it to the right hip
    (17, (-0.36, 0.04, 0.80),  (-0.18, -0.10, 0.88),   34,   10,    2,  0.05),   # wound up
    (22, (-0.12, -0.56, 1.22), (0.10, -0.53, 1.20),   -10,   14,   -4,  0.00),   # release: arms out and up, the net flies
    (28, (-0.10, -0.52, 1.04), (0.08, -0.50, 1.03),    -6,   12,    6,  0.00),   # follow through
    (36, (-0.12, -0.44, 0.95), (0.06, -0.42, 0.95),     0,    8,   12,  0.01),   # hold the rope while it sinks
    (41, (-0.10, -0.50, 0.98), (0.06, -0.16, 0.88),     4,    4,   12,  0.02),   # haul: right hand out, left hand in
    (46, (-0.10, -0.16, 0.88), (0.06, -0.50, 0.98),    -4,   -2,   12,  0.02),   # ...left hand out, right hand in
    (51, (-0.10, -0.50, 0.98), (0.06, -0.16, 0.88),     4,    4,   12,  0.02),
    (56, (-0.10, -0.18, 0.90), (0.06, -0.46, 0.96),    -4,   -2,   12,  0.02),
    (59, (-0.10, -0.38, 1.22), (0.08, -0.36, 1.22),     0,   -4,    0,  0.00),   # lift it out of the water (the catch)
    (66, (0.10, -0.24, 0.94),  (0.26, -0.06, 0.86),   -22,    6,   10,  0.02),   # tip it into the bag at the left hip
    (72, (-0.10, -0.32, 0.88), (0.06, -0.30, 0.90),     0,    6,    8,  0.00),   # ready again
]


def make_netcast():
    FRAMES = 72
    tgt_r = empty('n_tgt_r', NET_KEYS[0][1])
    tgt_l = empty('n_tgt_l', NET_KEYS[0][2])
    pole_r = empty('n_pole_r', (-0.60, 0.25, 0.60))
    pole_l = empty('n_pole_l', (0.60, 0.25, 0.60))
    c_r = ik('wrist.r', tgt_r, pole_r, 3)
    c_l = ik('wrist.l', tgt_l, pole_l, 3)
    ang_r = best_pole_angle(c_r, 'lowerarm.r', lambda e: e.z - 0.4 * (-e.x))   # elbows low and out
    ang_l = best_pole_angle(c_l, 'lowerarm.l', lambda e: e.z - 0.4 * e.x)
    log('netcast pole angles (deg)', round(math.degrees(ang_r)), round(math.degrees(ang_l)))
    for (f, r, l, turn, lean, head, drop) in NET_KEYS:
        tgt_r.location = Vector(r)
        tgt_r.keyframe_insert('location', frame=f)
        tgt_l.location = Vector(l)
        tgt_l.keyframe_insert('location', frame=f)
        key_rot('spine', Euler((fs_spine * math.radians(lean), 0, 0)))
        key_rot('chest', Euler((fs_spine * math.radians(lean * 0.4), ts_chest * math.radians(turn), 0)))
        key_rot('head', Euler((fs_head * math.radians(head), 0, 0)))
        for b in ('spine', 'chest', 'head'):
            PB[b].keyframe_insert('rotation_quaternion', frame=f)
        PB['hips'].location = Vector((0.0, 0.0, -drop))
        PB['hips'].keyframe_insert('location', frame=f)
    # smooth in between, and no overshoot (a held net does not wobble past where it is going)
    for obj in (tgt_r, tgt_l, arm):
        ad = obj.animation_data
        if not ad or not ad.action:
            continue
        for fc in getattr(ad.action, 'fcurves', []):
            for kp in fc.keyframe_points:
                kp.interpolation = 'BEZIER'
                kp.handle_left_type = 'AUTO_CLAMPED'
                kp.handle_right_type = 'AUTO_CLAMPED'
    action = bake('NetCast', FRAMES, [tgt_r, tgt_l, pole_r, pole_l])
    # check: where the hands are at the release and at the lift
    return action


# ---------------------------------------------------------------------------------------------------------- Rummage
# One try at a pile, 43 frames (1.79 s). The legs are held by IK: the right knee down on the ground with the shin lying back and the
# foot stretched out behind, the left foot flat on the ground ahead with its knee up. The hips come down to kneeling height (the hip
# joints from 0.52 to 0.30). Each row: frame, right hand, left hand (where the wrists go: low, in front, at the pile's near edge),
# chest turn (+ = to the right), lean (+ = forward), head tilt (+ = down). Frame 43 is frame 1, so it loops.
RUM_DROP = 0.22
RUM_FWD = 0.10    # the whole kneel sits this far forward of where he stands, so the hands reach the pile
RUM_KEYS = [
    # frame  right hand              left hand               turn  lean  head
    (1,  (-0.10, -0.64, 0.24), (0.14, -0.58, 0.36),     4,   36,   16),   # right hand in the pile, left hovering
    (8,  (-0.20, -0.66, 0.22), (0.10, -0.66, 0.24),     6,   37,   16),   # right sweeps aside, left goes in
    (15, (-0.08, -0.60, 0.32), (0.18, -0.68, 0.22),    -2,   36,   15),   # right picks something up, left sweeps the other way
    (22, (-0.08, -0.50, 0.50), (0.13, -0.62, 0.28),    -6,   31,   10),   # right lifts it to look at it: the find
    (29, (-0.14, -0.66, 0.22), (0.09, -0.56, 0.40),     2,   36,   16),   # right back in, left lifts and turns a stone over
    (36, (-0.07, -0.68, 0.22), (0.16, -0.66, 0.22),     6,   37,   17),   # both in the pile
    (43, (-0.10, -0.64, 0.24), (0.14, -0.58, 0.36),     4,   36,   16),   # as at frame 1
]


def make_rummage():
    FRAMES = 43
    # the hips come down: a pose location is in the bone's own axes, so the world drop is turned into the hips' axes
    down = arm.data.bones['hips'].matrix_local.to_3x3().inverted() @ Vector((0.0, -RUM_FWD, -RUM_DROP))
    PB['hips'].location = down
    update()
    # the legs: ankles (the shin bones' tails) held where kneeling puts them, knees steered by pole targets
    tgt_fl = empty('r_foot_l', (0.171, -0.20 - RUM_FWD, 0.145))      # left foot flat on the ground ahead, its knee up
    pole_fl = empty('r_pole_l', (0.171, -0.90 - RUM_FWD, 0.45))
    tgt_fr = empty('r_foot_r', (-0.171, 0.18 - RUM_FWD, 0.08))       # right shin lying back along the ground, the knee down
    pole_fr = empty('r_pole_r', (-0.171, -0.80 - RUM_FWD, 0.05))
    c_fl = ik('lowerleg.l', tgt_fl, pole_fl, 2)
    c_fr = ik('lowerleg.r', tgt_fr, pole_fr, 2)
    best_pole_angle(c_fl, 'lowerleg.l', lambda e: e.y - 0.5 * e.z)      # left knee forward and up
    best_pole_angle(c_fr, 'lowerleg.r', lambda e: e.z + 0.3 * e.y)      # right knee down on the ground, a little forward
    # the right foot stretched out behind and level (the toes bend down from it, so they rest on the ground)
    aim_fr = empty('r_aim_r', (-0.171, 0.42 - RUM_FWD, 0.12))
    track = PB['foot.r'].constraints.new('DAMPED_TRACK')
    track.target = aim_fr
    track.track_axis = 'TRACK_Y'                                        # a bone points along its own Y
    # the hands
    tgt_r = empty('r_tgt_r', RUM_KEYS[0][1])
    tgt_l = empty('r_tgt_l', RUM_KEYS[0][2])
    pole_r = empty('r_pole_hr', (-0.60, 0.10, 0.50))
    pole_l = empty('r_pole_hl', (0.60, 0.10, 0.50))
    c_r = ik('wrist.r', tgt_r, pole_r, 3)
    c_l = ik('wrist.l', tgt_l, pole_l, 3)
    lean0, turn0 = RUM_KEYS[0][4], RUM_KEYS[0][3]                       # lean the body before the arms' poles are chosen
    key_rot('spine', Euler((fs_spine * math.radians(lean0 * 0.75), 0, 0)))
    key_rot('chest', Euler((fs_spine * math.radians(lean0 * 0.25), ts_chest * math.radians(turn0), 0)))
    update()
    best_pole_angle(c_r, 'lowerarm.r', lambda e: e.z - 0.4 * (-e.x))   # elbows low and out
    best_pole_angle(c_l, 'lowerarm.l', lambda e: e.z - 0.4 * e.x)
    for (f, r, l, turn, lean, head) in RUM_KEYS:
        tgt_r.location = Vector(r)
        tgt_r.keyframe_insert('location', frame=f)
        tgt_l.location = Vector(l)
        tgt_l.keyframe_insert('location', frame=f)
        key_rot('spine', Euler((fs_spine * math.radians(lean * 0.75), 0, 0)))
        key_rot('chest', Euler((fs_spine * math.radians(lean * 0.25), ts_chest * math.radians(turn), 0)))
        key_rot('head', Euler((fs_head * math.radians(head), 0, 0)))
        for b in ('spine', 'chest', 'head'):
            PB[b].keyframe_insert('rotation_quaternion', frame=f)
        PB['hips'].location = down
        PB['hips'].keyframe_insert('location', frame=f)
    for obj in (tgt_r, tgt_l, arm):
        ad = obj.animation_data
        if not ad or not ad.action:
            continue
        for fc in getattr(ad.action, 'fcurves', []):
            for kp in fc.keyframe_points:
                kp.interpolation = 'BEZIER'
                kp.handle_left_type = 'AUTO_CLAMPED'
                kp.handle_right_type = 'AUTO_CLAMPED'
    return bake('Rummage', FRAMES, [tgt_fl, pole_fl, tgt_fr, pole_fr, aim_fr, tgt_r, tgt_l, pole_r, pole_l])


stir = make_stirring()
net = make_netcast()
rum = make_rummage()

# check the baked Rummage: the right knee on the ground, the left foot flat ahead, nothing far below the ground, the hands low in front
arm.animation_data.action = rum
for f in (1, 15, 22, 36):
    scene.frame_set(f)
    update()
    pt = lambda b, t=False: tuple(round(v, 3) for v in world(PB[b], t))
    log('Rummage frame', f, 'knee r', pt('lowerleg.r'), 'knee l', pt('lowerleg.l'), 'ankle l', pt('foot.l'), 'toes r', pt('toes.r', True),
        'hips', pt('hips'), 'hand r', pt('wrist.r', True), 'hand l', pt('wrist.l', True), 'head', pt('head', True))
arm.animation_data.action = None

# check the baked NetCast hand path: out at the release, in at the haul, up at the lift
arm.animation_data.action = net
for f in (1, 17, 22, 46, 59, 66):
    scene.frame_set(f)
    update()
    log('NetCast frame', f, 'right hand', tuple(round(v, 3) for v in world(PB['wrist.r'], True)), 'left hand', tuple(round(v, 3) for v in world(PB['wrist.l'], True)))
arm.animation_data.action = None

# one animation per clip: through NLA tracks, like the converter that made KayKit's files
ad = arm.animation_data
for tr in list(ad.nla_tracks):
    ad.nla_tracks.remove(tr)
for action in (stir, net, rum):
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
