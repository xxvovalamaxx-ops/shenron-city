export declare const cityWorld: {
  facade: import('./facade.js').FacadeMaterial | null
  weather: import('./weather.js').Weather | null
  lights: { sun: import('three').DirectionalLight; hemi: import('three').HemisphereLight; fill: import('three').DirectionalLight } | null
  streamer: import('./streamer.js').TileStreamer | null
  streets: import('./streamer.js').TileStreamer | null
  lod: import('./lod.js').LodLayer | null
  props: import('./props.js').StaticProps | null
  traffic: import('./traffic.js').Traffic | null
  crowd: import('./pedestrians.js').Crowd | null
  subway: import('./subway.js').Subway | null
  interiors: import('./interiors.js').Interiors | null
  hq: import('./hq.js').HQ | null
  doors: import('./doors.js').Doors | null
  city: import('./city.js').City | null
  demand: import('./demand.js').Demand | null
  ready: boolean
}
