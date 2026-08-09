"""Cross-artifact validation for a packaged Phase-1 city product."""

from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any

from .glb import glb_building_ids, glb_position_bounds
from .models import ContractError
from .tiles import (
    GAMEPLAY_ACTIVATION_RADIUS_METERS,
    GAMEPLAY_AXIS_CONVENTION,
    GAMEPLAY_COLLIDER_COORDINATE_SPACE,
    GAMEPLAY_FOOTPRINT_LOCAL_AXIS_ORDER,
    GAMEPLAY_MANIFEST_COORDINATE_SPACE,
    GAMEPLAY_SCHEMA_VERSION,
    GAMEPLAY_TILE_ORIGIN_AXIS_ORDER,
    GAMEPLAY_VERTICAL_AXIS,
    RELEASE_SCHEMA_VERSION,
    SHA256_RE,
    gltf_y_up_bounds_to_tile_z_up,
)


TILE_ID_RE = re.compile(r"^([1-9][0-9]*)_([pm])([0-9]{3})_([pm])([0-9]{3})$")
EPSILON = 1e-6


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON constant is not allowed: {value}")


def _read_json(path: Path) -> Any:
    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            parse_constant=_reject_json_constant,
        )
    except FileNotFoundError as exc:
        raise ContractError(f"generated artifact is missing: {path}") from exc
    except (json.JSONDecodeError, ValueError) as exc:
        raise ContractError(f"invalid generated JSON at {path}: {exc}") from exc


def _contained_path(root: Path, uri: Any, label: str) -> Path:
    if not isinstance(uri, str) or not uri or "://" in uri:
        raise ContractError(f"{label} must be a non-empty same-origin relative URI")
    target = (root / Path(uri)).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError as exc:
        raise ContractError(f"{label} escapes its artifact directory: {uri}") from exc
    return target


def _finite(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError(f"{label} must be a finite number")
    number = float(value)
    if not math.isfinite(number):
        raise ContractError(f"{label} must be a finite number")
    return number


def _integer(value: Any, label: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ContractError(f"{label} must be an integer greater than or equal to {minimum}")
    return value


def _integral_number(value: Any, label: str, *, minimum: int = 0) -> int:
    number = _finite(value, label)
    if not number.is_integer() or number < minimum:
        raise ContractError(f"{label} must be an integral number greater than or equal to {minimum}")
    return int(number)


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ContractError(f"{label} must be a non-empty string")
    return value


def _sha256(value: Any, label: str) -> str:
    result = _string(value, label)
    if not SHA256_RE.fullmatch(result):
        raise ContractError(f"{label} must be 64 lowercase hexadecimal characters")
    return result


def _close(first: float, second: float, label: str, tolerance: float = EPSILON) -> None:
    if not math.isclose(first, second, abs_tol=tolerance, rel_tol=0.0):
        raise ContractError(f"{label} does not match the generated geometry")


def _box_bounds(value: Any, label: str) -> tuple[float, float, float, float, float, float]:
    if not isinstance(value, list) or len(value) != 12:
        raise ContractError(f"{label} must be a 12-number 3D Tiles box")
    numbers = [_finite(item, f"{label}[{index}]") for index, item in enumerate(value)]
    center = numbers[:3]
    axes = (numbers[3:6], numbers[6:9], numbers[9:12])
    # Phase 1 deliberately emits axis-aligned boxes. Strictness catches an
    # accidental frame/axis conversion before the browser consumes it.
    if any(
        abs(axes[row][column]) > 1e-9
        for row in range(3)
        for column in range(3)
        if row != column
    ):
        raise ContractError(f"{label} is not axis-aligned")
    half = (abs(axes[0][0]), abs(axes[1][1]), abs(axes[2][2]))
    return (
        center[0] - half[0],
        center[1] - half[1],
        center[2] - half[2],
        center[0] + half[0],
        center[1] + half[1],
        center[2] + half[2],
    )


def _bounds_contain(
    container: tuple[float, float, float, float, float, float],
    content: tuple[float, float, float, float, float, float],
    tolerance: float = 1e-5,
) -> bool:
    return all(container[index] <= content[index] + tolerance for index in range(3)) and all(
        container[index] + tolerance >= content[index] for index in range(3, 6)
    )


def _matrix4(value: Any, label: str) -> tuple[float, ...]:
    if not isinstance(value, list) or len(value) != 16:
        raise ContractError(f"{label} must be a 16-number affine matrix")
    matrix = tuple(_finite(item, f"{label}[{index}]") for index, item in enumerate(value))
    if any(abs(matrix[index]) > EPSILON for index in (3, 7, 11)) or not math.isclose(
        matrix[15], 1.0, abs_tol=EPSILON, rel_tol=0.0
    ):
        raise ContractError(f"{label} must be affine with a [0, 0, 0, 1] final row")
    return matrix


def _transform_point(
    matrix: tuple[float, ...], point: tuple[float, float, float]
) -> tuple[float, float, float]:
    return tuple(
        matrix[row] * point[0]
        + matrix[4 + row] * point[1]
        + matrix[8 + row] * point[2]
        + matrix[12 + row]
        for row in range(3)
    )  # type: ignore[return-value]


def _transform_bounds(
    matrix: tuple[float, ...],
    bounds: tuple[float, float, float, float, float, float],
) -> tuple[float, float, float, float, float, float]:
    points = [
        _transform_point(matrix, (x, y, z))
        for x in (bounds[0], bounds[3])
        for y in (bounds[1], bounds[4])
        for z in (bounds[2], bounds[5])
    ]
    return (
        min(point[0] for point in points),
        min(point[1] for point in points),
        min(point[2] for point in points),
        max(point[0] for point in points),
        max(point[1] for point in points),
        max(point[2] for point in points),
    )


def _vertical_reference(value: Any, label: str) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ContractError(f"{label} must be an object")
    required = {
        "sourceGroundElevationVerticalDatum",
        "hqAnchorVerticalDatum",
        "sourceDatumRelation",
        "normalizedUpFormula",
    }
    if set(value) != required or any(
        not isinstance(value[key], str) or not value[key] for key in required
    ):
        raise ContractError(f"{label} is not a complete vertical-reference contract")
    if value["sourceDatumRelation"] != "same-as-hq-anchor":
        raise ContractError(f"{label}.sourceDatumRelation must be same-as-hq-anchor")
    if value["sourceGroundElevationVerticalDatum"] != value["hqAnchorVerticalDatum"]:
        raise ContractError(f"{label} source and HQ vertical datums must match")
    if value["normalizedUpFormula"] != "sourceGroundElevationMeters - hqGeoAnchor.elevationMeters":
        raise ContractError(f"{label}.normalizedUpFormula is unsupported")
    return value


def _tile_key(tile_id: Any, label: str, expected_size: int | None = None) -> tuple[int, int, int]:
    value = _string(tile_id, label)
    match = TILE_ID_RE.fullmatch(value)
    if not match:
        raise ContractError(f"{label} must use <size>_<p|m><xxx>_<p|m><xxx> notation")
    size = int(match.group(1))
    east_index = int(match.group(3)) * (-1 if match.group(2) == "m" else 1)
    north_index = int(match.group(5)) * (-1 if match.group(4) == "m" else 1)
    if (match.group(2) == "m" and east_index == 0) or (
        match.group(4) == "m" and north_index == 0
    ):
        raise ContractError(f"{label} must encode zero with p000")
    if expected_size is not None and size != expected_size:
        raise ContractError(f"{label} tile size does not match the manifest")
    return size, east_index, north_index


def _axis_order(value: Any, expected: tuple[str, str], label: str) -> None:
    if not isinstance(value, list) or value != list(expected):
        raise ContractError(f"{label} must be {list(expected)}")


def _manifest_coordinate_contract(manifest: dict[str, Any]) -> None:
    if manifest.get("coordinateSpace") != GAMEPLAY_MANIFEST_COORDINATE_SPACE:
        raise ContractError("gameplay manifest coordinateSpace is unsupported")
    if manifest.get("axisConvention") != GAMEPLAY_AXIS_CONVENTION:
        raise ContractError("gameplay manifest axisConvention is unsupported")
    _axis_order(
        manifest.get("tileOriginAxisOrder"),
        GAMEPLAY_TILE_ORIGIN_AXIS_ORDER,
        "gameplay manifest tileOriginAxisOrder",
    )
    if manifest.get("colliderCoordinateSpace") != GAMEPLAY_COLLIDER_COORDINATE_SPACE:
        raise ContractError("gameplay manifest colliderCoordinateSpace is unsupported")
    _axis_order(
        manifest.get("footprintLocalAxisOrder"),
        GAMEPLAY_FOOTPRINT_LOCAL_AXIS_ORDER,
        "gameplay manifest footprintLocalAxisOrder",
    )
    if manifest.get("verticalAxis") != GAMEPLAY_VERTICAL_AXIS:
        raise ContractError("gameplay manifest verticalAxis is unsupported")


def _collider_coordinate_contract(collider: dict[str, Any], label: str) -> None:
    if collider.get("coordinateSpace") != GAMEPLAY_COLLIDER_COORDINATE_SPACE:
        raise ContractError(f"{label}.coordinateSpace is unsupported")
    if collider.get("axisConvention") != GAMEPLAY_AXIS_CONVENTION:
        raise ContractError(f"{label}.axisConvention is unsupported")
    _axis_order(
        collider.get("tileOriginAxisOrder"),
        GAMEPLAY_TILE_ORIGIN_AXIS_ORDER,
        f"{label}.tileOriginAxisOrder",
    )
    _axis_order(
        collider.get("footprintLocalAxisOrder"),
        GAMEPLAY_FOOTPRINT_LOCAL_AXIS_ORDER,
        f"{label}.footprintLocalAxisOrder",
    )
    if collider.get("verticalAxis") != GAMEPLAY_VERTICAL_AXIS:
        raise ContractError(f"{label}.verticalAxis is unsupported")


def _horizontal_bounds(value: Any, label: str) -> tuple[float, float, float, float]:
    required = {"minEast", "minNorth", "maxEast", "maxNorth"}
    if not isinstance(value, dict) or set(value) != required:
        raise ContractError(f"{label} must contain exactly min/max east/north")
    min_east = _finite(value["minEast"], f"{label}.minEast")
    min_north = _finite(value["minNorth"], f"{label}.minNorth")
    max_east = _finite(value["maxEast"], f"{label}.maxEast")
    max_north = _finite(value["maxNorth"], f"{label}.maxNorth")
    if min_east > max_east or min_north > max_north:
        raise ContractError(f"{label} minimums must not exceed maximums")
    return min_east, min_north, max_east, max_north


def _collider_bounds(value: Any, label: str) -> tuple[float, float, float, float, float, float]:
    required = {
        "minEast",
        "minNegativeNorth",
        "maxEast",
        "maxNegativeNorth",
        "minY",
        "maxY",
    }
    if not isinstance(value, dict) or set(value) != required:
        raise ContractError(f"{label} must contain exact local horizontal and vertical bounds")
    bounds = tuple(_finite(value[key], f"{label}.{key}") for key in (
        "minEast",
        "minNegativeNorth",
        "minY",
        "maxEast",
        "maxNegativeNorth",
        "maxY",
    ))
    if bounds[0] > bounds[3] or bounds[1] > bounds[4] or bounds[2] > bounds[5]:
        raise ContractError(f"{label} minimums must not exceed maximums")
    return bounds  # type: ignore[return-value]


def _orientation(
    first: tuple[float, float], second: tuple[float, float], third: tuple[float, float]
) -> float:
    return (second[0] - first[0]) * (third[1] - first[1]) - (
        second[1] - first[1]
    ) * (third[0] - first[0])


def _on_segment(
    first: tuple[float, float], second: tuple[float, float], point: tuple[float, float]
) -> bool:
    return (
        min(first[0], second[0]) - EPSILON <= point[0] <= max(first[0], second[0]) + EPSILON
        and min(first[1], second[1]) - EPSILON <= point[1] <= max(first[1], second[1]) + EPSILON
    )


def _segments_intersect(
    first_a: tuple[float, float],
    first_b: tuple[float, float],
    second_a: tuple[float, float],
    second_b: tuple[float, float],
) -> bool:
    ab_a = _orientation(first_a, first_b, second_a)
    ab_b = _orientation(first_a, first_b, second_b)
    cd_a = _orientation(second_a, second_b, first_a)
    cd_b = _orientation(second_a, second_b, first_b)
    if ((ab_a > EPSILON and ab_b < -EPSILON) or (ab_a < -EPSILON and ab_b > EPSILON)) and (
        (cd_a > EPSILON and cd_b < -EPSILON) or (cd_a < -EPSILON and cd_b > EPSILON)
    ):
        return True
    return (
        abs(ab_a) <= EPSILON and _on_segment(first_a, first_b, second_a)
    ) or (
        abs(ab_b) <= EPSILON and _on_segment(first_a, first_b, second_b)
    ) or (
        abs(cd_a) <= EPSILON and _on_segment(second_a, second_b, first_a)
    ) or (
        abs(cd_b) <= EPSILON and _on_segment(second_a, second_b, first_b)
    )


def _footprint(value: Any, label: str) -> list[tuple[float, float]]:
    if not isinstance(value, list) or len(value) < 3:
        raise ContractError(f"{label} must contain at least three points")
    points: list[tuple[float, float]] = []
    for index, raw in enumerate(value):
        if not isinstance(raw, list) or len(raw) != 2:
            raise ContractError(f"{label}[{index}] must contain exactly two values")
        points.append(
            (
                _finite(raw[0], f"{label}[{index}][0]"),
                _finite(raw[1], f"{label}[{index}][1]"),
            )
        )
    if len(set(points)) != len(points):
        raise ContractError(f"{label} repeats vertices")
    for first in range(len(points)):
        for second in range(first + 1, len(points)):
            if second in {first, (first + 1) % len(points)} or (
                first == 0 and second == len(points) - 1
            ):
                continue
            if _segments_intersect(
                points[first],
                points[(first + 1) % len(points)],
                points[second],
                points[(second + 1) % len(points)],
            ):
                raise ContractError(f"{label} self-intersects")
    signed_area = 0.5 * sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    )
    if signed_area >= -EPSILON:
        raise ContractError(
            f"{label} must be clockwise in tile-local east/negative-north coordinates"
        )
    return points


def _sorted_unique_ids(value: Any, label: str, expected_count: int | None = None) -> list[str]:
    if not isinstance(value, list):
        raise ContractError(f"{label} must be an array")
    ids = [_string(item, f"{label}[{index}]") for index, item in enumerate(value)]
    if ids != sorted(ids) or len(ids) != len(set(ids)):
        raise ContractError(f"{label} must contain sorted unique building IDs")
    if expected_count is not None and len(ids) != expected_count:
        raise ContractError(f"{label} count does not match its buildingCount")
    return ids


def _validate_child_transform(
    matrix: tuple[float, ...], tile_id: str, expected_size: int
) -> None:
    size, east_index, north_index = _tile_key(tile_id, "tileset child tileId", expected_size)
    expected = (
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        east_index * size,
        north_index * size,
        0.0,
        1.0,
    )
    if any(not math.isclose(actual, wanted, abs_tol=EPSILON, rel_tol=0.0) for actual, wanted in zip(matrix, expected)):
        raise ContractError(f"tileset child {tile_id} transform does not match its tile origin")


def _validate_collider_tile(
    collider: Any,
    *,
    tile_id: str,
    tile_size: int,
    source_id: str,
    source_hash: str,
    derivation_hash: str,
    manifest_ids: list[str],
    manifest_count: int,
    manifest_bounds: tuple[float, float, float, float],
) -> list[str]:
    label = f"gameplay tile {tile_id}"
    if not isinstance(collider, dict):
        raise ContractError(f"{label} must be an object")
    if _integer(collider.get("schemaVersion"), f"{label}.schemaVersion") != GAMEPLAY_SCHEMA_VERSION:
        raise ContractError(f"{label}.schemaVersion must be {GAMEPLAY_SCHEMA_VERSION}")
    if collider.get("tileId") != tile_id:
        raise ContractError(f"{label} identity mismatch")
    if _integral_number(collider.get("tileSizeMeters"), f"{label}.tileSizeMeters", minimum=1) != tile_size:
        raise ContractError(f"{label}.tileSizeMeters does not match the manifest")
    _collider_coordinate_contract(collider, label)
    if collider.get("sourceId") != source_id or _sha256(collider.get("sourceHash"), f"{label}.sourceHash") != source_hash:
        raise ContractError(f"{label} source identity/hash mismatch")
    if _sha256(collider.get("normalizedDerivationSha256"), f"{label}.normalizedDerivationSha256") != derivation_hash:
        raise ContractError(f"{label} normalized derivation hash mismatch")

    size, east_index, north_index = _tile_key(tile_id, f"{label}.tileId", tile_size)
    origin = collider.get("tileOriginMeters")
    if not isinstance(origin, list) or len(origin) != 2:
        raise ContractError(f"{label}.tileOriginMeters must contain exactly east and north")
    origin_east = _finite(origin[0], f"{label}.tileOriginMeters[0]")
    origin_north = _finite(origin[1], f"{label}.tileOriginMeters[1]")
    _close(origin_east, east_index * size, f"{label}.tileOriginMeters[0]")
    _close(origin_north, north_index * size, f"{label}.tileOriginMeters[1]")

    building_count = _integer(collider.get("buildingCount"), f"{label}.buildingCount")
    ids = _sorted_unique_ids(collider.get("buildingIds"), f"{label}.buildingIds", building_count)
    if building_count != manifest_count or ids != manifest_ids:
        raise ContractError(f"{label} building ownership does not match the manifest")
    colliders = collider.get("colliders")
    if not isinstance(colliders, list) or len(colliders) != building_count:
        raise ContractError(f"{label}.colliders count does not match buildingCount")

    hq_points: list[tuple[float, float]] = []
    collider_ids: list[str] = []
    for index, entry in enumerate(colliders):
        collider_label = f"{label}.colliders[{index}]"
        if not isinstance(entry, dict):
            raise ContractError(f"{collider_label} must be an object")
        building_id = _string(entry.get("buildingId"), f"{collider_label}.buildingId")
        footprint = _footprint(entry.get("footprintLocal"), f"{collider_label}.footprintLocal")
        min_y = _finite(entry.get("minY"), f"{collider_label}.minY")
        max_y = _finite(entry.get("maxY"), f"{collider_label}.maxY")
        if min_y > max_y:
            raise ContractError(f"{collider_label}.minY must not exceed maxY")
        declared = _collider_bounds(entry.get("boundsLocal"), f"{collider_label}.boundsLocal")
        actual = (
            min(point[0] for point in footprint),
            min(point[1] for point in footprint),
            min_y,
            max(point[0] for point in footprint),
            max(point[1] for point in footprint),
            max_y,
        )
        for position, (actual_value, declared_value) in enumerate(zip(actual, declared)):
            _close(actual_value, declared_value, f"{collider_label}.boundsLocal[{position}]")
        collider_ids.append(building_id)
        hq_points.extend((origin_east + east, origin_north - negative_north) for east, negative_north in footprint)

    if collider_ids != ids:
        raise ContractError(f"{label} collider IDs must be sorted and match buildingIds")
    actual_bounds = (
        min(point[0] for point in hq_points),
        min(point[1] for point in hq_points),
        max(point[0] for point in hq_points),
        max(point[1] for point in hq_points),
    )
    for position, (actual_value, declared_value) in enumerate(zip(actual_bounds, manifest_bounds)):
        _close(actual_value, declared_value, f"{label} manifest horizontal bounds[{position}]")
    return ids


def _validate_report_tiles(
    report: dict[str, Any],
    visual_by_tile: dict[str, list[str]],
    source_id: str,
    source_hash: str,
    derivation_hash: str,
) -> None:
    entries = report.get("tiles")
    if not isinstance(entries, list):
        raise ContractError("build report tiles must be an array")
    by_tile: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise ContractError("build report tile must be an object")
        tile_id = _string(entry.get("tileId"), "build report tileId")
        if tile_id in by_tile:
            raise ContractError("build report tile IDs must be unique")
        if entry.get("sourceId") != source_id or _sha256(entry.get("sourceHash"), f"build report {tile_id} sourceHash") != source_hash:
            raise ContractError(f"build report {tile_id} source identity/hash mismatch")
        if _sha256(entry.get("normalizedDerivationSha256"), f"build report {tile_id} normalizedDerivationSha256") != derivation_hash:
            raise ContractError(f"build report {tile_id} normalized derivation hash mismatch")
        by_tile[tile_id] = entry
    if set(by_tile) != set(visual_by_tile):
        raise ContractError("build report tile ownership does not match visual tiles")
    for tile_id, ids in visual_by_tile.items():
        entry_ids = _sorted_unique_ids(by_tile[tile_id].get("buildingIds"), f"build report {tile_id} buildingIds")
        if entry_ids != ids:
            raise ContractError(f"build report {tile_id} building ownership mismatch")


def _validate_release(
    output: Path,
    source_hash: str,
    derivation_hash: str,
    visual_by_tile: dict[str, list[str]],
) -> None:
    release = _read_json(output / "release.json")
    required = {
        "schemaVersion",
        "sourceHash",
        "normalizedDerivationSha256",
        "tilesetUri",
        "gameplayManifestUri",
        "requiredInitialTileIds",
    }
    if not isinstance(release, dict) or set(release) != required:
        raise ContractError("release manifest must contain exactly the Phase 1 release contract")
    if _integer(release.get("schemaVersion"), "release manifest schemaVersion") != RELEASE_SCHEMA_VERSION:
        raise ContractError(f"release manifest schemaVersion must be {RELEASE_SCHEMA_VERSION}")
    if _sha256(release.get("sourceHash"), "release manifest sourceHash") != source_hash:
        raise ContractError("release manifest source hash mismatch")
    if _sha256(release.get("normalizedDerivationSha256"), "release manifest normalizedDerivationSha256") != derivation_hash:
        raise ContractError("release manifest normalized derivation hash mismatch")
    if release.get("tilesetUri") != "tileset.json":
        raise ContractError("release manifest tilesetUri must be the canonical tileset path")
    if release.get("gameplayManifestUri") != "gameplay/manifest.json":
        raise ContractError("release manifest gameplayManifestUri must be the canonical gameplay path")
    if _contained_path(output, release["tilesetUri"], "release manifest tilesetUri") != output / "tileset.json":
        raise ContractError("release manifest tilesetUri does not resolve to the product tileset")
    if _contained_path(output, release["gameplayManifestUri"], "release manifest gameplayManifestUri") != output / "gameplay" / "manifest.json":
        raise ContractError("release manifest gameplayManifestUri does not resolve to the gameplay manifest")
    required_ids = _sorted_unique_ids(
        release.get("requiredInitialTileIds"),
        "release manifest requiredInitialTileIds",
    )
    if required_ids != sorted(visual_by_tile):
        raise ContractError("release manifest requiredInitialTileIds do not match visual tile content")


def validate_package(
    output: Path,
    expected_source_hash: str | None = None,
    expected_derivation_hash: str | None = None,
) -> dict[str, Any]:
    """Validate visual, gameplay, provenance, bounds, and ownership as one product."""

    output = output.resolve()
    tileset = _read_json(output / "tileset.json")
    manifest = _read_json(output / "gameplay" / "manifest.json")
    report = _read_json(output / "reports" / "build-report.json")
    if not isinstance(tileset, dict) or tileset.get("asset", {}).get("version") != "1.1":
        raise ContractError("tileset must declare 3D Tiles asset version 1.1")
    if tileset.get("asset", {}).get("gltfUpAxis") != "Y":
        raise ContractError("tileset must declare gltfUpAxis Y for Y-up GLB content")
    root = tileset.get("root")
    if not isinstance(root, dict) or not isinstance(root.get("children"), list) or not root["children"]:
        raise ContractError("tileset root must contain at least one child tile")
    root_extras = root.get("extras")
    if not isinstance(root_extras, dict):
        raise ContractError("tileset root extras must be an object")
    if root_extras.get("coordinateSpace") != GAMEPLAY_MANIFEST_COORDINATE_SPACE or root_extras.get("axisConvention") != GAMEPLAY_AXIS_CONVENTION:
        raise ContractError("tileset root coordinate contract is unsupported")
    source_id = _string(root_extras.get("sourceId"), "tileset root extras.sourceId")
    source_hash = _sha256(root_extras.get("sourceHash"), "tileset root extras.sourceHash")
    derivation_hash = _sha256(
        root_extras.get("normalizedDerivationSha256"),
        "tileset root extras.normalizedDerivationSha256",
    )
    if expected_source_hash is not None and source_hash != expected_source_hash:
        raise ContractError("tileset source hash does not match the locked input")
    if expected_derivation_hash is not None and derivation_hash != expected_derivation_hash:
        raise ContractError("tileset normalized derivation hash does not match the locked source and config")
    vertical_reference = _vertical_reference(
        root_extras.get("verticalReference"),
        "tileset root extras.verticalReference",
    )
    root_bounds = _box_bounds(root.get("boundingVolume", {}).get("box"), "root bounds")
    _matrix4(root.get("transform"), "root transform")

    visual_ids: list[str] = []
    visual_by_tile: dict[str, list[str]] = {}
    child_bounds_in_root: list[tuple[float, float, float, float, float, float]] = []
    total_visual_bytes = 0
    standard_tile_size: int | None = None
    for child in root["children"]:
        if not isinstance(child, dict):
            raise ContractError("tileset child must be an object")
        extras = child.get("extras")
        if not isinstance(extras, dict):
            raise ContractError("tileset child extras must be an object")
        tile_id = _string(extras.get("tileId"), "tileset child tileId")
        size, _east_index, _north_index = _tile_key(tile_id, "tileset child tileId")
        if standard_tile_size is None:
            standard_tile_size = size
        elif standard_tile_size != size:
            raise ContractError("tileset children must use one tile size")
        if tile_id in visual_by_tile:
            raise ContractError("tileset child tile IDs must be unique non-empty strings")
        if extras.get("sourceId") != source_id or _sha256(extras.get("sourceHash"), f"tile {tile_id} sourceHash") != source_hash:
            raise ContractError(f"tile {tile_id} source identity/hash mismatch")
        if _sha256(extras.get("normalizedDerivationSha256"), f"tile {tile_id} normalizedDerivationSha256") != derivation_hash:
            raise ContractError(f"tile {tile_id} normalized derivation hash mismatch")
        content_path = _contained_path(output, child.get("content", {}).get("uri"), "content.uri")
        try:
            glb = content_path.read_bytes()
        except FileNotFoundError as exc:
            raise ContractError(f"tile content is missing: {content_path}") from exc
        declared_bounds = _box_bounds(child.get("boundingVolume", {}).get("box"), f"tile {tile_id} bounds")
        actual_bounds = gltf_y_up_bounds_to_tile_z_up(glb_position_bounds(glb))
        if not all(math.isfinite(value) for value in actual_bounds):
            raise ContractError(f"tile {tile_id} GLB bounds must be finite")
        if not _bounds_contain(declared_bounds, actual_bounds):
            raise ContractError(f"tile {tile_id} GLB exceeds its declared bounding volume")
        transform = _matrix4(child.get("transform"), f"tile {tile_id} transform")
        _validate_child_transform(transform, tile_id, size)
        child_bounds_in_root.append(_transform_bounds(transform, declared_bounds))
        building_ids = glb_building_ids(glb)
        if not building_ids or len(building_ids) != len(set(building_ids)):
            raise ContractError(f"tile {tile_id} has missing or duplicate building IDs")
        if building_ids != sorted(building_ids):
            raise ContractError(f"tile {tile_id} GLB building IDs must be sorted")
        expected_count = _integer(extras.get("buildingCount"), f"tile {tile_id} buildingCount")
        expected_ids = _sorted_unique_ids(extras.get("buildingIds"), f"tile {tile_id} buildingIds", expected_count)
        if expected_count != len(building_ids) or expected_ids != building_ids:
            raise ContractError(f"tile {tile_id} building ownership does not match its GLB")
        visual_by_tile[tile_id] = building_ids
        visual_ids.extend(building_ids)
        total_visual_bytes += len(glb)

    if standard_tile_size != 256:
        raise ContractError("Phase 1 tileset children must use 256 m tiles")
    duplicates = sorted(key for key, count in Counter(visual_ids).items() if count != 1)
    if duplicates:
        raise ContractError(f"buildings are not owned by exactly one visual tile: {duplicates}")
    if not all(_bounds_contain(root_bounds, bounds) for bounds in child_bounds_in_root):
        raise ContractError("root bounds do not contain all transformed child bounds")
    _validate_release(output, source_hash, derivation_hash, visual_by_tile)

    if not isinstance(manifest, dict):
        raise ContractError("gameplay manifest must be an object")
    if _integer(manifest.get("schemaVersion"), "gameplay manifest schemaVersion") != GAMEPLAY_SCHEMA_VERSION:
        raise ContractError(f"gameplay manifest schemaVersion must be {GAMEPLAY_SCHEMA_VERSION}")
    _manifest_coordinate_contract(manifest)
    if manifest.get("sourceId") != source_id or _sha256(manifest.get("sourceHash"), "gameplay manifest sourceHash") != source_hash:
        raise ContractError("gameplay manifest source identity/hash mismatch")
    if _sha256(manifest.get("normalizedDerivationSha256"), "gameplay manifest normalizedDerivationSha256") != derivation_hash:
        raise ContractError("gameplay manifest normalized derivation hash mismatch")
    if _vertical_reference(manifest.get("verticalReference"), "gameplay manifest verticalReference") != vertical_reference:
        raise ContractError("gameplay manifest verticalReference mismatch")
    manifest_tile_size = _integral_number(manifest.get("tileSizeMeters"), "gameplay manifest tileSizeMeters", minimum=1)
    if manifest_tile_size != standard_tile_size:
        raise ContractError("gameplay manifest tileSizeMeters does not match visual tiles")
    activation_radius = _finite(manifest.get("activationRadiusMeters"), "gameplay manifest activationRadiusMeters")
    if not math.isclose(activation_radius, GAMEPLAY_ACTIVATION_RADIUS_METERS, abs_tol=EPSILON, rel_tol=0.0):
        raise ContractError("gameplay manifest activationRadiusMeters is unsupported")
    manifest_tiles = manifest.get("tiles")
    if not isinstance(manifest_tiles, list) or not manifest_tiles:
        raise ContractError("gameplay manifest tiles must be a non-empty array")
    gameplay_by_tile: dict[str, list[str]] = {}
    for item in manifest_tiles:
        if not isinstance(item, dict):
            raise ContractError("gameplay manifest tile must be an object")
        tile_id = _string(item.get("tileId"), "gameplay manifest tileId")
        _tile_key(tile_id, "gameplay manifest tileId", manifest_tile_size)
        if tile_id in gameplay_by_tile:
            raise ContractError("gameplay tile IDs must be unique non-empty strings")
        bounds = _horizontal_bounds(item.get("boundsHqLocal"), f"gameplay tile {tile_id} boundsHqLocal")
        building_count = _integer(item.get("buildingCount"), f"gameplay tile {tile_id} buildingCount")
        manifest_ids = _sorted_unique_ids(item.get("buildingIds"), f"gameplay tile {tile_id} buildingIds", building_count)
        collision_uri = item.get("collisionUri")
        if collision_uri != f"tiles/{tile_id}.json":
            raise ContractError(f"gameplay tile {tile_id} collisionUri must use its canonical tile path")
        collider_path = _contained_path(output / "gameplay", collision_uri, "collisionUri")
        collider_ids = _validate_collider_tile(
            _read_json(collider_path),
            tile_id=tile_id,
            tile_size=manifest_tile_size,
            source_id=source_id,
            source_hash=source_hash,
            derivation_hash=derivation_hash,
            manifest_ids=manifest_ids,
            manifest_count=building_count,
            manifest_bounds=bounds,
        )
        gameplay_by_tile[tile_id] = collider_ids

    if visual_by_tile != gameplay_by_tile:
        raise ContractError("visual and gameplay tile ownership do not match")
    if not isinstance(report, dict):
        raise ContractError("build report must be an object")
    if report.get("sourceId") != source_id or _sha256(report.get("sourceHash"), "build report sourceHash") != source_hash:
        raise ContractError("build report source identity/hash mismatch")
    if _sha256(report.get("normalizedDerivationSha256"), "build report normalizedDerivationSha256") != derivation_hash:
        raise ContractError("build report normalized derivation hash mismatch")
    if report.get("coordinateSpace") != GAMEPLAY_MANIFEST_COORDINATE_SPACE or report.get("axisConvention") != GAMEPLAY_AXIS_CONVENTION:
        raise ContractError("build report coordinate contract is unsupported")
    if _vertical_reference(report.get("verticalReference"), "build report verticalReference") != vertical_reference:
        raise ContractError("build report verticalReference mismatch")
    if report.get("buildings") != len(visual_ids):
        raise ContractError("build report building count does not match generated content")
    if report.get("visualTiles") != len(visual_by_tile) or report.get("gameplayTiles") != len(gameplay_by_tile):
        raise ContractError("build report tile counts do not match generated content")
    if report.get("visualBytes") != total_visual_bytes:
        raise ContractError("build report byte count does not match generated GLBs")
    _validate_report_tiles(report, visual_by_tile, source_id, source_hash, derivation_hash)

    return {
        "sourceHash": source_hash,
        "normalizedDerivationSha256": derivation_hash,
        "buildings": len(visual_ids),
        "visualTiles": len(visual_by_tile),
        "gameplayTiles": len(gameplay_by_tile),
        "visualBytes": total_visual_bytes,
        "status": "valid",
    }
