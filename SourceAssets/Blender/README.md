# Blender project

`scripts/bootstrap_shenron_city.py` creates a non-destructive Shenzhen City
collection hierarchy, sets metre units, records catalog paths, and saves
`ShenronCity.blend` beside this file.

Run it through the official Blender MCP connector. The `.blend` is a local
authoring file and is ignored by Git until a reviewed Git LFS policy and asset
license plan are approved.

## Official MCP setup

Use Blender Foundation's connector from
<https://www.blender.org/lab/mcp-server/>. It requires Blender 5.1 or newer.

1. Add `https://lab.blender.org/` as a Blender extension repository.
2. Install and enable the `MCP` extension, keep it on loopback
   (`127.0.0.1:9876`), and enable auto-start.
3. Register the MCP server from the official
   `projects.blender.org/lab/blender_mcp` source with the LLM client.
4. Open a clean Blender session, connect the client, and execute
   `scripts/bootstrap_shenron_city.py`.

The official connector can execute generated Python code without strong
sandboxing. Use it only in a workspace without unrelated sensitive files,
review scripts before execution, and never expose its socket beyond loopback.

The bootstrap does not import all FBX clips. Use the animation catalog to bring
only selected, verified motions into a character file.
