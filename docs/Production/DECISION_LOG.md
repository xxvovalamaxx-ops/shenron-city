# Shenron City — Decision Log

## 2026-07-28: Stack Decision
**Decision**: Three.js + React Three Fiber (not Unreal Engine)
**Rationale**: Browser-based deployment, no installation required, rapid iteration, existing expertise
**Trade-off**: Lower visual ceiling than Unreal, but faster time-to-playable

## 2026-07-28: NPC AI
**Decision**: Yuka steering behaviors (not behavior trees)
**Rationale**: Lightweight, path-following + obstacle avoidance covers ambient crowd needs
**Trade-off**: No high-level planning, but named NPCs use scripted dialogue instead

## 2026-07-28: Audio
**Decision**: Fully procedural Web Audio (no audio files)
**Rationale**: Zero download time, infinite variation, smaller bundle
**Trade-off**: Less realistic than recorded ambience, but more dynamic

## 2026-07-28: Collision
**Decision**: Custom AABB system + Rapier for static colliders
**Rationale**: Custom system gives full control for player movement; Rapier handles world geometry
**Trade-off**: Two collision systems, but each optimized for its use case

## 2026-07-28: Mission Control
**Decision**: Removed entirely — standalone game only
**Rationale**: User requested no external connections
**Trade-off**: No live data, but game is fully self-contained
