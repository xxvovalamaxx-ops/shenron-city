from __future__ import annotations

import unittest
from dataclasses import replace
from pathlib import Path

from pipeline.python.city_pipeline.config import load_config
from pipeline.python.city_pipeline.geo import GeoTransform, us_survey_feet_to_meters
from pipeline.python.city_pipeline.tiles import _root_transform


REPO_ROOT = Path(__file__).resolve().parents[3]


class GeoTransformTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.transform = GeoTransform(load_config(REPO_ROOT / "data/config/manhattan-hq.json"))

    def test_hq_anchor_is_local_and_world_origin(self) -> None:
        config = self.transform.config
        anchor = config.hq_geo_anchor
        local = self.transform.geographic_to_local(
            anchor.latitude, anchor.longitude, anchor.elevation_meters
        )
        world = self.transform.geographic_to_world(
            anchor.latitude, anchor.longitude, anchor.elevation_meters
        )
        for actual in local:
            self.assertAlmostEqual(actual, 0.0, places=7)
        for actual, expected in zip(world, config.hq_world_position):
            self.assertAlmostEqual(actual, expected, places=7)

    def test_geo_local_world_round_trip(self) -> None:
        samples = [(-450.0, -375.0, -4.0), (0.0, 0.0, 0.0), (499.0, 421.0, 188.0)]
        for local in samples:
            geographic = self.transform.local_to_geographic(*local)
            local_again = self.transform.geographic_to_local(*geographic)
            world = self.transform.local_to_world(*local)
            world_again = self.transform.world_to_local(*world)
            for actual, expected in zip(local_again, local):
                self.assertAlmostEqual(actual, expected, places=5)
            for actual, expected in zip(world_again, local):
                self.assertAlmostEqual(actual, expected, places=9)

    def test_us_survey_foot_uses_exact_definition(self) -> None:
        self.assertEqual(us_survey_feet_to_meters(3937.0), 1200.0)
        self.assertAlmostEqual(us_survey_feet_to_meters(1.0), 0.3048006096012192)

    def test_positive_yaw_rotates_north_toward_positive_world_x(self) -> None:
        transform = GeoTransform(replace(self.transform.config, north_yaw_degrees=90.0))
        origin = transform.config.hq_world_position
        east_world = transform.local_to_world(1.0, 0.0, 0.0)
        north_world = transform.local_to_world(0.0, 1.0, 0.0)
        self.assertAlmostEqual(east_world[0] - origin[0], 0.0, places=9)
        self.assertAlmostEqual(east_world[2] - origin[2], 1.0, places=9)
        self.assertAlmostEqual(north_world[0] - origin[0], 1.0, places=9)
        self.assertAlmostEqual(north_world[2] - origin[2], 0.0, places=9)
        self.assertEqual(
            tuple(round(value, 9) for value in transform.world_to_local(*north_world)),
            (0.0, 1.0, 0.0),
        )
        matrix = _root_transform(transform.config)
        self.assertEqual(
            tuple(round(matrix[index], 9) for index in (0, 2, 4, 6, 8, 9, 10)),
            (0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0),
        )

    def test_root_transform_composes_z_up_tile_coordinates_into_game_world(self) -> None:
        for config in (
            self.transform.config,
            replace(self.transform.config, north_yaw_degrees=90.0),
            replace(
                self.transform.config,
                north_yaw_degrees=37.0,
                world_units_per_meter=1.5,
            ),
        ):
            transform = GeoTransform(config)
            matrix = _root_transform(config)
            for tile_point in ((0.0, 0.0, 0.0), (17.25, -8.5, 3.75)):
                actual = tuple(
                    matrix[row] * tile_point[0]
                    + matrix[4 + row] * tile_point[1]
                    + matrix[8 + row] * tile_point[2]
                    + matrix[12 + row]
                    for row in range(3)
                )
                expected = transform.local_to_world(*tile_point)
                for value, expected_value in zip(actual, expected):
                    self.assertAlmostEqual(value, expected_value, places=9)


if __name__ == "__main__":
    unittest.main()
