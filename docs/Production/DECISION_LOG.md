# Shenron City — Decision Log

## 2026-07-28: Stack Decision
**Decision**: Three.js + React Three Fiber (not Unreal Engine)
**Rationale**: Browser-based deployment, no installation required, rapid iteration, existing expertise
**Trade-off**: Lower visual ceiling than Unreal, but faster time-to-playable

## 2026-07-28: Ambient crowd
**Decision**: Deterministic authored routes shared by meshes and collision
**Rationale**: One pure route sampler keeps every visible pedestrian and solid body frame-exact across quality presets
**Trade-off**: No local obstacle avoidance yet; named NPCs remain scripted and deterministic

## 2026-07-28: Audio
**Decision**: Fully procedural Web Audio (no audio files)
**Rationale**: Zero download time, infinite variation, smaller bundle
**Trade-off**: Less realistic than recorded ambience, but more dynamic

## 2026-07-28: Collision
**Decision**: One custom swept capsule-vs-AABB authority
**Rationale**: Rapier duplicated fixed geometry but owned no player, NPC, vehicle, or prop body. Shared renderer-free solid records now keep visible props and collision exact.
**Trade-off**: Dynamic rigid bodies remain deferred until a concrete gameplay feature needs them.

## 2026-07-28: Mission Control
**Decision**: Removed entirely — standalone game only
**Rationale**: User requested no external connections
**Trade-off**: No live data, but game is fully self-contained
