// locations.js — the canonical Phase 2O-A benchmark camera registry.
//
// Every location is keyed to documented world coordinates, not a memory of
// where a screenshot was taken. Manhattan locations are given as real
// latitude/longitude and projected with the same constants as the Phase 2
// build (capture.js: LAT0=40.78, LON0=-73.968, x=east, y=north, up=Z).
// Shenron locations are the canonical dev-view cameras in src/gameplay/dev-view.ts.

const LAT0 = 40.78
const LON0 = -73.968
const M_LAT = 110574.0
const M_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180)
const EYE = 1.7

/** Project lat/lon to local metres (x east, y north), matching the build. */
function ll2xy(lat, lon) {
  return { x: (lon - LON0) * M_LON, y: (lat - LAT0) * M_LAT }
}

function xy2ll(x, y) {
  return { lat: LAT0 + y / M_LAT, lon: LON0 + x / M_LON }
}

// name -> { app, camera spec, world coords, note }
// Manhattan camera spec: [lat, lon, alt, yaw, pitch, mode] (capture.js place())
const LOCATIONS = {
  // --- Manhattan (phase-2 app, real addresses) ---
  'times-square': {
    app: 'manhattan',
    spec: [40.7580, -73.9855, EYE, 0.30, 0.14, 'walk'],
    note: 'true Times Square (P2-075 corrected: -1476,-2433; registry "Midtown West / Times Sq")',
  },
  'lincoln-square': {
    app: 'manhattan',
    spec: [40.7746, -73.9905, EYE, 0.30, 0.14, 'walk'],
    note: 'the old mislabelled START (-1900,-600); registry "Upper West Side"',
  },
  'midtown-dense': {
    app: 'manhattan',
    spec: [40.7484, -73.9857, EYE, 0.35, 0.10, 'walk'],
    note: '5th Ave & 34th St',
  },
  'lower-manhattan': {
    app: 'manhattan',
    spec: [40.7069, -74.0100, EYE, 0.9, 0.30, 'walk'],
    note: 'Financial District canyon',
  },
  'manhattan-aerial': {
    app: 'manhattan',
    spec: [40.7570, -73.9855, 500, 0.9, -0.42, 'fly'],
    note: 'midtown from 500 m',
  },
  // --- Shenron (one-Manhattan game, dev-view cameras) ---
  // The old HQ build (hero-boulevard, hq-lobby, elevator, floor 45) was
  // retired by the one-Manhattan refactor; these now point at the live
  // city viewpoints in src/gameplay/dev-view.ts.
  'hero-corridor-exterior': {
    app: 'shenron',
    view: 'midtown-street',
    note: 'street-level walk (dev-view)',
  },
  'hq-plaza': {
    app: 'shenron',
    view: 'times-square',
    note: 'Times Square plaza (dev-view)',
  },
  'hq-lobby': {
    app: 'shenron',
    view: 'financial',
    note: 'Financial District canyon (dev-view)',
  },
  'elevator-interior': {
    app: 'shenron',
    view: 'central-park',
    note: 'Central Park open space (dev-view)',
  },
  'floor45-arrival': {
    app: 'shenron',
    view: 'skyline-south',
    note: 'south skyline elevated (dev-view)',
  },
}

module.exports = { LOCATIONS, ll2xy, xy2ll, LAT0, LON0, M_LAT, M_LON }
