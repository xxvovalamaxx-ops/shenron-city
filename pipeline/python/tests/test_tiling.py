from __future__ import annotations

import unittest

from pipeline.python.city_pipeline.glb import (
    build_massing_glb,
    glb_building_ids,
    glb_position_bounds,
    triangulate_polygon,
)
from pipeline.python.city_pipeline.models import NormalizedBuilding, TileKey
from pipeline.python.city_pipeline.tiles import (
    _child_transform,
    assign_buildings,
    gltf_y_up_bounds_to_tile_z_up,
    tile_for_point,
)


def building(building_id: str, centroid: tuple[float, float], outer=None) -> NormalizedBuilding:
    x, y = centroid
    footprint = outer or ((x - 5, y - 5), (x + 5, y - 5), (x + 5, y + 5), (x - 5, y + 5))
    return NormalizedBuilding(
        building_id=building_id,
        centroid_meters=centroid,
        outer=tuple(footprint),
        holes=(),
        source_ground_elevation_meters=14.0,
        ground_elevation_meters=2.0,
        roof_height_meters=20.0,
        floor_count=6,
        year_built=1970,
        land_use="test",
        variation_seed=1,
        source_properties={},
    )


class TileTests(unittest.TestCase):
    def test_y_up_glb_bounds_become_z_up_tile_bounds(self) -> None:
        self.assertEqual(
            gltf_y_up_bounds_to_tile_z_up((-2.0, 3.0, -5.0, 7.0, 11.0, 13.0)),
            (-2.0, -13.0, 3.0, 7.0, 5.0, 11.0),
        )

    def test_child_transform_translates_east_and_north_in_z_up_tile_space(self) -> None:
        matrix = _child_transform(TileKey(-1, 2, 256))
        point = (3.0, 4.0, 5.0)
        transformed = tuple(
            matrix[row] * point[0]
            + matrix[4 + row] * point[1]
            + matrix[8 + row] * point[2]
            + matrix[12 + row]
            for row in range(3)
        )
        self.assertEqual(transformed, (-253.0, 516.0, 5.0))

    def test_floor_based_tile_edges_are_deterministic(self) -> None:
        cases = [
            ((0.0, 0.0), (0, 0)),
            ((255.999, 255.999), (0, 0)),
            ((256.0, 256.0), (1, 1)),
            ((-0.001, -0.001), (-1, -1)),
            ((-256.0, -256.0), (-1, -1)),
        ]
        for point, expected in cases:
            tile = tile_for_point(*point, 256.0)
            self.assertEqual((tile.tx, tile.ty), expected)

    def test_cross_boundary_building_has_one_centroid_owner(self) -> None:
        crossing = building(
            "crossing",
            (254.0, 40.0),
            ((240.0, 30.0), (270.0, 30.0), (270.0, 50.0), (240.0, 50.0)),
        )
        ownership = assign_buildings([crossing], 256.0)
        self.assertEqual(list(ownership), [TileKey(0, 0, 256)])
        self.assertEqual([item.building_id for item in ownership[TileKey(0, 0, 256)]], ["crossing"])

    def test_concave_polygon_triangulates_and_round_trips_glb_metadata(self) -> None:
        concave = ((0.0, 0.0), (30.0, 0.0), (30.0, 10.0), (12.0, 10.0), (12.0, 25.0), (0.0, 25.0))
        self.assertEqual(len(triangulate_polygon(concave)), len(concave) - 2)
        item = building("concave", (10.0, 10.0), concave)
        glb, metrics = build_massing_glb([item], TileKey(0, 0, 256))
        self.assertEqual(glb_building_ids(glb), ["concave"])
        self.assertEqual(glb_position_bounds(glb), metrics.bounds)


if __name__ == "__main__":
    unittest.main()
