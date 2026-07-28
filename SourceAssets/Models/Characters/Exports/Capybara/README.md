# Capybara character

The Shenzhen City capybara is a browser-ready, anatomically reconstructed adult
animal authored in Blender 5.1 through Blender Foundation's official MCP
connector.

## Reviewed outputs

- `capybara_animated.glb` is the textured authoring export.
- `capybara_animated_side.png`, `capybara_animated_three_quarter.png`, and
  `capybara_animated_front.png` are neutral-pose inspection renders.
- `capybara_pose_walk.png`, `capybara_pose_graze.png`, and
  `capybara_pose_sit.png` inspect representative deformation poses.
- `../../Source/Capybara/capybara_rigged.blend` is the editable, LFS-tracked
  artist master.
- `../../../../Blender/scripts/rig_capybara.py` deterministically rebuilds the
  textures, rig, actions, previews, authoring GLB, and runtime GLB.

The production runtime file is
`public/models/animals/capybara/capybara.glb`.

## Verified asset facts

- 1.24 m long, 0.46 m wide, and 0.58 m high
- 37,374 vertices and 74,744 triangles
- one portable PBR material with a 2K albedo and 1K normal/roughness maps
- 43 deform bones, at most four influences per vertex, and no unweighted
  vertices
- 21 named animation actions, including locomotion, idle, grazing, drinking,
  sitting, sleeping, startle, vocalization, and swimming
- glTF 2.0 without Draco, remote textures, or runtime decoder dependencies

The exact reconstruction and image provenance is recorded in
`../../Source/Capybara/PROVENANCE.md`.
