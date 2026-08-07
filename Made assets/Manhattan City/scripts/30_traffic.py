"""
30_traffic.py — moving vehicles on the real street network.

Runs inside Blender. Idempotent (purges 11_traffic).

Design
------
Tens of thousands of cars cannot be individual animated objects; the depsgraph
would collapse. Instead every drivable road becomes a poly spline in one curve
object, and a single Geometry Nodes tree turns those splines into evenly spaced
instanced cars.

Motion uses the standard "slide within one slot" trick: points are emitted at a
fixed spacing S along each curve, then offset along their own tangent by
(time * speed) mod S. Because the cars are identical and evenly spaced, a car
reaching the next slot is indistinguishable from the one that was there, so the
wrap is invisible and the traffic flows continuously - including round corners,
since the tangent is re-evaluated per point. One modifier drives the whole city.

Lanes are offset to the right of the centreline so oncoming streams separate,
which is what actually reads as traffic from the air.
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

CAR_Z = bc.LAND_LEVEL + 0.18
SPACING = 52.0           # metres between vehicles (34 m put every side street
                         # bumper-to-bumper, which reads as a car park)
# fraction of minor streets that get any traffic at all
MINOR_KEEP = 0.42
DRIVABLE = {"motorway", "trunk", "primary", "secondary", "tertiary",
            "residential", "motorway_link", "trunk_link", "primary_link",
            "secondary_link"}
MAJOR = {"motorway", "trunk", "primary", "secondary", "tertiary",
         "motorway_link", "trunk_link", "primary_link"}


def build_car_mesh():
    """~4.4 m sedan: body box plus a narrower cabin. 16 verts."""
    me = bpy.data.meshes.get("MSH_car")
    if me:
        return me
    L, W, H = 4.4, 1.85, 0.72
    ch, cl, cw = 0.62, 2.3, 1.62
    V = [(-L / 2, -W / 2, 0), (L / 2, -W / 2, 0), (L / 2, W / 2, 0),
         (-L / 2, W / 2, 0),
         (-L / 2, -W / 2, H), (L / 2, -W / 2, H), (L / 2, W / 2, H),
         (-L / 2, W / 2, H),
         (-cl / 2, -cw / 2, H), (cl / 2 - 0.3, -cw / 2, H),
         (cl / 2 - 0.3, cw / 2, H), (-cl / 2, cw / 2, H),
         (-cl / 2 + 0.2, -cw / 2 + 0.12, H + ch),
         (cl / 2 - 0.6, -cw / 2 + 0.12, H + ch),
         (cl / 2 - 0.6, cw / 2 - 0.12, H + ch),
         (-cl / 2 + 0.2, cw / 2 - 0.12, H + ch)]
    F = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (3, 2, 1, 0),
         (8, 9, 13, 12), (9, 10, 14, 13), (10, 11, 15, 14), (11, 8, 12, 15),
         (12, 13, 14, 15), (4, 5, 6, 7)]
    me = bpy.data.meshes.new("MSH_car")
    me.from_pydata(V, [], F)
    me.validate(verbose=False)
    me.update()
    mat = bpy.data.materials.get("MAT_car")
    if mat:
        me.materials.append(mat)
    return me


def offset_line(pts, d):
    """Shift a polyline to its right by d metres (the driving lane)."""
    out = []
    n = len(pts)
    for i, (x, y) in enumerate(pts):
        if i == 0:
            dx, dy = pts[1][0] - x, pts[1][1] - y
        elif i == n - 1:
            dx, dy = x - pts[-2][0], y - pts[-2][1]
        else:
            dx = pts[i + 1][0] - pts[i - 1][0]
            dy = pts[i + 1][1] - pts[i - 1][1]
        L = math.hypot(dx, dy) or 1.0
        out.append((x + dy / L * d, y - dx / L * d))
    return out


def build_lane_curve(roads, name="CRV_traffic_lanes"):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.resolution_u = 1

    n_lanes = 0
    total_len = 0.0
    for idx, r in enumerate(roads):
        if r["tunnel"] or r["hw"] not in DRIVABLE:
            continue
        # thin out side streets deterministically so the grid still breathes
        if r["hw"] not in MAJOR and (idx * 2654435761 % 1000) / 1000.0 > MINOR_KEEP:
            continue
        pts = r["pts"]
        if len(pts) < 2:
            continue
        seg_len = sum(math.dist(pts[i], pts[i + 1])
                      for i in range(len(pts) - 1))
        if seg_len < 45.0:
            continue

        lanes = [(r["w"] * 0.26, False)]
        if not r["oneway"] and r["hw"] in MAJOR:
            lanes.append((r["w"] * 0.26, True))     # opposing stream

        for (off, flip) in lanes:
            line = offset_line(pts, -off if flip else off)
            if flip:
                line = line[::-1]
            sp = cu.splines.new('POLY')
            sp.points.add(len(line) - 1)
            for i, (x, y) in enumerate(line):
                sp.points[i].co = (x, y, CAR_Z, 1.0)
            n_lanes += 1
            total_len += seg_len

    ob = bpy.data.objects.new(name, cu)
    bc.link_to(ob, "11_traffic")
    return ob, n_lanes, total_len


def build_traffic_nodetree(car_obj, spacing=SPACING, speed=13.0):
    """
    Curve -> evenly spaced points -> slide along tangent by time -> instance car.
    """
    name = "GN_traffic"
    ng = bpy.data.node_groups.get(name)
    if ng:
        bpy.data.node_groups.remove(ng)
    ng = bpy.data.node_groups.new(name, 'GeometryNodeTree')

    ng.interface.new_socket(name="Geometry", in_out='INPUT',
                            socket_type='NodeSocketGeometry')
    ng.interface.new_socket(name="Geometry", in_out='OUTPUT',
                            socket_type='NodeSocketGeometry')

    n = ng.nodes
    lk = ng.links
    gin = n.new("NodeGroupInput")
    gin.location = (-900, 0)
    gout = n.new("NodeGroupOutput")
    gout.location = (900, 0)

    # even spacing along every spline, carrying the tangent
    c2p = n.new("GeometryNodeCurveToPoints")
    c2p.location = (-660, 0)
    c2p.mode = 'LENGTH'
    c2p.inputs["Length"].default_value = spacing
    lk.new(gin.outputs["Geometry"], c2p.inputs["Curve"])

    # offset = tangent * ((time * speed) mod spacing)
    tim = n.new("GeometryNodeInputSceneTime")
    tim.location = (-900, -320)
    mul = n.new("ShaderNodeMath")
    mul.location = (-720, -320)
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = speed
    lk.new(tim.outputs["Seconds"], mul.inputs[0])

    mod = n.new("ShaderNodeMath")
    mod.location = (-540, -320)
    mod.operation = 'MODULO'
    mod.inputs[1].default_value = spacing
    lk.new(mul.outputs[0], mod.inputs[0])

    scale = n.new("ShaderNodeVectorMath")
    scale.location = (-340, -240)
    scale.operation = 'SCALE'
    lk.new(c2p.outputs["Tangent"], scale.inputs[0])
    lk.new(mod.outputs[0], scale.inputs["Scale"])

    setpos = n.new("GeometryNodeSetPosition")
    setpos.location = (-140, 0)
    lk.new(c2p.outputs["Points"], setpos.inputs["Geometry"])
    lk.new(scale.outputs["Vector"], setpos.inputs["Offset"])

    # orient the car along the road
    align = n.new("FunctionNodeAlignRotationToVector") if \
        "FunctionNodeAlignRotationToVector" in dir(bpy.types) else None
    if align is None:
        try:
            align = n.new("FunctionNodeAlignEulerToVector")
        except Exception:
            align = None
    if align is not None:
        align.location = (80, -240)
        if hasattr(align, "axis"):
            align.axis = 'X'
        lk.new(c2p.outputs["Tangent"], align.inputs["Vector"])

    inst = n.new("GeometryNodeInstanceOnPoints")
    inst.location = (340, 0)
    lk.new(setpos.outputs["Geometry"], inst.inputs["Points"])
    if align is not None:
        try:
            lk.new(align.outputs[0], inst.inputs["Rotation"])
        except Exception:
            pass

    objinfo = n.new("GeometryNodeObjectInfo")
    objinfo.location = (80, 200)
    objinfo.inputs["Object"].default_value = car_obj
    objinfo.transform_space = 'RELATIVE'
    lk.new(objinfo.outputs["Geometry"], inst.inputs["Instance"])

    lk.new(inst.outputs["Instances"], gout.inputs["Geometry"])
    return ng


def main():
    t0 = time.time()
    bc.purge_collection("11_traffic")

    roads = pickle.load(open(os.path.join(bc.CACHE, "roads.pkl"), "rb"))

    car_me = build_car_mesh()
    car = bpy.data.objects.get("PROP_car")
    if car is None:
        car = bpy.data.objects.new("PROP_car", car_me)
    bc.link_to(car, "11_traffic")
    car.hide_render = True
    car.hide_viewport = True

    lanes_ob, n_lanes, total_len = build_lane_curve(roads)
    ng = build_traffic_nodetree(car)

    md = lanes_ob.modifiers.new("Traffic", 'NODES')
    md.node_group = ng

    est_cars = int(total_len / SPACING)
    return {"lanes": n_lanes,
            "lane_km": round(total_len / 1000.0, 1),
            "spacing_m": SPACING,
            "approx_vehicles": est_cars,
            "seconds": round(time.time() - t0, 1)}


if __name__ == "__main__":
    result = main()
    print(result)
