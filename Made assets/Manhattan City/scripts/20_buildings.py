"""
20_buildings.py — turn ~45k real OSM footprints into the Manhattan massing.

Runs inside Blender (headless via 99_build.py).

Approach
--------
Every building is an extruded real footprint, not a box on a grid. On top of the
raw extrusion the generator adds the things that actually make Manhattan read
from the air:

  * 1916-zoning style setbacks - the "wedding cake" profile. Towers step in
    two or three times, high-rises once. This is the single biggest cue that
    separates a real Manhattan skyline from a field of extruded polygons.
  * parapets on masonry low/mid-rise
  * rooftop mechanical penthouses on larger roofs
  * hexagonal timber water towers - nothing says New York rooftop faster
  * crowns/spires on the supertalls

Output is a small number of merged meshes (one per height band per spatial
tile) rather than 45k objects, because Blender's depsgraph falls over well
before 45k objects but handles a million verts in ~150 meshes without effort.

Per-building colour is baked into a FLOAT_COLOR corner attribute ("bcol") so
the whole city runs on a single facade material.
"""

import importlib
import math
import os
import pickle
import sys
import time

import bpy

SCRIPTS = r"D:\blender projects\Manheten\scripts"
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402
importlib.reload(bc)

COLOR_ATTR = "bcol"
TILE = 1400.0            # spatial chunk size in metres
GROUND = bc.LAND_LEVEL

CLS_SMALL, CLS_LOW, CLS_MID, CLS_HIGH, CLS_TOWER, CLS_GLASS, \
    CLS_INDUST, CLS_CIVIC = range(8)

# must stay in step with 02_process_osm.CLS_NAMES
CLS_NAMES = ["small", "lowrise", "midrise", "highrise",
             "tower", "glass", "industrial", "civic"]

# Two anchor colours per class (linear RGB) plus a metallic value.
#
# Buildings pick a point on the anchor->anchor line and then get a brightness
# multiplier. Jittering R/G/B independently (the obvious approach) decorrelates
# the channels and yields random pastel hues - lilac and mint skyscrapers -
# instead of a masonry family. Interpolating between two hand-picked anchors
# keeps every building inside a believable Manhattan palette.
PALETTE = {
    #            dark anchor                  light anchor              metal
    CLS_SMALL:  ((0.082, 0.058, 0.038), (0.205, 0.150, 0.096), 0.00),
    CLS_LOW:    ((0.086, 0.052, 0.029), (0.268, 0.178, 0.104), 0.00),
    CLS_MID:    ((0.102, 0.077, 0.052), (0.272, 0.218, 0.158), 0.00),
    CLS_HIGH:   ((0.122, 0.113, 0.101), (0.286, 0.266, 0.234), 0.05),
    CLS_TOWER:  ((0.162, 0.148, 0.126), (0.332, 0.303, 0.258), 0.05),
    CLS_GLASS:  ((0.021, 0.031, 0.049), (0.074, 0.097, 0.129), 0.55),
    CLS_INDUST: ((0.090, 0.084, 0.075), (0.204, 0.190, 0.169), 0.00),
    CLS_CIVIC:  ((0.184, 0.163, 0.132), (0.350, 0.315, 0.262), 0.00),
}

# height band -> destination collection
BANDS = [(0.0, 26.0, "05_lowrise"),
         (26.0, 90.0, "06_midrise"),
         (90.0, 1e9, "07_towers")]


# --------------------------------------------------------------------------
# polygon helpers
# --------------------------------------------------------------------------
def signed_area(pts):
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a * 0.5


def to_ccw(pts):
    return pts if signed_area(pts) >= 0 else pts[::-1]


def _segments_cross(a1, a2, b1, b2):
    """True when two segments properly cross (shared endpoints don't count)."""
    def orient(p, q, r):
        v = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1])
        return 0 if abs(v) < 1e-9 else (1 if v > 0 else 2)
    o1 = orient(a1, a2, b1)
    o2 = orient(a1, a2, b2)
    o3 = orient(b1, b2, a1)
    o4 = orient(b1, b2, a2)
    return o1 != o2 and o3 != o4


def self_intersects(poly):
    """
    Does the ring cross itself?

    This is the check that was missing. Insetting a concave footprint can fold
    it into a bowtie whose signed area is still positive and still a healthy
    fraction of the original, so area-based validation waves it through. Capped
    as an n-gon, a bowtie tessellates into the long triangular shards that were
    spiking out of roofs all over the city.
    """
    n = len(poly)
    if n < 4:
        return False
    for i in range(n):
        a1, a2 = poly[i], poly[(i + 1) % n]
        # skip the adjacent edge, and the wrap-around pair
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            if _segments_cross(a1, a2, poly[j], poly[(j + 1) % n]):
                return True
    return False


def offset_polygon(pts, d):
    """
    Inward offset of a CCW polygon by d metres, mitred at the corners.
    Returns None when the result collapses, inverts, folds an edge back on
    itself or self-intersects - each of which is the signal to stop stacking
    setbacks on that particular footprint.
    """
    n = len(pts)
    if n < 3 or d <= 0.0:
        return None
    lines = []
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy)
        if L < 1e-7:
            return None
        ux, uy = dx / L, dy / L
        nx, ny = -uy, ux                      # inward normal for CCW
        lines.append((x1 + nx * d, y1 + ny * d, ux, uy))

    out = []
    for i in range(n):
        px, py, ux, uy = lines[i - 1]
        qx, qy, vx, vy = lines[i]
        den = ux * vy - uy * vx
        if abs(den) < 1e-7:                   # near-parallel -> keep the point
            out.append((qx, qy))
        else:
            t = ((qx - px) * vy - (qy - py) * vx) / den
            ix, iy = px + ux * t, py + uy * t
            # Clamp blown-out mitres on sharp corners. The old limit of
            # 6*d+2 m let a 0.55 m parapet throw a 5 m spike off a small
            # footprint, which is most of why ordinary roofs looked skewed.
            if math.hypot(ix - qx, iy - qy) > d * 2.2 + 0.4:
                out.append((qx, qy))
            else:
                out.append((ix, iy))

    a0, a1 = signed_area(pts), signed_area(out)
    if a1 <= 0 or a1 < a0 * 0.16:
        return None

    # An edge that reversed direction means the outline folded through itself.
    # O(n) and catches the common collapse.
    n2 = len(out)
    for i in range(n2):
        j = (i + 1) % n2
        ax, ay = pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]
        bx, by = out[j][0] - out[i][0], out[j][1] - out[i][1]
        if ax * bx + ay * by < 0.0:
            return None

    # Concave rings can cross non-adjacent edges without any edge reversing,
    # which needs the full O(n^2) test. Footprints are capped at 64 verts so
    # the worst case is bounded and it runs once per setback stage.
    if self_intersects(out):
        return None
    return out


def bbox_of(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def principal_axis(ring):
    """
    Direction of the footprint's longest edge.

    Manhattan's street grid runs about 29 degrees off true north, so a
    world-axis-aligned rooftop box sits visibly skewed on essentially every
    building in the city. Orienting to the building's own longest edge is what
    makes roof plant look like it belongs to the roof.
    """
    best, bx, by = -1.0, 1.0, 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        if L2 > best:
            best, bx, by = L2, dx, dy
    L = math.sqrt(best) if best > 0 else 1.0
    return bx / L, by / L


def obb_of(ring, ux, uy):
    """Oriented bounding box in the (u, v) frame. Returns centre + half sizes."""
    vx, vy = -uy, ux
    us = [p[0] * ux + p[1] * uy for p in ring]
    vs = [p[0] * vx + p[1] * vy for p in ring]
    u0, u1 = min(us), max(us)
    v0, v1 = min(vs), max(vs)
    cu, cv = (u0 + u1) * 0.5, (v0 + v1) * 0.5
    cx = cu * ux + cv * vx
    cy = cu * uy + cv * vy
    return cx, cy, (u1 - u0), (v1 - v0)


def point_in_ring(x, y, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and \
           (x < (xj - xi) * (y - yi) / (yj - yi + 1e-30) + xi):
            inside = not inside
        j = i
    return inside


def footprint_fits(ring, cx, cy, ux, uy, sx, sy):
    """
    Is every part of an oriented box actually over the roof?

    Testing only the centre is not enough. The box is sized from the oriented
    bounding box, but on an L-shaped or cross-shaped footprint the OBB is much
    larger than the roof itself, so a centred box still hangs out over the
    notch - which is what read as plant floating beside buildings. Corners plus
    edge midpoints catch the overhang cheaply.
    """
    vx, vy = -uy, ux
    hx, hy = sx * 0.5, sy * 0.5
    for (a, c) in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy),
                   (0.0, -hy), (0.0, hy), (-hx, 0.0), (hx, 0.0)):
        if not point_in_ring(cx + a * ux + c * vx,
                             cy + a * uy + c * vy, ring):
            return False
    return True


# build-time counters so the roof-clutter fit can be measured, not assumed
CLUTTER = {"box_ok": 0, "box_shrunk": 0, "box_skipped": 0,
           "tower_ok": 0, "tower_shrunk": 0, "tower_skipped": 0,
           "mast_skipped": 0}


def fit_box(ring, cx, cy, ux, uy, sx, sy, min_size=1.8):
    """Shrink an oriented box until it sits entirely on the roof, or give up."""
    shrunk = False
    for _ in range(6):
        if footprint_fits(ring, cx, cy, ux, uy, sx, sy):
            CLUTTER["box_shrunk" if shrunk else "box_ok"] += 1
            return sx, sy
        sx *= 0.72
        sy *= 0.72
        shrunk = True
        if sx < min_size or sy < min_size:
            CLUTTER["box_skipped"] += 1
            return None
    CLUTTER["box_skipped"] += 1
    return None


def radius_fits(ring, cx, cy, r):
    """Does a small circular footprint clear the roof edge?"""
    for k in range(8):
        a = 2.0 * math.pi * k / 8.0
        if not point_in_ring(cx + r * math.cos(a),
                             cy + r * math.sin(a), ring):
            return False
    return True


def interior_point(ring, prefer):
    """
    A point guaranteed to sit on the roof.

    The bounding-box centre of an L-shaped or diagonal footprint is often
    outside the polygon, which is how roof boxes ended up hovering beside
    their buildings. Try the preferred point, then the centroid, then points
    pulled in from each vertex toward the centroid.
    """
    px, py = prefer
    if point_in_ring(px, py, ring):
        return px, py
    n = float(len(ring))
    gx = sum(p[0] for p in ring) / n
    gy = sum(p[1] for p in ring) / n
    if point_in_ring(gx, gy, ring):
        return gx, gy
    for t in (0.5, 0.3, 0.7):
        for (vx, vy) in ring:
            cx = gx + (vx - gx) * t
            cy = gy + (vy - gy) * t
            if point_in_ring(cx, cy, ring):
                return cx, cy
    return None


# --------------------------------------------------------------------------
# geometry emitters (append straight into flat buffers - fastest route)
# --------------------------------------------------------------------------
class Buf:
    __slots__ = ("V", "F", "C", "M", "BF", "BV", "rows")

    def __init__(self):
        self.V = []     # verts
        self.F = []     # faces (tuples of indices)
        self.C = []     # per-face rgba
        self.M = []     # per-face material slot
        self.BF = []    # per-face building id (int)
        self.BV = []    # per-vert building id (float, glTF-safe)
        self.rows = []  # per-building manifest records for this chunk

    def __len__(self):
        return len(self.V)


def emit_prism(buf, ring, z0, z1, wall_rgba, roof_rgba, cap=True):
    """Side walls + optional top cap for one closed ring."""
    n = len(ring)
    base = len(buf.V)
    for (x, y) in ring:
        buf.V.append((x, y, z0))
    for (x, y) in ring:
        buf.V.append((x, y, z1))
    for i in range(n):
        j = (i + 1) % n
        buf.F.append((base + i, base + j, base + n + j, base + n + i))
        buf.C.append(wall_rgba)
        buf.M.append(0)
    if cap:
        buf.F.append(tuple(base + n + i for i in range(n)))
        buf.C.append(roof_rgba)
        buf.M.append(1)


def emit_box(buf, cx, cy, sx, sy, z0, z1, rgba, mat=1, ux=1.0, uy=0.0):
    """Box oriented along (ux, uy) rather than the world axes."""
    vx, vy = -uy, ux
    hx, hy = sx * 0.5, sy * 0.5
    corners = ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))
    b = len(buf.V)
    for z in (z0, z1):
        for (a, c) in corners:
            buf.V.append((cx + a * ux + c * vx, cy + a * uy + c * vy, z))
    for f in ((b, b + 1, b + 5, b + 4), (b + 1, b + 2, b + 6, b + 5),
              (b + 2, b + 3, b + 7, b + 6), (b + 3, b, b + 4, b + 7),
              (b + 4, b + 5, b + 6, b + 7)):
        buf.F.append(f)
        buf.C.append(rgba)
        buf.M.append(mat)


def emit_water_tower(buf, cx, cy, z, r, rgba):
    """Hex tank on short legs with a conical cap - the NYC rooftop signature."""
    seg = 6
    leg = 1.6

    # The legs were described but never built, so the tank simply hovered
    # 1.6 m above the roof. Four posts, one per alternate hex corner.
    post = 0.22
    for k in range(0, seg, 2):
        a = 2 * math.pi * k / seg
        px = cx + (r * 0.82) * math.cos(a)
        py = cy + (r * 0.82) * math.sin(a)
        pb = len(buf.V)
        for zz in (z, z + leg):
            buf.V.extend([(px - post, py - post, zz), (px + post, py - post, zz),
                          (px + post, py + post, zz), (px - post, py + post, zz)])
        for f in ((pb, pb + 1, pb + 5, pb + 4), (pb + 1, pb + 2, pb + 6, pb + 5),
                  (pb + 2, pb + 3, pb + 7, pb + 6), (pb + 3, pb, pb + 4, pb + 7)):
            buf.F.append(f)
            buf.C.append(rgba)
            buf.M.append(0)

    b = len(buf.V)
    ring0 = [(cx + r * math.cos(2 * math.pi * i / seg),
              cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    for (x, y) in ring0:
        buf.V.append((x, y, z + leg))
    for (x, y) in ring0:
        buf.V.append((x, y, z + leg + r * 2.1))
    for i in range(seg):
        j = (i + 1) % seg
        buf.F.append((b + i, b + j, b + seg + j, b + seg + i))
        buf.C.append(rgba)
        buf.M.append(0)
    apex = len(buf.V)
    buf.V.append((cx, cy, z + leg + r * 3.0))
    for i in range(seg):
        j = (i + 1) % seg
        buf.F.append((b + seg + i, b + seg + j, apex))
        buf.C.append(rgba)
        buf.M.append(1)


# --------------------------------------------------------------------------
# per-building construction
# --------------------------------------------------------------------------
def build_one(buf, b):
    ring = to_ccw(b["pts"])
    h = b["h"]
    z0 = GROUND + b.get("min_h", 0.0)
    top = GROUND + h
    cls = b["cls"]
    rnd = b["rnd"]
    area = b["area"]

    dark, light, metal = PALETTE[cls]
    t = (rnd * 7.13) % 1.0                    # position along the anchor line
    # Keep values low: AgX desaturates hard as luminance rises, so bright base
    # colours come out of the view transform as white, not as warm masonry.
    v = 0.70 + 0.34 * ((rnd * 17.31) % 1.0)
    # a whisper of hue drift keeps big blocks from banding, without breaking family
    warm = 1.0 + 0.05 * (((rnd * 31.77) % 1.0) - 0.5)
    wall = (max(0.008, (dark[0] + (light[0] - dark[0]) * t) * v * warm),
            max(0.008, (dark[1] + (light[1] - dark[1]) * t) * v),
            max(0.008, (dark[2] + (light[2] - dark[2]) * t) * v / warm),
            metal)
    roof = (0.038, 0.039, 0.042, 0.0)

    r_eff = math.sqrt(max(area, 1.0) / math.pi)

    # ---- massing stages -------------------------------------------------
    if h >= 110.0:
        stages = [(0.00, 0.54), (0.54, 0.81), (0.81, 1.00)]
        inset = min(8.0, max(1.2, r_eff * 0.13))
    elif h >= 60.0:
        stages = [(0.00, 0.80), (0.80, 1.00)]
        inset = min(5.0, max(0.9, r_eff * 0.10))
    elif h >= 34.0 and rnd > 0.62:
        stages = [(0.00, 0.86), (0.86, 1.00)]
        inset = min(3.0, max(0.7, r_eff * 0.07))
    else:
        stages = [(0.00, 1.00)]
        inset = 0.0

    cur = ring
    span = top - z0
    last_ring, last_z = ring, top
    for si, (a, bnd) in enumerate(stages):
        if si > 0:
            nxt = offset_polygon(cur, inset)
            if nxt is None:
                # footprint too small to step in again - just run to the top
                emit_prism(buf, cur, z0 + span * a, top, wall, roof)
                last_ring, last_z = cur, top
                break
            cur = nxt
        za, zb = z0 + span * a, z0 + span * bnd
        emit_prism(buf, cur, za, zb, wall, roof)
        last_ring, last_z = cur, zb

    # ---- crown / spire on the supertalls ---------------------------------
    if h >= 200.0:
        crown = offset_polygon(last_ring, min(6.0, max(0.8, r_eff * 0.30)))
        if crown:
            ch = 6.0 + 14.0 * ((rnd * 5.0) % 1.0)
            emit_prism(buf, crown, last_z, last_z + ch, wall, roof)
            last_z += ch
        if h >= 260.0:
            # anchor the mast on the crown that is actually there, not on the
            # original footprint centroid, which the setbacks have moved away from
            mux, muy = principal_axis(last_ring)
            mbx, mby, _, _ = obb_of(last_ring, mux, muy)
            spot = interior_point(last_ring, (mbx, mby))
            if spot is not None:
                fit = fit_box(last_ring, spot[0], spot[1], mux, muy,
                              2.6, 2.6, min_size=0.9)
                if fit is not None:
                    mast = 12.0 + 46.0 * ((rnd * 11.0) % 1.0)
                    emit_box(buf, spot[0], spot[1], fit[0], fit[1],
                             last_z, last_z + mast, (0.09, 0.09, 0.10, 0.6),
                             mat=1, ux=mux, uy=muy)

    # ---- parapet on masonry low/mid-rise ---------------------------------
    elif 9.0 <= h < 60.0 and area > 90.0:
        inner = offset_polygon(last_ring, 0.55)
        if inner:
            emit_prism(buf, last_ring, last_z, last_z + 1.05, wall, roof,
                       cap=False)
            emit_prism(buf, inner, last_z, last_z + 1.05, wall, roof, cap=False)

    # ---- rooftop clutter -------------------------------------------------
    # Everything here is sized and oriented in the building's own frame, and
    # placed at a point proven to be inside the roof outline.
    ux, uy = principal_axis(last_ring)
    obx, oby, ow, od = obb_of(last_ring, ux, uy)

    if area > 260.0 and h < 200.0 and ((rnd * 3.7) % 1.0) < 0.55:
        bw = ow * (0.22 + 0.16 * ((rnd * 13.0) % 1.0))
        bd = od * (0.22 + 0.16 * ((rnd * 23.0) % 1.0))
        bh = 2.4 + 3.4 * ((rnd * 29.0) % 1.0)
        # nudge along the roof's own axes, never the world's
        du = (ow * 0.16) * (((rnd * 37.0) % 1.0) - 0.5)
        dv = (od * 0.16) * (((rnd * 41.0) % 1.0) - 0.5)
        want = (obx + du * ux - dv * uy, oby + du * uy + dv * ux)
        spot = interior_point(last_ring, want)
        if spot is not None:
            fit = fit_box(last_ring, spot[0], spot[1], ux, uy,
                          max(2.0, bw), max(2.0, bd))
            if fit is not None:
                emit_box(buf, spot[0], spot[1], fit[0], fit[1],
                         last_z, last_z + bh, (0.075, 0.074, 0.076, 0.15),
                         ux=ux, uy=uy)

    if 11.0 <= h <= 65.0 and area > 150.0 and ((rnd * 6.1) % 1.0) < 0.17:
        r = 1.5 + 0.7 * ((rnd * 43.0) % 1.0)
        want = (obx + ow * 0.22 * ux - od * 0.18 * uy,
                oby + ow * 0.22 * uy + od * 0.18 * ux)
        spot = interior_point(last_ring, want)
        if spot is not None:
            shrunk = False
            while r > 0.9 and not radius_fits(last_ring, spot[0], spot[1], r):
                r *= 0.75
                shrunk = True
            if radius_fits(last_ring, spot[0], spot[1], r):
                CLUTTER["tower_shrunk" if shrunk else "tower_ok"] += 1
                emit_water_tower(buf, spot[0], spot[1], last_z, r,
                                 (0.145, 0.088, 0.052, 0.0))
            else:
                CLUTTER["tower_skipped"] += 1


# --------------------------------------------------------------------------
# chunking + mesh creation
# --------------------------------------------------------------------------
def band_of(h):
    for i, (lo, hi, col) in enumerate(BANDS):
        if lo <= h < hi:
            return i, col
    return len(BANDS) - 1, BANDS[-1][2]


def flush(name, buf, collection, mats):
    if not buf.F:
        return None
    me = bpy.data.meshes.new(name)
    me.from_pydata(buf.V, [], buf.F)
    me.validate(verbose=False, clean_customdata=False)
    for m in mats:
        me.materials.append(m)

    if len(me.polygons) == len(buf.M):
        me.polygons.foreach_set("material_index", buf.M)

    # ---- building identity -------------------------------------------
    # Merging 56k buildings into a few hundred meshes is what makes the city
    # tractable, but it destroys per-building identity unless it is carried
    # explicitly. Two attributes do that:
    #   bid  INT on FACE  - select/isolate a building inside Blender
    #   _bid FLOAT on POINT - survives glTF export (glTF has no face
    #        attributes, and the leading underscore is what makes Blender's
    #        exporter emit it as a custom accessor). Indices up to 2^24 are
    #        exact in float32, so 56k is lossless.
    if len(me.polygons) == len(buf.BF):
        a = me.attributes.new(name="bid", type='INT', domain='FACE')
        a.data.foreach_set("value", buf.BF)
    if len(me.vertices) == len(buf.BV):
        a = me.attributes.new(name="_bid", type='FLOAT', domain='POINT')
        a.data.foreach_set("value", buf.BV)

    if len(me.polygons) == len(buf.C):
        ca = me.color_attributes.new(name=COLOR_ATTR, type='FLOAT_COLOR',
                                     domain='CORNER')
        data = []
        for poly, rgba in zip(me.polygons, buf.C):
            data.extend(rgba * poly.loop_total)
        ca.data.foreach_set("color", data)

    me.update()
    ob = bpy.data.objects.new(name, me)
    bc.link_to(ob, collection)
    try:
        me.shade_flat()
    except Exception:
        pass
    return ob


def main(limit=None):
    t0 = time.time()
    for k in CLUTTER:
        CLUTTER[k] = 0
    for _, _, col in BANDS:
        bc.purge_collection(col)

    blds = pickle.load(open(os.path.join(bc.CACHE, "buildings.pkl"), "rb"))
    if limit:
        blds = blds[:limit]

    facade = bpy.data.materials.get("MAT_facade")
    roofm = bpy.data.materials.get("MAT_roof")
    mats = [facade, roofm]

    chunks = {}          # (band, tx, ty) -> Buf
    for bid, b in enumerate(blds):
        bi, col = band_of(b["h"])
        tx = int(math.floor(b["cx"] / TILE))
        ty = int(math.floor(b["cy"] / TILE))
        key = (bi, tx, ty)
        buf = chunks.get(key)
        if buf is None:
            buf = chunks[key] = Buf()

        f0, v0 = len(buf.F), len(buf.V)
        try:
            build_one(buf, b)
        except Exception as e:
            print("  build failed for %s: %s" % (b.get("id"), e))
            continue
        nf, nv = len(buf.F) - f0, len(buf.V) - v0
        if nf <= 0:
            continue

        buf.BF.extend([bid] * nf)
        buf.BV.extend([float(bid)] * nv)
        buf.rows.append({
            "bid": bid,
            "osm_way_id": b["id"],
            "face_start": f0, "face_count": nf,
            "vert_start": v0, "vert_count": nv,
            "collection": col, "band": bi, "tile_x": tx, "tile_y": ty,
            "b": b,
        })

    t_gen = time.time() - t0

    made = []
    total_v = total_f = 0
    manifest = []
    for (bi, tx, ty), buf in sorted(chunks.items()):
        col = BANDS[bi][2]
        nm = "BLD_%s_%+03d_%+03d" % (col.split("_")[1], tx, ty)
        ob = flush(nm, buf, col, mats)
        if not ob:
            continue
        made.append(ob.name)
        total_v += len(ob.data.vertices)
        total_f += len(ob.data.polygons)
        for r in buf.rows:
            r["mesh"] = nm
            manifest.append(r)

    manifest.sort(key=lambda r: r["bid"])
    write_manifest(manifest)

    return {
        "buildings": len(blds),
        "chunk_objects": len(made),
        "verts": total_v,
        "faces": total_f,
        "manifest_rows": len(manifest),
        "roof_clutter": dict(CLUTTER),
        "gen_seconds": round(t_gen, 1),
        "total_seconds": round(time.time() - t0, 1),
        "per_collection": {c: len(bpy.data.collections[c].objects)
                           for _, _, c in BANDS if c in bpy.data.collections},
    }


MANIFEST_COLUMNS = [
    "bid", "osm_way_id", "name", "addr", "postcode", "district",
    "height_m", "height_source", "levels", "osm_building_type",
    "class", "lod", "area_m2", "footprint_verts",
    "lat", "lon", "x_m", "y_m",
    "mesh", "collection", "face_start", "face_count",
    "vert_start", "vert_count", "material_class", "collision", "is_context",
]

_COLLISION = {
    CLS_SMALL: "box", CLS_LOW: "box", CLS_MID: "box", CLS_HIGH: "hull",
    CLS_TOWER: "hull", CLS_GLASS: "hull", CLS_INDUST: "box", CLS_CIVIC: "hull",
}


def write_manifest(rows):
    """
    One row per building, mapping it back to its merged mesh and polygon range.

    This is the lookup table that makes the merged city addressable again:
    given a bid you can find the mesh, the exact face range, the source OSM
    way, and every attribute the build decided. Written as CSV (56k rows is
    ~9 MB, loads in pandas/JS in a blink) plus a small JSON index describing
    the chunks and the schema.
    """
    import csv
    import json

    os.makedirs(bc.EXPORTS, exist_ok=True)
    csv_path = os.path.join(bc.EXPORTS, "building_manifest.csv")
    idx_path = os.path.join(bc.EXPORTS, "building_index.json")

    chunks = {}
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(MANIFEST_COLUMNS)
        for r in rows:
            b = r["b"]
            lat, lon = bc.xy2ll(b["cx"], b["cy"])
            w.writerow([
                r["bid"], r["osm_way_id"], b.get("name") or "",
                b.get("addr") or "", b.get("postcode") or "",
                b.get("district") or "", round(b["h"], 2), b.get("hsrc", ""),
                b.get("levels") or "", b.get("btype") or "",
                CLS_NAMES[b["cls"]], b.get("lod", ""), round(b["area"], 1),
                len(b["pts"]), round(lat, 7), round(lon, 7),
                round(b["cx"], 2), round(b["cy"], 2),
                r["mesh"], r["collection"], r["face_start"], r["face_count"],
                r["vert_start"], r["vert_count"],
                "MAT_facade", _COLLISION.get(b["cls"], "box"),
                int(bool(b.get("ctx"))),
            ])
            c = chunks.setdefault(r["mesh"], {
                "mesh": r["mesh"], "collection": r["collection"],
                "tile_x": r["tile_x"], "tile_y": r["tile_y"],
                "bid_min": r["bid"], "bid_max": r["bid"],
                "buildings": 0, "faces": 0, "verts": 0})
            c["bid_min"] = min(c["bid_min"], r["bid"])
            c["bid_max"] = max(c["bid_max"], r["bid"])
            c["buildings"] += 1
            c["faces"] += r["face_count"]
            c["verts"] += r["vert_count"]

    index = {
        "schema_version": 1,
        "generated_by": "20_buildings.py",
        "building_count": len(rows),
        "tile_size_m": TILE,
        "projection": {
            "type": "local_tangent_plane",
            "lat0": bc.LAT0, "lon0": bc.LON0,
            "units": "metres", "up_axis": "Z",
            "note": "x = east, y = north; see blender_common.ll2xy",
        },
        "mesh_attributes": {
            "bid": {"domain": "FACE", "type": "INT",
                    "desc": "building id, index into building_manifest.csv"},
            "_bid": {"domain": "POINT", "type": "FLOAT",
                     "desc": "same id, exported to glTF as a custom accessor"},
            "bcol": {"domain": "CORNER", "type": "FLOAT_COLOR",
                     "desc": "per-building facade colour, exported as COLOR_0"},
        },
        "columns": MANIFEST_COLUMNS,
        "chunks": sorted(chunks.values(), key=lambda c: c["mesh"]),
    }
    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=1)

    print("  manifest: %s (%d rows), index: %s (%d chunks)"
          % (os.path.basename(csv_path), len(rows),
             os.path.basename(idx_path), len(chunks)))


if __name__ == "__main__":
    result = main()
    print(result)
