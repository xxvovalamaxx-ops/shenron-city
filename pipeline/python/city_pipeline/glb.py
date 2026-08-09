"""Small deterministic glTF/GLB massing writer and inspector."""

from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass
from typing import Any

from . import GENERATOR_VERSION
from .models import ContractError, NormalizedBuilding, TileKey

GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


@dataclass(frozen=True)
class GlbMetrics:
    triangles: int
    meshes: int
    materials: int
    bounds: tuple[float, float, float, float, float, float]


def _cross(
    a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]
) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _inside_triangle(
    point: tuple[float, float],
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
) -> bool:
    eps = 1e-9
    return (
        _cross(a, b, point) >= -eps
        and _cross(b, c, point) >= -eps
        and _cross(c, a, point) >= -eps
    )


def triangulate_polygon(
    ring: tuple[tuple[float, float], ...]
) -> list[tuple[int, int, int]]:
    """Ear-clip one simple counter-clockwise ring deterministically."""

    if len(ring) < 3:
        raise ContractError("cannot triangulate a ring with fewer than three points")
    remaining = list(range(len(ring)))
    triangles: list[tuple[int, int, int]] = []
    guard = len(ring) * len(ring)
    while len(remaining) > 3 and guard > 0:
        guard -= 1
        clipped = False
        for slot, current in enumerate(remaining):
            previous = remaining[(slot - 1) % len(remaining)]
            following = remaining[(slot + 1) % len(remaining)]
            a, b, c = ring[previous], ring[current], ring[following]
            if _cross(a, b, c) <= 1e-9:
                continue
            if any(
                candidate not in {previous, current, following}
                and _inside_triangle(ring[candidate], a, b, c)
                for candidate in remaining
            ):
                continue
            triangles.append((previous, current, following))
            del remaining[slot]
            clipped = True
            break
        if not clipped:
            raise ContractError("polygon could not be triangulated; check winding and validity")
    if len(remaining) != 3:
        raise ContractError("polygon triangulation did not terminate")
    triangles.append((remaining[0], remaining[1], remaining[2]))
    return triangles


def _building_triangles(
    building: NormalizedBuilding, tile: TileKey
) -> tuple[list[float], list[float]]:
    if building.holes:
        raise ContractError(
            f"{building.building_id}: courtyard massing is preserved by normalization "
            "but not triangulated by the Phase 1 fixture writer"
        )
    local = tuple(
        (
            point[0] - tile.origin_east,
            point[1] - tile.origin_north,
        )
        for point in building.outer
    )
    cap = triangulate_polygon(local)
    floor = building.ground_elevation_meters
    roof = floor + building.roof_height_meters
    positions: list[float] = []
    normals: list[float] = []

    def vertex(point: tuple[float, float], height: float, normal: tuple[float, float, float]) -> None:
        positions.extend((point[0], height, -point[1]))
        normals.extend(normal)

    for triangle in cap:
        for index in triangle:
            vertex(local[index], roof, (0.0, 1.0, 0.0))
        for index in reversed(triangle):
            vertex(local[index], floor, (0.0, -1.0, 0.0))

    for index, start in enumerate(local):
        end = local[(index + 1) % len(local)]
        dx = end[0] - start[0]
        dz = -(end[1] - start[1])
        length = math.hypot(dx, dz)
        if length <= 1e-9:
            continue
        normal = (-dz / length, 0.0, dx / length)
        for point, height in (
            (start, floor),
            (end, floor),
            (end, roof),
            (start, floor),
            (end, roof),
            (start, roof),
        ):
            vertex(point, height, normal)
    return positions, normals


def build_massing_glb(
    buildings: list[NormalizedBuilding], tile: TileKey
) -> tuple[bytes, GlbMetrics]:
    if not buildings:
        raise ContractError(f"{tile.tile_id}: cannot write an empty visual tile")
    binary = bytearray()
    buffer_views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []
    meshes: list[dict[str, Any]] = []
    nodes: list[dict[str, Any]] = []
    total_triangles = 0
    global_min = [math.inf, math.inf, math.inf]
    global_max = [-math.inf, -math.inf, -math.inf]

    def align() -> None:
        while len(binary) % 4:
            binary.append(0)

    def add_floats(values: list[float], target: int) -> int:
        align()
        offset = len(binary)
        binary.extend(struct.pack(f"<{len(values)}f", *values))
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": offset,
                "byteLength": len(values) * 4,
                "target": target,
            }
        )
        return len(buffer_views) - 1

    for building in sorted(buildings, key=lambda item: item.building_id):
        positions, normals = _building_triangles(building, tile)
        count = len(positions) // 3
        total_triangles += count // 3
        mins = [min(positions[axis::3]) for axis in range(3)]
        maxs = [max(positions[axis::3]) for axis in range(3)]
        for axis in range(3):
            global_min[axis] = min(global_min[axis], mins[axis])
            global_max[axis] = max(global_max[axis], maxs[axis])
        position_view = add_floats(positions, 34962)
        normal_view = add_floats(normals, 34962)
        position_accessor = len(accessors)
        accessors.append(
            {
                "bufferView": position_view,
                "componentType": 5126,
                "count": count,
                "type": "VEC3",
                "min": [round(value, 6) for value in mins],
                "max": [round(value, 6) for value in maxs],
            }
        )
        normal_accessor = len(accessors)
        accessors.append(
            {
                "bufferView": normal_view,
                "componentType": 5126,
                "count": count,
                "type": "VEC3",
            }
        )
        mesh_index = len(meshes)
        meshes.append(
            {
                "name": f"BLD_{building.building_id}",
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": position_accessor,
                            "NORMAL": normal_accessor,
                        },
                        "material": 0,
                        "mode": 4,
                    }
                ],
            }
        )
        nodes.append(
            {
                "name": f"BLD_{building.building_id}",
                "mesh": mesh_index,
                "extras": {
                    "buildingId": building.building_id,
                    "variationSeed": building.variation_seed,
                },
            }
        )

    raw_binary_length = len(binary)
    document: dict[str, Any] = {
        "asset": {"version": "2.0", "generator": GENERATOR_VERSION},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": [
            {
                "name": "CityMassingShared",
                "pbrMetallicRoughness": {
                    "baseColorFactor": [0.52, 0.54, 0.58, 1.0],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.86,
                },
            }
        ],
        "buffers": [{"byteLength": raw_binary_length}],
        "bufferViews": buffer_views,
        "accessors": accessors,
        "extras": {
            "tileId": tile.tile_id,
            "coordinateSpace": "tile-local-meters",
        },
    }
    json_bytes = json.dumps(
        document, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    binary.extend(b"\x00" * ((-len(binary)) % 4))
    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary)
    glb = bytearray(struct.pack("<III", GLB_MAGIC, 2, total_length))
    glb.extend(struct.pack("<II", len(json_bytes), JSON_CHUNK))
    glb.extend(json_bytes)
    glb.extend(struct.pack("<II", len(binary), BIN_CHUNK))
    glb.extend(binary)
    bounds = (
        global_min[0],
        global_min[1],
        global_min[2],
        global_max[0],
        global_max[1],
        global_max[2],
    )
    return bytes(glb), GlbMetrics(total_triangles, len(meshes), 1, bounds)


def parse_glb(data: bytes) -> tuple[dict[str, Any], bytes]:
    if len(data) < 20:
        raise ContractError("GLB is shorter than its header")
    magic, version, declared_length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC or version != 2 or declared_length != len(data):
        raise ContractError("invalid GLB header")
    offset = 12
    document: dict[str, Any] | None = None
    binary = b""
    while offset < len(data):
        if offset + 8 > len(data):
            raise ContractError("truncated GLB chunk header")
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset : offset + length]
        if len(chunk) != length:
            raise ContractError("truncated GLB chunk")
        if chunk_type == JSON_CHUNK:
            document = json.loads(chunk.decode("utf-8").rstrip(" \x00"))
        elif chunk_type == BIN_CHUNK:
            binary = chunk
        offset += length
    if document is None:
        raise ContractError("GLB contains no JSON chunk")
    return document, binary


def glb_position_bounds(data: bytes) -> tuple[float, float, float, float, float, float]:
    document, _ = parse_glb(data)
    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]
    found = False
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            accessor_index = primitive.get("attributes", {}).get("POSITION")
            if accessor_index is None:
                continue
            accessor = document["accessors"][accessor_index]
            if "min" not in accessor or "max" not in accessor:
                raise ContractError("POSITION accessor is missing min/max")
            found = True
            for axis in range(3):
                minimum[axis] = min(minimum[axis], float(accessor["min"][axis]))
                maximum[axis] = max(maximum[axis], float(accessor["max"][axis]))
    if not found:
        raise ContractError("GLB contains no POSITION accessors")
    return (*minimum, *maximum)


def glb_building_ids(data: bytes) -> list[str]:
    document, _ = parse_glb(data)
    ids = []
    for node in document.get("nodes", []):
        building_id = node.get("extras", {}).get("buildingId")
        if isinstance(building_id, str):
            ids.append(building_id)
    return ids
