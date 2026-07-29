"""Create a repository-safe Japanese forest shrine scene.

Project-authored layout, terrain, shrine architecture, lighting, and procedural
details are combined with explicitly verified Poly Haven CC0 nature assets and
Zgon's CC-BY-4.0 Komainu sculpture set.
The visual reference informs composition and atmosphere; none of its pixels or
unlicensed source geometry are embedded in the publishable Blender source.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


ROOT = Path(r"D:\Projects\GitHub Projects\shenron-city")
POLYHAVEN_ROOT = (
    ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "Raw"
    / "Verified"
    / "PolyHaven"
)
KOMA_INU_SOURCE = (
    ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "External"
    / "Zgon"
    / "Komainu_Statue"
    / "komainu_statue_1k.glb"
)
DAYLIGHT_HDRI = (
    POLYHAVEN_ROOT
    / "autumn_field_puresky"
    / "autumn_field_puresky_2k.hdr"
)
BLEND_PATH = (
    ROOT
    / "SourceAssets"
    / "Models"
    / "Environment"
    / "Working"
    / "Japanese_Forest_Shrine_Realistic.blend"
)
PREVIEW_PATH = (
    ROOT
    / "docs"
    / "Assets"
    / "Previews"
    / "japanese-forest-shrine-realistic.png"
)
REFERENCE_IMAGE = Path(
    r"C:\Users\xxvov\AppData\Local\Temp"
    r"\codex-clipboard-ffdb7388-3dc2-43a3-b27c-17eb18d42c3c.png"
)
CLAY_PATH = (
    ROOT
    / "docs"
    / "Assets"
    / "Previews"
    / "japanese-forest-shrine-clay.png"
)

random.seed(92341)


def clean_scene() -> bpy.types.Scene:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Remove the previous world before purging images. Otherwise a packed
    # HDRI from an earlier build remains referenced and silently inflates the
    # regenerated file even though this pass deliberately keeps it external.
    bpy.context.scene.world = None
    for world in list(bpy.data.worlds):
        bpy.data.worlds.remove(world)
    for existing_collection in list(bpy.data.collections):
        bpy.data.collections.remove(existing_collection)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.textures,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.node_groups,
    ):
        for datablock in list(datablocks):
            if hasattr(datablock, "use_fake_user"):
                datablock.use_fake_user = False
            if datablock.users == 0:
                datablocks.remove(datablock)
    for image in list(bpy.data.images):
        if image.users == 0 and image.type not in {"RENDER_RESULT", "COMPOSITING"}:
            bpy.data.images.remove(image)
    # Keep the published source self-contained. Blender can preload linked
    # Essentials brushes into a fresh session even though this generator does
    # not use them; remove those incidental library references before saving.
    for brush in list(bpy.data.brushes):
        if brush.library is not None or brush.users == 0:
            bpy.data.brushes.remove(brush)
    for palette in list(bpy.data.palettes):
        if palette.library is not None or palette.users == 0:
            bpy.data.palettes.remove(palette)
    for library in list(bpy.data.libraries):
        bpy.data.libraries.remove(library)
    bpy.data.orphans_purge(
        do_local_ids=True,
        do_linked_ids=True,
        do_recursive=True,
    )

    scene = bpy.context.scene
    scene.name = "Japanese_Forest_Shrine_Realistic"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene["asset_id"] = "environment.japanese_forest_shrine.realistic.v2"
    scene["asset_license"] = "CC0-1.0 + CC-BY-4.0"
    scene["asset_author"] = "Shenzhen City project"
    scene["asset_provenance"] = (
        "Original project-authored terrain, stairs, lanterns, flowers, "
        "lighting, shrine architecture, and composition with verified Poly "
        "Haven CC0 nature inputs and Zgon's CC-BY-4.0 Komainu Statue pair. "
        "No restricted, rejected-candidate, or unknown-license content."
    )
    scene["cc0_sources"] = (
        "https://polyhaven.com/a/forest_ground_04;"
        "https://polyhaven.com/a/pine_tree_01;"
        "https://polyhaven.com/a/rock_moss_set_01;"
        "https://polyhaven.com/a/fern_02;"
        "https://polyhaven.com/a/grass_medium_01;"
        "https://polyhaven.com/a/grass_medium_02;"
        "https://polyhaven.com/a/moss_01;"
        "https://polyhaven.com/a/nettle_plant;"
        "https://polyhaven.com/a/weed_plant_02;"
        "https://polyhaven.com/a/tree_small_02;"
        "https://polyhaven.com/a/island_tree_02"
    )
    scene["cc_by_sources"] = (
        "Komainu Statue by Zgon, CC BY 4.0;"
        "https://sketchfab.com/3d-models/"
        "komainu-statue-a5d4791ae95d4a9d9becedab6d2c7fc2"
    )
    scene["reference_scope"] = (
        "User-supplied image used only for broad composition: forested shrine, "
        "stone stairs, lanterns, guardian statues, and cinematic daylight."
    )
    return scene


def collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    target = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(target)
    return target


def move_to_collection(obj: bpy.types.Object, target: bpy.types.Collection) -> None:
    for source in list(obj.users_collection):
        source.objects.unlink(obj)
    target.objects.link(obj)


def material(
    name: str,
    base_color: tuple[float, float, float, float],
    roughness: float,
    *,
    metallic: float = 0.0,
    noise_scale: float | None = None,
    noise_strength: float = 0.25,
    bump_strength: float = 0.2,
    emission_color: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = base_color
    mat["asset_license"] = "CC0-1.0"
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = base_color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in shader.inputs:
        shader.inputs["Coat Weight"].default_value = 0.1 if metallic else 0.0
    if emission_color and "Emission Color" in shader.inputs:
        shader.inputs["Emission Color"].default_value = emission_color
        shader.inputs["Emission Strength"].default_value = emission_strength
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    if noise_scale:
        texcoord = nodes.new("ShaderNodeTexCoord")
        mapping = nodes.new("ShaderNodeMapping")
        noise = nodes.new("ShaderNodeTexNoise")
        ramp = nodes.new("ShaderNodeValToRGB")
        bump = nodes.new("ShaderNodeBump")
        noise.inputs["Scale"].default_value = noise_scale
        noise.inputs["Detail"].default_value = 5.0
        noise.inputs["Roughness"].default_value = 0.72
        ramp.color_ramp.elements[0].position = 0.25
        ramp.color_ramp.elements[0].color = (
            max(0.0, base_color[0] * (1.0 - noise_strength)),
            max(0.0, base_color[1] * (1.0 - noise_strength)),
            max(0.0, base_color[2] * (1.0 - noise_strength)),
            1.0,
        )
        ramp.color_ramp.elements[1].position = 0.78
        ramp.color_ramp.elements[1].color = (
            min(1.0, base_color[0] * (1.0 + noise_strength)),
            min(1.0, base_color[1] * (1.0 + noise_strength)),
            min(1.0, base_color[2] * (1.0 + noise_strength)),
            1.0,
        )
        bump.inputs["Strength"].default_value = bump_strength
        bump.inputs["Distance"].default_value = 0.16
        links.new(texcoord.outputs["Generated"], mapping.inputs["Vector"])
        links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], shader.inputs["Base Color"])
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return mat


def volume_material(name: str, density: float) -> bpy.types.Material:
    """Create scatter-only forest atmosphere without muddy absorption."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    volume = nodes.new("ShaderNodeVolumeScatter")
    volume.inputs["Density"].default_value = density
    volume.inputs["Color"].default_value = (0.72, 0.77, 0.70, 1.0)
    volume.inputs["Anisotropy"].default_value = 0.52
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    return mat


def light_shaft_volume_material(name: str) -> bpy.types.Material:
    """Create a very thin volume for real scatter-only shafts, never a surface card."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    volume = nodes.new("ShaderNodeVolumeScatter")
    volume.inputs["Density"].default_value = 0.009
    volume.inputs["Color"].default_value = (1.0, 0.88, 0.72, 1.0)
    volume.inputs["Anisotropy"].default_value = 0.58
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    return mat


def tag(obj: bpy.types.Object, asset_id: str) -> bpy.types.Object:
    obj["asset_id"] = asset_id
    obj["asset_license"] = "CC0-1.0"
    return obj


def append_cc0_material(
    asset_slug: str,
    material_name: str,
) -> bpy.types.Material:
    source = POLYHAVEN_ROOT / asset_slug / f"{asset_slug}_1k.blend"
    if not source.exists():
        raise FileNotFoundError(
            f"Missing verified CC0 source {source}. Run "
            "fetch_cc0_meadow_assets.py before rebuilding."
        )
    with bpy.data.libraries.load(str(source), link=False) as (data_from, data_to):
        if material_name not in data_from.materials:
            raise RuntimeError(f"{material_name} is missing from {source}")
        data_to.materials = [material_name]
    loaded = data_to.materials[0]
    loaded["asset_license"] = "CC0-1.0"
    loaded["asset_source"] = f"https://polyhaven.com/a/{asset_slug}"
    return loaded


def mossy_ground_material(source: bpy.types.Material) -> bpy.types.Material:
    """Preserve the CC0 PBR surface while adding broad forest-moss variation."""
    ground = source.copy()
    ground.name = "JF_CC0_ForestGround_MossBlend"
    nodes = ground.node_tree.nodes
    links = ground.node_tree.links
    shader = next(
        node for node in nodes if node.bl_idname == "ShaderNodeBsdfPrincipled"
    )
    base_color = shader.inputs["Base Color"]
    source_socket = base_color.links[0].from_socket if base_color.is_linked else None
    for link in list(base_color.links):
        links.remove(link)

    noise = nodes.new("ShaderNodeTexNoise")
    noise.name = "JF_MossCoverage"
    noise.inputs["Scale"].default_value = 0.62
    noise.inputs["Detail"].default_value = 4.2
    noise.inputs["Roughness"].default_value = 0.72

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.name = "JF_MossCoverageRamp"
    ramp.color_ramp.elements[0].position = 0.18
    ramp.color_ramp.elements[0].color = (0.52, 0.52, 0.52, 1.0)
    ramp.color_ramp.elements[1].position = 0.61
    ramp.color_ramp.elements[1].color = (0.86, 0.86, 0.86, 1.0)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])

    mix = nodes.new("ShaderNodeMixRGB")
    mix.name = "JF_ForestGroundMossMix"
    mix.blend_type = "MIX"
    mix.inputs["Color2"].default_value = (0.095, 0.140, 0.070, 1.0)
    if source_socket is not None:
        links.new(source_socket, mix.inputs["Color1"])
    else:
        mix.inputs["Color1"].default_value = base_color.default_value
    links.new(ramp.outputs["Color"], mix.inputs["Fac"])
    hue = nodes.new("ShaderNodeHueSaturation")
    hue.name = "JF_ForestGroundColorUnification"
    hue.inputs["Saturation"].default_value = 0.68
    hue.inputs["Value"].default_value = 0.82
    links.new(mix.outputs["Color"], hue.inputs["Color"])
    links.new(hue.outputs["Color"], base_color)
    ground["asset_id"] = "shrine.material.forest_ground_moss_blend"
    ground["asset_license"] = "CC0-1.0"
    ground["asset_source"] = "https://polyhaven.com/a/forest_ground_04"
    return ground


def append_cc0_objects(
    asset_slug: str,
    object_names: list[str],
    source_collection: bpy.types.Collection,
) -> dict[str, bpy.types.Object]:
    source = POLYHAVEN_ROOT / asset_slug / f"{asset_slug}_1k.blend"
    requested = list(object_names)
    if not source.exists():
        raise FileNotFoundError(
            f"Missing verified CC0 source {source}. Run "
            "fetch_cc0_meadow_assets.py before rebuilding."
        )
    with bpy.data.libraries.load(str(source), link=False) as (data_from, data_to):
        missing = sorted(set(requested) - set(data_from.objects))
        if missing:
            raise RuntimeError(f"Missing objects in {asset_slug}: {missing}")
        data_to.objects = list(requested)
    loaded: dict[str, bpy.types.Object] = {}
    for requested_name, obj in zip(requested, data_to.objects):
        if obj is None:
            raise RuntimeError(f"Failed to append {requested_name} from {asset_slug}")
        source_collection.objects.link(obj)
        obj.hide_render = True
        obj.hide_set(True)
        obj["asset_id"] = f"cc0.polyhaven.{asset_slug}.{requested_name}"
        obj["asset_license"] = "CC0-1.0"
        obj["asset_source"] = f"https://polyhaven.com/a/{asset_slug}"
        loaded[requested_name] = obj
    return loaded


def instance_cc0(
    template: bpy.types.Object,
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    rotation_z: float,
    target: bpy.types.Collection,
) -> bpy.types.Object:
    obj = template.copy()
    obj.data = template.data
    obj.animation_data_clear()
    obj.name = name
    obj.location = location
    obj.scale = scale
    obj.rotation_euler = (0.0, 0.0, rotation_z)
    obj.hide_render = False
    obj.hide_set(False)
    target.objects.link(obj)
    obj["asset_id"] = f"shrine.cc0_instance.{name.lower()}"
    obj["asset_license"] = "CC0-1.0"
    obj["asset_source"] = template.get("asset_source", "Poly Haven CC0")
    return obj


def desaturate_nature_materials(
    objects: list[bpy.types.Object],
    saturation: float,
    value: float = 0.96,
) -> None:
    """Reduce scan saturation at the albedo input while retaining PBR maps."""
    processed: set[bpy.types.Material] = set()
    for obj in objects:
        if obj.type != "MESH":
            continue
        for mat in obj.data.materials:
            if mat is None or mat in processed or not mat.use_nodes:
                continue
            processed.add(mat)
            shader = next(
                (
                    node
                    for node in mat.node_tree.nodes
                    if node.bl_idname == "ShaderNodeBsdfPrincipled"
                ),
                None,
            )
            if shader is None:
                continue
            base_color = shader.inputs["Base Color"]
            if not base_color.is_linked:
                continue
            source_socket = base_color.links[0].from_socket
            for link in list(base_color.links):
                mat.node_tree.links.remove(link)
            hue = mat.node_tree.nodes.new("ShaderNodeHueSaturation")
            hue.name = "JF_ForestColorUnification"
            hue.inputs["Saturation"].default_value = saturation
            hue.inputs["Value"].default_value = value
            hue.inputs["Fac"].default_value = 1.0
            mat.node_tree.links.new(source_socket, hue.inputs["Color"])
            mat.node_tree.links.new(hue.outputs["Color"], base_color)
            mat["jf_color_unification_saturation"] = saturation


def build_cc0_nature(
    source_collection: bpy.types.Collection,
    target: bpy.types.Collection,
) -> dict[str, int]:
    pines = append_cc0_objects(
        "pine_tree_01",
        [
            "pine_tree_01_a_LOD2",
            "pine_tree_01_b_LOD2",
        ],
        source_collection,
    )
    # Poly Haven's source "LOD2" meshes are still cinematic scans. Linked
    # instances preserve their materials and silhouettes, so simplify the two
    # shared source meshes once rather than carrying nearly a million polygons
    # into the publishable scene.
    for tree in pines.values():
        bpy.ops.object.select_all(action="DESELECT")
        tree.hide_set(False)
        tree.select_set(True)
        bpy.context.view_layer.objects.active = tree
        decimate = tree.modifiers.new("JF_WebSource_Decimate", "DECIMATE")
        decimate.ratio = 0.18
        decimate.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        tree.hide_set(True)
    rocks = append_cc0_objects(
        "rock_moss_set_01",
        [f"rock_moss_set_01_rock{index:02d}" for index in range(1, 7)],
        source_collection,
    )
    ferns = append_cc0_objects(
        "fern_02",
        [f"fern_02_{letter}" for letter in "abcd"],
        source_collection,
    )
    grasses = append_cc0_objects(
        "grass_medium_01",
        [
            "grass_medium_01_tiny_a_LOD2",
            "grass_medium_01_mid_a_LOD2",
            "grass_medium_01_large_a_LOD2",
        ],
        source_collection,
    )
    grasses_02 = append_cc0_objects(
        "grass_medium_02",
        [f"grass_medium_02_{letter}" for letter in "abcde"],
        source_collection,
    )
    moss_strands = append_cc0_objects(
        "moss_01",
        [f"moss_01_{letter}_LOD2" for letter in "abcdefghij"],
        source_collection,
    )
    nettles = append_cc0_objects(
        "nettle_plant",
        [
            "nettle_plant_small_a_LOD2",
            "nettle_plant_small_b_LOD2",
            "nettle_plant_medium_a_LOD2",
            "nettle_plant_medium_b_LOD2",
        ],
        source_collection,
    )
    weeds = append_cc0_objects(
        "weed_plant_02",
        [f"weed_plant_02_{letter}_LOD2" for letter in "abcde"],
        source_collection,
    )
    broadleaf_trees = {
        "tree_small_02": append_cc0_objects(
            "tree_small_02",
            ["tree_small_02_LOD1"],
            source_collection,
        )["tree_small_02_LOD1"],
        "island_tree_02": append_cc0_objects(
            "island_tree_02",
            ["island_tree_02_LOD1"],
            source_collection,
        )["island_tree_02_LOD1"],
    }
    desaturate_nature_materials(
        list(pines.values())
        + list(rocks.values())
        + list(ferns.values())
        + list(grasses.values())
        + list(grasses_02.values())
        + list(moss_strands.values())
        + list(nettles.values())
        + list(weeds.values())
        + list(broadleaf_trees.values()),
        0.34,
        1.05,
    )
    # The published source must remain below GitHub's 100 MiB blob limit.
    # Preserve UVs/materials while reducing source-scan density to a still
    # detailed hero-environment budget before creating linked instances.
    for tree in broadleaf_trees.values():
        bpy.ops.object.select_all(action="DESELECT")
        tree.hide_set(False)
        tree.select_set(True)
        bpy.context.view_layer.objects.active = tree
        decimate = tree.modifiers.new("JF_WebSource_Decimate", "DECIMATE")
        decimate.ratio = 0.24
        decimate.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        tree.hide_set(True)

    tree_positions = [
        (-11.5, -13.5, 1.48, 0.18),
        (-8.2, -9.2, 1.36, -0.36),
        (-16.8, -8.0, 1.35, -0.10),
        (-13.2, -1.0, 1.22, 0.35),
        (-12.0, 8.0, 1.12, -0.45),
        (-10.0, 18.0, 1.18, 0.70),
        (-4.0, 24.0, 1.25, -0.22),
        (14.7, -4.0, 1.24, 0.15),
        (17.0, 4.0, 1.13, -0.58),
        (15.2, 12.0, 1.28, 0.42),
        (12.6, 20.0, 1.20, -0.28),
        (7.5, 25.0, 1.16, 0.81),
        (-18.0, 16.0, 1.30, -0.74),
        (19.0, 19.0, 1.25, 0.54),
        (-6.5, 16.0, 1.48, -0.32),
        (-2.5, 17.5, 1.52, 0.25),
        (2.5, 18.5, 1.45, -0.62),
        (-1.0, 24.0, 1.58, 0.48),
        (-17.0, 24.0, 1.68, 0.10),
        (-13.0, 26.0, 1.74, -0.46),
        (-9.0, 24.5, 1.66, 0.58),
        (-5.0, 27.0, 1.75, -0.14),
        (3.0, 25.5, 1.70, 0.36),
        (8.0, 27.5, 1.78, -0.55),
        (13.0, 25.0, 1.69, 0.20),
        (18.0, 28.0, 1.82, -0.32),
        (-18.0, 30.0, 1.72, -0.20),
        (-13.0, 34.0, 1.88, 0.42),
        (-8.0, 31.0, 1.76, -0.62),
        (-3.0, 37.0, 1.96, 0.18),
        (2.0, 33.0, 1.80, -0.35),
        (7.0, 39.0, 2.02, 0.55),
        (12.0, 32.0, 1.82, -0.75),
        (17.0, 36.0, 1.94, 0.25),
        (-20.0, 42.0, 2.04, -0.48),
        (-7.0, 44.0, 2.12, 0.68),
        (6.0, 45.0, 2.08, -0.12),
        (20.0, 43.0, 2.10, 0.38),
    ]
    pine_templates = list(pines.values())
    for index, (x, y, scale, rotation) in enumerate(tree_positions):
        z = terrain_height(x, y) - 0.12
        instance_cc0(
            pine_templates[index % len(pine_templates)],
            f"JF_CC0_Pine_{index:02d}",
            (x, y, z),
            (scale, scale, scale * random.uniform(0.96, 1.06)),
            rotation,
            target,
        )

    broadleaf_positions = [
        ("island_tree_02", -9.7, -13.5, 4.45, 0.34),
        ("tree_small_02", -12.0, -20.0, 4.8, -0.26),
        ("island_tree_02", 12.0, -19.0, 4.7, 0.48),
        ("island_tree_02", -13.5, -15.5, 5.1, -0.18),
        ("island_tree_02", -19.0, -15.0, 4.1, -0.34),
        ("tree_small_02", -17.0, -6.0, 3.1, 0.15),
        ("tree_small_02", -13.0, 1.0, 3.6, -0.45),
        ("tree_small_02", -11.0, 10.0, 3.3, 0.72),
        ("island_tree_02", -7.0, 19.0, 3.2, -0.20),
        ("island_tree_02", -2.0, 22.0, 3.8, 0.55),
        ("tree_small_02", 4.0, 24.0, 3.6, -0.15),
        ("tree_small_02", 23.0, 27.0, 3.5, 0.35),
        ("island_tree_02", 22.0, 25.0, 3.4, -0.62),
        ("tree_small_02", 22.0, 12.0, 3.1, 0.18),
        ("island_tree_02", 18.0, 0.0, 3.9, 0.80),
        ("tree_small_02", 15.0, -8.0, 3.2, -0.28),
        ("tree_small_02", -18.0, 15.0, 3.4, 0.44),
        ("island_tree_02", -3.5, 14.5, 3.6, -0.48),
        ("tree_small_02", 2.5, 18.0, 3.8, 0.31),
        ("island_tree_02", 20.0, -10.0, 4.0, 0.57),
        ("tree_small_02", -18.0, 7.0, 4.3, -0.28),
        ("island_tree_02", -14.0, 12.0, 4.5, 0.52),
        ("tree_small_02", -9.0, 16.0, 4.4, -0.38),
        ("island_tree_02", -5.0, 20.0, 4.6, 0.24),
        ("tree_small_02", 4.0, 32.0, 4.3, -0.58),
        ("island_tree_02", 16.0, 30.0, 4.5, 0.31),
        ("tree_small_02", 22.0, 32.0, 4.4, -0.12),
        ("tree_small_02", 0.0, 27.0, 4.2, -0.19),
        ("island_tree_02", -21.0, 31.0, 4.5, -0.35),
        ("tree_small_02", -15.0, 38.0, 4.4, 0.22),
        ("island_tree_02", -9.0, 33.0, 4.6, -0.52),
        ("tree_small_02", -3.0, 41.0, 4.8, 0.48),
        ("island_tree_02", 4.0, 36.0, 4.5, -0.18),
        ("tree_small_02", 10.0, 42.0, 4.7, 0.62),
        ("island_tree_02", 16.0, 34.0, 4.6, -0.72),
        ("tree_small_02", 22.0, 40.0, 4.9, 0.16),
    ]
    for index, (asset_name, x, y, scale, rotation) in enumerate(
        broadleaf_positions
    ):
        z = terrain_height(x, y) - 0.10
        instance_cc0(
            broadleaf_trees[asset_name],
            f"JF_CC0_Broadleaf_{index:02d}",
            (x, y, z),
            (scale, scale, scale),
            rotation,
            target,
        )

    # A buried low-canopy row closes the horizon with real linked foliage
    # instead of a black or flat-color backdrop. Lowering these trees lets
    # their crowns read as dense understory behind the hero composition.
    understory_positions = [
        (-23.0, 24.0, 4.8, -0.32),
        (-19.0, 27.0, 5.2, 0.24),
        (-15.0, 24.5, 4.7, -0.58),
        (-11.0, 28.0, 5.4, 0.42),
        (-7.0, 25.0, 4.9, -0.16),
        (-3.0, 29.0, 5.5, 0.61),
        (1.0, 26.0, 4.8, -0.44),
        (5.0, 30.0, 5.3, 0.18),
        (9.0, 27.0, 5.0, -0.72),
        (13.0, 30.0, 5.5, 0.38),
        (17.0, 25.5, 4.9, -0.20),
        (21.0, 28.0, 5.3, 0.55),
        (25.0, 24.0, 4.8, -0.38),
    ]
    understory_template = broadleaf_trees["island_tree_02"]
    for index, (x, y, scale, rotation) in enumerate(understory_positions):
        instance_cc0(
            understory_template,
            f"JF_CC0_UnderstoryTree_{index:02d}",
            (x, y, terrain_height(x, y) - scale * 0.58),
            (scale, scale, scale),
            rotation,
            target,
        )

    rock_templates = list(rocks.values())
    for index in range(112):
        side = -1 if index % 2 == 0 else 1
        y = random.uniform(-28.0, 15.5)
        x = side * random.uniform(2.8, 11.5)
        z = terrain_height(x, y) - random.uniform(0.18, 0.45)
        scale = random.uniform(0.20, 0.58)
        instance_cc0(
            rock_templates[index % len(rock_templates)],
            f"JF_CC0_MossRock_{index:03d}",
            (x, y, z),
            (
                scale * random.uniform(0.82, 1.28),
                scale * random.uniform(0.82, 1.20),
                scale * random.uniform(0.78, 1.10),
            ),
            random.uniform(0.0, math.tau),
            target,
        )

    vegetation_zones = (
        (-7.0, -27.0, 5.5, 6.5),
        (7.0, -27.0, 5.5, 6.5),
        (-8.0, -15.0, 6.5, 7.5),
        (8.2, -15.0, 6.8, 7.5),
        (-9.5, -1.0, 7.5, 14.0),
        (-7.0, 11.0, 6.0, 10.0),
        (9.5, 0.5, 7.5, 15.0),
        (8.0, 12.0, 7.0, 9.0),
        (0.0, 23.0, 17.0, 7.0),
    )

    def zone_location(
        *,
        minimum_path_distance: float = 2.8,
        minimum_abs_x: float = 0.0,
        maximum_abs_x: float = 19.0,
    ) -> tuple[float, float, float]:
        for _attempt in range(48):
            center_x, center_y, radius_x, radius_y = random.choice(vegetation_zones)
            angle = random.uniform(0.0, math.tau)
            radius = math.sqrt(random.random())
            x = center_x + math.cos(angle) * radius_x * radius
            y = center_y + math.sin(angle) * radius_y * radius
            if not minimum_abs_x <= abs(x) <= maximum_abs_x:
                continue
            if abs(x - stair_path_center(y)) < minimum_path_distance:
                continue
            return (x, y, terrain_height(x, y) + 0.018)
        x = maximum_abs_x if random.random() > 0.5 else -maximum_abs_x
        y = random.uniform(-12.0, 18.0)
        return (x, y, terrain_height(x, y) + 0.018)

    fern_templates = list(ferns.values())
    for index in range(920):
        x, y, z = zone_location(minimum_path_distance=2.35, minimum_abs_x=1.8)
        scale = random.uniform(0.65, 1.65)
        instance_cc0(
            fern_templates[index % len(fern_templates)],
            f"JF_CC0_Fern_{index:03d}",
            (x, y, z),
            (scale, scale, scale),
            random.uniform(0.0, math.tau),
            target,
        )

    grass_templates = list(grasses.values())
    grass_count = 0
    for index in range(3000):
        x, y, z = zone_location(minimum_path_distance=2.25, minimum_abs_x=1.7)
        scale = random.uniform(2.10, 4.10)
        instance_cc0(
            grass_templates[index % len(grass_templates)],
            f"JF_CC0_Grass_{grass_count:03d}",
            (x, y, z),
            (scale, scale, scale * random.uniform(0.82, 1.22)),
            random.uniform(0.0, math.tau),
            target,
        )
        grass_count += 1

    def scattered_location(
        *,
            x_min: float = 1.75,
        x_max: float = 18.0,
        y_min: float = -30.0,
        y_max: float = 22.0,
    ) -> tuple[float, float, float]:
        for _attempt in range(32):
            x, y, z = zone_location(
                minimum_path_distance=2.20,
                minimum_abs_x=x_min,
                maximum_abs_x=x_max,
            )
            if y_min <= y <= y_max:
                return (x, y, z)
        return zone_location(
            minimum_path_distance=2.20,
            minimum_abs_x=x_min,
            maximum_abs_x=x_max,
        )

    grass_02_templates = list(grasses_02.values())
    for index in range(1800):
        x, y, z = scattered_location()
        scale = random.uniform(1.30, 2.65)
        instance_cc0(
            grass_02_templates[index % len(grass_02_templates)],
            f"JF_CC0_Grass02_{index:04d}",
            (x, y, z),
            (scale, scale, scale * random.uniform(0.85, 1.18)),
            random.uniform(0.0, math.tau),
            target,
        )

    moss_templates = list(moss_strands.values())
    for index in range(3000):
        x, y, z = scattered_location(x_min=1.70, x_max=16.0)
        scale = random.uniform(1.4, 3.4)
        instance_cc0(
            moss_templates[index % len(moss_templates)],
            f"JF_CC0_Moss_{index:04d}",
            (x, y, z),
            (scale, scale, scale * random.uniform(0.75, 1.25)),
            random.uniform(0.0, math.tau),
            target,
        )

    # Moss is deliberately grown into the stair joints and chipped tread
    # edges so the staircase belongs to the hillside rather than sitting on it.
    stair_moss_count = 0
    for step_index in range(18):
        progress = step_index / 17.0
        y = -20.5 + progress * 37.5
        center_x = stair_path_center(y)
        width = 5.35 - 1.15 * progress
        for patch in range(8):
            side = -1 if patch % 2 == 0 else 1
            x = (
                center_x + side * width * random.uniform(0.34, 0.54)
                if patch < 4
                else center_x + random.uniform(-width * 0.28, width * 0.28)
            )
            z = terrain_height(x, y) + random.uniform(0.100, 0.165)
            scale = random.uniform(0.70, 1.50)
            instance_cc0(
                moss_templates[stair_moss_count % len(moss_templates)],
                f"JF_CC0_StairMoss_{stair_moss_count:03d}",
                (x, y + random.uniform(-0.35, 0.35), z),
                (
                    scale * 21.60,
                    scale * 21.60,
                    scale * 5.76 * random.uniform(0.72, 1.12),
                ),
                random.uniform(0.0, math.tau),
                target,
            )
            stair_moss_count += 1

    # Low cover continues toward the camera after the first stone tier. This
    # replaces the exposed foreground strip without creating another repeated
    # staircase row or blocking the central visual route.
    foreground_path_cover_count = 0
    for index in range(220):
        y = random.uniform(-27.5, -20.8)
        x = stair_path_center(y) + random.uniform(-2.65, 2.65)
        z = terrain_height(x, y) + random.uniform(0.025, 0.065)
        if index % 3:
            template = moss_templates[index % len(moss_templates)]
            scale = random.uniform(0.75, 1.65)
        else:
            template = grass_02_templates[index % len(grass_02_templates)]
            scale = random.uniform(0.70, 1.30)
        instance_cc0(
            template,
            f"JF_CC0_ForegroundPathCover_{index:03d}",
            (x, y, z),
            (scale, scale, scale * random.uniform(0.78, 1.18)),
            random.uniform(0.0, math.tau),
            target,
        )
        foreground_path_cover_count += 1

    nettle_templates = list(nettles.values())
    for index in range(140):
        x, y, z = scattered_location(x_min=3.0, x_max=14.0, y_min=-13.0)
        scale = random.uniform(0.55, 1.45)
        instance_cc0(
            nettle_templates[index % len(nettle_templates)],
            f"JF_CC0_Nettle_{index:03d}",
            (x, y, z),
            (scale, scale, scale),
            random.uniform(0.0, math.tau),
            target,
        )

    weed_templates = list(weeds.values())
    for index in range(170):
        x, y, z = scattered_location(x_min=3.0, x_max=15.5, y_min=-15.0)
        scale = random.uniform(0.65, 1.55)
        instance_cc0(
            weed_templates[index % len(weed_templates)],
            f"JF_CC0_Weed_{index:03d}",
            (x, y, z),
            (scale, scale, scale),
            random.uniform(0.0, math.tau),
            target,
        )

    return {
        "tree_instances": len(tree_positions),
        "broadleaf_tree_instances": len(broadleaf_positions),
        "rock_instances": 112,
        "fern_instances": 920,
        "grass_instances": grass_count,
        "grass_02_instances": 1800,
        "moss_instances": 3000,
        "stair_moss_instances": stair_moss_count,
        "foreground_path_cover_instances": foreground_path_cover_count,
        "nettle_instances": 140,
        "weed_instances": 170,
    }


def add_bevel(obj: bpy.types.Object, width: float, segments: int = 3) -> None:
    modifier = obj.modifiers.new("Production_Bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"


def add_box(
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel: float = 0.06,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        add_bevel(obj, bevel)
    obj.data.materials.append(mat)
    move_to_collection(obj, target)
    return tag(obj, f"shrine.{name.lower()}")


def add_cylinder(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    vertices: int = 24,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel: float = 0.035,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    if bevel:
        add_bevel(obj, bevel, 2)
    obj.data.materials.append(mat)
    move_to_collection(obj, target)
    return tag(obj, f"shrine.{name.lower()}")


def add_cone_between(
    name: str,
    start: Vector,
    end: Vector,
    radius_start: float,
    radius_end: float,
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    vertices: int = 14,
) -> bpy.types.Object:
    direction = end - start
    midpoint = (start + end) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius_start,
        radius2=radius_end,
        depth=direction.length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(direction.normalized())
    obj.rotation_mode = "XYZ"
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    move_to_collection(obj, target)
    return tag(obj, f"shrine.{name.lower()}")


def add_uv_sphere(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    segments: int = 32,
    rings: int = 20,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    move_to_collection(obj, target)
    return tag(obj, f"shrine.{name.lower()}")


def add_ico(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    subdivisions: int = 2,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    move_to_collection(obj, target)
    return tag(obj, f"shrine.{name.lower()}")


def make_leaf_cluster_mesh(
    name: str,
    mat: bpy.types.Material,
    *,
    leaf_count: int = 90,
) -> bpy.types.Mesh:
    """Build one reusable cluster of volumetric, individually oriented leaves."""
    stable_seed = sum((index + 1) * ord(char) for index, char in enumerate(name))
    local_random = random.Random(stable_seed & 0xFFFF_FFFF)
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for _ in range(leaf_count):
        while True:
            center = Vector(
                (
                    local_random.uniform(-1.0, 1.0),
                    local_random.uniform(-1.0, 1.0),
                    local_random.uniform(-0.75, 0.75),
                )
            )
            if center.length_squared <= 1.0:
                break
        angle = local_random.uniform(0.0, math.tau)
        tilt = local_random.uniform(-0.55, 0.55)
        length = local_random.uniform(0.15, 0.27)
        width = length * local_random.uniform(0.42, 0.62)
        transform = (
            Matrix.Translation(center)
            @ Matrix.Rotation(angle, 4, "Z")
            @ Matrix.Rotation(tilt, 4, "Y")
            @ Matrix.Diagonal((length, width, length * 0.10, 1.0))
        )
        bmesh.ops.create_icosphere(
            bm,
            subdivisions=1,
            radius=1.0,
            matrix=transform,
        )
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    mesh.materials.append(mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return mesh


def make_bloom_cluster_mesh(
    name: str,
    mat: bpy.types.Material,
    *,
    flower_count: int = 56,
) -> bpy.types.Mesh:
    """Create a hydrangea head from four-petal florets on a rounded crown."""
    stable_seed = sum((index + 1) * ord(char) for index, char in enumerate(name))
    local_random = random.Random((stable_seed ^ 0xA51CE55) & 0xFFFF_FFFF)
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for _ in range(flower_count):
        while True:
            normal = Vector(
                (
                    local_random.uniform(-1.0, 1.0),
                    local_random.uniform(-1.0, 1.0),
                    local_random.uniform(-0.78, 1.0),
                )
            )
            if 0.16 < normal.length_squared <= 1.0:
                normal.normalize()
                break
        crown_radius = local_random.uniform(0.70, 1.0)
        center = normal * crown_radius
        tangent = normal.cross(Vector((0.0, 0.0, 1.0)))
        if tangent.length_squared < 0.05:
            tangent = normal.cross(Vector((0.0, 1.0, 0.0)))
        tangent.normalize()
        bitangent = normal.cross(tangent).normalized()
        phase = local_random.uniform(0.0, math.tau)
        petal_length = local_random.uniform(0.085, 0.135)
        petal_width = petal_length * local_random.uniform(0.62, 0.82)
        for petal in range(4):
            angle = phase + math.tau * petal / 4.0
            direction = (
                tangent * math.cos(angle)
                + bitangent * math.sin(angle)
            ).normalized()
            side = normal.cross(direction).normalized()
            petal_center = (
                center
                + direction * petal_length * 0.48
                + normal * local_random.uniform(-0.014, 0.025)
            )
            frame = Matrix((direction, side, normal)).transposed().to_4x4()
            transform = (
                Matrix.Translation(petal_center)
                @ frame
                @ Matrix.Diagonal(
                    (
                        petal_length,
                        petal_width,
                        petal_length * 0.10,
                        1.0,
                    )
                )
            )
            bmesh.ops.create_icosphere(
                bm,
                subdivisions=1,
                radius=1.0,
                matrix=transform,
            )
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    mesh.materials.append(mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return mesh


def add_leaf_cluster(
    name: str,
    location: Vector,
    scale: tuple[float, float, float],
    mesh: bpy.types.Mesh,
    target: bpy.types.Collection,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.location = location
    obj.scale = scale
    obj.rotation_euler = (
        random.uniform(-0.18, 0.18),
        random.uniform(-0.18, 0.18),
        random.uniform(0.0, math.tau),
    )
    return tag(obj, f"shrine.{name.lower()}")


def add_curve(
    name: str,
    points: list[tuple[float, float, float]],
    bevel_depth: float,
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    resolution: int = 3,
    cyclic: bool = False,
) -> bpy.types.Object:
    curve_data = bpy.data.curves.new(name, "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = resolution
    curve_data.bevel_depth = bevel_depth
    curve_data.bevel_resolution = 3
    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve_data)
    target.objects.link(obj)
    curve_data.materials.append(mat)
    return tag(obj, f"shrine.{name.lower()}")


def stair_path_center(y: float) -> float:
    """Bend the ancient route gradually toward the shrine on the right bank."""
    progress = max(0.0, min(1.0, (y + 22.0) / 39.0))
    return -0.10 + 0.42 * progress + 2.45 * progress * progress


def terrain_height(x: float, y: float) -> float:
    """An asymmetrical terraced hillside with shelves, roots, and erosion."""
    path_x = stair_path_center(y)
    path_distance = abs(x - path_x)
    slope = 0.150 * (y + 22.0)
    left_bank = 0.080 * max(-x - 1.8, 0.0) ** 1.40
    right_bank = 0.052 * max(x - 2.4, 0.0) ** 1.48

    # Broad hand-shaped shelves break the old mirrored mound silhouette.
    left_shelf = 1.10 * math.exp(-((x + 9.0) / 5.8) ** 2 - ((y - 2.0) / 10.0) ** 2)
    left_upper = 0.72 * math.exp(-((x + 12.0) / 7.0) ** 2 - ((y - 15.0) / 8.5) ** 2)
    shrine_shelf = 1.55 * math.exp(-((x - 13.5) / 6.2) ** 2 - ((y - 18.0) / 7.0) ** 2)
    right_lower = 0.55 * math.exp(-((x - 10.0) / 5.0) ** 2 - ((y + 4.0) / 8.0) ** 2)

    # Root buttresses and exposed-rock bulges are large enough to survive the
    # clay and blurred comparisons.
    root_bulges = (
        0.58 * math.exp(-((x + 13.0) / 2.8) ** 2 - ((y + 2.0) / 5.0) ** 2)
        + 0.46 * math.exp(-((x + 6.0) / 2.4) ** 2 - ((y - 10.0) / 4.5) ** 2)
        + 0.50 * math.exp(-((x - 8.5) / 2.7) ** 2 - ((y - 2.0) / 5.5) ** 2)
    )

    # Shallow channels cut through the banks rather than applying even noise.
    erosion = (
        -0.46 * math.exp(-((x + 5.0 + 0.08 * y) / 1.25) ** 2)
        -0.32 * math.exp(-((x - 9.5 + 0.05 * y) / 1.55) ** 2)
    )
    macro = (
        0.25 * math.sin(x * 0.29 + y * 0.10)
        + 0.16 * math.sin(x * 0.67 - y * 0.14)
        + 0.08 * math.sin(x * 1.31 + y * 0.27)
    )

    # Only the walkable corridor is gently settled; the banks retain all
    # terracing and displacement.
    path_flatten = max(0.0, 1.0 - path_distance / 3.2)
    bank_detail = (
        left_shelf
        + left_upper
        + shrine_shelf
        + right_lower
        + root_bulges
        + erosion
        + macro
    )
    return slope + left_bank + right_bank + bank_detail * (1.0 - 0.70 * path_flatten)


def add_weathered_step_slab(
    name: str,
    center: tuple[float, float, float],
    size: tuple[float, float, float],
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    rotation: tuple[float, float, float],
    bevel: float,
) -> bpy.types.Object:
    """Author an irregular six-sided stair stone instead of a visible cuboid."""
    width, depth, height = size
    footprint = [
        (-0.50, -0.44),
        (-0.22, -0.53),
        (0.18, -0.50),
        (0.49, -0.46),
        (0.53, 0.38),
        (0.24, 0.50),
        (-0.16, 0.53),
        (-0.47, 0.43),
    ]
    bottom = [
        (
            px * width + random.uniform(-0.035, 0.035),
            py * depth + random.uniform(-0.028, 0.028),
            -height * 0.5 + random.uniform(-0.025, 0.012),
        )
        for px, py in footprint
    ]
    top = [
        (
            px * width + random.uniform(-0.060, 0.060),
            py * depth + random.uniform(-0.045, 0.045),
            height * 0.5 + random.uniform(-0.025, 0.025),
        )
        for px, py in footprint
    ]
    vertices = bottom + top
    count = len(footprint)
    faces: list[tuple[int, ...]] = [
        tuple(reversed(range(count))),
        tuple(range(count, count * 2)),
    ]
    faces.extend(
        (
            index,
            (index + 1) % count,
            (index + 1) % count + count,
            index + count,
        )
        for index in range(count)
    )
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.location = center
    obj.rotation_euler = rotation
    mesh.materials.append(mat)
    add_bevel(obj, bevel, 4)
    weathering_texture = bpy.data.textures.get("JF_StoneEdgeWeathering")
    if weathering_texture is None:
        weathering_texture = bpy.data.textures.new(
            "JF_StoneEdgeWeathering",
            type="CLOUDS",
        )
        weathering_texture.noise_scale = 0.18
        weathering_texture.noise_depth = 2
    displace = obj.modifiers.new("Stone_Edge_Weathering", "DISPLACE")
    displace.texture = weathering_texture
    displace.texture_coords = "GLOBAL"
    displace.strength = min(width, depth) * 0.032
    displace.mid_level = 0.52
    for polygon in mesh.polygons:
        polygon.use_smooth = polygon.index > 1
    tag(obj, f"shrine.stair.{name.lower()}")
    obj["asset_role"] = "walkable_visual_step"
    return obj


def add_weathered_stone_marker(
    name: str,
    x: float,
    y: float,
    height: float,
    mat: bpy.types.Material,
    moss: bpy.types.Material,
    target: bpy.types.Collection,
) -> bpy.types.Object:
    """Create a narrow, irregular memorial marker with a worn crown."""
    width = height * 0.42
    depth = height * 0.22
    profile = [
        (-0.50, 0.00),
        (0.48, 0.00),
        (0.52, 0.72),
        (0.37, 0.95),
        (0.05, 1.00),
        (-0.43, 0.92),
        (-0.50, 0.68),
    ]
    vertices: list[tuple[float, float, float]] = []
    for side_y in (-depth * 0.5, depth * 0.5):
        vertices.extend(
            (px * width, side_y, pz * height)
            for px, pz in profile
        )
    count = len(profile)
    faces: list[tuple[int, ...]] = [
        tuple(reversed(range(count))),
        tuple(range(count, count * 2)),
    ]
    faces.extend(
        (
            index,
            (index + 1) % count,
            (index + 1) % count + count,
            index + count,
        )
        for index in range(count)
    )
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    marker = bpy.data.objects.new(name, mesh)
    target.objects.link(marker)
    marker.location = (x, y, terrain_height(x, y))
    marker.rotation_euler.z = math.radians(-7.0)
    marker.data.materials.append(mat)
    add_bevel(marker, height * 0.035, 4)
    tag(marker, f"shrine.marker.{name.lower()}")
    for patch in range(3):
        add_ico(
            f"{name}_Moss_{patch}",
            (
                x + random.uniform(-0.30, 0.30) * width,
                y - depth * 0.48,
                marker.location.z + random.uniform(0.18, 0.94) * height,
            ),
            (
                random.uniform(0.055, 0.12) * height,
                random.uniform(0.018, 0.035) * height,
                random.uniform(0.012, 0.026) * height,
            ),
            moss,
            target,
            subdivisions=1,
        )
    return marker


def build_terrain(
    target: bpy.types.Collection,
    soil: bpy.types.Material,
    moss: bpy.types.Material,
) -> bpy.types.Object:
    size_x = 42.0
    start_y = -36.0
    size_y = 84.0
    nx = 85
    ny = 121
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for iy in range(ny):
        y = start_y + size_y * iy / (ny - 1)
        for ix in range(nx):
            x = -size_x * 0.5 + size_x * ix / (nx - 1)
            z = terrain_height(x, y)
            vertices.append((x, y, z))
    for iy in range(ny - 1):
        for ix in range(nx - 1):
            a = iy * nx + ix
            faces.append((a, a + 1, a + 1 + nx, a + nx))
    mesh = bpy.data.meshes.new("JF_Terrain_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="JF_Terrain_UV")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv_layer.data[loop_index].uv = (
                (vertex.x + size_x * 0.5) / 5.5,
                (vertex.y - start_y) / 5.5,
            )
    terrain = bpy.data.objects.new("JF_Terrain_Hillside", mesh)
    target.objects.link(terrain)
    terrain.data.materials.append(soil)
    terrain.data.materials.append(moss)
    for polygon in terrain.data.polygons:
        polygon.use_smooth = True
        center = terrain.data.vertices[polygon.vertices[0]].co
        polygon.material_index = 1 if center.z > 1.2 else 0
    add_bevel(terrain, 0.025, 2)
    return tag(terrain, "shrine.terrain.hillside")


def build_stairs(
    target: bpy.types.Collection,
    stone: bpy.types.Material,
    moss: bpy.types.Material,
) -> None:
    stone_total = 0
    tread_count = 22
    for index in range(tread_count):
        progress = index / (tread_count - 1)
        y = -20.5 + progress * 37.5 + random.uniform(-0.16, 0.16)
        center_x = stair_path_center(y) + random.uniform(-0.12, 0.12)
        path_width = (
            5.35
            - 1.15 * progress
            + 0.28 * math.sin(progress * math.pi * 3.0)
            + random.uniform(-0.38, 0.32)
        )
        stone_count = random.choice((3, 3, 4, 4, 4))
        gaps = [random.uniform(0.07, 0.24) for _ in range(stone_count - 1)]
        available = path_width - sum(gaps)
        raw_weights = [random.uniform(0.48, 1.75) for _ in range(stone_count)]
        weight_sum = sum(raw_weights)
        widths = [available * weight / weight_sum for weight in raw_weights]
        cursor = (
            center_x
            - path_width * 0.5
            + random.uniform(-0.34, 0.34)
        )
        # Broad, overlapping tread stones keep the staircase readable as a
        # constructed route while the broken outlines retain its age.
        tread_depth = random.uniform(1.34, 1.78)
        base_height = random.uniform(0.18, 0.32)
        ground_z = terrain_height(center_x, y)

        for piece, piece_width in enumerate(widths):
            if index in {6, 13, 19} and piece == stone_count - 1:
                # A missing/displaced edge stone produces a readable break.
                cursor += piece_width
                continue
            x = cursor + piece_width * 0.5 + random.uniform(-0.055, 0.055)
            piece_depth = tread_depth * random.uniform(0.90, 1.12)
            piece_height = base_height * random.uniform(0.82, 1.18)
            add_weathered_step_slab(
                f"JF_AncientStep_{index:02d}_{piece:02d}",
                (
                    x,
                    y + random.uniform(-0.14, 0.14),
                    ground_z
                    + piece_height * 0.42
                    - random.uniform(0.205, 0.265),
                ),
                (
                    max(0.78, min(2.25, piece_width)),
                    piece_depth,
                    piece_height,
                ),
                stone,
                target,
                rotation=(
                    math.radians(random.uniform(-4.5, 4.5)),
                    math.radians(random.uniform(-5.5, 5.5)),
                    math.radians(random.uniform(-10.0, 10.0)),
                ),
                bevel=random.uniform(0.022, 0.053),
            )
            stone_total += 1
            cursor += piece_width
            if piece < len(gaps):
                cursor += gaps[piece]

        # Damp moss and soil collect in cracks and at missing corners.
        for patch in range(random.choice((1, 1, 2))):
            px = center_x + random.uniform(-path_width * 0.47, path_width * 0.47)
            py = y + random.uniform(-tread_depth * 0.52, tread_depth * 0.52)
            add_ico(
                f"JF_AncientStepMoss_{index:02d}_{patch:02d}",
                (
                    px,
                    py,
                    ground_z + random.uniform(0.085, 0.205),
                ),
                (
                    random.uniform(0.288, 0.792),
                    random.uniform(0.150, 0.420),
                    random.uniform(0.011, 0.027),
                ),
                moss,
                target,
                subdivisions=1,
            )

        # Uneven side retaining blocks embed the route in the terraced bank.
        if index % 2 == 0:
            side = -1 if (index // 2) % 2 == 0 else 1
            retaining_x = center_x + side * (path_width * 0.58 + random.uniform(0.15, 0.55))
            retaining_y = y + random.uniform(-0.35, 0.30)
            retaining_height = random.uniform(0.30, 0.62)
            add_weathered_step_slab(
                f"JF_RetainingStone_{index:02d}",
                (
                    retaining_x,
                    retaining_y,
                    terrain_height(retaining_x, retaining_y)
                    + retaining_height * 0.25
                    - random.uniform(0.04, 0.14),
                ),
                (
                    random.uniform(0.72, 1.45),
                    random.uniform(0.48, 0.88),
                    retaining_height,
                ),
                stone,
                target,
                rotation=(
                    math.radians(random.uniform(-4.0, 4.0)),
                    math.radians(random.uniform(-4.0, 4.0)),
                    math.radians(random.uniform(-9.0, 9.0)),
                ),
                bevel=random.uniform(0.04, 0.09),
            )
            stone_total += 1

    bpy.context.scene["ancient_stair_stone_count"] = stone_total

def roof_mesh(
    name: str,
    center: tuple[float, float, float],
    width: float,
    depth: float,
    mat: bpy.types.Material,
    target: bpy.types.Collection,
    *,
    front_extension: float = 0.0,
    ridge_height: float = 1.85,
    pitch: float = 0.38,
) -> bpy.types.Object:
    cx, cy, cz = center
    nx = 33
    ny = 17
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for iy in range(ny):
        v = iy / (ny - 1)
        y_local = (v - 0.5) * depth - front_extension
        for ix in range(nx):
            u = ix / (nx - 1)
            x_local = (u - 0.5) * width
            ridge = ridge_height - pitch * abs(y_local)
            upturn_x = 0.055 * max(abs(x_local) - width * 0.34, 0.0) ** 2
            upturn_y = 0.08 * max(abs(y_local) - depth * 0.36, 0.0) ** 2
            z = cz + ridge + upturn_x + upturn_y
            vertices.append((cx + x_local, cy + y_local, z))
    for iy in range(ny - 1):
        for ix in range(nx - 1):
            a = iy * nx + ix
            faces.append((a, a + 1, a + 1 + nx, a + nx))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    mesh.materials.append(mat)
    solidify = obj.modifiers.new("Roof_Thickness", "SOLIDIFY")
    solidify.thickness = 0.24
    solidify.offset = 0.0
    bevel = obj.modifiers.new("Roof_Edge_Bevel", "BEVEL")
    bevel.width = 0.08
    bevel.segments = 3
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return tag(obj, f"shrine.architecture.{name.lower()}")


def make_ceramic_roof_tile_mesh(
    name: str,
    mat: bpy.types.Material,
) -> bpy.types.Mesh:
    """Create one reusable curved ceramic tile with real silhouette thickness."""
    width = 0.23
    length = 0.42
    thickness = 0.032
    segments = 7
    vertices: list[tuple[float, float, float]] = []
    for y in (-length * 0.5, length * 0.5):
        for level in (0.0, -thickness):
            for index in range(segments):
                t = index / (segments - 1)
                x = (t - 0.5) * width
                arch = 0.055 * (1.0 - ((t - 0.5) / 0.5) ** 2)
                vertices.append((x, y, arch + level))
    faces: list[tuple[int, int, int, int]] = []
    stride = segments
    for level_index in range(2):
        front = level_index * stride
        back = (2 + level_index) * stride
        for index in range(segments - 1):
            if level_index == 0:
                faces.append(
                    (
                        front + index,
                        front + index + 1,
                        back + index + 1,
                        back + index,
                    )
                )
            else:
                faces.append(
                    (
                        back + index,
                        back + index + 1,
                        front + index + 1,
                        front + index,
                    )
                )
    # Join the two long edges and both end caps.
    for edge_index in (0, segments - 1):
        faces.append(
            (
                edge_index,
                2 * stride + edge_index,
                3 * stride + edge_index,
                stride + edge_index,
            )
        )
    faces.append(tuple(range(segments - 1, -1, -1)) + tuple(range(segments, 2 * segments)))
    faces.append(
        tuple(range(2 * segments, 3 * segments))
        + tuple(range(4 * segments - 1, 3 * segments - 1, -1))
    )
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(mat)
    mesh["asset_id"] = "shrine.architecture.ceramic_roof_tile.master"
    mesh["asset_license"] = "CC0-1.0"
    return mesh


def build_ceramic_roof_tiles(
    target: bpy.types.Collection,
    mat: bpy.types.Material,
    center: tuple[float, float, float],
    width: float,
    depth: float,
    *,
    ridge_height: float = 1.85,
    pitch: float = 0.38,
) -> int:
    """Instance real overlapping tiles across the hero roof."""
    cx, cy, cz = center
    tile_mesh = make_ceramic_roof_tile_mesh("JF_CeramicRoofTile_Master", mat)
    tile_count = 0
    x_spacing = 0.25
    y_spacing = 0.32
    columns = max(1, int((width - 0.8) / x_spacing))
    rows_per_side = max(1, int((depth * 0.5 - 0.35) / y_spacing))
    for side in (-1, 1):
        for row in range(rows_per_side):
            y_local = side * (0.22 + row * y_spacing)
            for column in range(columns):
                x_local = -width * 0.5 + 0.40 + column * x_spacing
                ridge = ridge_height - pitch * abs(y_local)
                upturn_x = 0.055 * max(abs(x_local) - width * 0.34, 0.0) ** 2
                upturn_y = 0.08 * max(abs(y_local) - depth * 0.36, 0.0) ** 2
                tile = bpy.data.objects.new(
                    f"JF_RoofTile_{side:+d}_{row:02d}_{column:03d}",
                    tile_mesh,
                )
                target.objects.link(tile)
                tile.location = (
                    cx + x_local,
                    cy + y_local,
                    cz + ridge + upturn_x + upturn_y + 0.16,
                )
                tile.rotation_euler = (
                    side * math.atan(0.38),
                    math.radians(random.uniform(-0.45, 0.45)),
                    math.radians(random.uniform(-0.55, 0.55)),
                )
                tile.scale = (
                    random.uniform(0.96, 1.04),
                    random.uniform(0.97, 1.04),
                    random.uniform(0.96, 1.04),
                )
                tile["asset_id"] = "shrine.architecture.ceramic_roof_tile"
                tile["asset_role"] = "instanced_overlapping_hero_roof_tile"
                tile_count += 1
    bpy.context.scene["hero_roof_tile_count"] = tile_count
    return tile_count


def build_shrine(
    target: bpy.types.Collection,
    wood: bpy.types.Material,
    wood_red: bpy.types.Material,
    roof: bpy.types.Material,
    stone: bpy.types.Material,
    paper: bpy.types.Material,
    rope: bpy.types.Material,
    gold: bpy.types.Material,
    dark: bpy.types.Material,
) -> None:
    existing = set(bpy.context.scene.objects)
    # Keep the architecture high on the right-hand bank, matching the
    # reference composition instead of centering it like a stage set.
    cx = 13.0
    cy = 18.8
    ground = terrain_height(cx, cy)
    floor_z = ground + 1.1

    foundation = add_box(
        "JF_ShrineFoundation",
        (cx, cy, floor_z - 0.48),
        (13.4, 7.5, 0.92),
        stone,
        target,
        bevel=0.18,
    )
    add_box("JF_ShrineFloor", (cx, cy - 0.2, floor_z), (14.2, 7.4, 0.42), wood, target, bevel=0.08)

    for row_y in (cy - 3.05, cy + 2.85):
        for col_x in (-5.8, -2.9, 0.0, 2.9, 5.8):
            add_cylinder(
                f"JF_Column_{row_y:.1f}_{col_x:.1f}",
                (cx + col_x, row_y, floor_z + 2.9),
                0.29,
                5.9,
                wood_red,
                target,
                vertices=24,
                bevel=0.025,
            )

    add_box("JF_BackWall", (cx, cy + 3.0, floor_z + 2.55), (12.5, 0.32, 5.0), wood, target)
    add_box("JF_LeftWall", (cx - 6.25, cy, floor_z + 2.55), (0.32, 5.9, 5.0), wood, target)
    add_box("JF_RightWall", (cx + 6.25, cy, floor_z + 2.55), (0.32, 5.9, 5.0), wood, target)

    for x in (-4.7, -2.3, 0.0, 2.3, 4.7):
        add_box(
            f"JF_FrontDoor_{x:.1f}",
            (cx + x, cy - 3.14, floor_z + 2.15),
            (2.0, 0.22, 4.15),
            wood,
            target,
            bevel=0.035,
        )
        for slat in range(-3, 4):
            add_box(
                f"JF_DoorSlat_{x:.1f}_{slat}",
                (cx + x + slat * 0.23, cy - 3.29, floor_z + 2.15),
                (0.07, 0.08, 3.75),
                wood_red,
                target,
                bevel=0.01,
            )

    # A recessed central sanctuary opening gives the facade real depth. The
    # surrounding posts and lintel remain readable inside the deep eave shade.
    add_box(
        "JF_CentralSanctuaryRecess",
        (cx, cy - 3.34, floor_z + 2.20),
        (3.25, 0.24, 4.25),
        dark,
        target,
        bevel=0.025,
    )
    for side in (-1, 1):
        add_box(
            f"JF_CentralDoorJamb_{side}",
            (cx + side * 1.78, cy - 3.50, floor_z + 2.25),
            (0.30, 0.34, 4.70),
            wood_red,
            target,
            bevel=0.045,
        )
    add_box(
        "JF_CentralDoorLintel",
        (cx, cy - 3.50, floor_z + 4.52),
        (3.85, 0.34, 0.34),
        wood_red,
        target,
        bevel=0.045,
    )

    for y_offset in (-3.36, 3.2):
        add_box("JF_TopBeam", (cx, cy + y_offset, floor_z + 5.3), (14.2, 0.42, 0.45), wood_red, target, bevel=0.06)
        add_box("JF_MidBeam", (cx, cy + y_offset, floor_z + 3.9), (13.5, 0.34, 0.34), wood_red, target, bevel=0.05)

    roof_cx = cx + 2.20
    roof_mesh(
        "JF_MainRoof",
        (roof_cx, cy + 0.20, floor_z + 6.45),
        14.8,
        11.8,
        roof,
        target,
        ridge_height=3.60,
        pitch=0.58,
    )
    roof_mesh(
        "JF_PorchRoof",
        (cx + 1.20, cy - 4.05, floor_z + 4.72),
        15.0,
        5.9,
        roof,
        target,
        front_extension=0.65,
        ridge_height=2.50,
        pitch=0.55,
    )
    roof_mesh(
        "JF_UpperRearRoof",
        (cx + 3.0, cy + 1.35, floor_z + 7.95),
        12.5,
        8.8,
        roof,
        target,
        ridge_height=3.30,
        pitch=0.58,
    )
    build_ceramic_roof_tiles(
        target,
        roof,
        (roof_cx, cy + 0.20, floor_z + 6.45),
        14.8,
        11.8,
        ridge_height=3.60,
        pitch=0.58,
    )

    # Layered brackets and tie beams create the deep, physically supported
    # eaves visible in the reference instead of a roof floating on posts.
    for bracket_index in range(15):
        x = cx - 6.5 + bracket_index
        for layer in range(3):
            add_box(
                f"JF_EaveBracketFront_{bracket_index:02d}_{layer}",
                (
                    x,
                    cy - 3.48 - layer * 0.16,
                    floor_z + 4.72 + layer * 0.25,
                ),
                (
                    0.30 + layer * 0.045,
                    1.02 + layer * 0.24,
                    0.27,
                ),
                wood if layer != 1 else wood_red,
                target,
                rotation=(0.0, math.radians(-8.0), 0.0),
                bevel=0.045,
            )
        add_box(
            f"JF_EaveBracketRear_{bracket_index:02d}",
            (x, cy + 3.18, floor_z + 4.90),
            (0.28, 0.92, 0.30),
            wood,
            target,
            rotation=(0.0, math.radians(8.0), 0.0),
            bevel=0.045,
        )

    # Decorative roof ribs follow the pitch and make the silhouette readable.
    for x in [roof_cx - 6.65 + i * 0.70 for i in range(20)]:
        points = []
        for step in range(13):
            y_local = -5.45 + step * 0.91
            ridge = 3.60 - 0.58 * abs(y_local)
            upturn_x = 0.055 * max(
                abs(x - roof_cx) - 14.8 * 0.34,
                0.0,
            ) ** 2
            upturn_y = 0.08 * max(
                abs(y_local) - 11.8 * 0.36,
                0.0,
            ) ** 2
            points.append(
                (
                    x,
                    cy + 0.20 + y_local,
                    floor_z
                    + 6.45
                    + ridge
                    + upturn_x
                    + upturn_y
                    + 0.12,
                )
            )
        add_curve(f"JF_RoofRib_{x:.2f}", points, 0.055, roof, target, resolution=1)

    for row_index in range(10):
        y_local = -4.75 + row_index * 1.06
        points = []
        for step in range(25):
            x_local = -6.85 + step * (13.7 / 24.0)
            ridge = 3.60 - 0.58 * abs(y_local)
            upturn_x = 0.055 * max(abs(x_local) - 14.8 * 0.34, 0.0) ** 2
            upturn_y = 0.08 * max(abs(y_local) - 11.8 * 0.36, 0.0) ** 2
            points.append(
                (
                    roof_cx + x_local,
                    cy + 0.20 + y_local,
                    floor_z
                    + 6.45
                    + ridge
                    + upturn_x
                    + upturn_y
                    + 0.10,
                )
            )
        add_curve(
            f"JF_RoofTileRow_{row_index:02d}",
            points,
            0.032,
            roof,
            target,
            resolution=1,
        )

    add_curve(
        "JF_RoofRidge",
        [
            (roof_cx - 6.95, cy + 0.20, floor_z + 9.85),
            (roof_cx, cy + 0.20, floor_z + 10.25),
            (roof_cx + 6.95, cy + 0.20, floor_z + 9.85),
        ],
        0.28,
        roof,
        target,
    )
    # Repeated front-facing tile caps give the eave a readable crafted edge
    # at the hero camera distance.
    for cap_index in range(29):
        cap_x = roof_cx - 6.85 + cap_index * 0.49
        edge_fraction = abs(cap_x - roof_cx) / 6.85
        cap_z = floor_z + 6.58 + 1.12 * edge_fraction**3
        add_cylinder(
            f"JF_FrontEaveTileCap_{cap_index:02d}",
            (cap_x, cy - 5.78, cap_z),
            0.17,
            0.18,
            roof,
            target,
            vertices=20,
            rotation=(math.radians(90.0), 0.0, 0.0),
            bevel=0.018,
        )
    for side in (-1, 1):
        add_curve(
            f"JF_RoofFinial_{side}",
            [
                (
                    roof_cx + side * 6.20,
                    cy + 0.20,
                    floor_z + 9.78,
                ),
                (
                    roof_cx + side * 6.95,
                    cy + 0.20,
                    floor_z + 10.40,
                ),
                (
                    roof_cx + side * 6.70,
                    cy + 0.20,
                    floor_z + 11.25,
                ),
                (
                    roof_cx + side * 6.22,
                    cy + 0.20,
                    floor_z + 11.62,
                ),
            ],
            0.24,
            roof,
            target,
        )
        for ornament in range(3):
            add_ico(
                f"JF_RidgeOrnament_{side}_{ornament}",
                (
                    roof_cx + side * (6.20 + ornament * 0.24),
                    cy + 0.20,
                    floor_z + 10.02 + ornament * 0.42,
                ),
                (
                    0.34 - ornament * 0.04,
                    0.22,
                    0.30,
                ),
                roof,
                target,
                subdivisions=2,
            )
    # Authored ridge scrolls replace the former plain bar silhouette. Their
    # thick ceramic profiles catch the same grazing light as the roof tiles.
    for crest_index, crest_x in enumerate(
        (roof_cx - 3.8, roof_cx, roof_cx + 3.8)
    ):
        spiral_points: list[tuple[float, float, float]] = []
        for point_index in range(28):
            angle = math.radians(35.0 + point_index * 20.0)
            radius = 0.62 * (1.0 - point_index / 38.0)
            spiral_points.append(
                (
                    crest_x + math.cos(angle) * radius,
                    cy - 0.18,
                    floor_z
                    + 10.45
                    + math.sin(angle) * radius
                    + crest_index * 0.06,
                )
            )
        add_curve(
            f"JF_RidgeScroll_{crest_index}",
            spiral_points,
            0.13,
            roof,
            target,
            resolution=2,
        )
        add_ico(
            f"JF_RidgeBoss_{crest_index}",
            (crest_x, cy - 0.20, floor_z + 10.42),
            (0.31, 0.18, 0.31),
            roof,
            target,
            subdivisions=2,
        )

    # Front stairs and veranda.
    for index in range(5):
        add_box(
            f"JF_PorchStep_{index}",
            (cx, cy - 5.0 - index * 0.55, floor_z - 0.15 - index * 0.22),
            (5.6 + index * 0.4, 0.72, 0.32),
            stone,
            target,
            bevel=0.08,
        )
    for side in (-1, 1):
        for x_offset in range(6):
            x = cx + side * (2.8 + x_offset * 0.58)
            add_cylinder(
                f"JF_RailingPost_{side}_{x_offset}",
                (x, cy - 3.55, floor_z + 0.75),
                0.095,
                1.5,
                wood_red,
                target,
                vertices=12,
            )
        add_box(
            f"JF_RailingTop_{side}",
            (cx + side * 4.2, cy - 3.55, floor_z + 1.45),
            (3.3, 0.16, 0.18),
            wood_red,
            target,
            bevel=0.035,
        )

    # Shimenawa rope and folded shide paper.
    add_curve(
        "JF_Shimenawa",
        [
            (cx - 3.3, cy - 3.55, floor_z + 3.55),
            (cx, cy - 3.72, floor_z + 3.2),
            (cx + 3.3, cy - 3.55, floor_z + 3.55),
        ],
        0.115,
        rope,
        target,
    )
    for index, x in enumerate((-2.4, -1.2, 0.0, 1.2, 2.4)):
        z = floor_z + 3.25 - 0.12 * (1.0 - abs(x) / 2.4)
        add_box(
            f"JF_Shide_{index}",
            (cx + x, cy - 3.82, z - 0.35),
            (0.36, 0.035, 0.82),
            paper,
            target,
            rotation=(0.0, 0.0, 0.18 if index % 2 else -0.18),
            bevel=0.01,
        )

    add_cylinder("JF_OfferingBell", (cx, cy - 3.95, floor_z + 2.35), 0.28, 0.55, gold, target, vertices=32)
    add_curve(
        "JF_BellRope",
        [(cx, cy - 4.0, floor_z + 3.5), (cx + 0.08, cy - 4.15, floor_z + 1.15)],
        0.055,
        rope,
        target,
    )

    # Enlarge the entire authored building around its foundation so it holds
    # the right half of the frame like the reference hero structure.
    shrine_root = bpy.data.objects.new("JF_Shrine_Architecture_Root", None)
    target.objects.link(shrine_root)
    shrine_root.location = (0.0, 0.0, 0.0)
    tag(shrine_root, "shrine.architecture.root")
    scale_matrix = (
        Matrix.Translation((cx, cy, floor_z))
        @ Matrix.Diagonal((1.34, 1.21, 1.25, 1.0))
        @ Matrix.Translation((-cx, -cy, -floor_z))
    )
    for obj in set(bpy.context.scene.objects) - existing:
        if obj is shrine_root:
            continue
        world = scale_matrix @ obj.matrix_world
        obj.parent = shrine_root
        obj.matrix_world = world
    shrine_root.location.z = -0.85

    # The shrine crosses a steep diagonal bank. Ground its downhill wing with
    # an individually staggered stone retaining wall and two visible piers;
    # otherwise the projecting floor reads as a levitating platform.
    bpy.context.view_layer.update()
    retaining_rng = random.Random(73026)
    foundation_bottom = min(
        (foundation.matrix_world @ Vector(corner)).z
        for corner in foundation.bound_box
    )
    retaining_top = foundation_bottom + 0.10
    retaining_count = 0

    def retaining_block(
        name: str,
        center: tuple[float, float, float],
        size: tuple[float, float, float],
        rotation_z: float = 0.0,
    ) -> bpy.types.Object:
        block = add_box(
            name,
            center,
            size,
            stone,
            target,
            rotation=(0.0, 0.0, rotation_z),
            bevel=retaining_rng.uniform(0.035, 0.065),
        )
        block.parent = shrine_root
        block.matrix_world = (
            Matrix.Translation(Vector(center))
            @ Matrix.Rotation(rotation_z, 4, "Z")
        )
        block["asset_id"] = (
            "shrine.architecture.retaining_masonry."
            f"{name.lower()}"
        )
        block["asset_role"] = "visible_structural_retaining_block"
        block["construction"] = (
            "Individual weathered stone block supporting the downhill "
            "shrine foundation."
        )
        return block

    for column, x in enumerate(4.25 + i * 1.35 for i in range(8)):
        y = 14.35
        base = terrain_height(x, y) - 0.10
        if base >= retaining_top - 0.18:
            continue
        rows = max(1, math.ceil((retaining_top - base) / 0.46))
        height = (retaining_top - base) / rows
        for row in range(rows):
            width = 1.26 + retaining_rng.uniform(-0.10, 0.12)
            block_x = (
                x
                + (0.16 if row % 2 else -0.05)
                + retaining_rng.uniform(-0.035, 0.035)
            )
            retaining_block(
                f"JF_ShrineRetaining_Front_{column:02d}_{row:02d}",
                (
                    block_x,
                    y + retaining_rng.uniform(-0.035, 0.035),
                    base + (row + 0.5) * height,
                ),
                (width, 0.92, height * 1.07),
                math.radians(retaining_rng.uniform(-2.2, 2.2)),
            )
            retaining_count += 1

    for column, y in enumerate(15.25 + i * 1.20 for i in range(7)):
        x = 4.22
        base = terrain_height(x, y) - 0.10
        if base >= retaining_top - 0.16:
            continue
        rows = max(1, math.ceil((retaining_top - base) / 0.46))
        height = (retaining_top - base) / rows
        for row in range(rows):
            block_y = (
                y
                + (0.12 if row % 2 else -0.04)
                + retaining_rng.uniform(-0.03, 0.03)
            )
            retaining_block(
                f"JF_ShrineRetaining_Return_{column:02d}_{row:02d}",
                (
                    x + retaining_rng.uniform(-0.025, 0.025),
                    block_y,
                    base + (row + 0.5) * height,
                ),
                (
                    0.92,
                    1.12 + retaining_rng.uniform(-0.08, 0.10),
                    height * 1.07,
                ),
                math.radians(retaining_rng.uniform(-1.4, 1.4)),
            )
            retaining_count += 1

    for pier_index, (x, y) in enumerate(((6.4, 15.0), (9.0, 14.8))):
        base = terrain_height(x, y) - 0.08
        height = max(0.35, retaining_top - base)
        retaining_block(
            f"JF_ShrineRetaining_Pier_{pier_index:02d}",
            (x, y, base + height * 0.5),
            (0.95, 0.95, height),
        )
        retaining_count += 1

    bpy.context.scene["shrine_retaining_block_count"] = retaining_count


def build_lantern(
    name: str,
    x: float,
    y: float,
    scale: float,
    target: bpy.types.Collection,
    stone: bpy.types.Material,
    dark: bpy.types.Material,
    glow: bpy.types.Material,
    moss: bpy.types.Material,
) -> None:
    z = terrain_height(x, y)
    add_cylinder(f"{name}_Base", (x, y, z + 0.22 * scale), 0.76 * scale, 0.44 * scale, stone, target, vertices=8)
    add_cylinder(f"{name}_Post", (x, y, z + 1.45 * scale), 0.30 * scale, 2.2 * scale, stone, target, vertices=8)
    add_box(f"{name}_Chamber", (x, y, z + 2.75 * scale), (1.15 * scale, 1.15 * scale, 1.25 * scale), stone, target, bevel=0.08 * scale)
    for side in (-1, 1):
        add_box(
            f"{name}_OpeningX_{side}",
            (x + side * 0.59 * scale, y, z + 2.76 * scale),
            (0.035 * scale, 0.60 * scale, 0.68 * scale),
            dark,
            target,
            bevel=0.01,
        )
        add_box(
            f"{name}_OpeningY_{side}",
            (x, y + side * 0.59 * scale, z + 2.76 * scale),
            (0.60 * scale, 0.035 * scale, 0.68 * scale),
            dark,
            target,
            bevel=0.01,
        )
    add_uv_sphere(f"{name}_Glow", (x, y, z + 2.75 * scale), (0.34 * scale, 0.34 * scale, 0.40 * scale), glow, target, segments=20, rings=12)
    # A deep circular front aperture and carved ring make the lantern read as
    # a traditional tōrō rather than a glowing box.
    add_cylinder(
        f"{name}_FrontAperture",
        (x, y - 0.615 * scale, z + 2.76 * scale),
        0.31 * scale,
        0.055 * scale,
        dark,
        target,
        vertices=32,
        rotation=(math.radians(90.0), 0.0, 0.0),
        bevel=0.01 * scale,
    )
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.36 * scale,
        minor_radius=0.075 * scale,
        major_segments=32,
        minor_segments=10,
        location=(x, y - 0.652 * scale, z + 2.76 * scale),
        rotation=(math.radians(90.0), 0.0, 0.0),
    )
    aperture_ring = bpy.context.object
    aperture_ring.name = f"{name}_FrontApertureRing"
    aperture_ring.data.materials.append(stone)
    move_to_collection(aperture_ring, target)
    tag(aperture_ring, f"shrine.lantern.{name.lower()}.aperture_ring")
    add_cylinder(f"{name}_Roof", (x, y, z + 3.48 * scale), 1.04 * scale, 0.30 * scale, stone, target, vertices=8)
    add_cylinder(f"{name}_Cap", (x, y, z + 3.84 * scale), 0.34 * scale, 0.56 * scale, stone, target, vertices=8)
    for patch in range(4):
        add_ico(
            f"{name}_Moss_{patch}",
            (
                x + random.uniform(-0.45, 0.45) * scale,
                y + random.uniform(-0.45, 0.45) * scale,
                z + random.uniform(0.45, 3.55) * scale,
            ),
            (0.28 * scale, 0.20 * scale, 0.08 * scale),
            moss,
            target,
            subdivisions=1,
        )


def build_guardian(
    name: str,
    x: float,
    y: float,
    scale: float,
    target: bpy.types.Collection,
    stone: bpy.types.Material,
    dark: bpy.types.Material,
    moss: bpy.types.Material,
    *,
    mirrored: bool,
    yaw: float = 0.0,
    ground_offset: float = 0.0,
) -> None:
    facing = -1 if mirrored else 1
    ground = terrain_height(x, y) + ground_offset
    add_box(f"{name}_PedestalLower", (x, y, ground + 0.35 * scale), (2.2 * scale, 2.2 * scale, 0.7 * scale), stone, target, bevel=0.15 * scale)
    add_box(f"{name}_PedestalUpper", (x, y, ground + 0.85 * scale), (1.8 * scale, 1.8 * scale, 0.35 * scale), stone, target, bevel=0.12 * scale)
    base = ground + 1.0 * scale
    existing = set(bpy.context.scene.objects)

    # A low, powerful quadruped silhouette viewed in profile, as in the
    # reference shrine guardians.
    add_uv_sphere(
        f"{name}_Torso",
        (x - facing * 0.18 * scale, y, base + 1.38 * scale),
        (1.34 * scale, 0.78 * scale, 0.96 * scale),
        stone,
        target,
        segments=40,
        rings=26,
    )
    add_uv_sphere(
        f"{name}_Rump",
        (x - facing * 0.88 * scale, y, base + 1.38 * scale),
        (0.88 * scale, 0.79 * scale, 0.92 * scale),
        stone,
        target,
        segments=36,
        rings=24,
    )
    add_uv_sphere(
        f"{name}_Chest",
        (x + facing * 0.72 * scale, y, base + 1.48 * scale),
        (0.80 * scale, 0.79 * scale, 1.00 * scale),
        stone,
        target,
        segments=36,
        rings=24,
    )
    add_uv_sphere(
        f"{name}_Neck",
        (x + facing * 0.86 * scale, y, base + 1.96 * scale),
        (0.75 * scale, 0.74 * scale, 0.78 * scale),
        stone,
        target,
        segments=36,
        rings=24,
    )
    head_x = x + facing * 1.14 * scale
    add_uv_sphere(
        f"{name}_Head",
        (head_x, y, base + 2.28 * scale),
        (0.88 * scale, 0.80 * scale, 0.78 * scale),
        stone,
        target,
        segments=40,
        rings=26,
    )
    add_uv_sphere(
        f"{name}_BrowMass",
        (x + facing * 1.48 * scale, y, base + 2.39 * scale),
        (0.52 * scale, 0.70 * scale, 0.34 * scale),
        stone,
        target,
        segments=32,
        rings=20,
    )
    add_uv_sphere(
        f"{name}_Muzzle",
        (x + facing * 1.74 * scale, y, base + 2.12 * scale),
        (0.56 * scale, 0.58 * scale, 0.36 * scale),
        stone,
        target,
        segments=36,
        rings=22,
    )
    add_uv_sphere(
        f"{name}_UpperJaw",
        (x + facing * 1.80 * scale, y, base + 1.99 * scale),
        (0.47 * scale, 0.50 * scale, 0.20 * scale),
        stone,
        target,
        segments=32,
        rings=20,
    )
    add_uv_sphere(
        f"{name}_LowerJaw",
        (x + facing * 1.66 * scale, y, base + 1.72 * scale),
        (0.48 * scale, 0.48 * scale, 0.18 * scale),
        stone,
        target,
        segments=32,
        rings=20,
    )
    add_uv_sphere(
        f"{name}_MouthShadow",
        (x + facing * 1.91 * scale, y - 0.01 * scale, base + 1.84 * scale),
        (0.28 * scale, 0.45 * scale, 0.14 * scale),
        dark,
        target,
        segments=28,
        rings=18,
    )
    add_uv_sphere(
        f"{name}_Nose",
        (x + facing * 2.09 * scale, y, base + 2.17 * scale),
        (0.16 * scale, 0.34 * scale, 0.15 * scale),
        dark,
        target,
        segments=24,
        rings=16,
    )

    for side in (-1, 1):
        add_uv_sphere(
            f"{name}_Ear_{side}",
            (
                x + facing * 0.94 * scale,
                y + side * 0.48 * scale,
                base + 2.79 * scale,
            ),
            (0.23 * scale, 0.19 * scale, 0.32 * scale),
            stone,
            target,
            segments=24,
            rings=16,
        )
        add_uv_sphere(
            f"{name}_EyeSocket_{side}",
            (
                x + facing * 1.45 * scale,
                y + side * 0.51 * scale,
                base + 2.42 * scale,
            ),
            (0.16 * scale, 0.12 * scale, 0.14 * scale),
            stone,
            target,
            segments=24,
            rings=16,
        )
        add_uv_sphere(
            f"{name}_Eye_{side}",
            (
                x + facing * 1.50 * scale,
                y + side * 0.60 * scale,
                base + 2.42 * scale,
            ),
            (0.075 * scale, 0.055 * scale, 0.075 * scale),
            dark,
            target,
            segments=20,
            rings=12,
        )

    for front_index, leg_x in enumerate(
        (x + facing * 0.72 * scale, x - facing * 0.72 * scale)
    ):
        for side in (-1, 1):
            leg_y = y + side * 0.43 * scale
            add_cylinder(
                f"{name}_Leg_{front_index}_{side}",
                (leg_x, leg_y, base + 0.66 * scale),
                0.25 * scale,
                1.04 * scale,
                stone,
                target,
                vertices=24,
                bevel=0.06 * scale,
            )
            paw_x = leg_x + facing * 0.13 * scale
            add_uv_sphere(
                f"{name}_Paw_{front_index}_{side}",
                (paw_x, leg_y - 0.05 * scale, base + 0.18 * scale),
                (0.44 * scale, 0.34 * scale, 0.23 * scale),
                stone,
                target,
                segments=28,
                rings=18,
            )
            for toe in (-1, 0, 1):
                add_uv_sphere(
                    f"{name}_Toe_{front_index}_{side}_{toe}",
                    (
                        paw_x + facing * 0.31 * scale,
                        leg_y + toe * 0.10 * scale,
                        base + 0.20 * scale,
                    ),
                    (0.13 * scale, 0.085 * scale, 0.10 * scale),
                    stone,
                    target,
                    segments=18,
                    rings=12,
                )

    # Layered mane curls create the asymmetric, carved komainu outline.
    for ring, (radius_x, radius_z, count) in enumerate(
        ((0.88, 0.82, 16), (1.14, 1.06, 20))
    ):
        for index in range(count):
            angle = math.tau * index / count
            add_uv_sphere(
                f"{name}_Mane_{ring}_{index:02d}",
                (
                    head_x - facing * 0.18 * scale
                    + math.cos(angle) * radius_x * scale,
                    y + math.sin(angle * 2.0) * 0.13 * scale,
                    base + 2.23 * scale
                    + math.sin(angle) * radius_z * scale,
                ),
                (
                    0.20 * scale,
                    0.18 * scale,
                    0.20 * scale,
                ),
                stone,
                target,
                segments=18,
                rings=12,
            )

    add_curve(
        f"{name}_UpperLip",
        [
            (
                x + facing * 1.62 * scale,
                y - 0.53 * scale,
                base + 2.19 * scale,
            ),
            (
                x + facing * 2.03 * scale,
                y - 0.56 * scale,
                base + 2.10 * scale,
            ),
            (
                x + facing * 2.24 * scale,
                y - 0.38 * scale,
                base + 2.20 * scale,
            ),
        ],
        0.07 * scale,
        stone,
        target,
    )
    add_curve(
        f"{name}_Tail",
        [
            (
                x - facing * 1.15 * scale,
                y + 0.18 * scale,
                base + 1.25 * scale,
            ),
            (
                x - facing * 1.72 * scale,
                y + 0.24 * scale,
                base + 1.95 * scale,
            ),
            (
                x - facing * 1.42 * scale,
                y + 0.12 * scale,
                base + 2.82 * scale,
            ),
            (
                x - facing * 0.96 * scale,
                y - 0.02 * scale,
                base + 2.46 * scale,
            ),
        ],
        0.25 * scale,
        stone,
        target,
    )
    for patch in range(8):
        add_ico(
            f"{name}_Moss_{patch}",
            (
                x + random.uniform(-1.1, 1.1) * scale,
                y + random.uniform(-0.55, 0.55) * scale,
                base + random.uniform(0.45, 3.4) * scale,
            ),
            (random.uniform(0.18, 0.45) * scale, random.uniform(0.16, 0.38) * scale, random.uniform(0.035, 0.09) * scale),
            moss,
            target,
            subdivisions=1,
        )
    # Fuse the body construction into one continuous weathered sculpture.
    # This preserves authored silhouette/detail objects while removing the
    # separate-sphere appearance of the earlier blockout.
    created = set(bpy.context.scene.objects) - existing
    stone_parts = [
        obj
        for obj in created
        if obj.type == "MESH"
        and obj.data.materials
        and obj.data.materials[0] is stone
    ]
    if stone_parts:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in stone_parts:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = stone_parts[0]
        bpy.ops.object.join()
        fused = bpy.context.object
        fused.name = f"{name}_FusedStoneSculpture"
        remesh = fused.modifiers.new("Sculptural_Voxel_Remesh", "REMESH")
        remesh.mode = "VOXEL"
        remesh.voxel_size = 0.060 * scale
        remesh.use_smooth_shade = True
        bpy.ops.object.modifier_apply(modifier=remesh.name)
        texture = bpy.data.textures.new(f"{name}_Weathering", type="CLOUDS")
        texture.noise_scale = 0.18 * scale
        texture.noise_depth = 2
        weathering = fused.modifiers.new("Stone_Surface_Weathering", "DISPLACE")
        weathering.texture = texture
        weathering.strength = 0.028 * scale
        weathering.texture_coords = "GLOBAL"
        bpy.ops.object.modifier_apply(modifier=weathering.name)
        for polygon in fused.data.polygons:
            polygon.use_smooth = True
        fused["asset_id"] = f"shrine.sculpture.{name.lower()}.fused"
    # Turn the authored sculpture as one piece so the two guardians frame the
    # stair rather than staring symmetrically at the camera.
    sculpture = bpy.data.objects.new(f"{name}_SculptureRoot", None)
    target.objects.link(sculpture)
    tag(sculpture, f"shrine.sculpture.{name.lower()}")
    rotation = (
        Matrix.Translation((x, y, ground))
        @ Matrix.Rotation(yaw, 4, "Z")
        @ Matrix.Translation((-x, -y, -ground))
    )
    for obj in set(bpy.context.scene.objects) - existing:
        if obj is sculpture:
            continue
        obj.matrix_world = rotation @ obj.matrix_world
        world = obj.matrix_world.copy()
        obj.parent = sculpture
        obj.matrix_world = world


def build_komainu_pair(
    target: bpy.types.Collection,
    stone: bpy.types.Material,
    moss: bpy.types.Material,
) -> dict[str, int]:
    """Import and art-direct Zgon's realistic CC-BY stone guardian pair."""
    if not KOMA_INU_SOURCE.exists():
        raise FileNotFoundError(
            f"Missing verified Zgon CC-BY source: {KOMA_INU_SOURCE}"
        )

    before_objects = set(bpy.data.objects)
    before_materials = set(bpy.data.materials)
    before_images = set(bpy.data.images)
    bpy.ops.import_scene.gltf(filepath=str(KOMA_INU_SOURCE))
    imported_objects = [
        obj for obj in bpy.data.objects if obj not in before_objects
    ]
    imported_object_names = [obj.name for obj in imported_objects]
    imported_materials = [
        mat for mat in bpy.data.materials if mat not in before_materials
    ]
    imported_images = [
        image for image in bpy.data.images if image not in before_images
    ]
    bpy.context.view_layer.update()

    moss_material = next(
        (
            mat
            for mat in imported_materials
            if mat.name.startswith("Komaine_Moss")
        ),
        None,
    )
    if moss_material is None:
        raise RuntimeError("Komaine_Moss is missing from the verified source")
    moss_material.name = "JF_Zgon_Komainu_Moss_CC_BY"
    moss_material["asset_license"] = "CC-BY-4.0"
    moss_material["asset_creator"] = "Zgon"
    moss_material["asset_source"] = (
        "https://sketchfab.com/3d-models/"
        "komainu-statue-a5d4791ae95d4a9d9becedab6d2c7fc2"
    )
    shader = next(
        node
        for node in moss_material.node_tree.nodes
        if node.bl_idname == "ShaderNodeBsdfPrincipled"
    )
    base_color = shader.inputs["Base Color"]
    source_socket = (
        base_color.links[0].from_socket if base_color.is_linked else None
    )
    for link in list(base_color.links):
        moss_material.node_tree.links.remove(link)
    tint = moss_material.node_tree.nodes.new("ShaderNodeMixRGB")
    tint.name = "JF_OutdoorMossPatina"
    tint.blend_type = "MULTIPLY"
    tint.inputs[0].default_value = 0.28
    tint.inputs[2].default_value = (0.26, 0.34, 0.25, 1.0)
    if source_socket is not None:
        moss_material.node_tree.links.new(source_socket, tint.inputs[1])
    else:
        tint.inputs[1].default_value = base_color.default_value
    moss_material.node_tree.links.new(tint.outputs["Color"], base_color)
    used_images = {
        node.image
        for node in moss_material.node_tree.nodes
        if getattr(node, "image", None) is not None
    }
    for image in used_images:
        image["jf_publish_max_size"] = 512
        image["asset_license"] = "CC-BY-4.0"
        image["asset_creator"] = "Zgon"

    placements = (
        {
            "source": "Komainu_Left_Komaine_Stone_0",
            "name": "JF_Komainu_Left_CC_BY",
            "x": -1.80,
            "y": 10.50,
            "pedestal_scale": 0.808,
            "height": 5.332,
            "width_scale": 1.24,
            "depth_scale": 1.06,
            "ground_offset": -1.01,
            "yaw": math.radians(-80.0),
        },
        {
            "source": "Komainu_Right_Komaine_Moss_0",
            "name": "JF_Komainu_Right_CC_BY",
            "x": 13.00,
            "y": 4.70,
            "pedestal_scale": 1.14,
            "height": 5.90,
            "width_scale": 1.40,
            "depth_scale": 1.04,
            "ground_offset": -1.40,
            "yaw": math.radians(80.0),
        },
    )
    triangle_count = 0
    kept_guardians: list[bpy.types.Object] = []

    for placement in placements:
        guardian = next(
            (
                obj
                for obj in imported_objects
                if obj.type == "MESH"
                and obj.name.startswith(str(placement["source"]))
            ),
            None,
        )
        if guardian is None:
            raise RuntimeError(
                f"Expected guardian mesh {placement['source']} in "
                f"{KOMA_INU_SOURCE.name}"
            )
        world_matrix = guardian.matrix_world.copy()
        guardian.parent = None
        guardian.matrix_world = world_matrix
        move_to_collection(guardian, target)
        guardian.name = str(placement["name"])
        bpy.ops.object.select_all(action="DESELECT")
        guardian.select_set(True)
        bpy.context.view_layer.objects.active = guardian
        bpy.ops.object.transform_apply(
            location=False,
            rotation=True,
            scale=True,
        )
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")

        for polygon in guardian.data.polygons:
            polygon.use_smooth = True

        guardian.data.materials.clear()
        guardian.data.materials.append(moss_material)
        # Preserve the scanned silhouette while preparing a hero-density mesh
        # for the source normal/roughness detail and close camera framing.
        subdivision = guardian.modifiers.new(
            "JF_HeroGuardian_Subdivision",
            "SUBSURF",
        )
        subdivision.subdivision_type = "SIMPLE"
        subdivision.levels = 1
        subdivision.render_levels = 1
        bpy.ops.object.modifier_apply(modifier=subdivision.name)
        height_scale = float(placement["height"]) / guardian.dimensions.z
        guardian.scale = (height_scale, height_scale, height_scale)
        bpy.ops.object.transform_apply(
            location=False,
            rotation=False,
            scale=True,
        )
        guardian.rotation_euler.z = float(placement["yaw"])
        guardian.scale = (
            float(placement["width_scale"]),
            float(placement["depth_scale"]),
            1.0,
        )

        x = float(placement["x"])
        y = float(placement["y"])
        pedestal_scale = float(placement["pedestal_scale"])
        ground = terrain_height(x, y) + float(placement["ground_offset"])
        pedestal_top = ground + 1.03 * pedestal_scale
        guardian.location = (
            x,
            y,
            pedestal_top + guardian.dimensions.z * 0.5,
        )
        guardian["asset_id"] = (
            f"shrine.sculpture.{str(placement['name']).lower()}"
        )
        guardian["asset_license"] = "CC-BY-4.0"
        guardian["asset_creator"] = "Zgon"
        guardian["asset_source"] = (
            "https://sketchfab.com/3d-models/"
            "komainu-statue-a5d4791ae95d4a9d9becedab6d2c7fc2"
        )
        guardian["asset_modifications"] = (
            "Moss material applied to both symmetric meshes; smooth shading, "
            "scene scale, rotation, and placement."
        )
        kept_guardians.append(guardian)
        triangle_count += sum(
            max(1, len(polygon.vertices) - 2)
            for polygon in guardian.data.polygons
        )

        add_box(
            f"{placement['name']}_PedestalLower",
            (x, y, ground + 0.35 * pedestal_scale),
            (
                2.25 * pedestal_scale,
                2.05 * pedestal_scale,
                0.70 * pedestal_scale,
            ),
            stone,
            target,
            bevel=0.15 * pedestal_scale,
        )
        add_box(
            f"{placement['name']}_PedestalUpper",
            (x, y, ground + 0.85 * pedestal_scale),
            (
                1.85 * pedestal_scale,
                1.70 * pedestal_scale,
                0.35 * pedestal_scale,
            ),
            stone,
            target,
            bevel=0.12 * pedestal_scale,
        )
        for patch in range(7):
            add_ico(
                f"{placement['name']}_PedestalMoss_{patch}",
                (
                    x + random.uniform(-0.76, 0.76) * pedestal_scale,
                    y + random.uniform(-0.66, 0.66) * pedestal_scale,
                    ground
                    + random.uniform(0.55, 1.05) * pedestal_scale,
                ),
                (
                    random.uniform(0.20, 0.44) * pedestal_scale,
                    random.uniform(0.16, 0.36) * pedestal_scale,
                    random.uniform(0.025, 0.070) * pedestal_scale,
                ),
                moss,
                target,
                subdivisions=1,
            )

    # Remove the import hierarchy, unused stele meshes, and unused material
    # variants. The attributed redistributable 1K source GLB remains beside
    # the generated blend.
    for object_name in imported_object_names:
        obj = bpy.data.objects.get(object_name)
        if obj is not None and obj not in kept_guardians:
            bpy.data.objects.remove(obj, do_unlink=True)
    for mat in imported_materials:
        if mat.name in bpy.data.materials and mat.users == 0:
            bpy.data.materials.remove(mat)
    for image in imported_images:
        if image.name in bpy.data.images and image.users == 0:
            bpy.data.images.remove(image)

    return {
        "guardians": len(placements),
        "triangles": triangle_count,
    }


def build_tree(
    index: int,
    x: float,
    y: float,
    height: float,
    target: bpy.types.Collection,
    bark: bpy.types.Material,
    foliage_meshes: list[bpy.types.Mesh],
) -> None:
    z = terrain_height(x, y)
    lean = Vector((random.uniform(-0.14, 0.14), random.uniform(-0.08, 0.10), 1.0)).normalized()
    points = [Vector((x, y, z))]
    for level in range(1, 7):
        fraction = level / 6.0
        sway = Vector(
            (
                math.sin(index * 1.7 + fraction * 3.3) * 0.45 * fraction,
                math.cos(index * 0.9 + fraction * 2.1) * 0.30 * fraction,
                0.0,
            )
        )
        points.append(Vector((x, y, z)) + lean * (height * fraction) + sway)
    for level in range(6):
        taper = 1.0 - level / 7.2
        add_cone_between(
            f"JF_Tree_{index:02d}_Trunk_{level}",
            points[level],
            points[level + 1],
            0.42 * taper * (height / 12.0),
            0.34 * taper * (height / 12.0),
            bark,
            target,
            vertices=16,
        )

    for branch_index in range(9):
        source_level = random.randint(2, 5)
        origin = points[source_level]
        angle = random.uniform(0, math.tau)
        length = height * random.uniform(0.17, 0.30)
        end = origin + Vector(
            (
                math.cos(angle) * length,
                math.sin(angle) * length,
                length * random.uniform(0.18, 0.50),
            )
        )
        add_cone_between(
            f"JF_Tree_{index:02d}_Branch_{branch_index}",
            origin,
            end,
            0.17 * (height / 12.0),
            0.055 * (height / 12.0),
            bark,
            target,
            vertices=12,
        )
        for cluster_index in range(3):
            position = end + Vector(
                (
                    random.uniform(-1.15, 1.15),
                    random.uniform(-1.15, 1.15),
                    random.uniform(-0.35, 0.95),
                )
            )
            add_leaf_cluster(
                f"JF_Tree_{index:02d}_Foliage_{branch_index}_{cluster_index}",
                position,
                (
                    random.uniform(1.05, 1.55),
                    random.uniform(0.90, 1.40),
                    random.uniform(0.85, 1.30),
                ),
                random.choice(foliage_meshes),
                target,
            )


def build_grass_and_flowers(
    target: bpy.types.Collection,
    grass: bpy.types.Material,
    moss: bpy.types.Material,
    pink: bpy.types.Material,
    purple: bpy.types.Material,
    white: bpy.types.Material,
) -> None:
    # Fine ground cover is supplied by packed Poly Haven CC0 grass, ferns,
    # and moss-covered rocks. Avoid smooth green blobs masquerading as moss.
    flower_vertices: list[tuple[float, float, float]] = []
    flower_faces: list[tuple[int, int, int]] = []
    flower_material_indices: list[int] = []
    for index in range(260):
        side = random.choice((-1, 1))
        x = side * random.uniform(3.0, 12.5)
        y = random.uniform(-10.0, 14.0)
        z = terrain_height(x, y) + random.uniform(0.24, 0.48)
        radius = random.uniform(0.11, 0.20)
        material_index = random.randrange(3)
        for petal in range(5):
            angle = math.tau * petal / 5.0
            start = len(flower_vertices)
            flower_vertices.extend(
                [
                    (x, y, z),
                    (x + math.cos(angle - 0.48) * radius, y + math.sin(angle - 0.48) * radius, z + 0.02),
                    (x + math.cos(angle + 0.48) * radius, y + math.sin(angle + 0.48) * radius, z + 0.02),
                ]
            )
            flower_faces.append((start, start + 1, start + 2))
            flower_material_indices.append(material_index)
    flower_mesh = bpy.data.meshes.new("JF_Flower_Mesh")
    flower_mesh.from_pydata(flower_vertices, [], flower_faces)
    flower_mesh.update()
    flowers = bpy.data.objects.new("JF_Flower_Banks", flower_mesh)
    target.objects.link(flowers)
    for mat in (pink, purple, white):
        flower_mesh.materials.append(mat)
    for polygon, material_index in zip(flower_mesh.polygons, flower_material_indices):
        polygon.material_index = material_index
    tag(flowers, "shrine.vegetation.flowers")


def build_hydrangea_banks(
    target: bpy.types.Collection,
    moss: bpy.types.Material,
    foliage_mesh: bpy.types.Mesh,
    bloom_meshes: list[bpy.types.Mesh],
) -> None:
    positions = [
        (-9.4, -1.8, 1.90),
        (-7.0, 1.2, 1.65),
        (-10.3, 3.8, 2.05),
        (-6.8, 6.3, 1.82),
        (-9.0, 9.2, 1.72),
        (-5.4, 11.8, 1.58),
        (7.2, -0.4, 1.80),
        (9.8, 2.8, 1.52),
        (7.4, 6.4, 1.68),
        (11.0, 8.2, 2.10),
        (8.6, 12.0, 1.82),
        (12.8, 12.4, 1.70),
    ]
    for index, (x, y, radius) in enumerate(positions):
        z = terrain_height(x, y)
        for leaf_cluster in range(8):
            angle = math.tau * leaf_cluster / 8.0 + random.uniform(-0.35, 0.35)
            add_leaf_cluster(
                f"JF_HydrangeaFoliage_{index:02d}_{leaf_cluster:02d}",
                Vector(
                    (
                        x + math.cos(angle) * radius * 0.32,
                        y + math.sin(angle) * radius * 0.28,
                        z + radius * random.uniform(0.30, 0.62),
                    )
                ),
                (
                    radius * random.uniform(0.48, 0.68),
                    radius * random.uniform(0.42, 0.62),
                    radius * random.uniform(0.34, 0.54),
                ),
                foliage_mesh,
                target,
            )
        for cluster in range(16):
            angle = math.tau * cluster / 16.0 + random.uniform(-0.24, 0.24)
            offset = Vector(
                (
                    math.cos(angle) * radius * random.uniform(0.32, 0.58),
                    math.sin(angle) * radius * random.uniform(0.30, 0.52),
                    radius * random.uniform(0.56, 0.90),
                )
            )
            add_leaf_cluster(
                f"JF_HydrangeaBloom_{index:02d}_{cluster}",
                Vector((x, y, z)) + offset,
                (radius * 0.48, radius * 0.45, radius * 0.41),
                bloom_meshes[(index + cluster) % len(bloom_meshes)],
                target,
            )


def build_fog_cards(
    target: bpy.types.Collection,
    fog_mat: bpy.types.Material,
    shaft_mat: bpy.types.Material,
) -> None:
    # These overlapping, genuinely volumetric regions catch the spotlights and
    # sunlight. No visible cone/card geometry is used: trunks and foliage break
    # the beams naturally and the shafts fade into the surrounding air.
    add_box(
        "JF_FogVolume_Left",
        (-9.0, 1.0, 10.5),
        (15.0, 30.0, 21.0),
        fog_mat,
        target,
        bevel=0.0,
    )
    add_box(
        "JF_FogVolume_Back",
        (4.0, 18.0, 12.0),
        (28.0, 26.0, 22.0),
        fog_mat,
        target,
        bevel=0.0,
    )
    shaft_specs = (
        (
            "JF_VolumeShaft_Left",
            Vector((-15.0, -11.5, 22.5)),
            Vector((-5.0, 5.0, 0.7)),
            0.34,
            2.15,
        ),
        (
            "JF_VolumeShaft_Center",
            Vector((-11.0, -9.0, 21.0)),
            Vector((0.0, 8.0, 1.2)),
            0.28,
            1.55,
        ),
        (
            "JF_VolumeShaft_Back",
            Vector((-6.0, -6.0, 19.0)),
            Vector((5.0, 11.0, 2.0)),
            0.22,
            1.10,
        ),
    )
    for name, start, end, start_radius, end_radius in shaft_specs:
        shaft = add_cone_between(
            name,
            start,
            end,
            start_radius,
            end_radius,
            shaft_mat,
            target,
            vertices=32,
        )
        if hasattr(shaft, "visible_shadow"):
            shaft.visible_shadow = False
        shaft["asset_role"] = "scatter_only_volumetric_light_shaft"


def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_camera_and_lighting(
    scene: bpy.types.Scene,
    target: bpy.types.Collection,
    glow_mat: bpy.types.Material,
) -> None:
    camera_data = bpy.data.cameras.new("JF_Hero_Camera")
    camera = bpy.data.objects.new("JF_Hero_Camera", camera_data)
    target.objects.link(camera)
    camera.location = (-1.15, -31.0, 1.35)
    camera_data.lens = 32.0
    camera_data.sensor_width = 36.0
    camera_data.dof.use_dof = True
    camera_data.dof.focus_distance = 21.0
    camera_data.dof.aperture_fstop = 10.0
    look_at(camera, (0.4, 8.0, 5.70))
    scene.camera = camera
    tag(camera, "shrine.camera.hero")
    if REFERENCE_IMAGE.exists():
        reference = bpy.data.images.load(str(REFERENCE_IMAGE), check_existing=True)
        reference.name = "JF_REFERENCE_ONLY_NOT_PACKED"
        reference["asset_role"] = "local_camera_alignment_reference"
        reference["do_not_pack_or_publish"] = True
        camera_data.show_background_images = True
        background_image = camera_data.background_images.new()
        background_image.image = reference
        background_image.alpha = 0.50
        background_image.display_depth = "BACK"
        background_image.frame_method = "FIT"

    sun_data = bpy.data.lights.new("JF_Sun", "SUN")
    sun_data.energy = 2.5
    sun_data.angle = math.radians(0.8)
    sun_data.color = (1.0, 0.91, 0.78)
    sun = bpy.data.objects.new("JF_Sun", sun_data)
    target.objects.link(sun)
    sun.location = (-18.0, -13.0, 24.0)
    look_at(sun, (0.0, 7.0, 1.0))
    tag(sun, "shrine.light.sun")

    area_data = bpy.data.lights.new("JF_KeyArea", "AREA")
    area_data.energy = 700.0
    area_data.shape = "DISK"
    area_data.size = 9.0
    area_data.color = (1.0, 0.86, 0.68)
    area = bpy.data.objects.new("JF_KeyArea", area_data)
    target.objects.link(area)
    area.location = (-12.0, -7.0, 20.0)
    look_at(area, (0.0, 5.0, 3.0))
    tag(area, "shrine.light.key")

    fill_data = bpy.data.lights.new("JF_FillArea", "AREA")
    fill_data.energy = 450.0
    fill_data.shape = "RECTANGLE"
    fill_data.size = 12.0
    fill_data.color = (0.48, 0.62, 0.54)
    fill = bpy.data.objects.new("JF_FillArea", fill_data)
    target.objects.link(fill)
    fill.location = (13.0, 4.0, 12.0)
    look_at(fill, (1.0, 10.0, 5.0))
    tag(fill, "shrine.light.fill")

    front_data = bpy.data.lights.new("JF_FrontBounce", "AREA")
    front_data.energy = 600.0
    front_data.shape = "RECTANGLE"
    front_data.size = 10.0
    front_data.color = (0.58, 0.70, 0.92)
    front = bpy.data.objects.new("JF_FrontBounce", front_data)
    target.objects.link(front)
    front.location = (0.0, -17.0, 11.0)
    look_at(front, (1.5, 10.0, 5.0))
    tag(front, "shrine.light.front_bounce")

    bloom_data = bpy.data.lights.new("JF_LeftGardenFill", "AREA")
    bloom_data.energy = 450.0
    bloom_data.shape = "DISK"
    bloom_data.size = 7.0
    bloom_data.color = (0.72, 0.82, 0.68)
    bloom = bpy.data.objects.new("JF_LeftGardenFill", bloom_data)
    target.objects.link(bloom)
    bloom.location = (-11.0, -3.0, 8.5)
    look_at(bloom, (-7.0, 3.0, 2.4))
    tag(bloom, "shrine.light.left_garden_fill")

    stair_data = bpy.data.lights.new("JF_StairFill", "AREA")
    stair_data.energy = 200.0
    stair_data.shape = "RECTANGLE"
    stair_data.size = 8.0
    stair_data.color = (0.72, 0.79, 0.67)
    stair = bpy.data.objects.new("JF_StairFill", stair_data)
    target.objects.link(stair)
    stair.location = (-5.0, -7.0, 12.0)
    look_at(stair, (0.0, -1.5, 1.8))
    tag(stair, "shrine.light.stair_fill")

    shaft_lights = (
        ((-15.0, -12.0, 22.0), (-4.0, 4.0, 1.0), 7200.0),
        ((-11.0, -9.0, 21.0), (0.0, 8.0, 1.4), 5200.0),
        ((-6.0, -6.0, 19.0), (5.0, 11.0, 2.2), 3400.0),
    )
    for index, (location, target_point, energy) in enumerate(shaft_lights):
        spot_data = bpy.data.lights.new(f"JF_VolumeSpot_{index}", "SPOT")
        spot_data.energy = energy
        spot_data.color = (1.0, 0.91, 0.76)
        spot_data.spot_size = math.radians(12.0)
        spot_data.spot_blend = 0.62
        spot_data.volume_factor = 1.45
        spot = bpy.data.objects.new(f"JF_VolumeSpot_{index}", spot_data)
        target.objects.link(spot)
        spot.location = location
        look_at(spot, target_point)
        tag(spot, f"shrine.light.spot.{index}")

    patch_lights = (
        ((-7.0, -22.0, 15.0), (4.0, -16.0, 0.8), 20000.0, 16.0),
        ((-15.0, -10.0, 15.0), (-8.0, -4.0, 4.8), 220000.0, 22.0),
        ((-15.0, 1.0, 25.0), (-8.0, 11.0, 12.5), 55000.0, 22.0),
        ((-12.0, -15.0, 15.0), (0.5, -10.0, 0.8), 2000.0, 14.0),
        ((2.0, -6.0, 18.0), (13.0, 4.7, 8.5), 42000.0, 13.0),
        ((-10.0, 0.0, 23.0), (0.0, 12.0, 10.0), 120000.0, 24.0),
        ((-9.0, -4.0, 18.0), (0.0, 4.0, 5.0), 30000.0, 18.0),
        ((-12.0, -21.0, 14.0), (-4.0, -16.0, 1.0), 70000.0, 18.0),
    )
    for index, (location, target_point, energy, angle) in enumerate(patch_lights):
        patch_data = bpy.data.lights.new(f"JF_SunPatch_{index}", "SPOT")
        patch_data.energy = energy
        patch_data.color = (1.0, 0.94, 0.82)
        patch_data.spot_size = math.radians(angle)
        patch_data.spot_blend = 0.72
        patch_data.volume_factor = 0.15
        # Each light represents a real opening in the canopy. The dense
        # overlapping scan canopies are not authored with matching holes, so
        # allow only these measured sun pools through while the global sun
        # retains full physical tree shadows.
        patch_data.use_shadow = False
        patch = bpy.data.objects.new(f"JF_SunPatch_{index}", patch_data)
        target.objects.link(patch)
        patch.location = location
        look_at(patch, target_point)
        tag(patch, f"shrine.light.sun_patch.{index}")

    world = bpy.data.worlds.new("JF_Forest_World") if not scene.world else scene.world
    scene.world = world
    if not DAYLIGHT_HDRI.exists():
        raise FileNotFoundError(
            f"Missing verified Poly Haven daylight HDRI: {DAYLIGHT_HDRI}"
        )
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    texture_coordinate = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    environment = nodes.new("ShaderNodeTexEnvironment")
    environment.image = bpy.data.images.load(
        str(DAYLIGHT_HDRI),
        check_existing=True,
    )
    environment.image["asset_license"] = "CC0-1.0"
    environment.image["asset_creator"] = "Poly Haven"
    environment.interpolation = "Linear"
    mapping.inputs["Rotation"].default_value.z = math.radians(112.0)
    background = nodes.new("ShaderNodeBackground")
    background.inputs["Strength"].default_value = 0.90
    camera_background = nodes.new("ShaderNodeBackground")
    camera_background.name = "JF_CameraForestBackground"
    camera_background.inputs["Color"].default_value = (0.026, 0.033, 0.029, 1.0)
    camera_background.inputs["Strength"].default_value = 0.58
    light_path = nodes.new("ShaderNodeLightPath")
    light_path.name = "JF_CameraRay"
    camera_mix = nodes.new("ShaderNodeMixShader")
    camera_mix.name = "JF_WorldCameraMix"
    output = nodes.new("ShaderNodeOutputWorld")
    links.new(texture_coordinate.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], environment.inputs["Vector"])
    links.new(environment.outputs["Color"], background.inputs["Color"])
    links.new(background.outputs["Background"], camera_mix.inputs[1])
    links.new(camera_background.outputs["Background"], camera_mix.inputs[2])
    links.new(light_path.outputs["Is Camera Ray"], camera_mix.inputs[0])
    links.new(camera_mix.outputs["Shader"], output.inputs["Surface"])


def configure_render(scene: bpy.types.Scene) -> None:
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 7
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.cycles.transmission_bounces = 4
    scene.cycles.volume_bounces = 2
    cycles_addon = bpy.context.preferences.addons.get("cycles")
    if cycles_addon:
        preferences = cycles_addon.preferences
        try:
            preferences.compute_device_type = "OPTIX"
        except Exception:
            try:
                preferences.compute_device_type = "CUDA"
            except Exception:
                pass
        try:
            preferences.get_devices()
            for device in preferences.devices:
                device.use = (
                    device.type in {"OPTIX", "CUDA"}
                    and "NVIDIA" in device.name.upper()
                )
        except Exception:
            pass
    scene.render.resolution_x = 1937
    scene.render.resolution_y = 1079
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_percentage = 100
    scene.render.use_compositing = True
    scene.render.use_sequencer = False
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = 0.00

    # Blender 5.1 moved compositor ownership to Scene.compositing_node_group
    # and removed the legacy Scene.node_tree API. Keep this source compatible
    # with the official 5.1 MCP build by rendering directly; restrained bloom
    # is added in the Three.js runtime rather than baked into the source image.
    scene.use_nodes = False
    scene.compositing_node_group = None


def render_clay_comparison(
    scene: bpy.types.Scene,
    atmosphere_collection: bpy.types.Collection,
) -> None:
    """Render the structural gate without hiding the hero tree silhouettes."""
    clay = material(
        "JF_ClayComparison",
        (0.18, 0.19, 0.18, 1.0),
        0.94,
        noise_scale=4.0,
        noise_strength=0.08,
        bump_strength=0.06,
    )
    view_layer = bpy.context.view_layer
    previous_override = view_layer.material_override
    previous_path = scene.render.filepath
    previous_resolution = (
        scene.render.resolution_x,
        scene.render.resolution_y,
        scene.render.resolution_percentage,
    )
    previous_samples = scene.cycles.samples
    previous_atmosphere_visibility = atmosphere_collection.hide_render
    hidden_objects: list[bpy.types.Object] = []
    small_prefixes = (
        "JF_CC0_Grass_",
        "JF_CC0_Grass02_",
        "JF_CC0_Fern_",
        "JF_CC0_Moss_",
        "JF_CC0_StairMoss_",
        "JF_CC0_Nettle_",
        "JF_CC0_Weed_",
        "JF_GrassBlade_",
        "JF_Flower_",
    )
    for obj in scene.objects:
        if obj.name.startswith(small_prefixes) and not obj.hide_render:
            obj.hide_render = True
            hidden_objects.append(obj)
    atmosphere_collection.hide_render = True
    view_layer.material_override = clay
    scene.render.resolution_x = 963
    scene.render.resolution_y = 538
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 64
    scene.render.filepath = str(CLAY_PATH)
    bpy.ops.render.render(write_still=True)
    view_layer.material_override = previous_override
    atmosphere_collection.hide_render = previous_atmosphere_visibility
    for obj in hidden_objects:
        obj.hide_render = False
    scene.render.filepath = previous_path
    scene.render.resolution_x = previous_resolution[0]
    scene.render.resolution_y = previous_resolution[1]
    scene.render.resolution_percentage = previous_resolution[2]
    scene.cycles.samples = previous_samples


def main() -> dict[str, object]:
    scene = clean_scene()

    root = collection("JF_PRODUCTION_REBUILD")
    reference_col = collection("00_REFERENCE", root)
    cameras_col = collection("01_CAMERAS", root)
    terrain_col = collection("02_TERRAIN", root)
    steps_col = collection("03_STONE_STEPS", root)
    architecture_col = collection("04_SHRINE_ARCHITECTURE", root)
    sculpture_col = collection("05_GUARDIANS", root)
    props_col = collection("06_LANTERNS_AND_MARKERS", root)
    hero_trees_col = collection("07_HERO_TREES", root)
    vegetation_near_col = collection("08_VEGETATION_NEAR", root)
    vegetation_mid_col = collection("09_VEGETATION_MID", root)
    vegetation_far_col = collection("10_VEGETATION_FAR", root)
    lights_col = collection("11_LIGHTS", root)
    atmosphere_col = collection("12_VOLUMES", root)
    fx_col = collection("13_FX", root)
    render_col = collection("14_RENDER_OUTPUT", root)
    cc0_source_col = collection("15_SOURCE_ASSET_MASTERS", root)

    soil = material("JF_Soil", (0.055, 0.043, 0.028, 1.0), 0.96, noise_scale=4.2, noise_strength=0.50, bump_strength=0.42)
    stone = material("JF_WeatheredStone", (0.062, 0.070, 0.058, 1.0), 0.91, noise_scale=5.5, noise_strength=0.62, bump_strength=0.62)
    stone_ramp = next(
        node
        for node in stone.node_tree.nodes
        if node.bl_idname == "ShaderNodeValToRGB"
    )
    stone_ramp.color_ramp.elements[0].color = (
        0.035,
        0.041,
        0.033,
        1.0,
    )
    stone_ramp.color_ramp.elements[1].color = (
        0.105,
        0.120,
        0.082,
        1.0,
    )
    guardian_stone = material("JF_GuardianPatina", (0.018, 0.052, 0.026, 1.0), 0.90, noise_scale=7.5, noise_strength=0.58, bump_strength=0.66)
    moss = material("JF_Moss", (0.020, 0.035, 0.012, 1.0), 0.96, noise_scale=9.0, noise_strength=0.46, bump_strength=0.36)
    bark = material("JF_Bark", (0.075, 0.045, 0.025, 1.0), 0.94, noise_scale=5.8, noise_strength=0.58, bump_strength=0.64)
    wood = material("JF_AgedWood", (0.038, 0.020, 0.012, 1.0), 0.82, noise_scale=6.2, noise_strength=0.52, bump_strength=0.30)
    wood_red = material("JF_VermilionWood", (0.090, 0.022, 0.012, 1.0), 0.76, noise_scale=7.0, noise_strength=0.32, bump_strength=0.18)
    roof = material("JF_BlueBlackRoofTile", (0.035, 0.055, 0.075, 1.0), 0.28, metallic=0.12, noise_scale=11.0, noise_strength=0.25, bump_strength=0.25)
    dark = material("JF_DeepShadow", (0.0015, 0.0020, 0.0015, 1.0), 0.72)
    rope = material("JF_StrawRope", (0.32, 0.19, 0.065, 1.0), 0.91, noise_scale=15.0, noise_strength=0.42, bump_strength=0.40)
    paper = material("JF_WhitePaper", (0.72, 0.70, 0.61, 1.0), 0.82, noise_scale=18.0, noise_strength=0.08, bump_strength=0.07)
    gold = material("JF_BronzeBell", (0.24, 0.11, 0.025, 1.0), 0.32, metallic=0.72, noise_scale=9.0, noise_strength=0.18, bump_strength=0.12)
    grass = material("JF_Grass", (0.040, 0.078, 0.030, 1.0), 0.91, noise_scale=6.0, noise_strength=0.38, bump_strength=0.12)
    foliage_1 = material("JF_FoliageDeep", (0.022, 0.050, 0.027, 1.0), 0.84, noise_scale=5.5, noise_strength=0.38, bump_strength=0.18)
    foliage_2 = material("JF_FoliageMid", (0.060, 0.110, 0.065, 1.0), 0.82, noise_scale=6.5, noise_strength=0.34, bump_strength=0.16)
    foliage_3 = material("JF_FoliageSunlit", (0.160, 0.190, 0.100, 1.0), 0.80, noise_scale=7.0, noise_strength=0.28, bump_strength=0.15)
    pink = material("JF_FlowerPink", (0.13, 0.055, 0.078, 1.0), 0.82, noise_scale=18.0, noise_strength=0.18, bump_strength=0.16)
    purple = material("JF_FlowerPurple", (0.060, 0.050, 0.115, 1.0), 0.82, noise_scale=20.0, noise_strength=0.16, bump_strength=0.15)
    white = material("JF_FlowerWhite", (0.20, 0.18, 0.19, 1.0), 0.86, noise_scale=17.0, noise_strength=0.12, bump_strength=0.12)
    glow = material(
        "JF_LanternGlow",
        (0.38, 0.16, 0.025, 1.0),
        0.35,
        emission_color=(1.0, 0.27, 0.035, 1.0),
        emission_strength=5.0,
    )
    fog = volume_material("JF_LocalFog", 0.007)
    light_shafts = light_shaft_volume_material("JF_LightShaftVolume")
    forest_ground = mossy_ground_material(
        append_cc0_material("forest_ground_04", "forest_ground_04")
    )
    leaf_meshes = [
        make_leaf_cluster_mesh("JF_LeafCluster_Deep", foliage_1),
        make_leaf_cluster_mesh("JF_LeafCluster_Mid", foliage_2),
        make_leaf_cluster_mesh("JF_LeafCluster_Sunlit", foliage_3),
    ]
    bloom_meshes = [
        make_bloom_cluster_mesh("JF_BloomCluster_Pink", pink),
        make_bloom_cluster_mesh("JF_BloomCluster_Purple", purple),
        make_bloom_cluster_mesh("JF_BloomCluster_White", white),
    ]

    # The moss_01 source uses cutout alpha and turns a closed terrain mesh
    # unnaturally black. Dense real grass, ferns, and rock moss provide the
    # green cover; the continuous hillside uses the opaque forest-ground PBR.
    build_terrain(terrain_col, forest_ground, forest_ground)
    build_stairs(steps_col, stone, moss)
    # The enclosed authored hall matches the target silhouette and placement.
    # A separately reviewed open-pavilion candidate was rejected and is not
    # included in the publishable scene.
    build_shrine(
        architecture_col,
        wood,
        wood_red,
        roof,
        stone,
        paper,
        rope,
        gold,
        dark,
    )
    guardian_counts = build_komainu_pair(
        sculpture_col,
        guardian_stone,
        moss,
    )

    build_lantern("JF_Lantern_Foreground", -8.8, -0.2, 1.02, props_col, stone, dark, glow, moss)
    build_lantern("JF_Lantern_LeftRise", -6.2, 5.8, 0.92, props_col, stone, dark, glow, moss)
    build_lantern("JF_Lantern_Back", 0.1, 12.0, 0.68, props_col, stone, dark, glow, moss)
    add_weathered_stone_marker(
        "JF_RightBank_StoneMarker",
        13.8,
        -0.2,
        2.35,
        stone,
        moss,
        props_col,
    )

    cc0_counts = build_cc0_nature(cc0_source_col, vegetation_mid_col)
    for obj in list(vegetation_mid_col.objects):
        if obj.name.startswith(("JF_CC0_Pine_", "JF_CC0_Broadleaf_")):
            move_to_collection(obj, hero_trees_col)
        elif obj.name.startswith("JF_CC0_UnderstoryTree_"):
            move_to_collection(obj, vegetation_far_col)
        else:
            move_to_collection(obj, vegetation_near_col)
    build_grass_and_flowers(
        vegetation_near_col,
        grass,
        moss,
        pink,
        purple,
        white,
    )
    build_hydrangea_banks(
        vegetation_near_col,
        moss,
        leaf_meshes[1],
        bloom_meshes,
    )
    build_fog_cards(atmosphere_col, fog, light_shafts)
    setup_camera_and_lighting(scene, lights_col, glow)
    for obj in list(lights_col.objects):
        if obj.type == "CAMERA":
            move_to_collection(obj, cameras_col)
    configure_render(scene)
    render_clay_comparison(scene, atmosphere_col)

    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Keep dense broadleaf and guardian textures publishable in GitHub while
    # their verified 1K originals remain available from pinned source files.
    for image in bpy.data.images:
        if image.get("do_not_pack_or_publish"):
            continue
        source_path = image.filepath.lower()
        if "autumn_field_puresky" in source_path:
            # Keep the verified repository-owned HDR external so the editable
            # blend remains below GitHub's per-file limit without converting
            # high-dynamic-range lighting data to an 8-bit packed texture.
            continue
        publish_max_size = int(image.get("jf_publish_max_size", 0))
        if "tree_small_02" in source_path or "island_tree_02" in source_path:
            publish_max_size = 512
        if "pine_tree_01" in source_path:
            publish_max_size = min(publish_max_size or 512, 512)
        if any(
            slug in source_path
            for slug in (
                "grass_medium",
                "fern_02",
                "moss_01",
                "nettle_plant",
                "weed_plant",
                "rock_moss",
            )
        ):
            publish_max_size = min(publish_max_size or 256, 256)
        if "forest_ground_04" in source_path:
            publish_max_size = min(publish_max_size or 512, 512)
        if publish_max_size and max(image.size) > publish_max_size:
            image.scale(publish_max_size, publish_max_size)
            original_path = image.filepath_raw
            original_format = image.file_format
            safe_name = "".join(
                char if char.isalnum() else "_" for char in image.name
            )
            packed_source = (
                Path(bpy.app.tempdir) / f"jf_publish_{safe_name}.png"
            )
            image.filepath_raw = str(packed_source)
            image.file_format = "PNG"
            image.save()
            packed_bytes = packed_source.read_bytes()
            image.pack(data=packed_bytes, data_len=len(packed_bytes))
            image.filepath_raw = original_path
            image.file_format = original_format
            packed_source.unlink(missing_ok=True)
        elif image.packed_file is None and image.source == "FILE":
            source_file = bpy.path.abspath(image.filepath)
            if source_file and Path(source_file).exists():
                image.pack()
    for library in list(bpy.data.libraries):
        if len(library.users_id) == 0:
            bpy.data.libraries.remove(library)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=True)

    scene["object_count_at_save"] = len(scene.objects)
    scene["material_count_at_save"] = len(bpy.data.materials)
    scene["collection_count_at_save"] = len(bpy.data.collections)
    scene["cc0_nature_counts"] = str(cc0_counts)
    scene["cc0_guardian_counts"] = str(guardian_counts)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), compress=True)
    bpy.ops.render.render(write_still=True)

    return {
        "blend": str(BLEND_PATH),
        "preview": str(PREVIEW_PATH),
        "objects": len(scene.objects),
        "materials": len(bpy.data.materials),
        "collections": len(bpy.data.collections),
        "meshes": len(bpy.data.meshes),
        "curves": len(bpy.data.curves),
        "license": scene["asset_license"],
        "asset_id": scene["asset_id"],
    }


result = main()
