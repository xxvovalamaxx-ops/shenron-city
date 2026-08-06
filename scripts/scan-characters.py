import bpy
import json
import os
import sys

LIST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "character-scan-list.json")
with open(LIST_PATH, "r") as fh:
    FILES = json.load(fh)
REPORT = {}

for path in FILES:
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        ext = os.path.splitext(path)[1].lower()
        if ext in (".glb", ".gltf"):
            bpy.ops.import_scene.gltf(filepath=path)
        else:
            bpy.ops.import_scene.fbx(filepath=path, axis_forward="-Z", axis_up="Y")
        objs = list(bpy.data.objects)
        meshes = [o for o in objs if o.type == "MESH"]
        arms = [o for o in objs if o.type == "ARMATURE"]
        verts = tris = 0
        for o in meshes:
            verts += len(o.data.vertices)
            tris += sum(1 if len(p.vertices) == 3 else 2 for p in o.data.polygons)
        bones = sum(len(a.data.bones) for a in arms) if arms else 0
        actions = list(bpy.data.actions)
        clips = []
        for a in actions:
            if a.frame_range:
                clips.append({
                    "name": a.name,
                    "frames": int(a.frame_range[1] - a.frame_range[0]),
                    "seconds": round((a.frame_range[1] - a.frame_range[0]) / bpy.context.scene.render.fps, 2),
                })
        shape_keys = sum(len(m.data.shape_keys.key_blocks) if m.data.shape_keys else 0 for m in meshes)
        mats = set()
        for m in meshes:
            for slot in m.material_slots:
                if slot.material:
                    mats.add(slot.material.name)
        textures = len(bpy.data.images)
        mb = os.path.getsize(path) / 1048576
        minc = None
        maxc = None
        for o in meshes:
            for v in o.data.vertices:
                w = o.matrix_world @ v.co
                if minc is None:
                    minc = [w.x, w.y, w.z]
                    maxc = [w.x, w.y, w.z]
                else:
                    for i in range(3):
                        minc[i] = min(minc[i], w[i])
                        maxc[i] = max(maxc[i], w[i])
        REPORT[os.path.basename(path)] = {
            "sizeMB": round(mb, 1),
            "objects": len(objs),
            "meshes": len(meshes),
            "verts": verts,
            "tris": tris,
            "bones": bones,
            "actions": len(actions),
            "clips": clips[:20],
            "shapeKeys": shape_keys,
            "materials": len(mats),
            "textures": textures,
            "boundsM": [round(maxc[i] - minc[i], 3) for i in range(3)],
        }
        print("OK", os.path.basename(path), flush=True)
    except Exception as e:
        REPORT[os.path.basename(path)] = {"error": repr(e)}
        print("ERR", os.path.basename(path), repr(e)[:120], flush=True)

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "character-scan.json"), "w") as fh:
    json.dump(REPORT, fh, indent=1, default=str)
print("SCAN DONE")
