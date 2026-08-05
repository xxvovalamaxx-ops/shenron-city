import bpy
import bmesh
import json
import os
import time
import contextlib
import io
from mathutils import Vector

STAGING = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "staging", "assets"))
CANDIDATES = os.path.join(STAGING, "candidates.json")
REPORTS = os.path.join(STAGING, "reports")

os.makedirs(REPORTS, exist_ok=True)

with open(CANDIDATES, "r", encoding="utf-8") as fh:
    manifest = json.load(fh)


def fresh_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for coll in list(bpy.data.collections):
        if coll.users == 0:
            bpy.data.collections.remove(coll)


def is_ascii_fbx(path):
    try:
        with open(path, "rb") as fh:
            head = fh.read(16)
        return head.startswith(b"; FBX") or head.startswith(b";;\tFBX") or head.startswith(b";\tFBX")
    except Exception:
        return False


def import_file(path, ext):
    ext = "." + ext
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path, forward_axis="NEGATIVE_Z", up_axis="Y")
    elif ext == ".dae":
        raise RuntimeError("Collada import removed in Blender 5.1 (DAE unsupported)")
    elif ext == ".blend":
        with bpy.data.libraries.load(path) as (data_from, data_to):
            for name in data_from.objects:
                data_to.objects.append(name)
        for ob in list(bpy.data.objects):
            if ob.users == 0:
                bpy.data.objects.remove(ob)
    else:
        bpy.ops.import_scene.fbx(filepath=path, axis_forward="-Z", axis_up="Y")


def mesh_stats(mesh):
    verts = len(mesh.vertices)
    tris = sum(1 if len(p.vertices) == 3 else 2 for p in mesh.polygons) if mesh.polygons else 0
    has_uv = bool(mesh.uv_layers)
    uv_degenerate_polys = 0
    if has_uv and mesh.uv_layers:
        uv = mesh.uv_layers[0].data
        uv_area = mesh.uv_layers[0].data if False else None
        for p in mesh.polygons:
            keys = []
            for li in p.loop_indices:
                keys.append((round(uv[li].uv.x, 4), round(uv[li].uv.y, 4)))
            if len(set(keys)) < len(keys):
                uv_degenerate_polys += 1
            elif len(keys) >= 3:
                x = [k[0] for k in keys]
                y = [k[1] for k in keys]
                uarea = abs(sum(x[i] * (y[(i + 1) % len(y)] - y[i - 1]) for i in range(len(x))) * 0.5)
                if uarea < 1e-9:
                    uv_degenerate_polys += 1
    nonmanifold_edges = nonmanifold_verts = 0
    if verts and verts <= 300000:
        try:
            bm = bmesh.new()
            bm.from_mesh(mesh)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
            bm.edges.ensure_lookup_table()
            for e in bm.edges:
                if not e.is_manifold:
                    nonmanifold_edges += 1
                    if not e.verts[0].is_manifold:
                        nonmanifold_verts += 1
                    if not e.verts[1].is_manifold:
                        nonmanifold_verts += 1
            bm.free()
        except Exception:
            pass
    return {
        "verts": verts,
        "tris": tris,
        "hasUV": has_uv,
        "uvDegeneratePolys": uv_degenerate_polys,
        "nonManifoldEdges": nonmanifold_edges,
        "nonManifoldVerts": nonmanifold_verts,
        "shapeKeyCount": len(mesh.shape_keys.key_blocks) if mesh.shape_keys else 0,
        "hasCustomNormals": mesh.has_custom_normals,
    }


def inspect(path, ext, aid):
    fresh_scene()
    report = {"id": aid, "ext": ext, "started": time.time()}
    warn_buf = io.StringIO()
    try:
        t0 = time.time()
        with contextlib.redirect_stdout(warn_buf), contextlib.redirect_stderr(warn_buf):
            if ext == ".fbx" and is_ascii_fbx(path):
                report["importError"] = "ASCII FBX (Blender FBX importer does not support ASCII FBX)"
                report["status"] = "ASCII_FBX_UNSUPPORTED"
                return report
            import_file(path, ext)
        report["importSeconds"] = round(time.time() - t0, 2)
    except Exception as e:
        report["importError"] = repr(e)
        report["status"] = "IMPORT_FAILED"
        return report

    objs = [o for o in bpy.data.objects]
    report["objectCount"] = len(objs)
    mesh_objs = [o for o in objs if o.type == "MESH"]
    report["meshCount"] = len(mesh_objs)
    report["armatureCount"] = len([o for o in objs if o.type == "ARMATURE"])
    report["negativeScale"] = any(o.scale.x < 0 or o.scale.y < 0 or o.scale.z < 0 for o in objs)
    report["emptyCount"] = len([o for o in objs if o.type == "EMPTY"])

    total_v = total_t = 0
    meshes_detail = []
    bounds = None
    for ob in mesh_objs:
        if ob.modifiers:
            deps = bpy.context.evaluated_depsgraph_get()
            me = ob.to_mesh(preserve_all_data_layers=True, depsgraph=deps)
        else:
            me = ob.data
        if me.vertices:
            for v in me.vertices:
                p = ob.matrix_world @ v.co
                if bounds is None:
                    bounds = [[p.x, p.y, p.z], [p.x, p.y, p.z]]
                else:
                    bounds[0][0] = min(bounds[0][0], p.x)
                    bounds[0][1] = min(bounds[0][1], p.y)
                    bounds[0][2] = min(bounds[0][2], p.z)
                    bounds[1][0] = max(bounds[1][0], p.x)
                    bounds[1][1] = max(bounds[1][1], p.y)
                    bounds[1][2] = max(bounds[1][2], p.z)
        st = mesh_stats(me)
        st["objectName"] = ob.name
        st["materialSlots"] = len(ob.material_slots)
        meshes_detail.append(st)
        total_v += st["verts"]
        total_t += st["tris"]
        if ob.modifiers:
            ob.to_mesh_clear()
    report["vertexCount"] = total_v
    report["triangleCount"] = total_t
    report["meshes"] = meshes_detail
    if bounds:
        size = [bounds[1][i] - bounds[0][i] for i in range(3)]
        center = Vector(((bounds[1][0] + bounds[0][0]) / 2, (bounds[1][1] + bounds[0][1]) / 2, (bounds[1][2] + bounds[0][2]) / 2))
        report["boundsMin"] = [round(x, 4) for x in bounds[0]]
        report["boundsMax"] = [round(x, 4) for x in bounds[1]]
        report["boundsSize"] = [round(x, 4) for x in size]
        report["boundsCenter"] = [round(x, 4) for x in center]
        report["maxDimensionM"] = round(max(size), 4)
        root = next((o for o in objs if o.parent is None), None)
        if root is not None:
            offset = root.matrix_world.translation - center
            report["pivotOffsetM"] = [round(offset[i], 3) for i in range(3)]

    mats = set()
    textures = []
    for ob in mesh_objs:
        for slot in ob.material_slots:
            if slot.material:
                mats.add(slot.material)
    report["materialCount"] = len(mats)
    node_types = set()
    principled_count = 0
    alpha_modes = set()
    unsupported_nodes = set()
    tex_dims = []
    embedded = 0
    missing_refs = set()
    for mat in mats:
        alpha_modes.add(mat.blend_method)
        if mat.node_tree:
            for node in mat.node_tree.nodes:
                node_types.add(node.type)
                if node.type == "BSDF_PRINCIPLED":
                    principled_count += 1
                elif node.type in {"TEX_IMAGE", "TEX_COORD", "MAPPING", "MIX", "MIX_RGB", "SEPARATE_XYZ", "COMBINE_XYZ", "VECTOR_TRANSFORM", "UV_MAP", "ATTRIBUTE", "VALUE", "RGB", "FRESNEL", "LAYER_WEIGHT", "BUMP", "NORMAL_MAP", "GROUP", "GROUP_INPUT", "GROUP_OUTPUT", "OUTPUT_MATERIAL", "BSDF_GLOSSY", "BSDF_DIFFUSE", "BSDF_ANISOTROPIC", "BSDF_REFRACTION", "BSDF_TRANSPARENT", "BSDF_GLASS", "SHADER_MIX", "MATH", "CLAMP", "MAPPING", "AMBIENT_OCCLUSION", "WAVELENGTH", "LIGHT_FALLOFF", "EEVEE_SPECULAR", "PRINCIPLED_VOLUME", "VOLUME_ABSORPTION", "VOLUME_SCATTER", "BSDF_SHEEN", "BSDF_TOON", "BSDF_HAIR", "POINT_INFO", "PARTICLE_INFO", "OBJECT_INFO", "CURVE_INFO", "CAMERA_DATA", "TANGENT", "GEO_PROXIMITY", "RGB_MIX", "NODE_GROUP"}:
                    pass
                else:
                    unsupported_nodes.add(node.type)
                if node.type == "TEX_IMAGE" and node.image:
                    img = node.image
                    textures.append(img)
                    try:
                        tex_dims.append((img.size[0], img.size[1]))
                    except Exception:
                        tex_dims.append((0, 0))
                    if img.packed_file:
                        embedded += 1
                    elif img.source == "FILE" and img.filepath:
                        p = bpy.path.abspath(img.filepath)
                        if not os.path.exists(p):
                            missing_refs.add(p)
    report["materialNodeTypes"] = sorted(node_types)
    report["principledCount"] = principled_count
    report["alphaModes"] = sorted(alpha_modes)
    report["unsupportedNodeTypes"] = sorted(unsupported_nodes)
    report["textureCount"] = len(textures)
    report["textureDims"] = tex_dims[:64]
    report["maxTextureDim"] = max([max(d) for d in tex_dims], default=0)
    report["embeddedTextureCount"] = embedded
    report["externalTextureCount"] = len(textures) - embedded
    report["missingTextureRefs"] = sorted(missing_refs)
    report["estimatedVRAMMB"] = round(sum(w * h * 4 for w, h in tex_dims) / 1048576, 2)

    arms = [o for o in objs if o.type == "ARMATURE"]
    report["boneCount"] = sum(len(a.data.bones) for a in arms if a.data) if arms else 0
    report["hasSkinWeights"] = any(len(o.vertex_groups) > 0 for o in mesh_objs)
    report["vertexGroupCount"] = max([len(o.vertex_groups) for o in mesh_objs], default=0)

    report["actionCount"] = len(bpy.data.actions)
    durations = []
    root_motion = False
    for act in bpy.data.actions:
        if act.frame_range:
            durations.append(round((act.frame_range[1] - act.frame_range[0]) / 24.0, 3))
        try:
            fcurves = act.fcurves
        except AttributeError:
            fcurves = getattr(act, "channels", [])
        for fcu in fcurves:
            data_path = getattr(fcu, "data_path", "") or ""
            group = getattr(fcu, "group", None)
            group_name = getattr(group, "name", "") if group is not None else ""
            if "location" in data_path and group_name and "root" in group_name.lower():
                root_motion = True
    report["animationDurations"] = durations[:64]
    report["maxAnimationDuration"] = max(durations, default=0)
    report["hasRootMotion"] = root_motion

    names = [o.name.lower() for o in objs]
    report["lodCount"] = sum(1 for n in names if "lod" in n)
    report["collisionCount"] = sum(1 for n in names if "collision" in n or "col_" in n or "physics" in n)

    report["importWarnings"] = [w.strip() for w in warn_buf.getvalue().splitlines() if w.strip()][:40]
    report["status"] = "OK"
    return report


for c in manifest["candidates"]:
    aid = c["id"]
    out_path = os.path.join(REPORTS, aid + ".json")
    if os.path.exists(out_path):
        continue
    src = os.path.join(STAGING, "files", c["relPath"])
    if not os.path.exists(src):
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump({"id": aid, "status": "MISSING_STAGED_FILE"}, fh)
        continue
    t0 = time.time()
    try:
        rep = inspect(src, c["ext"], aid)
        rep["bytes"] = c["bytes"]
        rep["pack"] = c["pack"]
        rep["packCategory"] = c["packCategory"]
        rep["license"] = c["license"]
        rep["relPath"] = c["relPath"]
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(rep, fh, default=list, indent=1)
        print(f"[{aid}] {rep.get('status','?')} {round(time.time()-t0,1)}s", flush=True)
    except Exception as e:
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump({"id": aid, "status": "CRASHED", "error": repr(e)}, fh)
        print(f"[{aid}] CRASHED {repr(e)}", flush=True)

print("ALL DONE", flush=True)
