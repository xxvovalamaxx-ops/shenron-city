"""Load and validate the single Manhattan/HQ configuration contract."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from .models import CityConfig, ContractError, GeoAnchor


def _number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ContractError(f"{field} must be a finite number")
    result = float(value)
    if not math.isfinite(result):
        raise ContractError(f"{field} must be a finite number")
    return result


def _object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ContractError(f"{field} must be an object")
    return value


def parse_config(raw: Any) -> CityConfig:
    obj = _object(raw, "config")
    required = {
        "configVersion",
        "hqGeoAnchor",
        "hqWorldPosition",
        "northYawDegrees",
        "worldUnitsPerMeter",
        "aoiSizeMeters",
        "standardTileSizeMeters",
        "heroTileSizeMeters",
        "axisConvention",
        "anchorStatus",
        "anchorNote",
    }
    missing = sorted(required - obj.keys())
    if missing:
        raise ContractError(f"config missing required field(s): {', '.join(missing)}")

    version = obj["configVersion"]
    if isinstance(version, bool) or not isinstance(version, int) or version != 1:
        raise ContractError("configVersion must be integer 1")

    anchor_obj = _object(obj["hqGeoAnchor"], "hqGeoAnchor")
    latitude = _number(anchor_obj.get("latitude"), "hqGeoAnchor.latitude")
    longitude = _number(anchor_obj.get("longitude"), "hqGeoAnchor.longitude")
    elevation = _number(
        anchor_obj.get("elevationMeters"), "hqGeoAnchor.elevationMeters"
    )
    vertical_datum = anchor_obj.get("verticalDatum")
    if not isinstance(vertical_datum, str) or not vertical_datum.strip():
        raise ContractError("hqGeoAnchor.verticalDatum must be a non-empty string")
    if not -90.0 <= latitude <= 90.0:
        raise ContractError("hqGeoAnchor.latitude must be between -90 and 90")
    if not -180.0 <= longitude <= 180.0:
        raise ContractError("hqGeoAnchor.longitude must be between -180 and 180")

    world = obj["hqWorldPosition"]
    if not isinstance(world, list) or len(world) != 3:
        raise ContractError("hqWorldPosition must contain exactly three numbers")
    world_position = tuple(
        _number(value, f"hqWorldPosition[{index}]")
        for index, value in enumerate(world)
    )

    units = _number(obj["worldUnitsPerMeter"], "worldUnitsPerMeter")
    aoi = _number(obj["aoiSizeMeters"], "aoiSizeMeters")
    standard = _number(obj["standardTileSizeMeters"], "standardTileSizeMeters")
    hero = _number(obj["heroTileSizeMeters"], "heroTileSizeMeters")
    if units <= 0:
        raise ContractError("worldUnitsPerMeter must be greater than zero")
    if aoi <= 0 or standard <= 0 or hero <= 0:
        raise ContractError("AOI and tile sizes must be greater than zero")
    if standard != 256:
        raise ContractError("Phase 1 standardTileSizeMeters must be exactly 256")
    if hero > standard:
        raise ContractError("heroTileSizeMeters must not exceed the standard tile size")

    axis = obj["axisConvention"]
    if axis != "x-east-y-up-z-negative-north":
        raise ContractError(
            "axisConvention must be x-east-y-up-z-negative-north"
        )
    status = obj["anchorStatus"]
    note = obj["anchorNote"]
    if status not in {"provisional", "verified"}:
        raise ContractError("anchorStatus must be provisional or verified")
    if not isinstance(note, str) or not note.strip():
        raise ContractError("anchorNote must be a non-empty string")

    return CityConfig(
        config_version=version,
        hq_geo_anchor=GeoAnchor(latitude, longitude, elevation, vertical_datum),
        hq_world_position=world_position,  # type: ignore[arg-type]
        north_yaw_degrees=_number(obj["northYawDegrees"], "northYawDegrees"),
        world_units_per_meter=units,
        aoi_size_meters=aoi,
        standard_tile_size_meters=standard,
        hero_tile_size_meters=hero,
        axis_convention=axis,
        anchor_status=status,
        anchor_note=note,
    )


def load_config(path: Path) -> CityConfig:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ContractError(f"config file does not exist: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ContractError(f"invalid config JSON at {path}: {exc}") from exc
    return parse_config(raw)
