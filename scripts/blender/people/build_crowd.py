"""Build the crowd bodies: public/models/people/crowd_men.glb, crowd_women.glb.

    python3 scripts/blender/people/fetch_quaternius.py /tmp/quat
    python3 scripts/blender/people/build_crowd.py /tmp/quat public/models/people

Source: Quaternius "Ultimate Modular Men" and "Ultimate Modular Women"
(CC0 1.0). Every outfit in a pack shares one 62-joint rig with an identical
bind pose, so each gender exports as ONE armature with many skinned parts
(heads, bodies, legs, feet, a backpack) that the runtime assembles into
outfits. The runtime bakes the clips into a bone-matrix texture per gender and
plays it back on instanced meshes (src/world/life/crowd-renderer.ts).

What this script changes:
  * Materials are replaced by a paint code in COLOR_0 (linear RGB + A):
      A = region / 7, region 0 fixed (RGB is the authored colour), 1 skin,
      2 hair, 3 top, 4 bottom, 5 shoes, 6 accent (a shirt under a jacket),
      7 prop (only shown in the phone idle). For tinted regions RGB is a
      grey shade multiplier, so darker authored details (stubble, knee pads)
      stay darker than the colour the runtime paints over them.
  * Region is decided per face from the source material, and for the few
    materials that cover two garments (a mohawk and shoes in one "Red"), by
    the face's height.
  * Clips kept: Walk, Run, Idle, Idle_Neutral, Wave, Interact, plus an
    authored "Phone" idle (Idle_Neutral with the right forearm raised and
    the head dipped) and a phone prop weighted to the right wrist.
  * Far LOD proxies: two outfit silhouettes per gender, decimated to about
    1000 and 300 triangles, used past ~25 m.
  * The pistol that ships with the suit character is dropped.
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

SRC = sys.argv[1] if len(sys.argv) > 1 else 'quaternius'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/models/people'

REGION = {'fixed': 0, 'skin': 1, 'hair': 2, 'top': 3, 'bottom': 4,
          'shoes': 5, 'accent': 6, 'prop': 7}

CLIPS = ['Walk', 'Run', 'Idle', 'Idle_Neutral', 'Wave', 'Interact']

# Common rules shared by every part.
BASE = {
    'Skin': ('skin', 1.0),
    'Skin_Darker': ('skin', 0.82),
    'Eyebrows': ('hair', 0.75),
    'Moustache': ('hair', 0.9),
    'Hair': ('hair', 1.0),
    'Hair_Blond': ('hair', 1.0),
    'Eye': ('fixed', None),
    'Earrings': ('fixed', None),
    'Gold': ('fixed', None),
    'Worker_Yellow': ('fixed', None),
    'Worker_Vest': ('fixed', None),
}


def split_height(shoes=0.2, waist=1.04, hair=1.5):
    """A material that spans garments: pick by the face centre height."""
    def rule(z):
        if z < shoes:
            return ('shoes', 1.0)
        if z < waist:
            return ('bottom', 1.0)
        if z > hair:
            return ('hair', 1.0)
        return ('top', 1.0)
    return rule


# part key -> (source file, object name, material rules)
PARTS = {
    'men': {
        'head_suit': ('men/Suit.gltf', 'Suit_Head', {}),
        'body_suit': ('men/Suit.gltf', 'Suit_Body',
                      {'Suit': ('top', 1.0), 'White': ('accent', 1.0),
                       'Tie': ('fixed', None)}),
        'legs_suit': ('men/Suit.gltf', 'Suit_Legs', {'Suit.001': ('bottom', 1.0)}),
        'feet_suit': ('men/Suit.gltf', 'Suit_Feet', {'Black': ('shoes', 1.0)}),
        'head_casual': ('men/Casual_2.gltf', 'Casual2_Head', {}),
        'body_tee': ('men/Casual_2.gltf', 'Casual2_Body', {'LightBrown': ('top', 1.0)}),
        'legs_jeans': ('men/Casual_2.gltf', 'Casual2_Legs', {'LightBlue': ('bottom', 1.0)}),
        'feet_sneaker': ('men/Casual_2.gltf', 'Casual2_Feet',
                         {'Red_Dark': ('shoes', 1.0), 'White': ('fixed', None)}),
        'head_short': ('men/Casual_Hoodie.gltf', 'Casual_Head', {}),
        'body_hoodie': ('men/Casual_Hoodie.gltf', 'Casual_Body', {'Purple': ('top', 1.0)}),
        'legs_shorts': ('men/Casual_Hoodie.gltf', 'Casual_Legs', {'LightBlue': ('bottom', 1.0)}),
        'feet_hoodie': ('men/Casual_Hoodie.gltf', 'Casual_Feet',
                        {'Purple': ('shoes', 1.0), 'White': ('fixed', None)}),
        'head_long': ('men/Beach.gltf', 'Beach_Head', {}),
        'body_tank': ('men/Beach.gltf', 'Beach_Body', {'LightBrown': ('top', 1.0)}),
        'body_vest': ('men/Punk.gltf', 'Punk_Body',
                      {'White': ('accent', 1.0), 'Black': ('top', 1.0)}),
        'legs_ripped': ('men/Punk.gltf', 'Punk_Legs', {'LightBlue': ('bottom', 1.0)}),
        'feet_boot': ('men/Punk.gltf', 'Punk_Feet', {'Black': ('shoes', 1.0)}),
        'head_worker': ('men/Worker.gltf', 'Worker_Head', {}),
        'body_worker': ('men/Worker.gltf', 'Worker_Body', {'LightBrown': ('top', 1.0)}),
        'legs_worker': ('men/Worker.gltf', 'Worker_Legs',
                        {'Brown': ('bottom', 1.0), 'Brown2': ('bottom', 0.8)}),
        'feet_worker': ('men/Worker.gltf', 'Worker_Feet',
                        {'Grey': ('shoes', 1.0), 'Black': ('fixed', None)}),
        'backpack': ('men/Adventurer.gltf', 'Backpack',
                     {'Brown': ('accent', 0.8), 'LightGreen': ('accent', 1.0),
                      'Green': ('accent', 0.7)}),
    },
    'women': {
        'head_bob': ('women/Casual.gltf', 'Casual_Head',
                     {'Hair_Brown': ('hair', 0.55), 'Brown': ('fixed', None)}),
        'body_tee': ('women/Casual.gltf', 'Casual_Body', {'White': ('top', 1.0)}),
        'legs_trousers': ('women/Casual.gltf', 'Casual_Legs', {'Orange': ('bottom', 1.0)}),
        'feet_flat': ('women/Casual.gltf', 'Casual_Feet', {'Grey': ('shoes', 1.0)}),
        'head_updo': ('women/Formal.gltf', 'Formad_Head',
                      {'Brown': ('fixed', None), 'Red': ('hair', 1.0)}),
        'body_dress': ('women/Formal.gltf', 'Formal_Body', {'LimeGreen': ('top', 1.0)}),
        'legs_dress': ('women/Formal.gltf', 'Formal_Legs', {'LimeGreen': ('top', 1.0)}),
        'feet_heel': ('women/Formal.gltf', 'Formal_Feet', {'Red': ('shoes', 1.0)}),
        'body_suit': ('women/Suit.gltf', 'Suit_Body',
                      {'Black': ('top', 1.0), 'White': ('accent', 1.0)}),
        'legs_suit': ('women/Suit.gltf', 'Suit_Legs', {'Black': ('bottom', 1.0)}),
        'feet_suit': ('women/Suit.gltf', 'Suit_Feet', {'Black': ('shoes', 1.0)}),
        'body_crop': ('women/Punk.gltf', 'Punk_Body',
                      {'Pink': ('top', 1.0), 'Black': ('accent', 1.0)}),
        'legs_leggings': ('women/Punk.gltf', 'Punk_Legs', {'Black': ('bottom', 1.0)}),
        'feet_boot': ('women/Punk.gltf', 'Punk_Feet',
                      {'Black': ('shoes', 1.0), 'Grey': ('fixed', None)}),
        'head_worker': ('women/Worker.gltf', 'Worker_Head',
                        {'DarkBrown': ('hair', 1.0), 'Brown': ('fixed', None)}),
        'body_worker': ('women/Worker.gltf', 'Worker_Body', {'White': ('top', 1.0)}),
        'legs_worker': ('women/Worker.gltf', 'Worker_Legs',
                        {'Brown_02': ('bottom', 1.0), 'Brown2': ('bottom', 0.8)}),
    },
}

# Far LOD silhouettes: (name, parts, [triangle targets])
PROXIES = {
    'men': [
        ('long', ['head_suit', 'body_suit', 'legs_suit', 'feet_suit']),
        ('short', ['head_casual', 'body_tee', 'legs_jeans', 'feet_sneaker']),
    ],
    'women': [
        ('trousers', ['head_bob', 'body_tee', 'legs_trousers', 'feet_flat']),
        ('dress', ['head_updo', 'body_dress', 'legs_dress', 'feet_heel']),
    ],
}
PROXY_TRIS = [('L1', 1100), ('L2', 320)]

SMOOTH_ANGLE = math.radians(48)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30


def import_gltf(path):
    before = set(bpy.data.objects)
    acts_before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    new_acts = [a for a in bpy.data.actions if a not in acts_before]
    return new, new_acts


def delete(objs):
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
    # Drop the source meshes and materials too, so the next import of the same
    # file gets its material names back unsuffixed ("Suit.001" stays
    # "Suit.001" instead of becoming "Suit.003").
    for me in [m for m in bpy.data.meshes if m.users == 0]:
        bpy.data.meshes.remove(me)
    for mat in [m for m in bpy.data.materials if m.users == 0 and not m.name.startswith('REG|')]:
        bpy.data.materials.remove(mat)


def region_material(region, shade, rgb):
    """Materials named for their paint code survive joins and decimation."""
    if region in ('fixed', 'prop'):
        key = 'REG|%d|%.4f|%.4f|%.4f' % ((REGION[region],) + tuple(rgb))
    else:
        key = 'REG|%d|%.3f|%.3f|%.3f' % ((REGION[region],) + (shade,) * 3)
    m = bpy.data.materials.get(key)
    if m is None:
        m = bpy.data.materials.new(key)
    return m


def base_color(mat):
    if mat is None:
        return (0.5, 0.5, 0.5)
    if mat.use_nodes:
        for n in mat.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                c = n.inputs['Base Color'].default_value
                return (c[0], c[1], c[2])
    c = mat.diffuse_color
    return (c[0], c[1], c[2])


_reported = set()


def apply_rules(obj, rules):
    """Reassign every face to a REG| material from its source material."""
    me = obj.data
    mw = obj.matrix_world
    src = [s.material for s in obj.material_slots]
    table = dict(BASE)
    table.update(rules)
    new_slots = {}
    face_mat = []
    for p in me.polygons:
        m = src[p.material_index] if p.material_index < len(src) else None
        name = m.name if m else '?'
        rule = table.get(name)
        if rule is None and m is not None:
            # Blender suffixes a re-imported name ("Black.001"); the source
            # name is what the tables use.
            base = name.rsplit('.', 1)[0] if name[-4:-3] == '.' and name[-3:].isdigit() else name
            rule = table.get(base)
        if rule is None:
            # anything unlisted keeps its authored colour
            rule = ('fixed', None)
            if name not in _reported:
                _reported.add(name)
                print(f'[crowd] {obj.name}: "{name}" kept as authored colour')
        if callable(rule):
            z = (mw @ p.center).z
            rule = rule(z)
        region, shade = rule
        rm = region_material(region, shade or 1.0, base_color(m))
        if rm.name not in new_slots:
            new_slots[rm.name] = rm
        face_mat.append(rm.name)
    me.materials.clear()
    order = list(new_slots)
    for k in order:
        me.materials.append(new_slots[k])
    idx = {k: i for i, k in enumerate(order)}
    for p, k in zip(me.polygons, face_mat):
        p.material_index = idx[k]


def paint_from_materials(obj):
    """Write COLOR_0 from the REG| material names, then drop the materials."""
    me = obj.data
    # A few source meshes carry an all-white COLOR_0 of their own; the exporter
    # writes the render-active attribute, so it must be the only one.
    for old in list(me.color_attributes):
        me.color_attributes.remove(old)
    attr = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    mats = [s.material for s in obj.material_slots]
    for p in me.polygons:
        name = mats[p.material_index].name
        _, reg, r, g, b = name.split('|')
        col = (float(r), float(g), float(b), int(reg) / 7.0)
        for li in p.loop_indices:
            attr.data[li].color = col
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
    me.materials.clear()


def smooth(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=SMOOTH_ANGLE)


def rebind(obj, rig):
    """Point a part at the master rig without moving it."""
    mw = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = mw
    for m in obj.modifiers:
        if m.type == 'ARMATURE':
            m.object = rig


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def decimate_to(obj, target):
    n = tri_count(obj)
    if n <= target:
        return
    mod = obj.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = max(0.02, target / n)
    mod.use_collapse_triangulate = True
    # Keep the armature modifier last so decimation runs on the rest mesh.
    bpy.context.view_layer.objects.active = obj
    while obj.modifiers.find('dec') > 0:
        bpy.ops.object.modifier_move_up(modifier='dec')
    bpy.ops.object.modifier_apply(modifier='dec')


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def duplicate(obj):
    d = obj.copy()
    d.data = obj.data.copy()
    bpy.context.collection.objects.link(d)
    return d


def add_phone(rig, gender):
    """A handset weighted to the right wrist, region 7 (prop)."""
    wrist = rig.data.bones['Wrist.R']
    head = rig.matrix_world @ wrist.head_local
    tail = rig.matrix_world @ wrist.tail_local
    axis = (tail - head).normalized()
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    # 7 x 14 x 0.9 cm, held in the palm a little past the wrist joint
    bmesh.ops.scale(bm, vec=Vector((0.07, 0.14, 0.009)), verts=bm.verts)
    me = bpy.data.meshes.new('part_phone')
    bm.to_mesh(me)
    ob = bpy.data.objects.new('PART_phone', me)
    bpy.context.collection.objects.link(ob)
    # align the long side with the forearm-to-hand direction
    up = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
    x = up.cross(axis).normalized()
    z = axis.cross(x).normalized()
    rot = Matrix((x, axis, z)).transposed().to_4x4()
    ob.matrix_world = Matrix.Translation(head + axis * 0.1) @ rot
    vg = ob.vertex_groups.new(name='Wrist.R')
    vg.add([v.index for v in me.vertices], 1.0, 'REPLACE')
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    mat = region_material('prop', 1.0, (0.02, 0.02, 0.025))
    me.materials.append(mat)
    ob.parent = rig
    ob.matrix_parent_inverse = rig.matrix_world.inverted()
    return ob


def author_phone_clip(rig, base_action):
    """Phone idle: Idle_Neutral with the right forearm up and the head down.

    Rotations are applied on top of the base clip's keys in each bone's own
    local frame, so the clip keeps the base idle's breathing and weight shift.
    """
    act = base_action.copy()
    act.name = 'Phone'
    rig.animation_data_create()
    rig.animation_data.action = act
    # bone: [(local axis, degrees)], applied in order. This rig's arm bones
    # flex about local Z and twist about local Y; neck and head nod about X.
    # Measured in Blender: the wrist ends ~23 cm in front of the chest, the
    # elbow stays at the side.
    offsets = {
        'UpperArm.R': [((0, 0, 1), 25), ((0, 1, 0), -20)],
        'LowerArm.R': [((0, 0, 1), 95)],
        'Neck': [((1, 0, 0), 8)],
        'Head': [((1, 0, 0), 20)],
    }
    from mathutils import Quaternion
    for bone, rots in offsets.items():
        path = f'pose.bones["{bone}"].rotation_quaternion'
        curves = [act.fcurves.find(path, index=i) for i in range(4)]
        if any(c is None for c in curves):
            continue
        q_off = Quaternion()
        for ax, deg in rots:
            q_off = q_off @ Quaternion(Vector(ax), math.radians(deg))
        frames = sorted({round(k.co[0], 3) for c in curves for k in c.keyframe_points})
        values = []
        for f in frames:
            q = Quaternion([c.evaluate(f) for c in curves])
            values.append((f, q @ q_off))
        for c in curves:
            c.keyframe_points.clear()
        for f, q in values:
            for i, c in enumerate(curves):
                c.keyframe_points.insert(f, q[i], options={'FAST'})
    return act


def build(gender):
    reset()
    parts = PARTS[gender]
    first = next(iter(parts.values()))[0]
    objs, acts = import_gltf(os.path.join(SRC, first))
    rig = next(o for o in objs if o.type == 'ARMATURE')
    rig.name = 'CrowdRig'
    rig.data.name = 'CrowdRig'
    keep_actions = {}
    for a in acts:
        clean = a.name.replace('_CharacterArmature', '')
        if clean in CLIPS:
            a.name = clean
            a.use_fake_user = True
            keep_actions[clean] = a
        else:
            bpy.data.actions.remove(a)
    delete([o for o in objs if o is not rig])

    by_file = {}
    for key, (f, obname, rules) in parts.items():
        by_file.setdefault(f, []).append((key, obname, rules))

    part_objs = {}
    for f, items in by_file.items():
        objs, acts = import_gltf(os.path.join(SRC, f))
        for a in acts:
            bpy.data.actions.remove(a)
        wanted = {obname: (key, rules) for key, obname, rules in items}
        for o in objs:
            if o.type == 'MESH' and o.name in wanted:
                key, rules = wanted[o.name]
                apply_rules(o, rules)
                rebind(o, rig)
                o.name = f'PART_{key}'
                o.data.name = f'PART_{key}'
                part_objs[key] = o
        delete([o for o in objs if o.name not in {p.name for p in part_objs.values()}])

    part_objs['phone'] = add_phone(rig, gender)

    # Proxies first, from copies, while the parts still carry REG materials.
    proxies = []
    for pname, keys in PROXIES[gender]:
        for lod, tris in PROXY_TRIS:
            copies = [duplicate(part_objs[k]) for k in keys]
            p = join(copies, f'PROXY_{pname}_{lod}')
            decimate_to(p, tris)
            proxies.append(p)

    for o in list(part_objs.values()) + proxies:
        paint_from_materials(o)
        smooth(o)

    base = keep_actions.get('Idle_Neutral') or keep_actions.get('Idle')
    phone = author_phone_clip(rig, base)
    phone.use_fake_user = True
    rig.animation_data.action = None

    # Rest pose for export; every clip is exported as its own animation.
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'crowd_{gender}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=False,
        export_yup=True,
        export_apply=False,
        export_materials='NONE',
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_texcoords=False,
        export_normals=True,
        export_skins=True,
        export_influence_nb=4,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_force_sampling=True,
        export_frame_step=1,
        export_optimize_animation_size=True,
        export_anim_single_armature=True,
        export_def_bones=False,
    )
    summary = {o.name: tri_count(o) for o in list(part_objs.values()) + proxies}
    print('[crowd]', gender, os.path.getsize(path), 'bytes', summary)
    print('[crowd] clips', sorted(a.name for a in bpy.data.actions))


for g in ('men', 'women'):
    build(g)
