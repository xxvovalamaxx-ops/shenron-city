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

## Shared world data

`src/world/city-data.ts` is the source of truth for storefronts, market stalls,
trees, lights, ambient routes, the market keeper, and the district bounds.
Rendering and collision both consume the same solid footprints. Validation
tests reject duplicate IDs, invalid dimensions, out-of-bounds routes, and
route segments crossing solid obstacles.

## Runtime budget

- Store windows, trees, lamps, lane marks, and ambient people are instanced.
- Ambient population scales from 5 to 18 with the quality preset.
- Pedestrians sample constant-speed authored loops with no navigation runtime.
- Medium/high postprocessing is lazy-loaded in a separate chunk.
- No external models, textures, fonts, audio, network calls, or desktop bridge.

## Next art milestone

The next art pass can replace procedural storefront shells with reviewed GLB
assets. That is the trigger for a real glTF optimization pipeline and spatial
acceleration review—not before.
