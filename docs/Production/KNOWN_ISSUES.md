# Shenzhen City — Known Issues

## Current
- The Quaternius hero and pedestrian foundation is adult-proportioned and animated but
  remains stylized; it does not satisfy the realistic-human or conversation-closeup gate.
- The project has no production facial rig, viseme playback, eye moisture, hair-card, or
  four-level character LOD pipeline.
- The authored skyline is still dominated by one headquarters tower; a complete optimized
  distant skyline cluster remains missing.
- Vehicle families have animated wheels and responsive lamps, but no steering pivots,
  suspension rigs, texture-baked wear sets, or explicit LOD meshes.
- Static production GLBs are material-batched but have no embedded `MSFT_lod` hierarchy.
- Headquarters lobby and Floor 45 need more close-range prop and material detail.
- The six market stalls have authored structure and merchandise, but the current goods are
  modular forms rather than scanned or high-detail hero products.
- The 4 MB tree code chunk remains large even though it is lazy-loaded.
- High-preset Chromium telemetry did not prove the 60 FPS / 45 FPS 1%-low target.
- No complete gameplay recording, LUFS result, true-peak result, or stable GPU-memory
  capture exists for Production Pass 02.
- Automated Chromium cannot exercise normal pointer lock; the validation query disables
  PointerLockControls while preserving normal focused-browser behavior.
- Only two elevator destinations are implemented: Lobby and Floor 45.

## Deferred
- Legally distributable realistic hero and pedestrian character production
- Embedded model LODs, KTX2/Basis textures, and measured zone streaming
- Enterable storefront interiors
- Additional named-character motion-state integration
- Optional coherent weather states
- Per-bus audio controls beyond the existing master-volume slider
