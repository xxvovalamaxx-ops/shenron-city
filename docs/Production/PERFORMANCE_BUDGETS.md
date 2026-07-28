# Shenzhen City — Performance Budgets

## Target Hardware
- Windows 11, NVIDIA RTX 5070, 32GB RAM, 2560x1080

## Frame Budget (60 FPS = 16.67ms)
| Stage | Budget |
|-------|--------|
| Game logic (collision, AI, audio) | 2ms |
| React reconciliation | 1ms |
| Three.js scene graph | 2ms |
| Draw calls | 3ms |
| GPU | 8ms |
| Headroom | 0.67ms |

## Actor Counts
| Category | Low | Medium | High |
|----------|-----|--------|------|
| Traffic vehicles | 5 | 10 | 16 |
| Ambient pedestrians | 8 | 12 | 20 |
| Street trees | 8 | 13 | 13 |
| Street lights | 6 | 10 | 10 |

## Draw Call Targets
- Total: <200 (medium preset)
- Instanced meshes: <20 draw calls cover 80% of geometry

## VRAM Target
- Textures: <512MB
- Geometry: <256MB
- Total: <1GB at 2560x1080
