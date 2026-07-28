# Shenzhen City — Vision

## Product Vision
A living, explorable 3D night city inspired by Los Angeles and West Coast urbanism. The player walks through distinct districts, meets local scripted characters, and visits a fictional headquarters tower.

## Quality Target
GTA V as a broad quality benchmark — not copy-paste, but the standard for environmental detail, lighting, animation, and polish. Build a small area to AAA quality, then expand district by district.

## Core Experience
1. Walk Dragon Boulevard at night — neon, traffic, pedestrians
2. Visit the Night Market — stalls, shopkeepers, local character
3. Rest in Dragon Pocket Park — quiet green space
4. Enter Shenron HQ — automatic doors, cinematic lobby
5. Ride the elevator to Floor 45 — AI headquarters
6. Meet the agents — interactive NPCs with dialogue
7. Return to the city — seamless, no loading screens

## Art Direction
- Night-time primary, with warm artificial lighting
- LA-inspired: open space, modern architecture, nature integrated
- Neon signage, wet-look roads, atmospheric fog
- Human-scale details: market stalls, benches, street furniture
- The city should feel inhabited, not sterile

## Technical Stack
- Three.js + React Three Fiber (browser-based 3D)
- Zustand (state management)
- Deterministic authored pedestrian routes
- Deterministic swept collision, with rigid bodies deferred until gameplay requires them
- Web Audio (procedural spatial audio)
- Vite (build tooling)
