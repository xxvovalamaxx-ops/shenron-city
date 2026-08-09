"""Deterministic 256 m ownership, visual tiles, and gameplay products."""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from . import GENERATOR_VERSION
from .glb import GlbMetrics, build_massing_glb
from .models import (
    CityConfig,
    ContractError,
    NormalizedBuilding,
    SourceLockEntry,
    TileKey,
)
from .normalize import vertical_reference


GAMEPLAY_SCHEMA_VERSION = 2
GAMEPLAY_MANIFEST_COORDINATE_SPACE = "hq-local-meters"
GAMEPLAY_COLLIDER_COORDINATE_SPACE = (
    "tile-local-horizontal-plus-hq-local-y-up-meters"
)
GAMEPLAY_AXIS_CONVENTION = "x-east-y-up-z-negative-north"
GAMEPLAY_TILE_ORIGIN_AXIS_ORDER = ("hq-local-east", "hq-local-north")
GAMEPLAY_FOOTPRINT_LOCAL_AXIS_ORDER = (
    "tile-local-east",
    "tile-local-negative-north",
)
GAMEPLAY_VERTICAL_AXIS = "hq-local-y-up"
GAMEPLAY_ACTIVATION_RADIUS_METERS = 384.0
RELEASE_SCHEMA_VERSION = 1
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canonical_json_bytes(value))


def tile_for_point(east: float, north: float, tile_size_meters: float) -> TileKey:
    rounded_size = int(round(tile_size_meters))
    if abs(rounded_size - tile_size_meters) > 1e-9:
        raise ContractError("tile size must be an integer number of metres")
    return TileKey(
        tx=math.floor(east / tile_size_meters),
        ty=math.floor(north / tile_size_meters),
        size_meters=rounded_size,
    )


def assign_buildings(
    buildings: list[NormalizedBuilding], tile_size_meters: float
) -> dict[TileKey, list[NormalizedBuilding]]:
    result: dict[TileKey, list[NormalizedBuilding]] = defaultdict(list)
    seen: set[str] = set()
    for building in sorted(buildings, key=lambda item: item.building_id):
        if building.building_id in seen:
            raise ContractError(f"duplicate normalized building ID: {building.building_id}")
        seen.add(building.building_id)
        key = tile_for_point(*building.centroid_meters, tile_size_meters)
        result[key].append(building)
    return dict(sorted(result.items()))


def _box_from_bounds(
    bounds: tuple[float, float, float, float, float, float]
) -> list[float]:
    min_x, min_y, min_z, max_x, max_y, max_z = bounds
    center_x = (min_x + max_x) / 2.0
    center_y = (min_y + max_y) / 2.0
    center_z = (min_z + max_z) / 2.0
    return [
        round(center_x, 6),
        round(center_y, 6),
        round(center_z, 6),
        round((max_x - min_x) / 2.0, 6),
        0.0,
        0.0,
        0.0,
        round((max_y - min_y) / 2.0, 6),
        0.0,
        0.0,
        0.0,
        round((max_z - min_z) / 2.0, 6),
    ]


def _root_transform(config: CityConfig) -> list[float]:
    """Map 3D Tiles Z-up HQ-local coordinates into the existing game world.

    The tile renderer applies ``asset.gltfUpAxis = Y`` to GLB content before
    tile transforms.  A GLB vertex ``(east, up, -north)`` therefore becomes a
    tile-space vertex ``(east, north, up)``.  The root maps that Z-up tile
    frame into the game's X-east/Y-up/Z-negative-north frame.
    """

    yaw = math.radians(config.north_yaw_degrees)
    cosine = math.cos(yaw) * config.world_units_per_meter
    sine = math.sin(yaw) * config.world_units_per_meter
    x, y, z = config.hq_world_position
    return [
        round(cosine, 12), 0.0, round(sine, 12), 0.0,
        round(sine, 12), 0.0, round(-cosine, 12), 0.0,
        0.0, config.world_units_per_meter, 0.0, 0.0,
        x, y, z, 1.0,
    ]


def _child_transform(tile: TileKey) -> list[float]:
    return [
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        tile.origin_east, tile.origin_north, 0.0, 1.0,
    ]


def gltf_y_up_bounds_to_tile_z_up(
    bounds: tuple[float, float, float, float, float, float],
) -> tuple[float, float, float, float, float, float]:
    """Convert raw GLB X-east/Y-up/Z-negative-north bounds to tile Z-up.

    With ``asset.gltfUpAxis`` set to ``Y``, 3D Tiles rotates each GLB point
    from ``(x, y, z)`` to ``(x, -z, y)``.  Bounding volumes belong to tile
    space, so they must undergo that same conversion before serialization.
    """

    min_x, min_y, min_z, max_x, max_y, max_z = bounds
    return (min_x, -max_z, min_y, max_x, -min_z, max_y)


def _translated_bounds(
    tile: TileKey,
    bounds: tuple[float, float, float, float, float, float],
) -> tuple[float, float, float, float, float, float]:
    return (
        bounds[0] + tile.origin_east,
        bounds[1] + tile.origin_north,
        bounds[2],
        bounds[3] + tile.origin_east,
        bounds[4] + tile.origin_north,
        bounds[5],
    )


def _union_bounds(
    values: list[tuple[float, float, float, float, float, float]]
) -> tuple[float, float, float, float, float, float]:
    if not values:
        raise ContractError("cannot compute bounds for an empty tileset")
    return (
        min(value[0] for value in values),
        min(value[1] for value in values),
        min(value[2] for value in values),
        max(value[3] for value in values),
        max(value[4] for value in values),
        max(value[5] for value in values),
    )


def _hq_bounds(buildings: list[NormalizedBuilding]) -> dict[str, float]:
    """Return the exact horizontal union used to activate a gameplay tile."""

    return {
        "minEast": round(min(point[0] for building in buildings for point in building.outer), 6),
        "minNorth": round(min(point[1] for building in buildings for point in building.outer), 6),
        "maxEast": round(max(point[0] for building in buildings for point in building.outer), 6),
        "maxNorth": round(max(point[1] for building in buildings for point in building.outer), 6),
    }


def _collider_bounds_local(
    tile: TileKey, building: NormalizedBuilding
) -> dict[str, float]:
    footprint = [
        (point[0] - tile.origin_east, -(point[1] - tile.origin_north))
        for point in building.outer
    ]
    min_y = round(building.ground_elevation_meters, 6)
    max_y = round(building.ground_elevation_meters + building.roof_height_meters, 6)
    return {
        "minEast": round(min(point[0] for point in footprint), 6),
        "minNegativeNorth": round(min(point[1] for point in footprint), 6),
        "maxEast": round(max(point[0] for point in footprint), 6),
        "maxNegativeNorth": round(max(point[1] for point in footprint), 6),
        "minY": min_y,
        "maxY": max_y,
    }


def _collider_tile(
    tile: TileKey,
    buildings: list[NormalizedBuilding],
    source_id: str,
    source_hash: str,
    normalized_derivation_sha256: str,
) -> dict[str, Any]:
    colliders = []
    for building in sorted(buildings, key=lambda item: item.building_id):
        bounds_local = _collider_bounds_local(tile, building)
        colliders.append(
            {
                "buildingId": building.building_id,
                "footprintLocal": [
                    [
                        round(point[0] - tile.origin_east, 6),
                        round(-(point[1] - tile.origin_north), 6),
                    ]
                    for point in building.outer
                ],
                "minY": building.ground_elevation_meters,
                "maxY": round(
                    building.ground_elevation_meters + building.roof_height_meters,
                    6,
                ),
                "boundsLocal": bounds_local,
            }
        )
    return {
        "schemaVersion": GAMEPLAY_SCHEMA_VERSION,
        "tileId": tile.tile_id,
        "tileSizeMeters": tile.size_meters,
        "tileOriginMeters": [tile.origin_east, tile.origin_north],
        "tileOriginAxisOrder": list(GAMEPLAY_TILE_ORIGIN_AXIS_ORDER),
        "coordinateSpace": GAMEPLAY_COLLIDER_COORDINATE_SPACE,
        "axisConvention": GAMEPLAY_AXIS_CONVENTION,
        "footprintLocalAxisOrder": list(GAMEPLAY_FOOTPRINT_LOCAL_AXIS_ORDER),
        "verticalAxis": GAMEPLAY_VERTICAL_AXIS,
        "sourceId": source_id,
        "sourceHash": source_hash,
        "normalizedDerivationSha256": normalized_derivation_sha256,
        "buildingCount": len(colliders),
        "buildingIds": [collider["buildingId"] for collider in colliders],
        "colliders": colliders,
    }


def package_tiles(
    config: CityConfig,
    buildings: list[NormalizedBuilding],
    source: SourceLockEntry,
    source_hash: str,
    normalized_derivation_sha256: str,
    output: Path,
) -> dict[str, Any]:
    source_id = source.source_id
    if not SHA256_RE.fullmatch(source_hash):
        raise ContractError("source hash must be 64 lowercase hexadecimal characters")
    if not SHA256_RE.fullmatch(normalized_derivation_sha256):
        raise ContractError(
            "normalized derivation hash must be 64 lowercase hexadecimal characters"
        )
    source_vertical_reference = vertical_reference(config, source)
    tiles = assign_buildings(buildings, config.standard_tile_size_meters)
    visual_dir = output / "visual"
    gameplay_dir = output / "gameplay" / "tiles"
    report_dir = output / "reports"
    visual_dir.mkdir(parents=True, exist_ok=True)
    gameplay_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)

    children = []
    gameplay_tiles = []
    reports = []
    root_bounds_parts = []
    total_triangles = 0
    total_visual_bytes = 0

    for tile, owned in tiles.items():
        glb, metrics = build_massing_glb(owned, tile)
        building_ids = [building.building_id for building in owned]
        tile_local_bounds = gltf_y_up_bounds_to_tile_z_up(metrics.bounds)
        visual_name = f"{tile.tile_id}.glb"
        visual_path = visual_dir / visual_name
        visual_path.write_bytes(glb)
        total_triangles += metrics.triangles
        total_visual_bytes += len(glb)
        root_bounds_parts.append(_translated_bounds(tile, tile_local_bounds))
        children.append(
            {
                "boundingVolume": {"box": _box_from_bounds(tile_local_bounds)},
                "geometricError": 0.0,
                "refine": "REPLACE",
                "transform": _child_transform(tile),
                "content": {"uri": f"visual/{visual_name}"},
                "extras": {
                    "tileId": tile.tile_id,
                    "buildingCount": len(owned),
                    "buildingIds": building_ids,
                    "sourceId": source_id,
                    "sourceHash": source_hash,
                    "normalizedDerivationSha256": normalized_derivation_sha256,
                },
            }
        )

        collider_name = f"{tile.tile_id}.json"
        collider = _collider_tile(
            tile,
            owned,
            source_id,
            source_hash,
            normalized_derivation_sha256,
        )
        write_json(gameplay_dir / collider_name, collider)
        gameplay_tiles.append(
            {
                "tileId": tile.tile_id,
                "boundsHqLocal": _hq_bounds(owned),
                "collisionUri": f"tiles/{collider_name}",
                "buildingCount": len(owned),
                "buildingIds": building_ids,
            }
        )
        report = {
            "tileId": tile.tile_id,
            "sourceId": source_id,
            "sourceHash": source_hash,
            "normalizedDerivationSha256": normalized_derivation_sha256,
            "generatorVersion": GENERATOR_VERSION,
            "triangles": metrics.triangles,
            "meshes": metrics.meshes,
            "materials": metrics.materials,
            "compressedBytes": len(glb),
            "buildingIds": building_ids,
            "validationErrors": [],
            "licenseSources": [source_id],
            "glbBoundsYUp": list(metrics.bounds),
            "boundsTileLocalZUp": list(tile_local_bounds),
        }
        write_json(report_dir / f"{tile.tile_id}.json", report)
        reports.append(report)

    root_bounds = _union_bounds(root_bounds_parts)
    tileset = {
        "asset": {
            "version": "1.1",
            "tilesetVersion": GENERATOR_VERSION,
            "gltfUpAxis": "Y",
        },
        "geometricError": config.aoi_size_meters,
        "root": {
            "boundingVolume": {"box": _box_from_bounds(root_bounds)},
            "geometricError": config.standard_tile_size_meters,
            "refine": "REPLACE",
            "transform": _root_transform(config),
            "children": children,
            "extras": {
                "coordinateSpace": "hq-local-meters",
                "axisConvention": config.axis_convention,
                "sourceId": source_id,
                "sourceHash": source_hash,
                "normalizedDerivationSha256": normalized_derivation_sha256,
                "generatorVersion": GENERATOR_VERSION,
                "verticalReference": source_vertical_reference,
            },
        },
    }
    write_json(output / "tileset.json", tileset)

    gameplay_manifest = {
        "schemaVersion": GAMEPLAY_SCHEMA_VERSION,
        "generatedBy": GENERATOR_VERSION,
        "sourceId": source_id,
        "sourceHash": source_hash,
        "normalizedDerivationSha256": normalized_derivation_sha256,
        "coordinateSpace": GAMEPLAY_MANIFEST_COORDINATE_SPACE,
        "axisConvention": GAMEPLAY_AXIS_CONVENTION,
        "tileOriginAxisOrder": list(GAMEPLAY_TILE_ORIGIN_AXIS_ORDER),
        "colliderCoordinateSpace": GAMEPLAY_COLLIDER_COORDINATE_SPACE,
        "footprintLocalAxisOrder": list(GAMEPLAY_FOOTPRINT_LOCAL_AXIS_ORDER),
        "verticalAxis": GAMEPLAY_VERTICAL_AXIS,
        "verticalReference": source_vertical_reference,
        "tileSizeMeters": config.standard_tile_size_meters,
        "activationRadiusMeters": GAMEPLAY_ACTIVATION_RADIUS_METERS,
        "tiles": gameplay_tiles,
    }
    write_json(output / "gameplay" / "manifest.json", gameplay_manifest)

    release = {
        "schemaVersion": RELEASE_SCHEMA_VERSION,
        "sourceHash": source_hash,
        "normalizedDerivationSha256": normalized_derivation_sha256,
        "tilesetUri": "tileset.json",
        "gameplayManifestUri": "gameplay/manifest.json",
        "requiredInitialTileIds": sorted(
            child["extras"]["tileId"] for child in children
        ),
    }
    write_json(output / "release.json", release)

    build_report = {
        "schemaVersion": 1,
        "generatedBy": GENERATOR_VERSION,
        "sourceId": source_id,
        "sourceHash": source_hash,
        "normalizedDerivationSha256": normalized_derivation_sha256,
        "aoiSizeMeters": config.aoi_size_meters,
        "tileSizeMeters": config.standard_tile_size_meters,
        "coordinateSpace": GAMEPLAY_MANIFEST_COORDINATE_SPACE,
        "axisConvention": GAMEPLAY_AXIS_CONVENTION,
        "buildings": len(buildings),
        "visualTiles": len(children),
        "gameplayTiles": len(gameplay_tiles),
        "triangles": total_triangles,
        "materialsPerTile": 1,
        "visualBytes": total_visual_bytes,
        "rootBoundsTileLocalZUp": list(root_bounds),
        "verticalReference": source_vertical_reference,
        "tiles": reports,
    }
    write_json(output / "reports" / "build-report.json", build_report)
    return build_report
