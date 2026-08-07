"""
40_fetch_nyc_open_data.py — Phase 2B: ingest official NYC datasets.

Runs on system Python. Caches to source_data/nyc/ and skips anything already
downloaded (delete a file to refetch).

Datasets (NYC Open Data, Socrata). All are NYC OpenData public domain / local
law 11 open data — free to use and redistribute with attribution. Recorded in
docs/phase2/DATA_SOURCES.md.

  5zhs-2jue  BUILDING            current building footprints: BIN, BBL,
                                 surveyed height_roof, ground_elevation,
                                 construction_year, geometry
  64uk-42ks  PLUTO               lot attributes: land use, building class,
                                 year built, floors, units, areas, address
  vfx9-tbb6  Planimetric Sidewalk sidewalk polygons
  3mf9-qshr  Centerline (LION)   street centerlines with attributes

Manhattan filters:
  BUILDING  BIN 1000000-1999999  (first digit 1 = Manhattan)
  PLUTO     borough = 'MN'

Usage:  python scripts/phase2/40_fetch_nyc_open_data.py [--only building,pluto]
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "source_data", "nyc")
os.makedirs(OUT, exist_ok=True)

BASE = "https://%s/resource/%s.json"
DEFAULT_HOST = "data.cityofnewyork.us"
PAGE = 20000
UA = {"User-Agent": "manhattan-world-build/2.0 (research; contact via repo)"}

# Manhattan plus a margin, for datasets with no borough column.
MN_BOX = "within_box(%s, 40.885, -74.030, 40.680, -73.905)"

JOBS = {
    # name: (dataset id, select, where, order)
    "building": (
        "5zhs-2jue",
        ("bin,base_bbl,mappluto_bbl,construction_year,ground_elevation,"
         "height_roof,feature_code,geom_source,shape_area,the_geom"),
        "bin >= 1000000 AND bin < 2000000",
        "bin",
    ),
    # Authoritative neighbourhood boundaries. Phase 1 approximated districts
    # with latitude bands + a fixed Fifth-Avenue x, which is wrong on a 29-deg
    # rotated island (measured: Upper West Side 1071 buildings, East Village
    # 70). NTAs are the city's own polygons, so district becomes real data.
    "nta": (
        "9nt8-h7nd",
        ("nta2020,ntaname,ntaabbrev,ntatype,boroname,borocode,cdta2020,"
         "cdtaname,the_geom"),
        "boroname='Manhattan'",
        "nta2020",
    ),
    # ---- Phase 2E: streets -------------------------------------------------
    # The Socrata "map" resources (3mf9-qshr Centerline, vfx9-tbb6 Sidewalk)
    # return {} from the tabular API -- they are Esri-backed layers. The
    # tabular twins below are the ones that actually serve rows.
    #
    # Centerline is the road graph: geometry, lane counts, direction of
    # travel, posted speed, carriageway width. It drives both the road mesh
    # in Blender and the traffic system in the runtime.
    "centerline": (
        "inkn-q76z",
        ("physicalid,the_geom,full_street_name,stname_label,"
         "streetwidth,number_total_lanes,number_travel_lanes,"
         "number_park_lanes,posted_speed,trafdir,rw_type,segmentlength,"
         "boroughcode,l_zip,r_zip,snow_priority,status"),
        "boroughcode='1'",
        "physicalid",
    ),
    # Planimetric sidewalk polygons: the real kerb line, block face by block
    # face. 11k polygons for Manhattan, which is small enough to keep.
    "sidewalk": (
        "52n9-sdep",
        "the_geom,feat_code,sub_code,shape_area,shape_leng,source_id,status",
        MN_BOX % "the_geom",
        "source_id",
    ),
    # Street tree points with species and trunk diameter, for instanced trees.
    # `geometry` is a *text* column holding WKT, so it cannot be filtered
    # spatially; `location` is the real point column. Select the first,
    # filter on the second.
    "trees": (
        "hn5i-inap",
        "objectid,geometry,dbh,genusspecies,tpstructure,tpcondition",
        MN_BOX % "location",
        "objectid",
    ),
    # NYC DOT hourly traffic counts. 343,555 Manhattan observations is more
    # than the demand build needs and more than is worth caching, so the
    # aggregation happens server-side: one row per segment and direction,
    # carrying the mean volume. `wktgeom` is State Plane feet with no lat/lon
    # column -- scripts/phase2/nysp.py inverts EPSG:2263 to place it.
    "traffic_volume": (
        "7ym2-wayt",
        ("segmentid,wktgeom,street,direction,avg(vol) as v,count(*) as n,"
         "min(yr) as y0,max(yr) as y1"),
        "boro='Manhattan'",
        None,
        {"$group": "segmentid,wktgeom,street,direction"},
    ),
    # ---- Phase 2N: subway entrances ---------------------------------------
    # The biggest missing footfall generator in the demand field. A block with
    # a station entrance on it carries a different crowd to an identical block
    # without one, and until now the model had no way to know. Published by
    # the MTA on the state portal rather than the city's, which is why the
    # dataset id carries its own host.
    "subway_entrances": (
        "data.ny.gov/i9wp-a4ja",
        ("station_id,complex_id,stop_name,borough,daytime_routes,line,"
         "entrance_type,entry_allowed,exit_allowed,entrance_latitude,"
         "entrance_longitude"),
        "borough='M'",
        "station_id",
    ),
    "pluto": (
        "64uk-42ks",
        ("bbl,block,lot,address,zipcode,bldgclass,landuse,ownername,"
         "lotarea,bldgarea,comarea,resarea,officearea,retailarea,garagearea,"
         "strgearea,factryarea,otherarea,numbldgs,numfloors,unitsres,"
         "unitstotal,yearbuilt,yearalter1,lotfront,lotdepth,bldgfront,"
         "bldgdepth,proxcode,latitude,longitude,xcoord,ycoord,cd,"
         "zonedist1,builtfar,histdist,landmark"),
        "borough='MN'",
        "bbl",
    ),
}


def fetch_paged(name, ds, select, where, order, extra=None):
    path = os.path.join(OUT, name + ".json")
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        n = len(json.load(open(path, encoding="utf-8")))
        print("  [skip] %-10s %d rows, %.1f MB"
              % (name, n, os.path.getsize(path) / 1e6))
        return path

    rows = []
    offset = 0
    t0 = time.time()
    while True:
        q = {"$select": select, "$where": where,
             "$limit": PAGE, "$offset": offset}
        # A grouped query has no stable row order to page by, and Socrata
        # rejects $order on a column that is not in the group.
        if order:
            q["$order"] = order
        if extra:
            q.update(extra)
        # A dataset id may carry its own Socrata host: the MTA publishes on
        # data.ny.gov, not on the city's portal.
        host, _, rid = ds.rpartition("/")
        url = (BASE % (host or DEFAULT_HOST, rid)) + "?" \
            + urllib.parse.urlencode(q)
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=180) as r:
                    batch = json.loads(r.read().decode("utf-8"))
                break
            except Exception as e:
                if attempt == 3:
                    print("  [ERR ] %s at offset %d: %s" % (name, offset, e))
                    batch = []
                    break
                time.sleep(4 * (attempt + 1))
        if not batch:
            break
        rows.extend(batch)
        offset += len(batch)
        print("    %s ... %d rows (%.0fs)" % (name, len(rows), time.time() - t0))
        if len(batch) < PAGE:
            break

    if not rows:
        print("  [ERR ] %s returned nothing" % name)
        return None
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f)
    print("  [ ok ] %-10s %d rows, %.1f MB, %.0fs"
          % (name, len(rows), os.path.getsize(path) / 1e6, time.time() - t0))
    return path


def main(argv):
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))

    print("=" * 74)
    print("PHASE 2B  NYC OPEN DATA INGEST -> source_data/nyc/")
    print("=" * 74)
    got = {}
    for name, job in JOBS.items():
        ds, select, where, order = job[:4]
        extra = job[4] if len(job) > 4 else None
        if only and name not in only:
            continue
        print("  %s  (%s)" % (name, ds))
        p = fetch_paged(name, ds, select, where, order, extra)
        if p:
            got[name] = p
        time.sleep(1)

    print("-" * 74)
    for name, p in got.items():
        print("  %-10s %s" % (name, os.path.relpath(p, ROOT)))
    print("=" * 74)
    return 0 if got else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
