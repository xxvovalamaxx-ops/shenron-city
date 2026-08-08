# Stage 0C — which system actually renders each surface

Read from source at `5d78d5054`, not guessed. Every claim below names the line
that makes it true.

The brief asks for one authority per concern and for "runtime assertions
[that] expose which material system is bound to each streamed building tier".
Runtime assertions need a runtime; `src/city/traffic.js` currently has a parse
error from a concurrent edit by another session (see OPUS-006), so the game
cannot boot and this pass is static. The runtime assertion is still owed and is
tracked as 0C.2.

## What is mounted

`App.tsx`'s `<Scene>` mounts, in tree order:

    AtmosphericDust, CityLightingRig, DayCycle, DevSpawns, GameLoop,
    IntroCamera, ManhattanCity, NightEnvironment, PlayerAvatar,
    RendererBridge, ShadowBudget, VehicleRig

`ManhattanCity` is mounted with `mode="tiles"`.

## Finding 1 — the building night material never runs

| surface | material | how |
|---|---|---|
| streamed `BLD_*` | `FacadeMaterial` | `streamer.js:202` `o.material = this.injected`, injected by `CityPipeline` as `this.facade.material` |
| `ROAD_*` inside building tiles | `getRoadNightMaterial` | `ManhattanCity.tsx:413`, in `_onTileReady` |
| street-tile surfaces | streamer's own `plainMaterial`, or the authored material kept | `streamer.js:204-209` |
| `LAND_/WATER_/PARK_/BRIDGE_` | authored material kept | `streamer.js:206` — they carry no `COLOR_0`, so injecting would flatten them to grey |

`getBuildingNightMaterial` has exactly one call site: `ManhattanCity.tsx:102`,
inside `prepareFallbackMaterials`. That function is called only from the
`mode === 'full'` effect, which returns immediately unless the mode is `full`
(`ManhattanCity.tsx:608`). The game mounts `mode="tiles"`.

**So `getBuildingNightMaterial` never executes in the shipping game.** It is
a second building-material system, complete with quality presets, that no
streamed building has ever been rendered with. Either the tiles path should be
using it or it should go; deciding that is 0C.3, and it needs a visual
comparison, not a grep.

## Finding 2 — a night HDR lights the city at every hour

`NightEnvironment.tsx:38-39` sets `scene.environment` to a PMREM of
`/hdr/modern_buildings_night_1k.hdr` and pins `scene.environmentIntensity`.

The effect's dependency array is `[gl, scene]`. Neither changes after mount.
There is no reference to the clock, the hour, or the weather anywhere in the
file. The environment map is therefore applied **once and permanently**, and it
is a *night* map.

This is the defect the brief names in as many words: "No fixed night HDR
lighting the daytime city incorrectly." It is now located, at
`src/world/NightEnvironment.tsx:23-58`.

## Finding 3 — background and fog have one owner, and it is not the one you would guess

Three files write `scene.background` or `scene.fog`:

- `city/sky.js:15,18` — `buildSky()` sets both, once, from the `CityPipeline`
  constructor.
- `city/weather.js:219-226` — updates the background sky and the fog colour,
  near and far every frame from the clock.
- `world/SkyRig.tsx:88` — writes `scene.background` when it is a `Color`.

The first two are the same subsystem and cooperate by design: `buildSky`
installs, `Weather` drives. **`SkyRig` is not mounted** — it is imported by
nothing (`CityLightingRig.tsx:5` mentions it in a comment, which is how it
looks alive). So there is no background fight today; there is one dead file
that would start one if it were ever mounted.

`ManhattanCity.tsx:569` clears `scene.fog` on dispose, which is correct
teardown for a fog the pipeline installed.

## Verdict

The brief expected "no two components fighting over background, fog, exposure
or sun". Measured: nothing is fighting. What is actually wrong is quieter and
worse — **two of the systems are not running at all**, and the one that is
running unconditionally applies night lighting to a city with a day/night
clock.

Dead on the shipping path:
- `getBuildingNightMaterial` (reachable only in `mode="full"`)
- `SkyRig.tsx` (imported nowhere)

Wrong on the shipping path:
- `NightEnvironment` — night HDR, no clock dependency, permanent

## Owed

- **0C.1** Make `scene.environment` follow the clock, or stop applying a night
  map at midday. Needs a decision on where the day environment comes from.
- **0C.2** The runtime assertion the brief asks for: report, per streamed tier,
  which material instance is bound. Blocked until the tree compiles.
- **0C.3** Decide the fate of `getBuildingNightMaterial` and `SkyRig` — adopt
  or delete, with a visual comparison behind the choice. Deleting a system
  because it is unreferenced is right; deleting it because a grep missed a
  dynamic import is not, so check both.
