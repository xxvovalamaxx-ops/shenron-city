import bpy
import json
import os
import math
import sys
from mathutils import Vector

STAGING = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "staging", "assets"))
EVIDENCE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "evidence", "assets", "previews"))
LIST = os.path.join(STAGING, "preview-list.json")

os.makedirs(EVIDENCE, exist_ok=True)

with open(LIST, "r", encoding="utf-8") as fh:
    data = json.load(fh)

TURNTABLE_FRAMES = 24


def fresh_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in list(bpy.data.collections):
        if coll.users == 0:
            bpy.data.collections.remove(coll)


def import_file(path, ext):
    ext = "." + ext
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path, forward_axis="NEGATIVE_Z", up_axis="Y")
    elif ext == ".blend":
        with bpy.data.libraries.load(path) as (data_from, data_to):
            for name in data_from.objects:
                data_to.objects.append(name)
        for ob in list(bpy.data.objects):
            if ob.users == 0:
                bpy.data.objects.remove(ob)
    else:
        bpy.ops.import_scene.fbx(filepath=path, axis_forward="-Z", axis_up="Y")


def setup_scene(bg=(0.12, 0.12, 0.14, 1.0)):
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.render.resolution_x = 512
    bpy.context.scene.render.resolution_y = 512
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.view_settings.view_transform = "Standard"
    bpy.context.scene.view_settings.look = "None"
    world = bpy.data.worlds.new("pw")
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")
    if bg_node:
        bg_node.inputs[0].default_value = bg
        bg_node.inputs[1].default_value = 1.0
    bpy.context.scene.world = world


def add_key(name, energy, x, y, z):
    light_data = bpy.data.lights.new(name, "POINT")
    light_data.energy = energy
    light_obj = bpy.data.objects.new(name, light_data)
    bpy.context.scene.collection.objects.link(light_obj)
    light_obj.location = (x, y, z)
    return light_obj


def bounds_and_center():
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        return None
    min_v = Vector((1e9, 1e9, 1e9))
    max_v = Vector((-1e9, -1e9, -1e9))
    for ob in meshes:
        for v in ob.data.vertices:
            w = ob.matrix_world @ v.co
            for i in range(3):
                min_v[i] = min(min_v[i], w[i])
                max_v[i] = max(max_v[i], w[i])
    return min_v, max_v, (min_v + max_v) / 2


def aim_cam(cam, target):
    track = cam.constraints.new(type="TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"


def make_cam(name="cam"):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = 50
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    target = bpy.data.objects.new(name + "_target", None)
    bpy.context.scene.collection.objects.link(target)
    aim_cam(cam, target)
    bpy.context.scene.camera = cam
    return cam, target


def render(out_path):
    bpy.context.scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)


def center_objects():
    bpy.ops.object.select_all(action="SELECT")
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            ob.select_set(True)
    active = next((o for o in bpy.data.objects if o.type == "MESH"), None)
    if active:
        bpy.context.view_layer.objects.active = active
        bpy.ops.object.origin_set(type="ORIGIN_CENTER_OF_VOLUME", center="BOUNDS")
        bpy.ops.object.location_clear()


def render_views(asset_id, out_dir, dim, center, yaw_views, bg=(0.12, 0.12, 0.14, 1.0), lens=50):
    setup_scene(bg)
    cam, target = make_cam()
    cam.data.lens = lens
    target.location = center
    dist = dim * 2.0 + 0.6
    for name, (yaw, pitch) in yaw_views:
        cam.location = (center.x + math.sin(yaw) * dist, center.y + math.cos(yaw) * dist, center.z + dim * 0.55)
        cam.rotation_euler = (0, 0, 0)
        render(os.path.join(out_dir, f"{name}.png"))


def render_wireframe(asset_id, out_dir, dim, center):
    setup_scene((0.05, 0.05, 0.08, 1.0))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    mat = bpy.data.materials.new("wire")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.95, 0.95, 0.2, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    for ob in meshes:
        wf = ob.modifiers.new("wireframe", "WIREFRAME")
        wf.thickness = dim * 0.004
        wf.use_even_offset = True
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    cam, target = make_cam()
    target.location = center
    dist = dim * 2.0 + 0.6
    cam.location = (center.x + dist, center.y + dist * 0.6, center.z + dim * 0.55)
    render(os.path.join(out_dir, f"wireframe.png"))


def render_scale_ref(asset_id, out_dir, dim, center):
    setup_scene((0.1, 0.1, 0.12, 1.0))
    bpy.ops.mesh.primitive_grid_add(size=8, x_subdivisions=8, y_subdivisions=8, location=(center.x, center.y, center.z - dim * 0.6))
    grid = bpy.context.active_object
    grid_mat = bpy.data.materials.new("grid")
    grid_mat.use_nodes = True
    bsdf = grid_mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.2, 0.2, 0.25, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.8
    grid.data.materials.clear()
    grid.data.materials.append(grid_mat)
    cam, target = make_cam()
    target.location = center
    dist = dim * 2.4 + 0.8
    cam.location = (center.x + dist, center.y + dist * 0.5, center.z + dim * 0.5)
    cam.data.lens = 35
    render(os.path.join(out_dir, f"scale-reference.png"))


def render_rig_view(asset_id, out_dir, dim, center, ext):
    setup_scene((0.06, 0.08, 0.12, 1.0))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    body_mat = bpy.data.materials.new("body")
    body_mat.use_nodes = True
    bsdf = body_mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.8, 0.8, 0.85, 0.25)
        bsdf.inputs["Alpha"].default_value = 0.25
    body_mat.blend_method = "BLEND"
    for ob in meshes:
        ob.data.materials.clear()
        ob.data.materials.append(body_mat)
    bone_mat = bpy.data.materials.new("bones")
    bone_mat.use_nodes = True
    b2 = bone_mat.node_tree.nodes.get("Principled BSDF")
    if b2:
        b2.inputs["Base Color"].default_value = (1.0, 0.3, 0.1, 1.0)
        b2.inputs["Emission Strength"].default_value = 1.2
    for arm in [o for o in bpy.data.objects if o.type == "ARMATURE"]:
        for bone in arm.data.bones:
            head = arm.matrix_world @ bone.head_local
            tail = arm.matrix_world @ bone.tail_local
            vec = tail - head
            length = vec.length
            if length < 1e-5:
                continue
            cyl = bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=dim * 0.012, depth=length, location=(0, 0, 0))
            co = bpy.context.active_object
            co.rotation_mode = "QUATERNION"
            co.rotation_quaternion = vec.to_track_quat("Z", "X")
            co.location = (head + tail) / 2
            co.data.materials.clear()
            co.data.materials.append(bone_mat)
    cam, target = make_cam()
    target.location = center
    dist = dim * 2.0 + 0.6
    cam.location = (center.x + dist, center.y + dist * 0.6, center.z + dim * 0.55)
    render(os.path.join(out_dir, f"rig.png"))


def render_clip_filmstrip(clip, char_src, out_dir):
    fresh_scene()
    setup_scene()
    import_file(char_src, "fbx")
    import_file(os.path.join(STAGING, "files", clip["relPath"]), "fbx")
    bbox = bounds_and_center()
    if not bbox:
        return
    (mn, mx, center) = bbox
    dim = max((mx - mn).x, (mx - mn).y, (mx - mn).z)
    add_key("key", 800, center.x + dim, center.y - dim, center.z + dim)
    cam, target = make_cam()
    target.location = center
    dist = dim * 2.2 + 0.6
    actions = [a for a in bpy.data.actions if a.frame_range[1] - a.frame_range[0] > 5]
    if not actions:
        return
    act = actions[0]
    f0, f1 = act.frame_range
    total = max(1, int(f1 - f0))
    steps = 6
    for i in range(steps):
        bpy.context.scene.frame_set(int(f0 + total * i / (steps - 1)))
        cam.location = (center.x + dist * 0.75, center.y - dist * 0.4, center.z + dim * 0.5)
        render(os.path.join(out_dir, f"{clip['clipName']}_{i+1:02d}.png"))


def render_turntable(asset_id, out_dir, dim, center, n=TURNTABLE_FRAMES):
    setup_scene()
    cam, target = make_cam()
    target.location = center
    dist = dim * 2.0 + 0.6
    tt_dir = os.path.join(out_dir, "turntable")
    os.makedirs(tt_dir, exist_ok=True)
    for i in range(n):
        yaw = math.radians(360 * i / n)
        cam.location = (center.x + math.sin(yaw) * dist, center.y + math.cos(yaw) * dist, center.z + dim * 0.45)
        render(os.path.join(tt_dir, f"frame_{i:03d}.png"))


def process_job(job):
    aid = job["id"]
    out_dir = os.path.join(EVIDENCE, aid)
    os.makedirs(out_dir, exist_ok=True)
    if os.path.exists(os.path.join(out_dir, "front.png")) and not job.get("force"):
        print("skip", aid, flush=True)
        return
    fresh_scene()
    setup_scene()
    import_file(os.path.join(STAGING, "files", job["relPath"]), job["ext"])
    bbox = bounds_and_center()
    if not bbox:
        print("NOBOUNDS", aid, flush=True)
        return
    (mn, mx, center) = bbox
    dim = max((mx - mn).x, (mx - mn).y, (mx - mn).z)
    center_objects()
    bbox = bounds_and_center()
    (mn, mx, center) = bbox
    add_key("key", 900, center.x + dim, center.y - dim, center.z + dim)
    add_key("fill", 350, center.x - dim, center.y + dim, center.z - dim * 0.5)
    add_key("rim", 250, center.x, center.y, center.z + dim * 2)
    yaw_views = [
        ("front", (0, 0)),
        ("back", (math.radians(180), 0)),
        ("left", (math.radians(90), 0)),
        ("right", (math.radians(-90), 0)),
        ("threequarter", (math.radians(45), 0)),
    ]
    render_views(aid, out_dir, dim, center, yaw_views)
    render_wireframe(aid, out_dir, dim, center)
    render_scale_ref(aid, out_dir, dim, center)
    if job["role"] in ("pedestrian-rig", "character-clip"):
        render_rig_view(aid, out_dir, dim, center, job["ext"])
    if job["role"] == "vehicle":
        interior_cam(aid, out_dir, dim, center)
    if job.get("turntable"):
        render_turntable(aid, out_dir, dim, center)
    print("done", aid, flush=True)


def interior_cam(asset_id, out_dir, dim, center):
    setup_scene()
    cam, target = make_cam()
    cam.data.lens = 30
    target.location = (center.x, center.y - dim * 0.5, center.z)
    cam.location = (center.x, center.y + dim * 0.22, center.z + dim * 0.06)
    render(os.path.join(out_dir, f"interior.png"))


for job in data["jobs"]:
    try:
        process_job(job)
    except Exception as e:
        print("ERR", job["id"], repr(e), flush=True)

for clip in data["charJobs"]:
    out_dir = os.path.join(EVIDENCE, clip["id"])
    os.makedirs(out_dir, exist_ok=True)
    try:
        char_src = os.path.join(STAGING, "files", clip["charRelPath"])
        render_clip_filmstrip(clip, char_src, out_dir)
        print("clip done", clip["id"], flush=True)
    except Exception as e:
        print("ERR", clip["id"], repr(e), flush=True)

print("ALL PREVIEWS DONE", flush=True)
