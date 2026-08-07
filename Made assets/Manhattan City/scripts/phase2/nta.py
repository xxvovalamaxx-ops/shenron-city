"""
nta.py -- shared Manhattan boundary test, backed by the city's own polygons.

Several Phase 2 steps need to answer "is this point on Manhattan?" -- district
assignment, sidewalk filtering, street furniture placement. Doing it by
bounding box does not work: a rectangle around Manhattan also contains Long
Island City, Williamsburg, Hoboken and most of the south Bronx, and using one
silently pulled 74 km2 of sidewalk into a 59 km2 borough.

Loads NYC Open Data 9nt8-h7nd, the 2020 Neighborhood Tabulation Areas.
"""

import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
NYC = os.path.join(ROOT, "source_data", "nyc")

NTA_TYPE = {
    "0": "neighborhood", "5": "park", "6": "special", "9": "park_water",
}


def load(path=None):
    """Return a list of NTA records with cooked rings and a bbox, or None."""
    path = path or os.path.join(NYC, "nta.json")
    if not os.path.exists(path):
        return None
    raw = json.load(open(path, encoding="utf-8"))
    out = []
    for r in raw:
        g = r.get("the_geom") or {}
        if g.get("type") == "Polygon":
            polys = [g["coordinates"]]
        elif g.get("type") == "MultiPolygon":
            polys = g["coordinates"]
        else:
            continue
        x0 = y0 = 1e18
        x1 = y1 = -1e18
        cooked = []
        for poly in polys:
            rings = []
            for ring in poly:
                pts = [(float(p[0]), float(p[1])) for p in ring]
                rings.append(pts)
                for px, py in pts:
                    x0 = min(x0, px); x1 = max(x1, px)
                    y0 = min(y0, py); y1 = max(y1, py)
            if rings:
                cooked.append(rings)
        if not cooked:
            continue
        out.append({
            "id": r.get("nta2020", ""),
            "name": r.get("ntaname", ""),
            "type": NTA_TYPE.get(str(r.get("ntatype", "0")), "other"),
            "cdta": r.get("cdtaname", ""),
            "polys": cooked,
            "bbox": (x0, y0, x1, y1),
        })
    return out


def in_ring(x, y, ring):
    """Even-odd crossing test. Boundary handling is arbitrary but stable."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y):
            t = (y - yi) / (yj - yi)
            if x < xi + t * (xj - xi):
                inside = not inside
        j = i
    return inside


def in_nta(x, y, nta):
    x0, y0, x1, y1 = nta["bbox"]
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    for rings in nta["polys"]:
        if not in_ring(x, y, rings[0]):
            continue
        for hole in rings[1:]:
            if in_ring(x, y, hole):
                break
        else:
            return True
    return False


def find(lon, lat, ntas, hint=None):
    """Return the NTA containing (lon, lat), or None.

    `hint` is the last match: consecutive queries are usually on the same
    block, so testing it first turns a 38-polygon scan into one test.
    """
    if hint is not None and in_nta(lon, lat, hint):
        return hint
    for nt in ntas:
        if in_nta(lon, lat, nt):
            return nt
    return None
