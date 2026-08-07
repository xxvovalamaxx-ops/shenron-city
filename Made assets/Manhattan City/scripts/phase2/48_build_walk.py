"""
48_build_walk.py -- Phase 2H: the pedestrian network and street-furniture plan.

    python scripts/phase2/48_build_walk.py

Two official datasets have to agree before a pedestrian may stand anywhere:

    LION Centerline (inkn-q76z)     where the streets run, and how wide
    Planimetric Sidewalk (52n9-sdep) where the city actually surveyed pavement

Offsetting a street centreline by half its width gives a plausible sidewalk
line, but only plausible: it runs straight across the Hudson on the approach
to the Lincoln Tunnel, along the middle of the FDR, and through the piers.
So every candidate sample is tested against the survey polygons -- outer ring
minus holes -- and only the runs that land on real pavement survive. That is
the whole point of carrying two sources.

Outputs
    data/manhattan/streets/walk_graph.json   walk lanes + corner nodes
    data/manhattan/props/props.bin           static prop instances, 12 B each
    data/manhattan/props/props.json          type table + 200 m cell index

Props are placed here rather than in the runtime because placement has to be
deterministic: a bin that moves every time the page loads is not a bin, and a
hydrant that lands in the roadway is worse than no hydrant.
"""

import json
import math
import os
import random
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import nta as nta_mod  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
STREETS = os.path.join(ROOT, "data", "manhattan", "streets")
PROPS = os.path.join(ROOT, "data", "manhattan", "props")
NYC = os.path.join(ROOT, "source_data", "nyc")
DOCS = os.path.join(ROOT, "docs", "phase2")

LAT0 = 40.7800
LON0 = -73.9680
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))

SAMPLE = 5.0          # metres between pavement probes along a candidate lane
MIN_RUN = 3           # samples; 3 x 5 m = a 10 m stretch of usable pavement
GAP_OK = 1            # a single missed probe is a driveway, not a gap
CORNER_SNAP = 14.0    # endpoints within this join into one walk node
CELL = 200.0          # prop index cell, same as the traffic lane index

# How far a pedestrian may stand either side of the lane centreline.
#
# The centreline is derived from the street width, which is a fit, not a
# measurement -- so on a block where the fit runs wide, half the crowd walks
# into the building line. Probing outward from every retained sample gives the
# free width the survey actually contains, per side, and the runtime keeps
# inside it. Measured on the dense samples and then reduced by SIMPLIFY_TOL,
# because the polyline that ships has been flattened by up to that much.
FREE_STEP = 0.5
FREE_MAX = 4.5
SIMPLIFY_TOL = 0.30
BODY = 0.30           # half a shoulder, so nobody clips the wall they pass

# prop type table -- the order is the wire format, do not reorder
P_TREE, P_LIGHT, P_SIGNAL, P_HYDRANT, P_BIN, P_SHELTER, P_BOLLARD, P_NEWSBOX \
    = range(8)
TYPE_NAMES = ["tree", "streetlight", "signal", "hydrant", "bin", "shelter",
              "bollard", "newsbox"]

# spacing in metres along a walk lane
SPACING = {
    P_LIGHT: 30.0,
    P_HYDRANT: 85.0,
    P_BOLLARD: 0.0,       # placed only at plaza-width pavement, see below
    P_SHELTER: 250.0,
}

# A shelter belongs at a bus stop, and MTA runs buses on the avenues. There is
# no bus-stop dataset in the fetch yet, so the proxy is carriageway width plus
# a coin toss -- calibrated against the ~800 sheltered stops in the borough
# rather than against the ~3,000 stops.
#
# The threshold has to sit just under the avenue tier. LION widths in Manhattan
# top out at 21 m (the 70 ft avenue) with the 60 ft avenues at 18 m, so an
# earlier 22 m cut excluded every avenue in the borough and left 16 shelters.
SHELTER_MIN_W = 17.5
SHELTER_P = 0.26


# ---------------------------------------------------------------------------
# pavement index
# ---------------------------------------------------------------------------
class Pavement:
    """Point-in-sidewalk test over the planimetric survey, grid accelerated."""

    def __init__(self, polygons, cell=40.0):
        self.cell = cell
        self.polys = []
        self.grid = {}
        for rings in polygons:
            outer = None
            holes = []
            for r in rings:
                pts = r["pts"]
                if len(pts) < 3:
                    continue
                if r.get("outer") and outer is None:
                    outer = pts
                else:
                    holes.append(pts)
            if outer is None:
                continue
            xs = [p[0] for p in outer]
            ys = [p[1] for p in outer]
            bbox = (min(xs), min(ys), max(xs), max(ys))
            ix = len(self.polys)
            self.polys.append((outer, holes, bbox))
            cx0 = int(math.floor(bbox[0] / cell))
            cx1 = int(math.floor(bbox[2] / cell))
            cy0 = int(math.floor(bbox[1] / cell))
            cy1 = int(math.floor(bbox[3] / cell))
            for cx in range(cx0, cx1 + 1):
                for cy in range(cy0, cy1 + 1):
                    self.grid.setdefault((cx, cy), []).append(ix)

    @staticmethod
    def _in_ring(x, y, ring):
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

    def hit(self, x, y):
        cand = self.grid.get((int(math.floor(x / self.cell)),
                              int(math.floor(y / self.cell))))
        if not cand:
            return False
        for ix in cand:
            outer, holes, bb = self.polys[ix]
            if x < bb[0] or x > bb[2] or y < bb[1] or y > bb[3]:
                continue
            if not self._in_ring(x, y, outer):
                continue
            for h in holes:
                if self._in_ring(x, y, h):
                    break
            else:
                return True
        return False


# ---------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------
def offset_polyline(pts, off):
    """Offset a polyline by `off` metres to the right of travel."""
    out = []
    n = len(pts)
    for i in range(n):
        a = pts[max(0, i - 1)]
        b = pts[min(n - 1, i + 1)]
        dx = b[0] - a[0]
        dy = b[1] - a[1]
        d = math.hypot(dx, dy) or 1.0
        out.append((pts[i][0] + (dy / d) * off, pts[i][1] + (-dx / d) * off))
    return out


def resample(pts, step):
    """Walk a polyline at fixed arc length, returning (x, y, heading)."""
    out = []
    if len(pts) < 2:
        return out
    carry = 0.0
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        seg = math.hypot(bx - ax, by - ay)
        if seg < 1e-6:
            continue
        h = math.atan2(by - ay, bx - ax)
        t = carry
        while t <= seg:
            f = t / seg
            out.append((ax + (bx - ax) * f, ay + (by - ay) * f, h))
            t += step
        carry = t - seg
    lx, ly = pts[-1]
    if not out or math.hypot(out[-1][0] - lx, out[-1][1] - ly) > step * 0.5:
        ax, ay = pts[-2]
        out.append((lx, ly, math.atan2(ly - ay, lx - ax)))
    return out


def simplify(pts, tol):
    """Iterative Douglas-Peucker. The lanes are probed every 5 m, which is the
    resolution the pavement test needs, not the resolution a straight block of
    Lexington Avenue needs to be stored at -- 17 collinear points per lane put
    the walk graph at 6.3 MB before this ran."""
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i0, i1 = stack.pop()
        if i1 <= i0 + 1:
            continue
        ax, ay = pts[i0]
        bx, by = pts[i1]
        dx, dy = bx - ax, by - ay
        d2 = dx * dx + dy * dy
        worst = -1.0
        wi = -1
        for i in range(i0 + 1, i1):
            px, py = pts[i]
            if d2 < 1e-12:
                dist = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / d2))
                dist = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if dist > worst:
                worst = dist
                wi = i
        if worst > tol:
            keep[wi] = True
            stack.append((i0, wi))
            stack.append((wi, i1))
    return [pts[i] for i in range(len(pts)) if keep[i]]


class Union:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, a):
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def join(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


# ---------------------------------------------------------------------------
# walk lanes
# ---------------------------------------------------------------------------
def sidewalk_width(street_w):
    """Manhattan pavement scales with the street: 2.4 m on a mews, 5.5 m on an
    avenue. LION carries no sidewalk width, so this is a fit to the survey."""
    return max(2.4, min(5.5, 2.4 + street_w * 0.10))


def free_widths(pave, samples):
    """Free distance either side of the pavement, probed at every sample.

    Returns two lists in metres relative to the polyline direction, already
    reduced by the flattening tolerance and half a shoulder, so the runtime can
    treat them as hard limits.

    Per sample, not per lane. Taking the minimum over a whole lane sounded
    safe and was useless: one doorway alcove or one pinched corner zeroed the
    entire block, and 74% of lanes came back with no usable width at all."""
    left = []
    right = []
    margin = SIMPLIFY_TOL + BODY
    steps = int(FREE_MAX / FREE_STEP)
    for x, y, h in samples:
        # A sample the run bridged across (a driveway) is not pavement and
        # would read as zero width. It is still walked over, so record it as
        # unknown and let the neighbours speak for it.
        if not pave.hit(x, y):
            left.append(None)
            right.append(None)
            continue
        # left of travel is (-sin h, cos h); right is (sin h, -cos h)
        lx, ly = -math.sin(h), math.cos(h)
        fl = FREE_MAX
        fr = FREE_MAX
        for k in range(1, steps + 1):
            d = k * FREE_STEP
            if not pave.hit(x + lx * d, y + ly * d):
                fl = d - FREE_STEP
                break
        for k in range(1, steps + 1):
            d = k * FREE_STEP
            if not pave.hit(x - lx * d, y - ly * d):
                fr = d - FREE_STEP
                break
        left.append(max(0.0, fl - margin))
        right.append(max(0.0, fr - margin))
    return left, right


def span_width(vals, lo, hi):
    """A representative free width for the stretch a kept vertex stands for.

    Deliberately not the minimum. The simplifier drops eight vertices in nine,
    so a span is long, and one alcove or one pinched corner in it takes the
    minimum to zero -- which is how 71% of the lanes in the borough came back
    with no room to walk. The low quartile keeps the outlier from deciding
    the block while still erring narrow."""
    got = sorted(v for v in vals[lo:hi + 1] if v is not None)
    if not got:
        return 0.0
    return got[int(0.25 * (len(got) - 1))]


def simplify_idx(pts, tol):
    """Douglas-Peucker returning the indices it kept, so per-vertex data
    measured on the dense line can be carried across."""
    if len(pts) < 3:
        return list(range(len(pts)))
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i0, i1 = stack.pop()
        if i1 <= i0 + 1:
            continue
        ax, ay = pts[i0]
        bx, by = pts[i1]
        dx, dy = bx - ax, by - ay
        d2 = dx * dx + dy * dy
        worst = -1.0
        wi = -1
        for i in range(i0 + 1, i1):
            px, py = pts[i]
            if d2 < 1e-12:
                dist = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / d2))
                dist = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if dist > worst:
                worst = dist
                wi = i
        if worst > tol:
            keep[wi] = True
            stack.append((i0, wi))
            stack.append((wi, i1))
    return [i for i in range(len(pts)) if keep[i]]


def build_lanes(graph, pave):
    lanes = []
    skipped = {"undrivable": 0, "short": 0, "no_pavement": 0}
    probes = 0
    hits = 0

    for e in graph["edges"]:
        if not e.get("drivable"):
            skipped["undrivable"] += 1
            continue
        if e.get("kind") in ("ferry", "non_physical", "tunnel"):
            skipped["undrivable"] += 1
            continue
        if e.get("length", 0.0) < 12.0:
            skipped["short"] += 1
            continue

        sw = sidewalk_width(e.get("width", 12.8))
        off = e.get("width", 12.8) * 0.5 + sw * 0.5
        found_any = False

        for side in (1, -1):
            line = offset_polyline(e["pts"], off * side)
            samples = resample(line, SAMPLE)
            if len(samples) < MIN_RUN:
                continue

            run = []
            miss = 0
            emitted = []
            for s in samples:
                probes += 1
                if pave.hit(s[0], s[1]):
                    hits += 1
                    run.append(s)
                    miss = 0
                else:
                    miss += 1
                    if miss > GAP_OK:
                        if len(run) >= MIN_RUN:
                            emitted.append(run)
                        run = []
                    elif run:
                        run.append(s)      # bridge a single driveway
            if len(run) >= MIN_RUN:
                emitted.append(run)

            for r in emitted:
                found_any = True
                pts = [(round(p[0], 2), round(p[1], 2)) for p in r]
                cum = [0.0]
                for i in range(1, len(pts)):
                    cum.append(cum[-1] + math.hypot(pts[i][0] - pts[i - 1][0],
                                                    pts[i][1] - pts[i - 1][1]))
                wl, wr = free_widths(pave, r)
                lanes.append({
                    "id": len(lanes),
                    "eid": e["id"],
                    "name": e.get("name", ""),
                    "side": side,
                    # kerb is back toward the centreline, i.e. -side
                    "width": round(sw, 2),
                    "street_w": e.get("width", 12.8),
                    "wl": wl,
                    "wr": wr,
                    "len": round(cum[-1], 2),
                    "pts": pts,
                })
        if not found_any:
            skipped["no_pavement"] += 1

    return lanes, skipped, probes, hits


def join_corners(lanes):
    """Cluster lane endpoints into walk nodes so a pedestrian can turn a corner
    (and, where a side street is narrow enough, cross it)."""
    ends = []
    for ln in lanes:
        ends.append((ln["pts"][0][0], ln["pts"][0][1], ln["id"], 0))
        ends.append((ln["pts"][-1][0], ln["pts"][-1][1], ln["id"], 1))

    grid = {}
    for i, (x, y, _, _) in enumerate(ends):
        grid.setdefault((int(x // CORNER_SNAP), int(y // CORNER_SNAP)),
                        []).append(i)

    uf = Union(len(ends))
    for (cx, cy), members in grid.items():
        near = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                near.extend(grid.get((cx + dx, cy + dy), ()))
        for i in members:
            xi, yi = ends[i][0], ends[i][1]
            for j in near:
                if j <= i:
                    continue
                if math.hypot(ends[j][0] - xi, ends[j][1] - yi) <= CORNER_SNAP:
                    uf.join(i, j)

    roots = {}
    nodes = []
    for i, (x, y, lid, which) in enumerate(ends):
        r = uf.find(i)
        if r not in roots:
            roots[r] = len(nodes)
            nodes.append([0.0, 0.0, 0])
        n = roots[r]
        nodes[n][0] += x
        nodes[n][1] += y
        nodes[n][2] += 1
        lanes[lid]["a" if which == 0 else "b"] = n

    out = [[round(nx / c, 2), round(ny / c, 2)] for nx, ny, c in nodes]
    return out


# ---------------------------------------------------------------------------
# props
# ---------------------------------------------------------------------------
def kerb_frame(lane, i):
    """Position on the kerb edge and the yaw that faces the carriageway."""
    pts = lane["pts"]
    j = min(len(pts) - 1, max(1, i))
    ax, ay = pts[j - 1]
    bx, by = pts[j]
    d = math.hypot(bx - ax, by - ay) or 1.0
    # the kerb is on the centreline side, i.e. opposite the offset direction
    kx = -(by - ay) / d * lane["side"]
    ky = (bx - ax) / d * lane["side"]
    return kx, ky, math.atan2(ky, kx)


def place_props(lanes, graph, pave, rng):
    out = []
    seen_signal = set()
    deg = graph.get("node_degree", [])
    node_xy = graph.get("nodes", [])

    def push(t, x, y, yaw, scale=1.0, variant=0):
        if not pave.hit(x, y):
            return False
        out.append((t, x, y, yaw, scale, variant))
        return True

    for ln in lanes:
        pts = ln["pts"]
        if len(pts) < 2:
            continue
        inset = max(0.55, ln["width"] * 0.5 - 0.70)   # from lane centre to kerb
        step_i = {t: max(1, int(round(s / SAMPLE)))
                  for t, s in SPACING.items() if s > 0}
        phase = int(rng.random() * 6)

        for t, si in step_i.items():
            if t == P_SHELTER and (ln["street_w"] < SHELTER_MIN_W or
                                   ln["len"] < 60.0):
                continue
            for i in range(phase % si, len(pts), si):
                if t == P_HYDRANT and rng.random() < 0.25:
                    continue           # hydrants are irregular, not metronomic
                if t == P_SHELTER and rng.random() > SHELTER_P:
                    continue
                kx, ky, yaw = kerb_frame(ln, i)
                d = inset if t != P_SHELTER else max(0.4, inset - 0.9)
                push(t, pts[i][0] + kx * d, pts[i][1] + ky * d, yaw)

        # bins and newspaper boxes cluster at the corners
        for i in (1, len(pts) - 2):
            if i < 1 or i >= len(pts) - 1:
                continue
            kx, ky, yaw = kerb_frame(ln, i)
            x = pts[i][0] + kx * inset
            y = pts[i][1] + ky * inset
            if rng.random() < 0.35:
                push(P_BIN, x, y, yaw)
            elif rng.random() < 0.12:
                push(P_NEWSBOX, x, y, yaw)

    # traffic signals: one per corner of a junction, deduped on a 7 m grid
    for ln in lanes:
        for end, idx in (("a", 0), ("b", len(ln["pts"]) - 1)):
            pts = ln["pts"]
            kx, ky, yaw = kerb_frame(ln, idx)
            x = pts[idx][0] + kx * max(0.6, ln["width"] * 0.5 - 0.8)
            y = pts[idx][1] + ky * max(0.6, ln["width"] * 0.5 - 0.8)
            # only where the underlying street junction is a real junction
            near_junction = False
            for nid in (graph["edges"][ln["eid"]]["a"],
                        graph["edges"][ln["eid"]]["b"]):
                if nid < len(node_xy) and nid < len(deg) and deg[nid] >= 3:
                    nx, ny = node_xy[nid]
                    if math.hypot(nx - x, ny - y) < 26.0:
                        near_junction = True
                        break
            if not near_junction:
                continue
            key = (int(x // 7.0), int(y // 7.0))
            if key in seen_signal:
                continue
            seen_signal.add(key)
            push(P_SIGNAL, x, y, yaw)

    return out


# Crown shape, not taxonomy: form 2 is a conifer silhouette and must contain
# only actual conifers. An earlier table had pear, cherry, crab apple and
# hawthorn in it -- small round-headed ornamentals, all of them -- and put an
# 8 m spruce on the pavement of Fifth Avenue.
SPECIES_FORM = (
    ("juniperus", 2), ("picea", 2), ("pinus", 2), ("thuja", 2),
    ("abies", 2), ("tsuga", 2), ("taxus", 2), ("cedrus", 2),
    ("metasequoia", 2), ("cryptomeria", 2), ("chamaecyparis", 2),
    ("larix", 2), ("pseudotsuga", 2), ("cupressus", 2),

    # narrow, upright crowns
    ("ginkgo", 1), ("carpinus", 1), ("liriodendron", 1), ("populus", 1),
    ("pyrus", 1),                 # 'Bradford' callery pear, famously columnar
    ("koelreuteria", 1), ("ostrya", 1), ("sophora", 1),
    ("styphnolobium", 1), ("corylus", 1),
)


def tree_form(genus_species):
    """0 spreading broadleaf, 1 upright, 2 conifer. Everything unlisted is a
    spreading broadleaf, which is what Manhattan's street stock overwhelmingly
    is: London plane, honeylocust, oak, linden, elm, zelkova, maple."""
    g = (genus_species or "").lower()
    for key, form in SPECIES_FORM:
        if g.startswith(key):
            return form
    return 0


def place_trees(pave, ntas, rng):
    path = os.path.join(NYC, "trees.json")
    if not os.path.exists(path):
        return [], {"missing": True}
    raw = json.load(open(path, encoding="utf-8"))
    stat = {"rows": len(raw), "parsed": 0, "manhattan": 0, "retired": 0,
            "on_pavement": 0}
    forms = {0: 0, 1: 0, 2: 0}
    genera = {}
    out = []
    hint = None
    for r in raw:
        g = r.get("geometry") or ""
        if not g.startswith("POINT"):
            continue
        try:
            lon_s, lat_s = g[g.index("(") + 1:g.index(")")].split()
            lon = float(lon_s)
            lat = float(lat_s)
        except (ValueError, IndexError):
            continue
        stat["parsed"] += 1
        if not (-74.03 < lon < -73.90 and 40.68 < lat < 40.89):
            continue
        nt = nta_mod.find(lon, lat, ntas, hint)
        if nt is None:
            continue
        hint = nt
        stat["manhattan"] += 1
        if (r.get("tpstructure") or "").strip().lower() in ("retired", "dead",
                                                            "stump"):
            stat["retired"] += 1
            continue
        x = (lon - LON0) * M_LON
        y = (lat - LAT0) * M_LAT
        if not pave.hit(x, y):
            continue
        stat["on_pavement"] += 1
        try:
            dbh = float(r.get("dbh") or 0)
        except (TypeError, ValueError):
            dbh = 0.0
        # street-tree allometry, rough but measured-driven: a 10 in dbh London
        # plane is about 8 m tall. The mesh is authored at 8 m.
        h = 3.0 + max(0.0, min(40.0, dbh)) * 0.46
        form = tree_form(r.get("genusspecies"))
        forms[form] += 1
        gen = (r.get("genusspecies") or "?").split(" ")[0].lower()
        genera[gen] = genera.get(gen, 0) + 1
        out.append((P_TREE, x, y, rng.random() * math.tau,
                    max(0.35, min(2.2, h / 8.0)), form))
    stat["forms"] = {"broad": forms[0], "upright": forms[1],
                     "conifer": forms[2]}
    stat["top_genera"] = dict(sorted(genera.items(), key=lambda kv: -kv[1])[:12])
    return out, stat


def write_props(records):
    os.makedirs(PROPS, exist_ok=True)
    records.sort(key=lambda r: (int(math.floor(r[1] / CELL)),
                                int(math.floor(r[2] / CELL))))
    buf = bytearray()
    index = {}
    for i, (t, x, y, yaw, scale, variant) in enumerate(records):
        key = "%d,%d" % (int(math.floor(x / CELL)), int(math.floor(y / CELL)))
        slot = index.get(key)
        if slot is None:
            index[key] = [i, 1]
        else:
            slot[1] += 1
        yb = int(round((yaw % math.tau) / math.tau * 255.0)) & 0xFF
        sb = max(1, min(255, int(round(scale / 0.02))))
        buf += struct.pack("<ffBBBB", x, y, t, yb, sb, variant & 0xFF)

    with open(os.path.join(PROPS, "props.bin"), "wb") as f:
        f.write(buf)

    counts = {}
    for r in records:
        counts[TYPE_NAMES[r[0]]] = counts.get(TYPE_NAMES[r[0]], 0) + 1
    meta = {
        "generated_by": "scripts/phase2/48_build_walk.py",
        "record_bytes": 12,
        "layout": "f32 x_m, f32 y_m, u8 type, u8 yaw/255*2pi, "
                  "u8 scale*0.02, u8 variant",
        "types": TYPE_NAMES,
        "count": len(records),
        "counts": counts,
        "cell_m": CELL,
        "cells": index,
    }
    with open(os.path.join(PROPS, "props.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, separators=(",", ":"))
    return meta, len(buf)


def main():
    t0 = time.time()
    print("=" * 74)
    print("PHASE 2H  WALK NETWORK + STREET FURNITURE")
    print("=" * 74)

    graph = json.load(open(os.path.join(STREETS, "street_graph.json"),
                           encoding="utf-8"))
    side = json.load(open(os.path.join(STREETS, "sidewalk_geom.json"),
                          encoding="utf-8"))
    print("  street graph    : %d edges, %d nodes"
          % (len(graph["edges"]), len(graph["nodes"])))
    pave = Pavement(side["polygons"])
    print("  pavement index  : %d polygons, %d grid cells"
          % (len(pave.polys), len(pave.grid)))

    lanes, skipped, probes, hits = build_lanes(graph, pave)
    total_len = sum(l["len"] for l in lanes)
    print("  probes          : %d, on pavement %d (%.1f%%)"
          % (probes, hits, 100.0 * hits / max(1, probes)))
    print("  walk lanes      : %d, %.1f km"
          % (len(lanes), total_len / 1000.0))
    print("    skipped edges : %s" % skipped)

    nodes = join_corners(lanes)
    print("  walk nodes      : %d corners" % len(nodes))

    rng = random.Random(20260804)
    props = place_props(lanes, graph, pave, rng)
    print("  furniture       : %d placed" % len(props))

    ntas = nta_mod.load()
    if ntas:
        ntas = [n for n in ntas if n["id"].startswith("MN")]
    trees, tstat = place_trees(pave, ntas or [], rng)
    print("  trees           : %d of %d rows  (%s)"
          % (len(trees), tstat.get("rows", 0), tstat))

    meta, nbytes = write_props(props + trees)
    print("  props.bin       : %d records, %.2f MB"
          % (meta["count"], nbytes / 1048576.0))
    for k, v in sorted(meta["counts"].items(), key=lambda kv: -kv[1]):
        print("      %-12s %7d" % (k, v))

    # Placement is done: the dense 5 m sampling has served its purpose, so the
    # polylines that ship to the browser get flattened.
    dense = sum(len(l["pts"]) for l in lanes)
    slim = []
    for l in lanes:
        keep = simplify_idx(l["pts"], SIMPLIFY_TOL)
        pts = [[round(l["pts"][i][0], 1), round(l["pts"][i][1], 1)]
               for i in keep]
        # A dropped vertex is still pavement the crowd walks over, so each
        # kept vertex inherits the tightest width in the span it now stands
        # for. Decimetres, because 10 cm is finer than the survey.
        wl, wr = [], []
        for n, i in enumerate(keep):
            lo = keep[n - 1] if n else i
            hi = keep[n + 1] if n + 1 < len(keep) else i
            wl.append(int(round(span_width(l["wl"], lo, hi) * 10)))
            wr.append(int(round(span_width(l["wr"], lo, hi) * 10)))
        slim.append({"id": l["id"], "a": l["a"], "b": l["b"],
                     "w": l["width"], "wl": wl, "wr": wr,
                     "len": l["len"], "nm": l["name"], "pts": pts})
    print("  simplify        : %d -> %d points (%.1fx)"
          % (dense, sum(len(l["pts"]) for l in slim),
             dense / max(1, sum(len(l["pts"]) for l in slim))))

    walk = {
        "generated_by": "scripts/phase2/48_build_walk.py",
        "source": "LION inkn-q76z offset, validated against sidewalk 52n9-sdep",
        "projection": graph["projection"],
        "sample_m": SAMPLE,
        "corner_snap_m": CORNER_SNAP,
        "nodes": nodes,
        "lanes": slim,
    }
    with open(os.path.join(STREETS, "walk_graph.json"), "w",
              encoding="utf-8") as f:
        json.dump(walk, f, separators=(",", ":"))
    wsize = os.path.getsize(os.path.join(STREETS, "walk_graph.json"))
    print("  walk_graph.json : %.2f MB" % (wsize / 1048576.0))

    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "WALK_REPORT.json"), "w",
              encoding="utf-8") as f:
        json.dump({
            "walk_lanes": len(lanes),
            "walk_km": round(total_len / 1000.0, 2),
            "walk_nodes": len(nodes),
            "probes": probes,
            "probes_on_pavement": hits,
            "edges_skipped": skipped,
            "props": meta["counts"],
            "trees": tstat,
            "seconds": round(time.time() - t0, 1),
        }, f, indent=1)

    print("-" * 74)
    print("  done in %.0fs" % (time.time() - t0))
    print("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main())
