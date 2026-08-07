"""
99_build.py — headless build driver for the Manhattan world.

Runs every generation stage inside a background Blender so the artist's
interactive session is never touched and bpy.ops file operators behave
synchronously (they do not, reliably, when driven through the MCP bridge).

Usage
-----
  blender --background --factory-startup --python 99_build.py -- <stages...>

Stages (run in the order given; "all" expands to the full default chain):
  setup      fresh scene, collections, world, lighting, render config
  materials  (re)build the material library
  terrain    ocean, Manhattan landmass, harbour islands, context shorelines
  parks      park ground, Central Park water, tree massing
  roads      street network ribbons
  buildings  ~45k extruded OSM footprints with setbacks and roof detail
  bridges    East River / Hudson crossings
  piers      waterfront piers and wharfs
  landmarks  bespoke hero-tower replacements
  traffic    vehicle instancing along road curves
  cameras    aerial cameras + flythrough animation
  save       write blend/manhattan_world.blend

Example:
  blender -b --factory-startup --python 99_build.py -- setup materials terrain buildings save
"""

import importlib.util
import os
import sys
import time
import traceback

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

import bpy  # noqa: E402
import blender_common as bc  # noqa: E402

BLEND_PATH = os.path.join(bc.BLEND, "manhattan_world.blend")

# stage -> (module filename, callable name, kwargs)
STAGE_MODULES = {
    "setup":     ("10_scene_setup.py", "main", {"guard": False}),
    "materials": ("15_materials.py", "ensure_materials", {}),
    "terrain":   ("18_terrain.py", "main", {}),
    "parks":     ("19_parks.py", "main", {}),
    "roads":     ("22_roads.py", "main", {}),
    "buildings": ("20_buildings.py", "main", {}),
    "bridges":   ("24_bridges.py", "main", {}),
    "piers":     ("26_piers.py", "main", {}),
    "landmarks": ("28_landmarks.py", "main", {}),
    "lookdev":   ("35_lookdev.py", "main", {}),
    "traffic":   ("30_traffic.py", "main", {}),
    "cameras":   ("32_cameras.py", "main", {}),
}

DEFAULT_CHAIN = ["setup", "materials", "terrain", "parks", "roads",
                 "buildings", "bridges", "piers", "landmarks", "traffic",
                 "cameras", "save"]


def load_module(filename):
    """Import a digit-prefixed script file as a module."""
    path = os.path.join(SCRIPTS, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    name = "stage_" + os.path.splitext(filename)[0].replace(".", "_")
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def stage_save():
    os.makedirs(bc.BLEND, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=False)
    return {"saved": BLEND_PATH,
            "size_mb": round(os.path.getsize(BLEND_PATH) / 1e6, 2)}


def open_existing():
    """Continue from the saved world when the chain doesn't start with setup."""
    if os.path.exists(BLEND_PATH):
        bpy.ops.wm.open_mainfile(filepath=BLEND_PATH)
        return True
    return False


def main(argv):
    stages = argv or ["all"]
    if "all" in stages:
        stages = DEFAULT_CHAIN

    print("=" * 74)
    print("MANHATTAN WORLD BUILD   stages: %s" % ", ".join(stages))
    print("=" * 74)

    if stages[0] != "setup":
        if open_existing():
            print("[open] %s" % BLEND_PATH)
        else:
            print("[open] no existing blend - running setup implicitly")
            m = load_module(STAGE_MODULES["setup"][0])
            m.main(guard=False)

    results = {}
    t_all = time.time()
    for st in stages:
        t0 = time.time()
        print("\n---- %s %s" % (st, "-" * (66 - len(st))))
        try:
            if st == "save":
                res = stage_save()
            else:
                fn_file, fn_name, kwargs = STAGE_MODULES[st]
                mod = load_module(fn_file)
                res = getattr(mod, fn_name)(**kwargs)
                if isinstance(res, dict) and len(res) > 40:
                    res = {"keys": len(res)}
                elif not isinstance(res, (dict, list, int, float, str, type(None))):
                    res = str(type(res))
        except Exception as e:
            traceback.print_exc()
            res = {"ERROR": str(e)}
        results[st] = res
        print("[%s] %.1fs -> %s" % (st, time.time() - t0, res))

    print("\n" + "=" * 74)
    print("TOTAL %.1fs" % (time.time() - t_all))
    for k, v in results.items():
        print("  %-11s %s" % (k, v))

    failed = [k for k, v in results.items()
              if isinstance(v, dict) and "ERROR" in v]
    return 1 if failed else 0


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    sys.exit(main(argv))
