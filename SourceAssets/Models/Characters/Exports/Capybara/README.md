# Capybara character

High-detail procedural capybara created for Shenron City in Blender 5.1 through
Blender Foundation's official MCP connector.

## Files

- `capybara.glb` is the Draco-compressed portable review/export asset.
- `capybara_preview.png` is the 1200x900 Cycles portrait.
- `../../Working/Capybara/Capybara.blend` is the editable local master. It
  remains ignored by Git under the repository's large-binary policy.
- `../../../../Blender/scripts/create_capybara.py` deterministically rebuilds
  every generated asset from seed `20260728`.

## Asset facts

- 28,000 tapered fur strands
- 26 whiskers
- layered eyes, corneas, eyelids, ears, nostrils, mouth, paws, and 12 claws
- 31 GLB meshes, 11 materials, 695,103 vertices, and 658,520 triangles
- metric authoring scale, +X forward, glTF 2.0 portable export

The model and materials are original procedural work for Shenron City; no
third-party model, texture, or generated-image service is used.

This is the high-detail authoring version. Create reviewed LODs and collision
geometry before loading it in the browser game.
