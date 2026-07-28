# City vertical slice

The first exterior slice turns the headquarters entrance into a short city
journey while preserving the existing lobby, elevator, and floor 45 route.
Everything remains procedural and ships inside the web build.

## Playable route

1. Spawn on the west sidewalk of Dragon Boulevard.
2. Walk past mixed-use storefronts and ambient pedestrians.
3. Explore the night market or Pocket Park.
4. Talk to Mira, the local scripted market keeper.
5. Cross into the headquarters plaza.
6. Enter the lobby, talk to Iris, and take the lift to floor 45.

The City Tour HUD guides those actions as six ordered objectives and ends when
the player inspects a floor 45 office. The reducer ignores skipped and repeated
events, has no persistence, and is fully covered without a browser or GPU.

## Shared world data

`src/world/city-data.ts` is the source of truth for storefronts, market stalls,
trees, lights, ambient routes, the market keeper, and the district bounds.
Rendering and collision both consume the same solid footprints. Validation
tests reject duplicate IDs, invalid dimensions, out-of-bounds routes, and
route segments crossing solid obstacles.

## Runtime budget

- Store windows, trees, lamps, lane marks, and ambient people are instanced.
- Ambient pedestrians use local Yuka steering; their authored paths stay
  renderer-free.
- The objective system updates only when a location or interaction advances it.
- Medium/high postprocessing is lazy-loaded in a separate chunk.
- Detailed planter trees (ez-tree, ~3.9 MB) are a separate chunk too, so the
  entry bundle is 309 kB rather than 3.3 MB gzipped. Low never fetches it.
- Trees are sized in **metres of height**, not by a scale factor: ez-tree
  generates a ~98 m tree at scale 1, so both implementations normalise to the
  requested height. A shared `scale` prop once produced 34 m planter trees.
- No external models, fonts, recorded audio, network calls, or desktop bridge.
  The checked-in PBR textures are CC0 and provenance-recorded.

## Next art milestone

The next art pass can replace procedural storefront shells with reviewed GLB
assets. That is the trigger for a real glTF optimization pipeline and spatial
acceleration review—not before.
