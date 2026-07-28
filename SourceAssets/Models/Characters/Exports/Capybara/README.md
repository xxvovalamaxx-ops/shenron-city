# Capybara character

An anatomically reconstructed adult capybara for Shenron City, authored in
Blender 5.1 through Blender Foundation's official MCP connector.

## Files

- `capybara.glb` is the Draco-compressed, textured portable asset.
- `capybara_preview.png`, `capybara_side.png`, and `capybara_face.png` are
  inspection renders from the editable Blender scene.
- `../../Source/Capybara/` contains the reviewed reconstruction inputs, the
  generated source mesh, and the final baked albedo.
- `../../Working/Capybara/Capybara.blend` is the editable local master. It
  remains ignored by Git under the repository's large-binary policy.
- `../../../../Blender/scripts/create_capybara.py` rebuilds the scale,
  materials, final UV bake, inspection renders, and GLB.

## Asset facts

- real-world dimensions: 1.24 m long, 0.46 m wide, and 0.58 m high
- 76,939 render vertices and 97,800 triangles
- one portable PBR material with a 2,048 px baked albedo
- metric authoring scale, +X anatomical forward, glTF 2.0 export
- no procedural sphere/box anatomy and no copied third-party wildlife mesh

The reconstruction and image-generation provenance is recorded in
`../../Source/Capybara/PROVENANCE.md`.

This is a high-detail authoring/review asset. Create reviewed LODs, a rig, and
simple collision geometry before loading it in the browser game.
