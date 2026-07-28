# Shenzhen City — Decision Log

## 2026-07-28: Stack Decision
**Decision**: Three.js + React Three Fiber (not Unreal Engine)
**Rationale**: Browser-based deployment, no installation required, rapid iteration, existing expertise
**Trade-off**: Lower visual ceiling than Unreal, but faster time-to-playable

## 2026-07-28: Ambient crowd
**Decision**: Deterministic authored routes shared by meshes and collision
**Rationale**: One pure route sampler keeps every visible pedestrian and solid body frame-exact across quality presets
**Trade-off**: No local obstacle avoidance yet; named NPCs remain scripted and deterministic

## 2026-07-28: Living city character pass
**Decision**: Replace capsule placeholders with a shared articulated procedural citizen rig and instanced limb animation
**Rationale**: Distinct silhouettes, opposing arm/leg gait, role clothing, and full-height collision improve the recorded vertical slice without adding downloads or breaking the standalone boundary
**Trade-off**: The cast is intentionally stylized until a reviewed, licensed skinned-character pipeline is ready

## 2026-07-28: Audited CC0 character and city imports
**Decision**: Replace the procedural pedestrian cast and selected city blockouts with a small, hash-pinned CC0 Kenney set while retaining authored gameplay bounds as collision authority
**Rationale**: Six skinned citizen variants, three real skeletal clips, selected commercial buildings, vegetation, and traffic shells improve the playable route without publishing the unproven 2,393-file historical animation archive
**Trade-off**: The current citizen Run clip is slowed for locomotion and the cast remains stylized; broader motion coverage requires separately reviewed CC0 or project-authored clips

## 2026-07-28: Quaternius motion library
**Decision**: Ship one clothed Quaternius hero with 29 implemented motions selected from the 86 clips in two free CC0 Standard archives
**Rationale**: The Male Ranger and both animation packs share an exact 65-joint hierarchy, so the Blender build can preserve authored motion without unsafe retargeting or publishing the unproven historical FBX archive
**Trade-off**: The free Standard downloads do not contain every motion advertised in the larger packs, and only Kai currently consumes the library; additional roles require explicit gameplay bindings and performance review

## 2026-07-28: Night Market identity
**Decision**: Give each existing stall a validated, distinct procedural inventory rather than adding more stalls or downloading prop packs
**Rationale**: Ramen bowls, tea tins, flower pots, book stacks, cloth valances, and lantern practicals make the recorded route legible as a market while preserving the standalone boundary and collision footprint
**Trade-off**: The stalls remain non-enterable set pieces; full interiors stay deferred

## 2026-07-28: Night exposure
**Decision**: Calibrate one subdued ACES night pipeline with a reduced HDR contribution and restrained bloom
**Rationale**: The previous HDR, practicals, and postprocessing stacked into clipped white facades and floors; the new balance preserves material color in the market, lobby, and Floor 45
**Trade-off**: Bright practicals carry less exaggerated cyberpunk glow in exchange for readable surfaces

## 2026-07-28: Audio
**Decision**: Fully procedural Web Audio (no audio files)
**Rationale**: Zero download time, infinite variation, smaller bundle
**Trade-off**: Less realistic than recorded ambience, but more dynamic

## 2026-07-28: Collision
**Decision**: One custom swept capsule-vs-AABB authority
**Rationale**: Rapier duplicated fixed geometry but owned no player, NPC, vehicle, or prop body. Shared renderer-free solid records now keep visible props and collision exact.
**Trade-off**: Dynamic rigid bodies remain deferred until a concrete gameplay feature needs them.

## 2026-07-28: Destructible props
**Decision**: Destructible objects are unique authored props with collision generated from the same registry
**Rationale**: The first destruction pass duplicated lobby, market, and office geometry at unrelated coordinates; it placed a desk in the critical lobby route while every breakable remained walk-through. One small registry now owns rendering, damage, and active solid bounds, and destroyed props leave collision immediately.
**Trade-off**: Only a reviewed set of supply crates and one side-bay desk are destructible until existing architectural meshes can opt into the same authority without duplicate rendering.

## 2026-07-28: Mission Control
**Decision**: Removed entirely — standalone game only
**Rationale**: User requested no external connections
**Trade-off**: No live data, but game is fully self-contained
