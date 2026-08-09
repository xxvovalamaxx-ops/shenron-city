// locations.js — the canonical benchmark camera registry.
//
// Every location is keyed to documented world coordinates, not a memory of
// where a screenshot was taken. Manhattan locations are given as real
// latitude/longitude and projected with the same constants as the Phase 2
// build (capture.js: LAT0=40.78, LON0=-73.968, x=east, y=north, up=Z).
// Shenron locations are the canonical dev-view cameras in src/gameplay/dev-view.ts.
//
// Two kinds of staleness were cleaned up here, both of the same species: an
// entry that reads as authoritative and measures something else.
//
//   1. Five locations targeted `app: 'manhattan'` — the Phase 2 reference
//      application, which the one-Manhattan consolidation removed from the
//      repo. There is one game now. The runner already refused them, and said
//      so clearly, but nothing in this registry recorded it: the entries read
//      exactly like the runnable ones, and `--location times-square` was the
//      default. They are kept here, marked retired with the reason, because
//      their coordinates are real surveyed positions worth not losing — but
//      they cannot be run, and now they say that themselves.
//
//   2. Four Shenron locations still carried the retired HQ build's names while
//      pointing at unrelated cameras. `elevator-interior` aimed at Central
//      Park; `hq-lobby` at the Financial District canyon. A regression in
//      "elevator-interior" would have been a regression in an open park, and
//      the name is what ends up in the report. They are renamed for what they
//      are, with the old keys kept as aliases so evidence already filed under
//      them still resolves.

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

/** Why an app can no longer be benchmarked, keyed by app name. */
const RETIRED_APPS = {
  manhattan:
    'the Phase 2 reference application was removed by the one-Manhattan ' +
    'consolidation — there is one game, and it is `shenron`',
}

// name -> { app, camera spec, world coords, note }
// Manhattan camera spec: [lat, lon, alt, yaw, pitch, mode] (capture.js place())
const LOCATIONS = {
  // --- Manhattan (phase-2 app, real addresses) — RETIRED, see header ---
  'times-square': {
    app: 'manhattan',
    retired: 'manhattan',
    spec: [40.758, -73.9855, EYE, 0.3, 0.14, 'walk'],
    note: 'true Times Square (P2-075 corrected: -1476,-2433; registry "Midtown West / Times Sq")',
  },
  'lincoln-square': {
    app: 'manhattan',
    retired: 'manhattan',
    spec: [40.7746, -73.9905, EYE, 0.3, 0.14, 'walk'],
    note: 'the old mislabelled START (-1900,-600); registry "Upper West Side"',
  },
  'midtown-dense': {
    app: 'manhattan',
    retired: 'manhattan',
    spec: [40.7484, -73.9857, EYE, 0.35, 0.1, 'walk'],
    note: '5th Ave & 34th St',
  },
  'lower-manhattan': {
    app: 'manhattan',
    retired: 'manhattan',
    spec: [40.7069, -74.01, EYE, 0.9, 0.3, 'walk'],
    note: 'Financial District canyon',
  },
  'manhattan-aerial': {
    app: 'manhattan',
    retired: 'manhattan',
    spec: [40.757, -73.9855, 500, 0.9, -0.42, 'fly'],
    note: 'midtown from 500 m',
  },

  // --- Shenron (the game) — named for the camera they actually point at ---
  'midtown-street': {
    app: 'shenron',
    view: 'midtown-street',
    note: 'street-level walk (dev-view) — the hero corridor',
    aliases: ['hero-corridor-exterior'],
  },
  'times-square-plaza': {
    app: 'shenron',
    view: 'times-square',
    note: 'Times Square plaza (dev-view)',
    aliases: ['hq-plaza'],
  },
  'financial-canyon': {
    app: 'shenron',
    view: 'financial',
    note: 'Financial District canyon (dev-view)',
    aliases: ['hq-lobby'],
  },
  'central-park-open': {
    app: 'shenron',
    view: 'central-park',
    note: 'Central Park open space (dev-view) — the low-density counterweight',
    aliases: ['elevator-interior'],
  },
  'skyline-south': {
    app: 'shenron',
    view: 'skyline-south',
    note: 'south skyline elevated (dev-view)',
    aliases: ['floor45-arrival'],
  },
}

/** Old name -> current name, built from the `aliases` above. */
const ALIASES = {}
for (const [name, loc] of Object.entries(LOCATIONS)) {
  for (const alias of loc.aliases ?? []) ALIASES[alias] = name
}

/**
 * Resolve a location name, following aliases.
 *
 * Returns `{ name, location }` with the canonical name, or null when the name
 * is unknown. Callers report the canonical name so a report never carries a
 * retired label for a camera that is somewhere else entirely.
 */
function resolveLocation(name) {
  const canonical = LOCATIONS[name] ? name : ALIASES[name]
  if (!canonical) return null
  return { name: canonical, location: LOCATIONS[canonical], alias: canonical !== name ? name : null }
}

/** Location names that can actually be benchmarked today. */
function runnableLocations() {
  return Object.keys(LOCATIONS).filter((n) => !LOCATIONS[n].retired)
}

/**
 * Why this location cannot be run, or null if it can.
 *
 * A string rather than a boolean so the runner can say what happened. A
 * benchmark that fails with "timed out waiting for window.__manhattan" sends
 * the reader looking for a load bug that does not exist.
 */
function retirementReason(name) {
  const hit = resolveLocation(name)
  if (!hit) return `unknown location "${name}"`
  if (!hit.location.retired) return null
  return (
    `location "${hit.name}" targets the retired app "${hit.location.app}": ` +
    (RETIRED_APPS[hit.location.retired] ?? 'retired')
  )
}

module.exports = {
  LOCATIONS,
  ALIASES,
  RETIRED_APPS,
  resolveLocation,
  runnableLocations,
  retirementReason,
  ll2xy,
  xy2ll,
  LAT0,
  LON0,
  M_LAT,
  M_LON,
}
