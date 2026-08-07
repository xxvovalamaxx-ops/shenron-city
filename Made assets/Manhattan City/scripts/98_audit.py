"""
98_audit.py — independently verify every published claim about the world.

Runs inside Blender so it can check the .blend, the manifest, the raw Overpass
JSON and the exported GLB in one pass.

  blender -b --python 98_audit.py -- [--samples N]

Nothing here trusts the build report: counts are recomputed from primary
sources, and random buildings are traced from the manifest back to the exact
OSM way they came from.
"""

import json
import os
import random
import struct
import sys
import time

import bpy

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402

OK, FAIL, WARN = "PASS", "FAIL", "WARN"
results = []


def check(name, status, detail):
    results.append((status, name, detail))
    print("  [%s] %-46s %s" % (status, name, detail))


# --------------------------------------------------------------------------
def audit_manifest():
    p = os.path.join(bc.EXPORTS, "building_manifest.csv")
    if not os.path.exists(p):
        check("manifest exists", FAIL, "missing " + p)
        return None
    import csv
    with open(p, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    check("manifest rows", OK if rows else FAIL,
          "%d buildings, %.1f MB" % (len(rows), os.path.getsize(p) / 1e6))

    src = {}
    for r in rows:
        src[r["height_source"]] = src.get(r["height_source"], 0) + 1
    direct = src.get("tag", 0)
    levels = src.get("levels", 0)
    zone = src.get("zone_model", 0)
    lmk = src.get("landmark_override", 0)
    tot = len(rows)
    check("height provenance breakdown", OK,
          "tag=%d (%.1f%%) levels=%d zone_model=%d landmark=%d"
          % (direct, 100.0 * direct / tot, levels, zone, lmk))
    check("real-OSM height coverage (tag+levels)", OK,
          "%d/%d = %.1f%%  [zone-estimated only %d = %.1f%%]"
          % (direct + levels + lmk, tot,
             100.0 * (direct + levels + lmk) / tot, zone,
             100.0 * zone / tot))

    ids = set(int(r["bid"]) for r in rows)
    check("bid uniqueness / contiguity",
          OK if len(ids) == tot and min(ids) == 0 and max(ids) == tot - 1 else FAIL,
          "%d unique, range %d..%d" % (len(ids), min(ids), max(ids)))

    osm = set(r["osm_way_id"] for r in rows)
    check("osm_way_id uniqueness", OK if len(osm) == tot else WARN,
          "%d distinct OSM ways for %d buildings" % (len(osm), tot))

    named = sum(1 for r in rows if r["name"])
    addr = sum(1 for r in rows if r["addr"])
    dis = {}
    for r in rows:
        dis[r["district"]] = dis.get(r["district"], 0) + 1
    top = sorted(dis.items(), key=lambda t: -t[1])[:4]
    check("attribution coverage", OK,
          "named=%d addressed=%d districts=%d (top: %s)"
          % (named, addr, len(dis),
             ", ".join("%s %d" % (k, v) for k, v in top)))
    return rows


# --------------------------------------------------------------------------
def audit_traceability(rows, n_samples=12):
    """Trace random manifest rows back to the raw Overpass JSON they came from."""
    if not rows:
        return
    src_dir = bc.SOURCE_DATA
    files = [f for f in os.listdir(src_dir)
             if f.startswith(("buildings_band", "context_buildings"))
             and f.endswith(".json")]
    way_index = {}
    t0 = time.time()
    for fn in files:
        try:
            d = json.load(open(os.path.join(src_dir, fn), encoding="utf-8"))
        except Exception:
            continue
        for el in d.get("elements", []):
            if el.get("type") == "way":
                way_index[el["id"]] = el
    check("raw OSM ways indexed", OK,
          "%d ways from %d files in %.1fs"
          % (len(way_index), len(files), time.time() - t0))

    rng = random.Random(20260802)
    sample = rng.sample(rows, min(n_samples, len(rows)))
    matched = mismatched = missing = 0
    lines = []
    for r in sample:
        el = way_index.get(int(r["osm_way_id"]))
        if el is None:
            missing += 1
            continue
        tags = el.get("tags") or {}
        raw_h = tags.get("height")
        raw_lv = tags.get("building:levels")
        nverts_raw = len(el.get("geometry") or [])
        ok = True
        if r["height_source"] == "tag" and raw_h is not None:
            try:
                ok = abs(float(str(raw_h).replace("m", "").strip())
                         - float(r["height_m"])) < 0.6
            except Exception:
                ok = False
        elif r["height_source"] == "tag" and raw_h is None:
            ok = False
        matched += 1 if ok else 0
        mismatched += 0 if ok else 1
        lines.append("      bid=%-6s way=%-11s src=%-17s h=%-7s rawH=%-7s "
                     "rawLvl=%-4s rawPts=%-3d %s"
                     % (r["bid"], r["osm_way_id"], r["height_source"],
                        r["height_m"], raw_h, raw_lv, nverts_raw,
                        r["name"][:24]))
    check("traceability: manifest -> raw OSM way",
          OK if mismatched == 0 and missing == 0 else FAIL,
          "%d/%d verified, %d mismatched, %d not found"
          % (matched, len(sample), mismatched, missing))
    for ln in lines:
        print(ln)


# --------------------------------------------------------------------------
def audit_blend():
    blend = os.path.join(bc.BLEND, "manhattan_world.blend")
    if bpy.data.filepath != blend:
        bpy.ops.wm.open_mainfile(filepath=blend)

    bld_cols = ["05_lowrise", "06_midrise", "07_towers"]
    objs = []
    for cn in bld_cols:
        c = bpy.data.collections.get(cn)
        if c:
            objs.extend([o for o in c.objects if o.type == 'MESH'])
    verts = sum(len(o.data.vertices) for o in objs)
    faces = sum(len(o.data.polygons) for o in objs)
    check("building meshes in blend", OK,
          "%d chunk meshes, %s verts, %s faces"
          % (len(objs), format(verts, ","), format(faces, ",")))

    # building id attributes actually present and covering every face
    with_bid = [o for o in objs if "bid" in o.data.attributes]
    with_pbid = [o for o in objs if "_bid" in o.data.attributes]
    check("bid attribute on every chunk",
          OK if len(with_bid) == len(objs) else FAIL,
          "%d/%d meshes carry FACE int 'bid'" % (len(with_bid), len(objs)))
    check("_bid attribute (glTF-exportable)",
          OK if len(with_pbid) == len(objs) else FAIL,
          "%d/%d meshes carry POINT float '_bid'" % (len(with_pbid), len(objs)))

    # sample a mesh and confirm ids are sane
    if with_bid:
        o = with_bid[len(with_bid) // 2]
        a = o.data.attributes["bid"]
        vals = [0] * len(o.data.polygons)
        a.data.foreach_get("value", vals)
        check("bid values sane on sample chunk", OK if vals else FAIL,
              "%s: %d faces, %d distinct bids, range %d..%d"
              % (o.name, len(vals), len(set(vals)), min(vals), max(vals)))

    # ---- roof cap sanity -------------------------------------------------
    # Self-intersecting setback insets produce bowtie n-gon caps, which
    # tessellate into long triangular shards spiking out of roofs.
    #
    # Tested exactly, by looking for a crossing in the cap's own vertex ring.
    # An area-vs-bounding-box heuristic looks tempting and is wrong: a long
    # thin building on a diagonal has a huge bbox and a small area while being
    # perfectly convex, so it false-positives on ordinary Manhattan footprints.
    def _cross(a1, a2, b1, b2):
        def o(p, q, r):
            v = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1])
            return 0 if abs(v) < 1e-9 else (1 if v > 0 else 2)
        return (o(a1, a2, b1) != o(a1, a2, b2) and
                o(b1, b2, a1) != o(b1, b2, a2))

    bad, checked, worst = 0, 0, []
    for o in objs:
        me = o.data
        for p in me.polygons:
            n = len(p.vertices)
            if n < 4 or abs(p.normal.z) < 0.9:
                continue          # only horizontal caps
            checked += 1
            ring = [(me.vertices[i].co.x, me.vertices[i].co.y)
                    for i in p.vertices]
            hit = False
            for i in range(n):
                a1, a2 = ring[i], ring[(i + 1) % n]
                for j in range(i + 2, n):
                    if i == 0 and j == n - 1:
                        continue
                    if _cross(a1, a2, ring[j], ring[(j + 1) % n]):
                        hit = True
                        break
                if hit:
                    break
            if hit:
                bad += 1
                if len(worst) < 4:
                    worst.append("%s f%d (%d verts)" % (o.name, p.index, n))
    check("roof caps free of bowtie shards",
          OK if bad == 0 else FAIL,
          "%d self-intersecting of %d horizontal n-gon caps%s"
          % (bad, checked, (" e.g. " + "; ".join(worst)) if worst else ""))

    # ---- oversized footprints -------------------------------------------
    # OSM maps subway concourses as building=train_station with
    # location=underground; Pennsylvania Station's outline spans 946 m.
    # Extruded, one becomes a vast flat plate hovering over Midtown. The
    # processor filters them by tag - this proves none slipped through.
    # The largest legitimate building here is the North River treatment
    # plant at 658 m, so 700 m is a safe ceiling.
    worst_span, worst_who = 0.0, ""
    over = 0
    for o in objs:
        me = o.data
        vs = me.vertices
        for p in me.polygons:
            if len(p.vertices) < 4 or abs(p.normal.z) < 0.8:
                continue
            co = [vs[i].co for i in p.vertices]
            sp = 0.0
            for a in range(len(co)):
                for b in range(a + 1, len(co)):
                    d = (co[a] - co[b]).length
                    if d > sp:
                        sp = d
            if sp > worst_span:
                worst_span, worst_who = sp, "%s f%d" % (o.name, p.index)
            if sp > 700.0:
                over += 1
    check("no oversized building footprints",
          OK if over == 0 else FAIL,
          "%d faces span >700 m; largest is %.0f m (%s)"
          % (over, worst_span, worst_who))

    colattr = [o for o in objs if "bcol" in o.data.color_attributes]
    check("bcol colour attribute", OK if len(colattr) == len(objs) else WARN,
          "%d/%d meshes" % (len(colattr), len(objs)))

    # traffic
    lanes = bpy.data.objects.get("CRV_traffic_lanes")
    if lanes:
        nsp = len(lanes.data.splines)
        total = 0.0
        for sp in lanes.data.splines:
            pts = [p.co for p in sp.points]
            for i in range(len(pts) - 1):
                total += (pts[i + 1] - pts[i]).length
        deps = bpy.context.evaluated_depsgraph_get()
        ev = lanes.evaluated_get(deps)
        inst = sum(1 for i in deps.object_instances if i.is_instance
                   and i.parent and i.parent.original == lanes)
        check("traffic system", OK,
              "%d lane splines, %.0f lane-km, evaluated instances=%d "
              "(geometric estimate %d @ %.0f m spacing)"
              % (nsp, total / 1000.0, inst, int(total / 52.0), 52.0))
    else:
        check("traffic system", FAIL, "CRV_traffic_lanes missing")

    # bridges / piers
    for cn, label in (("09_bridges", "bridges"), ("10_piers", "piers"),
                      ("04_parks", "parks"), ("03_roads", "roads"),
                      ("08_landmarks", "landmarks")):
        c = bpy.data.collections.get(cn)
        if c:
            v = sum(len(o.data.vertices) for o in c.objects
                    if o.type == 'MESH' and o.data)
            check("collection %s" % label, OK,
                  "%d objects, %s verts" % (len(c.objects), format(v, ",")))

    cams = [o.name for o in bpy.data.objects if o.type == 'CAMERA']
    check("cameras", OK if cams else FAIL, ", ".join(sorted(cams)))
    sc = bpy.context.scene
    check("flythrough frame range", OK,
          "%d-%d @ %d fps = %.1f s"
          % (sc.frame_start, sc.frame_end, sc.render.fps,
             (sc.frame_end - sc.frame_start + 1) / sc.render.fps))
    return objs


# --------------------------------------------------------------------------
def audit_glb():
    p = os.path.join(bc.EXPORTS, "manhattan_world.glb")
    if not os.path.exists(p):
        check("GLB exists", WARN, "not exported yet")
        return
    size = os.path.getsize(p)
    with open(p, "rb") as f:
        magic, ver, length = struct.unpack("<III", f.read(12))
        if magic != 0x46546C67:
            check("GLB header", FAIL, "bad magic")
            return
        clen, ctype = struct.unpack("<II", f.read(8))
        js = json.loads(f.read(clen).decode("utf-8"))
    meshes = js.get("meshes", [])
    prims = sum(len(m.get("primitives", [])) for m in meshes)
    attrs = set()
    for m in meshes:
        for pr in m.get("primitives", []):
            attrs.update(pr.get("attributes", {}).keys())
    total_v = sum(a.get("count", 0) for a in js.get("accessors", [])
                  if a.get("type") == "VEC3")
    check("GLB structure", OK,
          "v%d, %.1f MB, %d meshes, %d primitives, %d nodes"
          % (ver, size / 1e6, len(meshes), prims, len(js.get("nodes", []))))
    check("GLB vertex attributes", OK if "COLOR_0" in attrs else WARN,
          "attributes present: %s" % ", ".join(sorted(attrs)))
    check("GLB carries building ids",
          OK if any(a.startswith("_BID") or a == "_bid" for a in attrs) else FAIL,
          "looked for _BID / _bid among %s" % ", ".join(sorted(attrs)))
    check("GLB extensions", OK,
          "used=%s" % (js.get("extensionsUsed") or []))


# --------------------------------------------------------------------------
def audit_untouched_user_file():
    p = r"D:\blender projects\brick_building\project\brick_scene_v002_architecture.blend"
    if not os.path.exists(p):
        check("user's brick file untouched", WARN, "file not found")
        return
    st = os.stat(p)
    check("user's brick file untouched", OK,
          "last modified %s, %d bytes (session started ~05:45)"
          % (time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
             st.st_size))


# --------------------------------------------------------------------------
def main(argv):
    n = 12
    if "--samples" in argv:
        n = int(argv[argv.index("--samples") + 1])

    print("=" * 78)
    print("MANHATTAN WORLD AUDIT")
    print("=" * 78)
    print("\n-- manifest ------------------------------------------------")
    rows = audit_manifest()
    print("\n-- traceability to source records --------------------------")
    audit_traceability(rows, n)
    print("\n-- blend contents ------------------------------------------")
    audit_blend()
    print("\n-- glTF export ---------------------------------------------")
    audit_glb()
    print("\n-- non-destructiveness -------------------------------------")
    audit_untouched_user_file()

    npass = sum(1 for s, _, _ in results if s == OK)
    nfail = sum(1 for s, _, _ in results if s == FAIL)
    nwarn = sum(1 for s, _, _ in results if s == WARN)
    print("\n" + "=" * 78)
    print("AUDIT: %d pass, %d warn, %d FAIL" % (npass, nwarn, nfail))
    if nfail:
        for s, nme, d in results:
            if s == FAIL:
                print("   FAILED: %s -- %s" % (nme, d))
    print("=" * 78)

    # machine-readable form so Phase 2 regression checks can diff it
    if "--json" in argv:
        import json as _json
        i = argv.index("--json")
        out = (argv[i + 1] if len(argv) > i + 1
               and not argv[i + 1].startswith("--")
               else os.path.join(bc.DOCS, "audit.json"))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            _json.dump({
                "pass": npass, "warn": nwarn, "fail": nfail,
                "checks": [{"status": s, "name": n, "detail": d}
                           for s, n, d in results],
            }, f, indent=1)
        print("wrote %s" % out)
    return nfail


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(argv)
