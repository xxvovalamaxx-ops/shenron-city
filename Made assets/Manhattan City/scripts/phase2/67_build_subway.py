"""
67_build_subway.py -- Phase 2N: place the subway entrances, and tell the
demand field about them.

    python scripts/phase2/67_build_subway.py

66_subway.py authors two entrances. This decides where they go and what they
mean.

Placement is not "drop a kiosk at the published coordinate". The MTA's point
is somewhere near the entrance, not on the pavement centreline, and a 3.4 m
kiosk dropped on a raw coordinate lands in the carriageway about as often as
not. Each point is snapped to the nearest walk lane that is wide enough to
hold it, and rotated to that lane's direction so the stair runs along the kerb
instead of across it. Anything that cannot be placed is reported rather than
nudged until it fits.

Not every entrance gets a kiosk. The dataset's own entrance_type says which
are street furniture and which are a door in somebody's lobby:

    Stair, Stair/Escalator, Escalator, Elevator     street furniture
    Easement - Street, Easement - Passage           a doorway or a passage
    Station House                                   a building

The second and third groups still generate footfall -- people come out of
them -- so they count towards demand even though nothing is drawn.

Outputs
    data/manhattan/subway/subway.json    what to draw, and where
    data/manhattan/subway/footfall.json  per 200 m cell, for the demand field
"""

import json
import math
import os
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(ROOT, "source_data", "nyc", "subway_entrances.json")
WALK = os.path.join(ROOT, "data", "manhattan", "streets", "walk_graph.json")
OUT_DIR = os.path.join(ROOT, "data", "manhattan", "subway")
DOCS = os.path.join(ROOT, "docs", "phase2")

# same tangent plane as blender_common.ll2xy
LAT0, LON0 = 40.7800, -73.9680
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))

CELL = 200.0
SNAP_R = 55.0            # how far a published point may be from a pavement
STAIR_W = 3.40           # the kiosk footprint, across the pavement
ELEV_W = 2.20

DRAWN = {"Stair": "stair", "Stair/Escalator": "stair", "Escalator": "stair",
         "Elevator": "elevator"}
# these generate footfall but have no street furniture of their own
UNDRAWN = {"Easement - Street", "Easement - Passage", "Station House"}


def ll2xy(lat, lon):
    return ((lon - LON0) * M_LON, (lat - LAT0) * M_LAT)


def seg_project(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 <= 1e-9 else max(0.0, min(1.0,
                                            ((px - ax) * vx + (py - ay) * vy) / L2))
    cx, cy = ax + vx * t, ay + vy * t
    return math.hypot(px - cx, py - cy), cx, cy, t


def load_lanes():
    w = json.load(open(WALK))
    lanes = []
    for L in w["lanes"]:
        pts = L["pts"]
        wl = L.get("wl") or []
        wr = L.get("wr") or []
        lanes.append({
            "pts": pts, "w": L.get("w", 0.0), "wl": wl, "wr": wr,
            "nm": L.get("nm", ""),
        })
    return lanes


def free_width_at(lane, i, t):
    """Surveyed free width at the sampled vertex nearest the projection.

    Both sides are carried; the kiosk only needs one of them to be wide
    enough, because it stands against the building line or against the kerb,
    not in the middle."""
    k = min(len(lane["pts"]) - 1, i + (1 if t > 0.5 else 0))
    left = lane["wl"][k] if k < len(lane["wl"]) and lane["wl"][k] else 0.0
    right = lane["wr"][k] if k < len(lane["wr"]) and lane["wr"][k] else 0.0
    return max(left or 0.0, right or 0.0), (left or 0.0), (right or 0.0)


# Kiosks are 3.4 x 2.4 and 2.2 x 2.2, so centres closer than this collide at
# any orientation.
CLEAR = 3.0
GRID = 8.0
NUDGE_STEP = 1.0
NUDGE_MAX = 12.0


def _index(x, y, grid):
    grid.setdefault((int(x // GRID), int(y // GRID)), []).append((x, y))


def _clear(x, y, grid):
    gx, gy = int(x // GRID), int(y // GRID)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for (px, py) in grid.get((gx + dx, gy + dy), ()):
                if math.hypot(x - px, y - py) < CLEAR:
                    return False
    return True


def _declash(x, y, ang, grid):
    """Slide along the kerb line, alternating either way, until clear."""
    if _clear(x, y, grid):
        return x, y, False
    ux, uy = math.cos(ang), math.sin(ang)
    step = NUDGE_STEP
    while step <= NUDGE_MAX:
        for s in (step, -step):
            nx, ny = x + ux * s, y + uy * s
            if _clear(nx, ny, grid):
                return nx, ny, True
        step += NUDGE_STEP
    return None, None, False


def main():
    rows = json.load(open(SRC))
    lanes = load_lanes()
    print("=" * 74)
    print("PHASE 2N  SUBWAY ENTRANCES")
    print("=" * 74)
    print("  %d published entrances, %d walk lanes" % (len(rows), len(lanes)))

    kinds = Counter(r.get("entrance_type") for r in rows)
    complexes = defaultdict(list)

    placed = []
    grid = {}
    footfall = defaultdict(float)
    stats = Counter()
    offsets = []

    for r in rows:
        try:
            lat = float(r["entrance_latitude"])
            lon = float(r["entrance_longitude"])
        except (KeyError, TypeError, ValueError):
            stats["no_coordinate"] += 1
            continue
        x, y = ll2xy(lat, lon)
        kind = r.get("entrance_type") or ""
        cid = r.get("complex_id") or r.get("station_id")
        complexes[cid].append((x, y))

        # Footfall is generated by every entrance, drawn or not: people come
        # out of a lobby doorway the same as out of a stair.
        cx = math.floor(x / CELL)
        cy = math.floor(y / CELL)
        weight = 1.0 if kind in DRAWN else 0.55
        if r.get("entry_allowed") == "NO" or r.get("exit_allowed") == "NO":
            weight *= 0.6
        footfall["%d_%d" % (cx, cy)] += weight
        stats["footfall_points"] += 1

        mesh = DRAWN.get(kind)
        if not mesh:
            stats["not_drawn:" + (kind or "blank")] += 1
            continue

        need = STAIR_W if mesh == "stair" else ELEV_W
        best = None
        for lane in lanes:
            pts = lane["pts"]
            for i in range(len(pts) - 1):
                d, sx, sy, t = seg_project(x, y, pts[i][0], pts[i][1],
                                           pts[i + 1][0], pts[i + 1][1])
                if d > SNAP_R:
                    continue
                fw, _, _ = free_width_at(lane, i, t)
                if fw < need + 0.6:
                    continue
                if best is None or d < best[0]:
                    ang = math.atan2(pts[i + 1][1] - pts[i][1],
                                     pts[i + 1][0] - pts[i][0])
                    best = (d, sx, sy, ang, fw, lane["nm"])
        if best is None:
            stats["no_pavement_wide_enough"] += 1
            continue

        d, sx, sy, ang, fw, nm = best

        # A station complex publishes several entrances within a few metres of
        # each other, and each one snaps to the nearest pavement independently
        # -- so nine pairs came out overlapping and two landed at exactly the
        # same point. Slide along the kerb line until the kiosk clears its
        # neighbours; give up rather than stack them.
        sx, sy, bumped = _declash(sx, sy, ang, grid)
        if sx is None:
            stats["clashed"] += 1
            continue
        if bumped:
            stats["nudged"] += 1
        _index(sx, sy, grid)
        offsets.append(d)
        placed.append({
            "x": round(sx, 2), "y": round(sy, 2),
            "yaw": round(ang, 4),
            "mesh": mesh,
            "globe": 0 if r.get("entry_allowed") == "YES" else 1,
            "stop": r.get("stop_name", ""),
            "routes": r.get("daytime_routes", ""),
            "street": nm,
            "moved_m": round(d, 2),
            "free_w": round(fw, 2),
        })
        stats["drawn:" + mesh] += 1

    os.makedirs(OUT_DIR, exist_ok=True)
    offsets.sort()
    def q(p):
        return offsets[min(len(offsets) - 1, int(p * (len(offsets) - 1)))] \
            if offsets else 0.0

    out = {
        "generated_by": "scripts/phase2/67_build_subway.py",
        "source": "MTA Subway Entrances and Exits, data.ny.gov i9wp-a4ja",
        "projection": {"lat0": LAT0, "lon0": LON0},
        "count": len(placed),
        "entrances": placed,
    }
    with open(os.path.join(OUT_DIR, "subway.json"), "w") as fh:
        json.dump(out, fh)
    with open(os.path.join(OUT_DIR, "footfall.json"), "w") as fh:
        json.dump({"cell_m": CELL,
                   "cells": {k: round(v, 3) for k, v in footfall.items()},
                   "stations": len(complexes),
                   "points": stats["footfall_points"]}, fh)

    report = {
        "published": len(rows),
        "by_type": dict(kinds),
        "drawn": sum(v for k, v in stats.items() if k.startswith("drawn:")),
        "drawn_by_mesh": {k.split(":", 1)[1]: v for k, v in stats.items()
                          if k.startswith("drawn:")},
        "not_drawn": {k.split(":", 1)[1]: v for k, v in stats.items()
                      if k.startswith("not_drawn:")},
        "unplaceable": stats["no_pavement_wide_enough"],
        "clashed": stats["clashed"],
        "nudged_along_kerb": stats["nudged"],
        "min_separation_m": CLEAR,
        "no_coordinate": stats["no_coordinate"],
        "footfall_points": stats["footfall_points"],
        "footfall_cells": len(footfall),
        "station_complexes": len(complexes),
        "snap_offset_m": {
            "median": round(q(0.50), 2), "p90": round(q(0.90), 2),
            "max": round(offsets[-1], 2) if offsets else 0.0,
            "limit": SNAP_R,
        },
        "rule": "snapped to the nearest walk lane with a surveyed free width "
                "of at least the kiosk footprint plus 0.6 m, and rotated to "
                "that lane's direction",
    }
    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "SUBWAY_PLACEMENT.json"), "w") as fh:
        json.dump(report, fh, indent=2)

    print("-" * 74)
    for k, v in kinds.most_common():
        mark = "drawn" if k in DRAWN else "footfall only"
        print("    %-22s %4d   %s" % (k, v, mark))
    print("  placed    %d kiosks (%s)"
          % (report["drawn"],
             ", ".join("%s %d" % (k, v)
                       for k, v in report["drawn_by_mesh"].items())))
    print("  unplaced  %d had no pavement wide enough within %.0f m, "
          "%d could not clear a neighbour"
          % (report["unplaceable"], SNAP_R, report["clashed"]))
    print("  nudged    %d slid along the kerb to clear another kiosk"
          % report["nudged_along_kerb"])
    print("  moved     median %.1f m, p90 %.1f m, max %.1f m"
          % (report["snap_offset_m"]["median"], report["snap_offset_m"]["p90"],
             report["snap_offset_m"]["max"]))
    print("  footfall  %d points over %d cells, %d station complexes"
          % (report["footfall_points"], report["footfall_cells"],
             report["station_complexes"]))
    print("  -> %s" % os.path.relpath(os.path.join(OUT_DIR, "subway.json"),
                                      ROOT))


main()
