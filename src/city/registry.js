// Shared handles to the ported city-life engine, so React components that are
// not its owner (the HUD, the tile loader) can read state without prop
// drilling. Written once by the pipeline in world/ManhattanCity.tsx.
export const cityWorld = {
  facade: null,
  weather: null,
  lights: null,
  streamer: null,
  streets: null,
  lod: null,
  props: null,
  traffic: null,
  crowd: null,
  subway: null,
  city: null,
  demand: null,
  ready: false,
}
