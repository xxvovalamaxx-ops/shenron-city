"""
blender_common.py — shared constants + helpers for the Manhattan world build.

Runs *inside* Blender. Every build script imports this so the projection,
collection names and naming conventions stay identical across passes.

Coordinate system
-----------------
1 Blender unit = 1 metre. +X = east, +Y = north, +Z = up.
Local tangent-plane projection centred on the Manhattan island centroid.
Across Manhattan's ~21 km extent the equirectangular error stays well under
a metre, which is far below the fidelity of the source footprints.
"""

import math
import os

import bpy

# --------------------------------------------------------------------------
# Project paths
# --------------------------------------------------------------------------
PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DATA = os.path.join(PROJECT, "source_data")
SCRIPTS = os.path.join(PROJECT, "scripts")
BLEND = os.path.join(PROJECT, "blend")
RENDERS = os.path.join(PROJECT, "renders")
PLAYBLASTS = os.path.join(PROJECT, "playblasts")
EXPORTS = os.path.join(PROJECT, "exports")
DOCS = os.path.join(PROJECT, "docs")
CACHE = os.path.join(SOURCE_DATA, "cache")

# --------------------------------------------------------------------------
# Geo projection
# --------------------------------------------------------------------------
LAT0 = 40.7800          # island centroid latitude
LON0 = -73.9680         # island centroid longitude
_M_PER_DEG_LAT = 110574.0
_M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))

# Sea level sits at z = 0; land is lifted clear of it.
#
# The gap matters more than it looks. A 24-bit depth buffer with a 60 m..90 km
# range resolves only ~3 m at 15 km, so the original 2 m of separation put the
# ocean and the landmass inside the same depth bucket and they z-fought across
# every borough - as horizontal banding with coarse land quads, and as a
# per-cell speckle once the land became a fine lattice. 12 m clears it with
# margin and is realistic for Manhattan's seawalled edge.
SEA_LEVEL = 0.0
LAND_LEVEL = 12.0


def ll2xy(lat, lon):
    """Lat/lon (degrees) -> local metres (x east, y north)."""
    return ((lon - LON0) * _M_PER_DEG_LON,
            (lat - LAT0) * _M_PER_DEG_LAT)


def xy2ll(x, y):
    """Local metres -> lat/lon (degrees). Inverse of ll2xy."""
    return (y / _M_PER_DEG_LAT + LAT0,
            x / _M_PER_DEG_LON + LON0)


# --------------------------------------------------------------------------
# Collection hierarchy
# --------------------------------------------------------------------------
COLLECTIONS = [
    "00_reference",
    "01_water",
    "02_landmass",
    "03_roads",
    "04_parks",
    "05_lowrise",
    "06_midrise",
    "07_towers",
    "08_landmarks",
    "09_bridges",
    "10_piers",
    "11_traffic",
    "12_lighting",
    "13_cameras",
    "14_exports",
]


def ensure_collections(scene=None):
    """Create the standard collection hierarchy (idempotent)."""
    scene = scene or bpy.context.scene
    made = []
    for name in COLLECTIONS:
        c = bpy.data.collections.get(name)
        if c is None:
            c = bpy.data.collections.new(name)
            made.append(name)
        if name not in {ch.name for ch in scene.collection.children}:
            try:
                scene.collection.children.link(c)
            except RuntimeError:
                pass
    return made


def get_collection(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def link_to(obj, collection_name):
    """Move obj so it lives only in the named collection."""
    col = get_collection(collection_name)
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj


def purge_collection(name):
    """Delete every object inside a collection (used when re-running a pass)."""
    col = bpy.data.collections.get(name)
    if not col:
        return 0
    n = 0
    for obj in list(col.objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        n += 1
        if data is not None and data.users == 0:
            try:
                if isinstance(data, bpy.types.Mesh):
                    bpy.data.meshes.remove(data)
                elif isinstance(data, bpy.types.Curve):
                    bpy.data.curves.remove(data)
            except Exception:
                pass
    return n


# --------------------------------------------------------------------------
# Mesh helpers
# --------------------------------------------------------------------------
def new_mesh_object(name, verts, faces, collection, materials=None,
                    face_materials=None, color_attr=None):
    """
    Build a mesh object from raw vert/face lists in one shot.

    verts           : list of (x, y, z)
    faces           : list of tuples of vertex indices
    materials       : list of bpy.types.Material to bind to slots
    face_materials  : per-face material slot index
    color_attr      : (name, list-of-(r,g,b,a) per *face*) painted to corners
    """
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate(verbose=False, clean_customdata=False)

    if materials:
        for m in materials:
            me.materials.append(m)
    if face_materials is not None and len(me.polygons) == len(face_materials):
        me.polygons.foreach_set("material_index", face_materials)

    if color_attr is not None:
        attr_name, per_face_rgba = color_attr
        if len(per_face_rgba) == len(me.polygons):
            ca = me.color_attributes.new(name=attr_name, type='FLOAT_COLOR',
                                         domain='CORNER')
            buf = []
            for poly, rgba in zip(me.polygons, per_face_rgba):
                buf.extend(list(rgba) * poly.loop_total)
            ca.data.foreach_set("color", buf)

    me.update()
    ob = bpy.data.objects.new(name, me)
    link_to(ob, collection)
    return ob


def shade_flat(obj):
    """Blender 5.x-safe flat shading without relying on operator context."""
    try:
        obj.data.shade_flat()
    except Exception:
        for p in obj.data.polygons:
            p.use_smooth = False
    return obj


# --------------------------------------------------------------------------
# Geometry utilities (pure python, no numpy dependency inside Blender)
# --------------------------------------------------------------------------
def polygon_area(pts):
    """Signed shoelace area. Positive = counter-clockwise."""
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a * 0.5


def polygon_centroid(pts):
    a = polygon_area(pts)
    if abs(a) < 1e-9:
        n = float(len(pts)) or 1.0
        return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)
    cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        cross = x1 * y2 - x2 * y1
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    return (cx / (6.0 * a), cy / (6.0 * a))


def point_in_polygon(x, y, poly):
    """Ray-casting test."""
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and \
           (x < (xj - xi) * (y - yi) / (yj - yi + 1e-30) + xi):
            inside = not inside
        j = i
    return inside


def simplify_ring(pts, tol=0.6):
    """
    Douglas-Peucker on a closed ring, keeping at least a triangle.
    Cuts OSM footprint vertex counts roughly in half at 0.6 m tolerance
    with no visible change at city scale.
    """
    if len(pts) < 4:
        return pts

    def dp(seq):
        if len(seq) < 3:
            return seq
        x1, y1 = seq[0]
        x2, y2 = seq[-1]
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        worst, wi = -1.0, 0
        for i in range(1, len(seq) - 1):
            px, py = seq[i]
            if L2 < 1e-12:
                d = math.hypot(px - x1, py - y1)
            else:
                t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L2))
                d = math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
            if d > worst:
                worst, wi = d, i
        if worst > tol:
            return dp(seq[:wi + 1])[:-1] + dp(seq[wi:])
        return [seq[0], seq[-1]]

    out = dp(list(pts) + [pts[0]])[:-1]
    return out if len(out) >= 3 else pts


def dedupe_ring(pts, eps=0.05):
    """Drop consecutive duplicate points and close-the-loop repeats."""
    out = []
    for p in pts:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > eps:
            out.append(p)
    while len(out) >= 2 and math.hypot(out[0][0] - out[-1][0],
                                       out[0][1] - out[-1][1]) <= eps:
        out.pop()
    return out


def hashf(*args):
    """Deterministic 0..1 hash so every rebuild produces the identical city."""
    h = 2166136261
    for a in args:
        v = int(a * 1000) if isinstance(a, float) else int(a)
        v &= 0xFFFFFFFF
        for _ in range(4):
            h ^= v & 0xFF
            h = (h * 16777619) & 0xFFFFFFFF
            v >>= 8
    return (h & 0xFFFFFF) / float(0xFFFFFF)
