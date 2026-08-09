"""WGS84, HQ-local ENU, and existing Three.js-world transformations."""

from __future__ import annotations

import math

from .models import CityConfig

WGS84_A = 6_378_137.0
WGS84_F = 1.0 / 298.257223563
WGS84_E2 = WGS84_F * (2.0 - WGS84_F)
US_SURVEY_FOOT_METERS = 1200.0 / 3937.0


def us_survey_feet_to_meters(value: float) -> float:
    """Convert EPSG:2263 US survey feet to metres."""

    return float(value) * US_SURVEY_FOOT_METERS


def _geodetic_to_ecef(
    latitude_deg: float, longitude_deg: float, elevation_meters: float
) -> tuple[float, float, float]:
    latitude = math.radians(latitude_deg)
    longitude = math.radians(longitude_deg)
    sin_lat = math.sin(latitude)
    cos_lat = math.cos(latitude)
    normal = WGS84_A / math.sqrt(1.0 - WGS84_E2 * sin_lat * sin_lat)
    return (
        (normal + elevation_meters) * cos_lat * math.cos(longitude),
        (normal + elevation_meters) * cos_lat * math.sin(longitude),
        (normal * (1.0 - WGS84_E2) + elevation_meters) * sin_lat,
    )


def _ecef_to_geodetic(x: float, y: float, z: float) -> tuple[float, float, float]:
    longitude = math.atan2(y, x)
    radius = math.hypot(x, y)
    latitude = math.atan2(z, radius * (1.0 - WGS84_E2))
    elevation = 0.0
    for _ in range(12):
        sin_lat = math.sin(latitude)
        normal = WGS84_A / math.sqrt(1.0 - WGS84_E2 * sin_lat * sin_lat)
        cos_lat = math.cos(latitude)
        if abs(cos_lat) < 1e-15:
            elevation = abs(z) - normal * (1.0 - WGS84_E2)
        else:
            elevation = radius / cos_lat - normal
        denominator = radius * (1.0 - WGS84_E2 * normal / (normal + elevation))
        next_latitude = math.atan2(z, denominator)
        if abs(next_latitude - latitude) < 1e-14:
            latitude = next_latitude
            break
        latitude = next_latitude
    return math.degrees(latitude), math.degrees(longitude), elevation


class GeoTransform:
    """Convert WGS84 positions to HQ-local metres and current Three.js world."""

    def __init__(self, config: CityConfig):
        self.config = config
        anchor = config.hq_geo_anchor
        self._anchor_ecef = _geodetic_to_ecef(
            anchor.latitude, anchor.longitude, anchor.elevation_meters
        )
        latitude = math.radians(anchor.latitude)
        longitude = math.radians(anchor.longitude)
        self._east = (-math.sin(longitude), math.cos(longitude), 0.0)
        self._north = (
            -math.sin(latitude) * math.cos(longitude),
            -math.sin(latitude) * math.sin(longitude),
            math.cos(latitude),
        )
        self._up = (
            math.cos(latitude) * math.cos(longitude),
            math.cos(latitude) * math.sin(longitude),
            math.sin(latitude),
        )
        self._yaw = math.radians(config.north_yaw_degrees)

    @staticmethod
    def _dot(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

    def geographic_to_local(
        self, latitude: float, longitude: float, elevation_meters: float
    ) -> tuple[float, float, float]:
        ecef = _geodetic_to_ecef(latitude, longitude, elevation_meters)
        delta = tuple(ecef[i] - self._anchor_ecef[i] for i in range(3))
        return (
            self._dot(delta, self._east),
            self._dot(delta, self._north),
            self._dot(delta, self._up),
        )

    def local_to_geographic(
        self, east: float, north: float, up: float
    ) -> tuple[float, float, float]:
        ecef = tuple(
            self._anchor_ecef[i]
            + east * self._east[i]
            + north * self._north[i]
            + up * self._up[i]
            for i in range(3)
        )
        return _ecef_to_geodetic(*ecef)

    def local_to_world(
        self, east: float, north: float, up: float
    ) -> tuple[float, float, float]:
        scale = self.config.world_units_per_meter
        cosine = math.cos(self._yaw)
        sine = math.sin(self._yaw)
        origin = self.config.hq_world_position
        return (
            origin[0] + scale * (cosine * east + sine * north),
            origin[1] + up * scale,
            origin[2] + scale * (sine * east - cosine * north),
        )

    def world_to_local(
        self, world_x: float, world_y: float, world_z: float
    ) -> tuple[float, float, float]:
        origin = self.config.hq_world_position
        dx = world_x - origin[0]
        dz = world_z - origin[2]
        cosine = math.cos(self._yaw)
        sine = math.sin(self._yaw)
        scale = self.config.world_units_per_meter
        return (
            (cosine * dx + sine * dz) / scale,
            (sine * dx - cosine * dz) / scale,
            (world_y - origin[1]) / scale,
        )

    def geographic_to_world(
        self, latitude: float, longitude: float, elevation_meters: float
    ) -> tuple[float, float, float]:
        return self.local_to_world(
            *self.geographic_to_local(latitude, longitude, elevation_meters)
        )

    def world_to_geographic(
        self, world_x: float, world_y: float, world_z: float
    ) -> tuple[float, float, float]:
        return self.local_to_geographic(
            *self.world_to_local(world_x, world_y, world_z)
        )
