"""
50_streets.py -- Phase 2E: build the street layer in Blender.

    blender -b --factory-startup --python scripts/phase2/50_streets.py

Reads the caches written by 47_build_streets.py and authors, in Blender:

  sidewalks     the surveyed planimetric kerb line, extruded to a 150 mm kerb.
                Polygons carry holes (block interiors, roadways), so they are
                tessellated with mathutils.geometry.tessellate_polygon rather
                than fanned -- fanning a ring turns the block interior into
                pavement.
  road markings lane dividers, double-yellow centre lines on two-way streets,
                zebra crosswalks and stop bars at every junction, all driven
                by LION's own lane count and direction of travel.

Everything lands in a *separate* file, blend/manhattan_streets.blend, and
exports to its own tile set. Phase 1's manhattan_world.blend is frozen and is
never opened for writing. The split is also the right runtime shape: kerbs and
paint only matter within a few hundred metres of the camera, while the massing
has to be visible across the island.

Heights, relative to Phase 1's constants:
    road surface   LAND_LEVEL + 0.05   (set by 22_roads.py)
    paint          road + 0.03
    sidewalk top   road + 0.15
"""

import json
import math
import os
import sys
import time
from collections import defaultdict

import bpy
import bmesh
from mathutils.geometry import tessellate_polygon

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402

ROOT = os.path.dirname(SCRIPTS)
STREETS = os.path.join(ROOT, "data", "manhattan", "streets")
DOCS = os.path.join(ROOT, "docs", "phase2")

TILE = 1400.0
ROAD_Z = bc.LAND_LEVEL + 0.05
PAINT_Z = ROAD_Z + 0.03
KERB_H = 0.15
WALK_Z = ROAD_Z + KERB_H

# markings
LANE_W = 0.12           # painted line width
DASH_ON = 3.0
DASH_OFF = 6.0
XWALK_SETBACK = 5.5     # from the junction node to the near edge of the zebra
XWALK_DEPTH = 3.2
XWALK_BAR = 0.55
XWALK_GAP = 0.55
STOPBAR_D = 0.45

COL_WALK = "20_sidewalks"
COL_PAINT = "21_roadmarks"


# ---------------------------------------------------------------------------
def fresh_collection(name):
    c = bpy.data.collections.get(name)
    if c is not None:
        for o in list(c.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        return c
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def material(name, rgb, rough=0.85):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (300, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)
    # Constant base colour on purpose: a node graph here would export to glTF
    # as white, which is exactly the bug that made the Phase 1 ground blow out.
    bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def tile_of(x, y):
    return (int(math.floor(x / TILE)), int(math.floor(y / TILE)))


def tile_name(prefix, tx, ty):
    return "%s_%+03d_%+03d" % (prefix, tx, ty)


class MeshBuilder:
    """Accumulates triangles per tile, then emits one object per tile."""

    def __init__(self, prefix, collection, mat):
        self.prefix = prefix
        self.collection = collection
        self.mat = mat
        self.tiles = defaultdict(lambda: {"v": [], "f": []})

    def add_tri(self, key, a, b, c):
        t = self.tiles[key]
        i = len(t["v"])
        t["v"].extend((a, b, c))
        t["f"].append((i, i + 1, i + 2))

    def add_quad(self, key, a, b, c, d):
        t = self.tiles[key]
        i = len(t["v"])
        t["v"].extend((a, b, c, d))
        t["f"].append((i, i + 1, i + 2, i + 3))

    def emit(self):
        objs = []
        for (tx, ty), t in sorted(self.tiles.items()):
            if not t["f"]:
                continue
            me = bpy.data.meshes.new(tile_name(self.prefix, tx, ty))
            me.from_pydata(t["v"], [], t["f"])
            me.validate(verbose=False)
            me.polygons.foreach_set("use_smooth", [False] * len(me.polygons))
            me.update()
            me.materials.append(self.mat)
            ob = bpy.data.objects.new(me.name, me)
            self.collection.objects.link(ob)
            objs.append(ob)
        return objs

    def stats(self):
        return (len(self.tiles),
                sum(len(t["v"]) for t in self.tiles.values()),
                sum(len(t["f"]) for t in self.tiles.values()))


# ---------------------------------------------------------------------------
# sidewalks
# ---------------------------------------------------------------------------
def build_sidewalks(col):
    path = os.path.join(STREETS, "sidewalk_geom.json")
    if not os.path.exists(path):
        print("[walk] missing %s -- run 47_build_streets.py" % path)
        return None, {}
    data = json.load(open(path, encoding="utf-8"))
    polys = data["polygons"]

    mat = material("MAT_sidewalk", (0.128, 0.125, 0.118), 0.88)
    top = MeshBuilder("SIDEWALK", col, mat)
    stats = defaultdict(int)

    for rings in polys:
        outer = rings[0]["pts"]
        holes = [r["pts"] for r in rings[1:]]
        if len(outer) < 3:
            continue

        # tessellate_polygon takes the outer contour first, then holes, and
        # returns index triples into the concatenated list
        contours = [[(p[0], p[1], 0.0) for p in outer]]
        for h in holes:
            if len(h) >= 3:
                contours.append([(p[0], p[1], 0.0) for p in h])
        flat = [p for c in contours for p in c]
        try:
            tris = tessellate_polygon(contours)
        except Exception as e:                       # pragma: no cover
            stats["tessellate_failed"] += 1
            print("[walk] tessellate failed on a %d-vertex ring: %s"
                  % (len(outer), e))
            continue
        if not tris:
            stats["tessellate_empty"] += 1
            continue

        # A polygon can straddle a tile boundary. Assign each triangle by its
        # own centroid rather than the polygon's, or a block-long sidewalk
        # ends up entirely in one tile and pops in from the wrong distance.
        for a, b, c in tris:
            pa, pb, pc = flat[a], flat[b], flat[c]
            cx = (pa[0] + pb[0] + pc[0]) / 3.0
            cy = (pa[1] + pb[1] + pc[1]) / 3.0
            key = tile_of(cx, cy)
            top.add_tri(key,
                        (pa[0], pa[1], WALK_Z),
                        (pb[0], pb[1], WALK_Z),
                        (pc[0], pc[1], WALK_Z))
            stats["tris"] += 1

        # kerb: a vertical band under every ring edge, so the pavement has a
        # visible 150 mm lip instead of floating
        for ri, ring in enumerate(rings):
            pts = ring["pts"]
            n = len(pts)
            for i in range(n):
                x0, y0 = pts[i]
                x1, y1 = pts[(i + 1) % n]
                if abs(x1 - x0) < 1e-6 and abs(y1 - y0) < 1e-6:
                    continue
                key = tile_of((x0 + x1) * 0.5, (y0 + y1) * 0.5)
                top.add_quad(key,
                             (x0, y0, ROAD_Z), (x1, y1, ROAD_Z),
                             (x1, y1, WALK_Z), (x0, y0, WALK_Z))
                stats["kerb_quads"] += 1

    stats["polygons"] = len(polys)
    return top, stats


# ---------------------------------------------------------------------------
# road markings
# ---------------------------------------------------------------------------
def _unit(ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    d = math.hypot(dx, dy)
    if d < 1e-9:
        return 0.0, 0.0, 0.0
    return dx / d, dy / d, d


def _band(mb, cx, cy, ux, uy, length, width, z=PAINT_Z):
    """A rectangle centred at (cx, cy), `length` along (ux, uy)."""
    px, py = -uy, ux
    hl, hw = length * 0.5, width * 0.5
    a = (cx - ux * hl - px * hw, cy - uy * hl - py * hw, z)
    b = (cx + ux * hl - px * hw, cy + uy * hl - py * hw, z)
    c = (cx + ux * hl + px * hw, cy + uy * hl + py * hw, z)
    d = (cx - ux * hl + px * hw, cy - uy * hl + py * hw, z)
    mb.add_quad(tile_of(cx, cy), a, b, c, d)


def _dashed(mb, ax, ay, bx, by, offset, width):
    """Dashed line parallel to the segment, `offset` metres to its left."""
    ux, uy, d = _unit(ax, ay, bx, by)
    if d < DASH_ON:
        return 0
    px, py = -uy, ux
    sx, sy = ax + px * offset, ay + py * offset
    n = 0
    t = DASH_OFF * 0.5
    while t + DASH_ON < d:
        cx = sx + ux * (t + DASH_ON * 0.5)
        cy = sy + uy * (t + DASH_ON * 0.5)
        _band(mb, cx, cy, ux, uy, DASH_ON, width)
        n += 1
        t += DASH_ON + DASH_OFF
    return n


def _solid(mb, ax, ay, bx, by, offset, width):
    ux, uy, d = _unit(ax, ay, bx, by)
    if d < 0.5:
        return 0
    px, py = -uy, ux
    # split long runs so a marking never spans more than one tile badly
    step = 40.0
    n = 0
    t = 0.0
    while t < d:
        seg = min(step, d - t)
        cx = ax + px * offset + ux * (t + seg * 0.5)
        cy = ay + py * offset + uy * (t + seg * 0.5)
        _band(mb, cx, cy, ux, uy, seg, width)
        n += 1
        t += seg
    return n


def build_markings(col, graph):
    white = material("MAT_line_white", (0.62, 0.61, 0.58), 0.62)
    yellow = material("MAT_line_yellow", (0.52, 0.36, 0.05), 0.62)

    mw = MeshBuilder("ROADMARK_W", col, white)
    my = MeshBuilder("ROADMARK_Y", col, yellow)
    stats = defaultdict(int)

    edges = graph["edges"]
    nodes = graph["nodes"]
    deg = graph["node_degree"]

    for e in edges:
        if not e["drivable"] or e["kind"] in ("driveway", "uturn"):
            continue
        lanes = max(1, e["lanes"])
        width = e["width"]
        pts = e["pts"]

        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]

            if e["oneway"] == 0 and lanes >= 2:
                # double yellow on the centreline
                stats["yellow"] += _solid(my, ax, ay, bx, by, 0.16, LANE_W)
                stats["yellow"] += _solid(my, ax, ay, bx, by, -0.16, LANE_W)
                per_side = max(1, lanes // 2)
                lane_w = (width * 0.5) / per_side
                for k in range(1, per_side):
                    stats["white"] += _dashed(mw, ax, ay, bx, by,
                                              k * lane_w, LANE_W)
                    stats["white"] += _dashed(mw, ax, ay, bx, by,
                                              -k * lane_w, LANE_W)
            elif lanes >= 2:
                # one-way: dashed dividers across the full carriageway
                lane_w = width / lanes
                for k in range(1, lanes):
                    off = -width * 0.5 + k * lane_w
                    stats["white"] += _dashed(mw, ax, ay, bx, by, off, LANE_W)

            # edge lines, set in from the kerb by the parking lane if any
            inset = 0.35
            stats["white"] += _solid(mw, ax, ay, bx, by,
                                     width * 0.5 - inset, LANE_W)
            stats["white"] += _solid(mw, ax, ay, bx, by,
                                     -(width * 0.5 - inset), LANE_W)

    # ---- crosswalks and stop bars -----------------------------------------
    incident = defaultdict(list)
    for e in edges:
        if not e["drivable"] or e["kind"] in ("driveway", "uturn", "tunnel"):
            continue
        incident[e["a"]].append((e, False))
        incident[e["b"]].append((e, True))

    for ni, inc in incident.items():
        if deg[ni] < 3 or len(inc) < 2:
            continue
        nx, ny = nodes[ni]
        for e, reversed_ in inc:
            pts = e["pts"]
            if reversed_:
                p0, p1 = pts[-1], pts[-2]
            else:
                p0, p1 = pts[0], pts[1]
            ux, uy, d = _unit(p0[0], p0[1], p1[0], p1[1])
            if d < XWALK_SETBACK + XWALK_DEPTH + 4.0:
                stats["xwalk_too_short"] += 1
                continue

            width = e["width"]
            # zebra bars run *along* the direction of travel, banded across
            nbars = max(3, int(width / (XWALK_BAR + XWALK_GAP)))
            span = nbars * (XWALK_BAR + XWALK_GAP) - XWALK_GAP
            px, py = -uy, ux
            base = nx + ux * (XWALK_SETBACK + XWALK_DEPTH * 0.5)
            basey = ny + uy * (XWALK_SETBACK + XWALK_DEPTH * 0.5)
            start = -span * 0.5 + XWALK_BAR * 0.5
            for k in range(nbars):
                off = start + k * (XWALK_BAR + XWALK_GAP)
                cx = base + px * off
                cy = basey + py * off
                _band(mw, cx, cy, ux, uy, XWALK_DEPTH, XWALK_BAR)
                stats["xwalk_bars"] += 1

            # stop bar just beyond the crossing
            sx = nx + ux * (XWALK_SETBACK + XWALK_DEPTH + 0.8)
            sy = ny + uy * (XWALK_SETBACK + XWALK_DEPTH + 0.8)
            bar_w = width if e["oneway"] else width * 0.5
            boff = 0.0 if e["oneway"] else width * 0.25
            _band(mw, sx + px * boff, sy + py * boff, ux, uy,
                  STOPBAR_D, bar_w)
            stats["stop_bars"] += 1

    return mw, my, stats


# ---------------------------------------------------------------------------
def main():
    t0 = time.time()
    bpy.ops.wm.read_homefile(use_empty=True)

    gpath = os.path.join(STREETS, "street_graph.json")
    if not os.path.exists(gpath):
        print("missing %s -- run 47_build_streets.py first" % gpath)
        return 2
    graph = json.load(open(gpath, encoding="utf-8"))

    cw = fresh_collection(COL_WALK)
    cp = fresh_collection(COL_PAINT)

    print("=" * 74)
    print("PHASE 2E  STREET LAYER (Blender)")
    print("=" * 74)

    walk, wstats = build_sidewalks(cw)
    if walk is None:
        return 2
    wobjs = walk.emit()
    wt, wv, wf = walk.stats()
    print("  sidewalks  : %d polygons -> %d tiles, %d verts, %d faces"
          % (wstats["polygons"], len(wobjs), wv, wf))
    print("               %d surface tris, %d kerb quads"
          % (wstats["tris"], wstats["kerb_quads"]))
    if wstats.get("tessellate_failed"):
        print("               %d polygons FAILED to tessellate"
              % wstats["tessellate_failed"])

    mw, my, mstats = build_markings(cp, graph)
    mwobjs = mw.emit()
    myobjs = my.emit()
    _, mwv, mwf = mw.stats()
    _, myv, myf = my.stats()
    print("  markings   : %d white objs (%d faces), %d yellow objs (%d faces)"
          % (len(mwobjs), mwf, len(myobjs), myf))
    print("               %d crosswalk bars, %d stop bars, %d skipped approaches"
          % (mstats["xwalk_bars"], mstats["stop_bars"],
             mstats["xwalk_too_short"]))

    os.makedirs(bc.BLEND, exist_ok=True)
    out = os.path.join(bc.BLEND, "manhattan_streets.blend")
    bpy.ops.wm.save_as_mainfile(filepath=out)

    report = {
        "sidewalk_polygons": wstats["polygons"],
        "sidewalk_objects": len(wobjs),
        "sidewalk_verts": wv,
        "sidewalk_faces": wf,
        "sidewalk_surface_tris": wstats["tris"],
        "kerb_quads": wstats["kerb_quads"],
        "tessellate_failed": wstats.get("tessellate_failed", 0),
        "marking_objects": len(mwobjs) + len(myobjs),
        "marking_faces": mwf + myf,
        "crosswalk_bars": mstats["xwalk_bars"],
        "stop_bars": mstats["stop_bars"],
        "approaches_too_short": mstats["xwalk_too_short"],
        "heights": {"road_z": ROAD_Z, "paint_z": PAINT_Z,
                    "sidewalk_z": WALK_Z, "kerb_h": KERB_H},
        "blend": os.path.relpath(out, ROOT),
        "seconds": round(time.time() - t0, 1),
    }
    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "STREET_BUILD_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    print("-" * 74)
    print("  total faces: %d" % (wf + mwf + myf))
    print("  saved      : %s  (%.0fs)"
          % (os.path.relpath(out, ROOT), time.time() - t0))
    print("=" * 74)
    return 0


if __name__ == "__main__":
    main()
