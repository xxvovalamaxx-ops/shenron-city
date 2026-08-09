"""Normalize a locked GeoJSON source into deterministic HQ-local records."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any, Iterable

from . import GENERATOR_VERSION
from .geo import GeoTransform, us_survey_feet_to_meters
from .models import CityConfig, ContractError, NormalizedBuilding, SourceLockEntry


def deterministic_seed(building_id: str) -> int:
    """Stable unsigned 32-bit variation seed derived only from the stable ID."""

    digest = hashlib.sha256(building_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "little", signed=False)


def _signed_area(ring: Iterable[tuple[float, float]]) -> float:
    points = list(ring)
    return 0.5 * sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    )


def _centroid(ring: tuple[tuple[float, float], ...]) -> tuple[float, float]:
    twice_area = 0.0
    x_sum = 0.0
    y_sum = 0.0
    for index, point in enumerate(ring):
        nxt = ring[(index + 1) % len(ring)]
        cross = point[0] * nxt[1] - nxt[0] * point[1]
        twice_area += cross
        x_sum += (point[0] + nxt[0]) * cross
        y_sum += (point[1] + nxt[1]) * cross
    if abs(twice_area) < 1e-9:
        raise ContractError("polygon has zero area")
    return x_sum / (3.0 * twice_area), y_sum / (3.0 * twice_area)


def _orientation(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _segments_intersect(
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
    d: tuple[float, float],
) -> bool:
    eps = 1e-9
    ab_c = _orientation(a, b, c)
    ab_d = _orientation(a, b, d)
    cd_a = _orientation(c, d, a)
    cd_b = _orientation(c, d, b)
    return (
        ((ab_c > eps and ab_d < -eps) or (ab_c < -eps and ab_d > eps))
        and ((cd_a > eps and cd_b < -eps) or (cd_a < -eps and cd_b > eps))
    )


def _has_self_intersection(ring: tuple[tuple[float, float], ...]) -> bool:
    count = len(ring)
    for first in range(count):
        a = ring[first]
        b = ring[(first + 1) % count]
        for second in range(first + 1, count):
            if second in {first, (first + 1) % count}:
                continue
            if first == 0 and second == count - 1:
                continue
            c = ring[second]
            d = ring[(second + 1) % count]
            if _segments_intersect(a, b, c, d):
                return True
    return False


def _clean_ring(
    coordinates: Any,
    transform: GeoTransform,
    want_counter_clockwise: bool,
) -> tuple[tuple[tuple[float, float], ...], list[str]]:
    if not isinstance(coordinates, list) or len(coordinates) < 4:
        raise ContractError("polygon ring must contain at least four GeoJSON positions")
    points: list[tuple[float, float]] = []
    repaired: list[str] = []
    anchor_elevation = transform.config.hq_geo_anchor.elevation_meters
    for index, coordinate in enumerate(coordinates):
        if (
            not isinstance(coordinate, list)
            or len(coordinate) < 2
            or isinstance(coordinate[0], bool)
            or isinstance(coordinate[1], bool)
            or not isinstance(coordinate[0], (int, float))
            or not isinstance(coordinate[1], (int, float))
        ):
            raise ContractError(f"invalid GeoJSON position at ring index {index}")
        longitude = float(coordinate[0])
        latitude = float(coordinate[1])
        if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
            raise ContractError(f"GeoJSON position outside WGS84 range at index {index}")
        east, north, _ = transform.geographic_to_local(
            latitude, longitude, anchor_elevation
        )
        point = (round(east, 6), round(north, 6))
        if points and point == points[-1]:
            repaired.append("removed consecutive duplicate point")
            continue
        points.append(point)
    if len(points) > 1 and points[0] == points[-1]:
        points.pop()
    if len(points) < 3 or len(set(points)) < 3:
        raise ContractError("polygon ring has fewer than three distinct points")
    ring = tuple(points)
    if _has_self_intersection(ring):
        raise ContractError("polygon ring self-intersects")
    area = _signed_area(ring)
    if abs(area) < 1e-6:
        raise ContractError("polygon ring has zero area")
    is_counter_clockwise = area > 0
    if is_counter_clockwise != want_counter_clockwise:
        ring = tuple(reversed(ring))
        repaired.append("normalized polygon winding")
    return ring, repaired


def _finite_number(value: Any, field: str, default: float | None = None) -> float:
    if value is None and default is not None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError(f"{field} must be a finite number")
    result = float(value)
    if not math.isfinite(result):
        raise ContractError(f"{field} must be a finite number")
    return result


def _height(properties: dict[str, Any], meter_key: str, foot_key: str) -> float:
    if meter_key in properties:
        return _finite_number(properties[meter_key], meter_key)
    if foot_key in properties:
        return us_survey_feet_to_meters(_finite_number(properties[foot_key], foot_key))
    raise ContractError(f"building requires {meter_key} or {foot_key}")


def vertical_reference(config: CityConfig, source: SourceLockEntry) -> dict[str, str]:
    """Return the only Phase-1 vertical contract accepted by this adapter.

    A source lock owns datum provenance for source-wide ground-elevation
    attributes.  Phase 1 deliberately does not guess a geoid/ellipsoid or
    datum conversion: the input must explicitly declare that it is in the
    same named datum as the HQ anchor.
    """

    if source.ground_elevation_datum_relation != "same-as-hq-anchor":
        raise ContractError(
            "Phase 1 ground elevations require "
            "groundElevationDatumRelation=same-as-hq-anchor; datum conversion "
            "is not implemented"
        )
    if source.ground_elevation_vertical_datum != config.hq_geo_anchor.vertical_datum:
        raise ContractError(
            "source groundElevationVerticalDatum must exactly match "
            "hqGeoAnchor.verticalDatum when "
            "groundElevationDatumRelation=same-as-hq-anchor"
        )
    return {
        "sourceGroundElevationVerticalDatum": source.ground_elevation_vertical_datum,
        "hqAnchorVerticalDatum": config.hq_geo_anchor.vertical_datum,
        "sourceDatumRelation": source.ground_elevation_datum_relation,
        "normalizedUpFormula": (
            "sourceGroundElevationMeters - hqGeoAnchor.elevationMeters"
        ),
    }


def normalize_ground_elevation(
    source_ground_elevation_meters: float,
    config: CityConfig,
    source: SourceLockEntry,
) -> float:
    """Convert a source ground height in the shared datum to HQ-local up."""

    vertical_reference(config, source)
    return source_ground_elevation_meters - config.hq_geo_anchor.elevation_meters


def normalize_geojson(
    config: CityConfig,
    source: SourceLockEntry,
) -> tuple[dict[str, Any], list[NormalizedBuilding]]:
    if source.original_crs.upper() not in {"EPSG:4326", "WGS84"}:
        raise ContractError(
            "the Phase 1 GeoJSON adapter accepts only WGS84/EPSG:4326 coordinates; "
            f"got {source.original_crs}"
        )
    try:
        raw = json.loads(source.source_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ContractError(f"invalid source GeoJSON: {exc}") from exc
    if not isinstance(raw, dict) or raw.get("type") != "FeatureCollection":
        raise ContractError("source must be a GeoJSON FeatureCollection")
    features = raw.get("features")
    if not isinstance(features, list):
        raise ContractError("GeoJSON FeatureCollection.features must be an array")

    source_vertical_reference = vertical_reference(config, source)
    transform = GeoTransform(config)
    half_aoi = config.aoi_size_meters / 2.0
    buildings: list[NormalizedBuilding] = []
    seen_ids: set[str] = set()
    report: dict[str, Any] = {
        "inputFeatures": len(features),
        "normalized": 0,
        "outsideAoi": [],
        "repaired": [],
        "invalid": [],
        "skipped": [],
    }

    for index, feature in enumerate(features):
        label = f"feature[{index}]"
        try:
            if not isinstance(feature, dict) or feature.get("type") != "Feature":
                raise ContractError("record is not a GeoJSON Feature")
            properties = feature.get("properties")
            geometry = feature.get("geometry")
            if not isinstance(properties, dict):
                raise ContractError("properties must be an object")
            if not isinstance(geometry, dict) or geometry.get("type") != "Polygon":
                raise ContractError("only Polygon geometry is supported in Phase 1")
            building_id = properties.get("building_id")
            if not isinstance(building_id, str) or not building_id.strip():
                raise ContractError("building_id must be a non-empty string")
            if building_id in seen_ids:
                raise ContractError(f"duplicate building_id {building_id}")
            coordinates = geometry.get("coordinates")
            if not isinstance(coordinates, list) or not coordinates:
                raise ContractError("Polygon.coordinates must contain an outer ring")
            outer, repairs = _clean_ring(coordinates[0], transform, True)
            holes: list[tuple[tuple[float, float], ...]] = []
            for hole_coordinates in coordinates[1:]:
                hole, hole_repairs = _clean_ring(
                    hole_coordinates, transform, False
                )
                holes.append(hole)
                repairs.extend(hole_repairs)
            centroid = _centroid(outer)
            if abs(centroid[0]) > half_aoi or abs(centroid[1]) > half_aoi:
                report["outsideAoi"].append(building_id)
                continue
            source_ground = _height(
                properties,
                "ground_elevation_meters",
                "ground_elevation_us_survey_ft",
            )
            ground = normalize_ground_elevation(source_ground, config, source)
            roof = _height(
                properties,
                "roof_height_meters",
                "height_roof_us_survey_ft",
            )
            if roof <= 0:
                raise ContractError("roof height must be greater than zero")
            floor_count = properties.get("floor_count", 0)
            year_built = properties.get("year_built", 0)
            if isinstance(floor_count, bool) or not isinstance(floor_count, int) or floor_count < 0:
                raise ContractError("floor_count must be a non-negative integer")
            if isinstance(year_built, bool) or not isinstance(year_built, int) or year_built < 0:
                raise ContractError("year_built must be a non-negative integer")
            land_use = properties.get("land_use", "")
            if not isinstance(land_use, str):
                raise ContractError("land_use must be a string")
            building = NormalizedBuilding(
                building_id=building_id,
                centroid_meters=(round(centroid[0], 6), round(centroid[1], 6)),
                outer=outer,
                holes=tuple(holes),
                source_ground_elevation_meters=round(source_ground, 6),
                ground_elevation_meters=round(ground, 6),
                roof_height_meters=round(roof, 6),
                floor_count=floor_count,
                year_built=year_built,
                land_use=land_use,
                variation_seed=deterministic_seed(building_id),
                source_properties={key: properties[key] for key in sorted(properties)},
            )
            seen_ids.add(building_id)
            buildings.append(building)
            if repairs:
                report["repaired"].append(
                    {"buildingId": building_id, "actions": sorted(set(repairs))}
                )
        except ContractError as exc:
            report["invalid"].append({"record": label, "reason": str(exc)})

    buildings.sort(key=lambda building: building.building_id)
    report["normalized"] = len(buildings)
    if report["invalid"]:
        details = "; ".join(
            f"{row['record']}: {row['reason']}" for row in report["invalid"]
        )
        raise ContractError(f"normalization rejected invalid records: {details}")
    if not buildings:
        raise ContractError("normalization produced no buildings inside the AOI")

    document = {
        "schemaVersion": 1,
        "generatedBy": GENERATOR_VERSION,
        "sourceId": source.source_id,
        "sourceSha256": source.sha256,
        "coordinateSpace": "hq-local-meters",
        "axisConvention": config.axis_convention,
        "verticalReference": source_vertical_reference,
        "aoiSizeMeters": config.aoi_size_meters,
        "buildings": [building.as_json() for building in buildings],
        "report": report,
    }
    return document, buildings


def normalized_document_sha256(document: dict[str, Any]) -> str:
    """Hash the canonical normalized document used to derive tile products."""

    try:
        canonical = json.dumps(
            document,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        ) + "\n"
    except (TypeError, ValueError) as exc:
        raise ContractError("normalized document cannot be canonically hashed") from exc
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _loaded_ring(value: Any, label: str, want_counter_clockwise: bool) -> tuple[tuple[float, float], ...]:
    if not isinstance(value, list) or len(value) < 3:
        raise ContractError(f"{label} must contain at least three points")
    points: list[tuple[float, float]] = []
    for index, point in enumerate(value):
        if not isinstance(point, list) or len(point) != 2:
            raise ContractError(f"{label}[{index}] must contain exactly two numbers")
        points.append(
            (
                _finite_number(point[0], f"{label}[{index}][0]"),
                _finite_number(point[1], f"{label}[{index}][1]"),
            )
        )
    ring = tuple(points)
    if len(set(ring)) != len(ring):
        raise ContractError(f"{label} must not repeat vertices")
    if _has_self_intersection(ring):
        raise ContractError(f"{label} self-intersects")
    area = _signed_area(ring)
    if abs(area) < 1e-6:
        raise ContractError(f"{label} has zero area")
    if (area > 0) != want_counter_clockwise:
        winding = "counter-clockwise" if want_counter_clockwise else "clockwise"
        raise ContractError(f"{label} must be {winding}")
    return ring


def building_from_json(raw: Any) -> NormalizedBuilding:
    if not isinstance(raw, dict):
        raise ContractError("normalized building must be an object")
    footprint = raw.get("footprintMeters")
    if not isinstance(footprint, dict):
        raise ContractError("normalized building footprintMeters must be an object")
    outer_raw = footprint.get("outer")
    holes_raw = footprint.get("holes")
    if not isinstance(holes_raw, list):
        raise ContractError("normalized building holes must be an array")

    centroid = raw.get("centroidMeters")
    if not isinstance(centroid, list) or len(centroid) != 2:
        raise ContractError("normalized centroidMeters must contain two numbers")
    building_id = raw.get("buildingId")
    if not isinstance(building_id, str) or not building_id:
        raise ContractError("normalized buildingId must be a non-empty string")
    floor_count = raw.get("floorCount")
    year_built = raw.get("yearBuilt")
    variation_seed = raw.get("variationSeed")
    if isinstance(floor_count, bool) or not isinstance(floor_count, int) or floor_count < 0:
        raise ContractError("normalized floorCount must be a non-negative integer")
    if isinstance(year_built, bool) or not isinstance(year_built, int) or year_built < 0:
        raise ContractError("normalized yearBuilt must be a non-negative integer")
    if (
        isinstance(variation_seed, bool)
        or not isinstance(variation_seed, int)
        or not 0 <= variation_seed <= 0xFFFFFFFF
    ):
        raise ContractError("normalized variationSeed must be an unsigned 32-bit integer")
    land_use = raw.get("landUse")
    if not isinstance(land_use, str):
        raise ContractError("normalized landUse must be a string")
    source_properties = raw.get("sourceProperties")
    if not isinstance(source_properties, dict):
        raise ContractError("normalized sourceProperties must be an object")
    roof_height = _finite_number(raw.get("roofHeightMeters"), "normalized roofHeightMeters")
    if roof_height <= 0:
        raise ContractError("normalized roofHeightMeters must be greater than zero")
    return NormalizedBuilding(
        building_id=building_id,
        centroid_meters=(
            _finite_number(centroid[0], "normalized centroidMeters[0]"),
            _finite_number(centroid[1], "normalized centroidMeters[1]"),
        ),
        outer=_loaded_ring(outer_raw, "normalized outer ring", True),
        holes=tuple(
            _loaded_ring(ring, f"normalized hole ring {index}", False)
            for index, ring in enumerate(holes_raw)
        ),
        source_ground_elevation_meters=_finite_number(
            raw.get("sourceGroundElevationMeters"),
            "normalized sourceGroundElevationMeters",
        ),
        ground_elevation_meters=_finite_number(
            raw.get("groundElevationMeters"), "normalized groundElevationMeters"
        ),
        roof_height_meters=roof_height,
        floor_count=floor_count,
        year_built=year_built,
        land_use=land_use,
        variation_seed=variation_seed,
        source_properties=source_properties,
    )


def load_normalized(path: Path) -> tuple[dict[str, Any], list[NormalizedBuilding]]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ContractError(f"normalized input does not exist: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ContractError(f"invalid normalized JSON at {path}: {exc}") from exc
    if not isinstance(document, dict) or document.get("schemaVersion") != 1:
        raise ContractError("normalized document must have schemaVersion 1")
    raw_buildings = document.get("buildings")
    if not isinstance(raw_buildings, list) or not raw_buildings:
        raise ContractError("normalized document must contain buildings")
    buildings = [building_from_json(raw) for raw in raw_buildings]
    ids = [building.building_id for building in buildings]
    if ids != sorted(ids) or len(ids) != len(set(ids)):
        raise ContractError("normalized buildings must have unique, sorted IDs")
    return document, buildings
