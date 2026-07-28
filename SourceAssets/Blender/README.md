# Blender project

`scripts/bootstrap_shenron_city.py` creates a non-destructive Shenron City
collection hierarchy, sets metre units, records catalog paths, and saves
`ShenronCity.blend` beside this file.

Run it through the official Blender MCP connector. The `.blend` is a local
authoring file and is ignored by Git until a reviewed Git LFS policy and asset
license plan are approved.

The bootstrap does not import all FBX clips. Use the animation catalog to bring
only selected, verified motions into a character file.
