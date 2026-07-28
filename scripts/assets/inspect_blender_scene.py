"""Return a compact production-collection inventory through Blender MCP."""

import bpy


result = {
    "file": bpy.data.filepath,
    "collections": [
        {
            "name": collection.name,
            "direct_objects": len(collection.objects),
            "all_objects": len(collection.all_objects),
            "axis_roots": [
                obj.name
                for obj in collection.all_objects
                if obj is not None and obj.type == "EMPTY" and "AXIS_ROOT" in obj.name
            ],
            "plaza_objects": [
                obj.name
                for obj in collection.all_objects
                if obj is not None and "HQ_PLAZA" in obj.name
            ],
        }
        for collection in bpy.data.collections
        if collection.name.startswith("PRODUCTION_")
    ],
    "key_objects": {
        name: {
            "exists": bpy.data.objects.get(name) is not None,
            "collections": [
                collection.name for collection in bpy.data.objects[name].users_collection
            ] if bpy.data.objects.get(name) is not None else [],
            "parent": bpy.data.objects[name].parent.name
            if bpy.data.objects.get(name) is not None and bpy.data.objects[name].parent
            else None,
            "hidden": bpy.data.objects[name].hide_get()
            if bpy.data.objects.get(name) is not None
            else None,
        }
        for name in (
            "HQ_CANOPY",
            "HQ_PLAZA_PAVING",
            "MARKET_ramen",
            "ROAD_DragonBoulevard",
            "PRODUCTION_ExteriorHeroDistrict.002_AXIS_ROOT",
        )
    },
    "gltf_properties": [
        property.identifier
        for property in bpy.ops.export_scene.gltf.get_rna_type().properties
    ],
}
