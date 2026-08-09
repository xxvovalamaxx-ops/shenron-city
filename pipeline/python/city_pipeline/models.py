"""Typed records shared by the city compiler.

The project intentionally stays on the Python standard library for this first
fixture.  Dataclasses make the validated boundary explicit without requiring a
runtime dependency merely to read a small JSON contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ContractError(ValueError):
    """A configuration, source, or generated artifact violated its contract."""


@dataclass(frozen=True)
class GeoAnchor:
    latitude: float
    longitude: float
    elevation_meters: float
    vertical_datum: str


@dataclass(frozen=True)
class CityConfig:
    config_version: int
    hq_geo_anchor: GeoAnchor
    hq_world_position: tuple[float, float, float]
    north_yaw_degrees: float
    world_units_per_meter: float
    aoi_size_meters: float
    standard_tile_size_meters: float
    hero_tile_size_meters: float
    axis_convention: str
    anchor_status: str
    anchor_note: str


@dataclass(frozen=True)
class SourceLockEntry:
    source_id: str
    dataset_name: str
    publisher: str
    version_or_retrieval_date: str
    source_file: Path
    sha256: str
    original_crs: str
    ground_elevation_vertical_datum: str
    ground_elevation_datum_relation: str
    license_note: str
    normalization_script_version: str


@dataclass(frozen=True)
class NormalizedBuilding:
    building_id: str
    centroid_meters: tuple[float, float]
    outer: tuple[tuple[float, float], ...]
    holes: tuple[tuple[tuple[float, float], ...], ...]
    source_ground_elevation_meters: float
    ground_elevation_meters: float
    roof_height_meters: float
    floor_count: int
    year_built: int
    land_use: str
    variation_seed: int
    source_properties: dict[str, Any]

    def as_json(self) -> dict[str, Any]:
        return {
            "buildingId": self.building_id,
            "centroidMeters": list(self.centroid_meters),
            "footprintMeters": {
                "outer": [list(point) for point in self.outer],
                "holes": [
                    [list(point) for point in ring]
                    for ring in self.holes
                ],
            },
            "sourceGroundElevationMeters": self.source_ground_elevation_meters,
            "groundElevationMeters": self.ground_elevation_meters,
            "roofHeightMeters": self.roof_height_meters,
            "floorCount": self.floor_count,
            "yearBuilt": self.year_built,
            "landUse": self.land_use,
            "variationSeed": self.variation_seed,
            "sourceProperties": self.source_properties,
        }


@dataclass(frozen=True, order=True)
class TileKey:
    tx: int
    ty: int
    size_meters: int

    @property
    def tile_id(self) -> str:
        def signed(value: int) -> str:
            return ("p" if value >= 0 else "m") + f"{abs(value):03d}"

        return f"{self.size_meters}_{signed(self.tx)}_{signed(self.ty)}"

    @property
    def origin_east(self) -> float:
        return self.tx * self.size_meters

    @property
    def origin_north(self) -> float:
        return self.ty * self.size_meters
