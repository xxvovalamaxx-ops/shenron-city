"""
15_materials.py — the shared material library for the Manhattan world.

Runs inside Blender. Idempotent: re-running rebuilds node trees in place so
lookdev can be iterated without touching geometry.

Design
------
The city runs on very few materials on purpose. Variety comes from two mesh
attributes baked at build time, not from more materials:

  bcol  FLOAT_COLOR corner attribute - per-building base colour (alpha carries
        "glassiness", which selects curtain-wall vs punched-window treatment)
  _bid  FLOAT point attribute - the building id, hashed in-shader to give every
        building its own floor height, window pitch, glass tint and blind
        pattern

So 56,501 individually detailed buildings still cost exactly one facade
material and one draw call per chunk.

Facades are textured procedurally rather than with image maps because the
merged chunks have no UVs, 56k buildings would need an impossible atlas, and
a world-space projection gives correct real-world window scale everywhere for
free.
"""

import importlib
import sys

import bpy

SCRIPTS = r"D:\blender projects\Manheten\scripts"
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)
import blender_common as bc  # noqa: E402
importlib.reload(bc)

COLOR_ATTR = "bcol"
BID_ATTR = "_bid"


# --------------------------------------------------------------------------
# small node helpers
# --------------------------------------------------------------------------
def _fresh(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    if not m.node_tree:
        m.use_nodes = True
    m.node_tree.nodes.clear()
    return m, m.node_tree


def _principled(nt, x=0):
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (x + 340, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (x, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return bsdf


def _math(nt, op, a=None, b=None, loc=(0, 0), clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.location = loc
    n.use_clamp = clamp
    if a is not None:
        if hasattr(a, "default_value") or hasattr(a, "node"):
            nt.links.new(a, n.inputs[0])
        else:
            n.inputs[0].default_value = a
    if b is not None:
        if hasattr(b, "default_value") or hasattr(b, "node"):
            nt.links.new(b, n.inputs[1])
        else:
            n.inputs[1].default_value = b
    return n


def _mix(nt, fac, c1, c2, loc=(0, 0), blend='MIX'):
    n = nt.nodes.new("ShaderNodeMixRGB")
    n.blend_type = blend
    n.location = loc
    for sock, val in (("Fac", fac), ("Color1", c1), ("Color2", c2)):
        if val is None:
            continue
        if hasattr(val, "node"):
            nt.links.new(val, n.inputs[sock])
        elif isinstance(val, (tuple, list)):
            n.inputs[sock].default_value = val
        else:
            n.inputs[sock].default_value = val
    return n


def _hash01(nt, src, mult, loc):
    """fract(value * mult) -> a decorrelated 0..1 per-building constant."""
    m = _math(nt, 'MULTIPLY', src, mult, (loc[0], loc[1]))
    return _math(nt, 'FRACT', m.outputs[0], None, (loc[0] + 170, loc[1]))


# --------------------------------------------------------------------------
# facade — the one that matters
# --------------------------------------------------------------------------
def mat_facade():
    """
    Procedural curtain-wall / punched-window facade.

    Projection: for a vertical face, whichever of the two horizontal axes the
    wall runs along becomes U and world Z becomes V. That yields true metric
    window spacing on every wall of every building with no UVs at all.
    """
    m, nt = _fresh("MAT_facade")
    bsdf = _principled(nt, 700)

    # ---- inputs ----------------------------------------------------------
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    geo.location = (-1900, -200)
    pos = nt.nodes.new("ShaderNodeSeparateXYZ")
    pos.location = (-1720, -120)
    nt.links.new(geo.outputs["Position"], pos.inputs["Vector"])
    nrm = nt.nodes.new("ShaderNodeSeparateXYZ")
    nrm.location = (-1720, -340)
    nt.links.new(geo.outputs["True Normal"], nrm.inputs["Vector"])

    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = COLOR_ATTR
    col.location = (-1900, 320)

    bid = nt.nodes.new("ShaderNodeAttribute")
    bid.attribute_type = 'GEOMETRY'
    bid.attribute_name = BID_ATTR
    bid.location = (-1900, 120)

    # per-building constants from the id
    r_floor = _hash01(nt, bid.outputs["Fac"], 0.61803398, (-1700, 180))
    r_win = _hash01(nt, bid.outputs["Fac"], 0.75487766, (-1700, 60))
    r_tint = _hash01(nt, bid.outputs["Fac"], 0.38196601, (-1700, -20))

    # ---- pick the horizontal axis the wall runs along --------------------
    ax = _math(nt, 'ABSOLUTE', nrm.outputs["X"], None, (-1540, -300))
    ay = _math(nt, 'ABSOLUTE', nrm.outputs["Y"], None, (-1540, -400))
    # sel = 1 when the normal points mostly along X (wall runs along Y)
    sel = _math(nt, 'GREATER_THAN', ax.outputs[0], ay.outputs[0], (-1380, -350))
    u = _mix(nt, sel.outputs[0], pos.outputs["X"], pos.outputs["Y"],
             (-1200, -220))

    # ---- window lattice --------------------------------------------------
    # floor pitch 3.3-4.3 m, window pitch 2.2-3.6 m, both per building
    fp = _math(nt, 'MULTIPLY', r_floor.outputs[0], 1.0, (-1380, 200))
    fp = _math(nt, 'ADD', fp.outputs[0], 3.3, (-1220, 200))
    wp = _math(nt, 'MULTIPLY', r_win.outputs[0], 1.4, (-1380, 90))
    wp = _math(nt, 'ADD', wp.outputs[0], 2.2, (-1220, 90))

    vdiv = _math(nt, 'DIVIDE', pos.outputs["Z"], fp.outputs[0], (-1040, 40))
    udiv = _math(nt, 'DIVIDE', u.outputs["Color"], wp.outputs[0], (-1040, -80))
    vf = _math(nt, 'FRACT', vdiv.outputs[0], None, (-880, 40))
    uf = _math(nt, 'FRACT', udiv.outputs[0], None, (-880, -80))

    # a window occupies the middle of each cell; the rest is spandrel/mullion
    vband = nt.nodes.new("ShaderNodeMapRange")
    vband.location = (-720, 40)
    vband.clamp = True
    for k, val in (("From Min", 0.16), ("From Max", 0.30),
                   ("To Min", 0.0), ("To Max", 1.0)):
        vband.inputs[k].default_value = val
    nt.links.new(vf.outputs[0], vband.inputs["Value"])
    vband2 = nt.nodes.new("ShaderNodeMapRange")
    vband2.location = (-720, -110)
    vband2.clamp = True
    for k, val in (("From Min", 0.86), ("From Max", 0.72),
                   ("To Min", 0.0), ("To Max", 1.0)):
        vband2.inputs[k].default_value = val
    nt.links.new(vf.outputs[0], vband2.inputs["Value"])
    vmask = _math(nt, 'MULTIPLY', vband.outputs["Result"],
                  vband2.outputs["Result"], (-540, -30))

    uband = nt.nodes.new("ShaderNodeMapRange")
    uband.location = (-720, -260)
    uband.clamp = True
    for k, val in (("From Min", 0.10), ("From Max", 0.20),
                   ("To Min", 0.0), ("To Max", 1.0)):
        uband.inputs[k].default_value = val
    nt.links.new(uf.outputs[0], uband.inputs["Value"])
    uband2 = nt.nodes.new("ShaderNodeMapRange")
    uband2.location = (-720, -410)
    uband2.clamp = True
    for k, val in (("From Min", 0.90), ("From Max", 0.80),
                   ("To Min", 0.0), ("To Max", 1.0)):
        uband2.inputs[k].default_value = val
    nt.links.new(uf.outputs[0], uband2.inputs["Value"])
    umask = _math(nt, 'MULTIPLY', uband.outputs["Result"],
                  uband2.outputs["Result"], (-540, -340))

    win = _math(nt, 'MULTIPLY', vmask.outputs[0], umask.outputs[0], (-380, -180))

    # kill the pattern on horizontal faces (roofs, setback ledges, boxes)
    nz = _math(nt, 'ABSOLUTE', nrm.outputs["Z"], None, (-540, -520))
    flat = _math(nt, 'LESS_THAN', nz.outputs[0], 0.55, (-380, -520))
    win = _math(nt, 'MULTIPLY', win.outputs[0], flat.outputs[0], (-220, -300))

    # ground floor: taller glazing, so suppress the lattice near street level
    zg = _math(nt, 'SUBTRACT', pos.outputs["Z"], bc.LAND_LEVEL, (-1040, -300))
    shop = nt.nodes.new("ShaderNodeMapRange")
    shop.location = (-880, -300)
    shop.clamp = True
    for k, val in (("From Min", 2.0), ("From Max", 6.5),
                   ("To Min", 0.35), ("To Max", 1.0)):
        shop.inputs[k].default_value = val
    nt.links.new(zg.outputs[0], shop.inputs["Value"])

    # ---- per-window randomness (blinds, occupancy) -----------------------
    ucell = _math(nt, 'FLOOR', udiv.outputs[0], None, (-880, -600))
    vcell = _math(nt, 'FLOOR', vdiv.outputs[0], None, (-880, -700))
    cellvec = nt.nodes.new("ShaderNodeCombineXYZ")
    cellvec.location = (-700, -650)
    nt.links.new(ucell.outputs[0], cellvec.inputs["X"])
    nt.links.new(vcell.outputs[0], cellvec.inputs["Y"])
    nt.links.new(bid.outputs["Fac"], cellvec.inputs["Z"])
    wn = nt.nodes.new("ShaderNodeTexWhiteNoise")
    wn.noise_dimensions = '3D'
    wn.location = (-520, -650)
    nt.links.new(cellvec.outputs["Vector"], wn.inputs["Vector"])

    # ---- distance fade: hand-rolled mipmapping ---------------------------
    # A window cell is ~3 m and its mullions ~0.45 m, so past roughly 600 m
    # the fine detail falls under a pixel. A sharp procedural has no mip
    # chain, so instead of averaging it samples one arbitrary point per pixel
    # and the whole city dissolves into speckle. Fading the pattern toward its
    # own mean is what an image texture's mip levels would do automatically.
    camd = nt.nodes.new("ShaderNodeCameraData")
    camd.location = (-1900, -560)
    fade = nt.nodes.new("ShaderNodeMapRange")
    fade.location = (-1700, -560)
    fade.clamp = True
    for k, val in (("From Min", 320.0), ("From Max", 1700.0),
                   ("To Min", 0.0), ("To Max", 1.0)):
        fade.inputs[k].default_value = val
    nt.links.new(camd.outputs["View Distance"], fade.inputs["Value"])

    # per-pane randomness has to collapse too, or it aliases on its own
    wn_f = _mix(nt, fade.outputs["Result"], wn.outputs["Value"],
                (0.5, 0.5, 0.5, 1.0), (-340, -650))

    # ---- colours ---------------------------------------------------------
    # Glass tint follows the building's own glassiness (bcol alpha), not a
    # blanket blue. A blue-glass tint applied to all 56k buildings drags the
    # whole city cool, because windows cover most of every facade - masonry
    # stock needs a warm dark pane or Manhattan stops looking like Manhattan.
    warm_pane = (0.030, 0.024, 0.019, 1.0)     # punched window, masonry
    cool_pane = (0.011, 0.019, 0.033, 1.0)     # curtain wall, glass tower
    glass = _mix(nt, col.outputs["Alpha"], warm_pane, cool_pane, (-380, 240))
    # a little per-building drift on top so blocks don't read identical
    glass = _mix(nt, r_tint.outputs[0], glass.outputs["Color"],
                 (0.026, 0.027, 0.029, 1.0), (-380, 120))
    # some panes read lighter (blinds down / curtains / unlit interior)
    glass_v = _mix(nt, wn_f.outputs["Color"], glass.outputs["Color"],
                   (0.062, 0.058, 0.052, 1.0), (-200, 240))

    # subtle horizontal slab shadow every floor, independent of the windows
    slab = nt.nodes.new("ShaderNodeMapRange")
    slab.location = (-380, 60)
    slab.clamp = True
    for k, val in (("From Min", 0.0), ("From Max", 0.12),
                   ("To Min", 0.72), ("To Max", 1.0)):
        slab.inputs[k].default_value = val
    nt.links.new(vf.outputs[0], slab.inputs["Value"])
    wall_slab = _mix(nt, 1.0, col.outputs["Color"], slab.outputs["Result"],
                     (-200, 420), blend='MULTIPLY')

    # weathering
    ntex = nt.nodes.new("ShaderNodeTexNoise")
    ntex.location = (-380, 600)
    ntex.inputs["Scale"].default_value = 0.055
    ntex.inputs["Detail"].default_value = 5.0
    ntex.inputs["Roughness"].default_value = 0.62
    grime = _mix(nt, 0.22, wall_slab.outputs["Color"], ntex.outputs["Fac"],
                 (-20, 420), blend='MULTIPLY')

    winfac = _math(nt, 'MULTIPLY', win.outputs[0], shop.outputs["Result"],
                   (-20, -180), clamp=True)
    # 0.42 is roughly the glazed fraction of a facade, so far buildings settle
    # on the colour the window pattern averages to rather than sparkling
    winfac_f = _mix(nt, fade.outputs["Result"], winfac.outputs[0],
                    (0.42, 0.42, 0.42, 1.0), (110, -180))

    base = _mix(nt, winfac_f.outputs["Color"], grime.outputs["Color"],
                glass_v.outputs["Color"], (300, 300))
    nt.links.new(base.outputs["Color"], bsdf.inputs["Base Color"])

    # roughness / metallic follow the faded window mask
    rough = _mix(nt, winfac_f.outputs["Color"], (0.62, 0.62, 0.62, 1.0),
                 (0.07, 0.07, 0.07, 1.0), (300, 120))
    nt.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    metal = _mix(nt, winfac_f.outputs["Color"], (0.0, 0.0, 0.0, 1.0),
                 (0.85, 0.85, 0.85, 1.0), (300, -40))
    nt.links.new(metal.outputs["Color"], bsdf.inputs["Metallic"])

    # normal break-up, also faded - a bump map made of sub-pixel detail is
    # pure noise at distance
    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (500, -260)
    bump.inputs["Strength"].default_value = 0.18
    bump.inputs["Distance"].default_value = 0.05
    nt.links.new(winfac.outputs[0], bump.inputs["Height"])
    bstr = _math(nt, 'SUBTRACT', 1.0, fade.outputs["Result"], (300, -300))
    bstr = _math(nt, 'MULTIPLY', bstr.outputs[0], 0.18, (420, -300))
    nt.links.new(bstr.outputs[0], bump.inputs["Strength"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_roof():
    m, nt = _fresh("MAT_roof")
    bsdf = _principled(nt)
    bsdf.inputs["Roughness"].default_value = 0.86

    n1 = nt.nodes.new("ShaderNodeTexNoise")
    n1.location = (-700, 0)
    n1.inputs["Scale"].default_value = 1.4
    n1.inputs["Detail"].default_value = 6.0
    # Roofs are most of what an aerial camera actually sees, so their noise
    # has to stay coarse. Scale 18 gravel is sub-pixel past a few hundred
    # metres and speckles the whole city from above.
    n2 = nt.nodes.new("ShaderNodeTexNoise")
    n2.location = (-700, -260)
    n2.inputs["Scale"].default_value = 4.5
    n2.inputs["Detail"].default_value = 2.0

    mix = _mix(nt, n1.outputs["Fac"], (0.030, 0.031, 0.034, 1.0),
               (0.088, 0.084, 0.078, 1.0), (-400, 0))
    grit = _mix(nt, 0.16, mix.outputs["Color"], n2.outputs["Fac"],
                (-200, 0), blend='MULTIPLY')
    nt.links.new(grit.outputs["Color"], bsdf.inputs["Base Color"])

    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-200, -300)
    bump.inputs["Strength"].default_value = 0.08
    nt.links.new(n2.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_water():
    m, nt = _fresh("MAT_water")
    bsdf = _principled(nt)
    bsdf.inputs["Base Color"].default_value = (0.005, 0.011, 0.020, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.105
    bsdf.inputs["IOR"].default_value = 1.333

    n1 = nt.nodes.new("ShaderNodeTexNoise")
    n1.location = (-900, -260)
    n1.inputs["Scale"].default_value = 0.9
    n1.inputs["Detail"].default_value = 6.0
    n2 = nt.nodes.new("ShaderNodeTexNoise")
    n2.location = (-900, -520)
    n2.inputs["Scale"].default_value = 6.5
    n2.inputs["Detail"].default_value = 4.0

    b1 = nt.nodes.new("ShaderNodeBump")
    b1.location = (-620, -300)
    b1.inputs["Strength"].default_value = 0.42
    b1.inputs["Distance"].default_value = 0.35
    nt.links.new(n1.outputs["Fac"], b1.inputs["Height"])
    b2 = nt.nodes.new("ShaderNodeBump")
    b2.location = (-380, -300)
    b2.inputs["Strength"].default_value = 0.19
    b2.inputs["Distance"].default_value = 0.06
    nt.links.new(n2.outputs["Fac"], b2.inputs["Height"])
    nt.links.new(b1.outputs["Normal"], b2.inputs["Normal"])
    nt.links.new(b2.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_pond():
    """
    Inland water (Central Park lake, reservoirs, ponds).

    Kept deliberately dull. The open-water material is nearly a mirror, and on
    a small pond viewed from the air that reflects raw sky and reads as a
    blown-out white blob rather than water.
    """
    m, nt = _fresh("MAT_pond")
    bsdf = _principled(nt)
    bsdf.inputs["Base Color"].default_value = (0.010, 0.020, 0.021, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.30
    bsdf.inputs["Metallic"].default_value = 0.0
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = (-560, -240)
    n.inputs["Scale"].default_value = 9.0
    b = nt.nodes.new("ShaderNodeBump")
    b.location = (-300, -240)
    b.inputs["Strength"].default_value = 0.14
    nt.links.new(n.outputs["Fac"], b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_land():
    """Urban ground: a mottled grey that reads as blocks and lots from above."""
    m, nt = _fresh("MAT_land")
    bsdf = _principled(nt)
    bsdf.inputs["Roughness"].default_value = 0.93

    big = nt.nodes.new("ShaderNodeTexNoise")
    big.location = (-760, 60)
    big.inputs["Scale"].default_value = 0.9
    big.inputs["Detail"].default_value = 5.0
    big.inputs["Roughness"].default_value = 0.55

    fine = nt.nodes.new("ShaderNodeTexNoise")
    fine.location = (-760, -220)
    fine.inputs["Scale"].default_value = 14.0
    fine.inputs["Detail"].default_value = 3.0

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-500, 60)
    cr = ramp.color_ramp
    cr.elements[0].position = 0.32
    cr.elements[0].color = (0.036, 0.035, 0.033, 1.0)
    cr.elements[1].position = 0.74
    cr.elements[1].color = (0.072, 0.070, 0.065, 1.0)
    nt.links.new(big.outputs["Fac"], ramp.inputs["Fac"])

    mixed = _mix(nt, 0.18, ramp.outputs["Color"], fine.outputs["Fac"],
                 (-220, 60), blend='MULTIPLY')
    nt.links.new(mixed.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def mat_asphalt():
    m, nt = _fresh("MAT_asphalt")
    bsdf = _principled(nt)
    bsdf.inputs["Roughness"].default_value = 0.68

    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = (-700, 0)
    n.inputs["Scale"].default_value = 5.5
    n.inputs["Detail"].default_value = 5.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-440, 0)
    cr = ramp.color_ramp
    cr.elements[0].position = 0.35
    cr.elements[0].color = (0.017, 0.017, 0.019, 1.0)
    cr.elements[1].position = 0.72
    cr.elements[1].color = (0.040, 0.040, 0.043, 1.0)
    nt.links.new(n.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])

    b = nt.nodes.new("ShaderNodeBump")
    b.location = (-220, -260)
    b.inputs["Strength"].default_value = 0.08
    nt.links.new(n.outputs["Fac"], b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_park():
    m, nt = _fresh("MAT_park")
    bsdf = _principled(nt)
    bsdf.inputs["Roughness"].default_value = 0.95

    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = (-620, 0)
    n.inputs["Scale"].default_value = 2.6
    n.inputs["Detail"].default_value = 8.0
    n.inputs["Roughness"].default_value = 0.65

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-360, 0)
    cr = ramp.color_ramp
    cr.elements[0].position = 0.30
    cr.elements[0].color = (0.017, 0.046, 0.012, 1.0)
    cr.elements[1].position = 0.72
    cr.elements[1].color = (0.068, 0.125, 0.034, 1.0)
    nt.links.new(n.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def mat_tree():
    m, nt = _fresh("MAT_tree")
    bsdf = _principled(nt)
    bsdf.inputs["Roughness"].default_value = 0.92
    obj = nt.nodes.new("ShaderNodeObjectInfo")
    obj.location = (-620, 0)
    # canopy blobs are ~6 m across; noise finer than that just aliases
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = (-620, -240)
    n.inputs["Scale"].default_value = 3.5
    n.inputs["Detail"].default_value = 2.0
    mix = _mix(nt, n.outputs["Fac"], (0.017, 0.043, 0.011, 1.0),
               (0.042, 0.082, 0.022, 1.0), (-340, 0))
    nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def mat_concrete():
    m, nt = _fresh("MAT_concrete")
    bsdf = _principled(nt)
    bsdf.inputs["Roughness"].default_value = 0.72
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = (-620, 0)
    n.inputs["Scale"].default_value = 3.0
    n.inputs["Detail"].default_value = 5.0
    mix = _mix(nt, n.outputs["Fac"], (0.112, 0.110, 0.104, 1.0),
               (0.205, 0.201, 0.192, 1.0), (-340, 0))
    nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    b = nt.nodes.new("ShaderNodeBump")
    b.location = (-340, -260)
    b.inputs["Strength"].default_value = 0.10
    nt.links.new(n.outputs["Fac"], b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_steel():
    m, nt = _fresh("MAT_steel")
    bsdf = _principled(nt)
    bsdf.inputs["Base Color"].default_value = (0.105, 0.101, 0.098, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.88
    bsdf.inputs["Roughness"].default_value = 0.38
    return m


def mat_bridge_cable():
    m, nt = _fresh("MAT_cable")
    bsdf = _principled(nt)
    bsdf.inputs["Base Color"].default_value = (0.062, 0.060, 0.058, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.75
    bsdf.inputs["Roughness"].default_value = 0.45
    return m


def mat_glass():
    m, nt = _fresh("MAT_glass")
    bsdf = _principled(nt)
    bsdf.inputs["Base Color"].default_value = (0.030, 0.045, 0.062, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.055
    bsdf.inputs["Metallic"].default_value = 0.70
    return m


def mat_car_body():
    """Cars are a few pixels from the air, so colour and specular are all that read."""
    m, nt = _fresh("MAT_car")
    bsdf = _principled(nt)
    bsdf.inputs["Roughness"].default_value = 0.16
    bsdf.inputs["Metallic"].default_value = 0.55
    bsdf.inputs["Coat Weight"].default_value = 0.6
    bsdf.inputs["Coat Roughness"].default_value = 0.05

    obj_info = nt.nodes.new("ShaderNodeObjectInfo")
    obj_info.location = (-700, 0)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-440, 0)
    cr = ramp.color_ramp
    cr.interpolation = 'CONSTANT'
    stops = [
        (0.00, (0.30, 0.31, 0.33, 1)),     # silver
        (0.20, (0.62, 0.63, 0.65, 1)),     # white
        (0.42, (0.020, 0.020, 0.022, 1)),  # black
        (0.58, (0.24, 0.035, 0.030, 1)),   # red
        (0.70, (0.78, 0.52, 0.04, 1)),     # taxi yellow
        (0.84, (0.025, 0.060, 0.16, 1)),   # blue
        (0.93, (0.05, 0.13, 0.07, 1)),     # green
    ]
    while len(cr.elements) > 1:
        cr.elements.remove(cr.elements[-1])
    cr.elements[0].position, cr.elements[0].color = stops[0]
    for pos, c in stops[1:]:
        cr.elements.new(pos).color = c
    nt.links.new(obj_info.outputs["Random"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return m


ALL = {
    "MAT_facade": mat_facade,
    "MAT_roof": mat_roof,
    "MAT_water": mat_water,
    "MAT_pond": mat_pond,
    "MAT_land": mat_land,
    "MAT_asphalt": mat_asphalt,
    "MAT_park": mat_park,
    "MAT_tree": mat_tree,
    "MAT_concrete": mat_concrete,
    "MAT_steel": mat_steel,
    "MAT_cable": mat_bridge_cable,
    "MAT_glass": mat_glass,
    "MAT_car": mat_car_body,
}


def ensure_materials():
    return {name: fn() for name, fn in ALL.items()}


if __name__ == "__main__":
    mats = ensure_materials()
    result = {"materials": sorted(mats.keys()), "count": len(mats)}
    print(result)
