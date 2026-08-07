// bench.test.mjs — unit tests for the pure parts of the Phase 2O-A bench.
//
// Run: node --test scripts/qa/
//
// Everything here imports only pure code: the stats math and camera math from
// apps/manhattan-threejs/src/bench.js (no DOM at module scope) and the data
// re-measurement helpers from bench-run.mjs (guarded so importing them does
// not start the benchmark).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  median, pctl, p95, proj, specToEyeAt, batterySpec,
} from '../../apps/manhattan-threejs/src/bench.js'
import {
  toWgs84, segDist, statePlaneClaim, sidewalkAreaClaim,
} from './bench-run.mjs'

test('median and percentiles', () => {
  assert.equal(median([1, 2, 3, 4, 5]), 3)
  assert.equal(median([1, 2, 3, 4]), 2.5)
  assert.ok(Math.abs(p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) - 9.55) < 1e-9)
  assert.equal(pctl([5, 5, 5], 0.5), 5)
  assert.ok(Number.isNaN(median([])))
  // must not mutate the caller's array
  const a = [3, 1, 2]
  median(a)
  assert.deepEqual(a, [3, 1, 2])
})

test('proj matches capture.js constants', () => {
  // LAT0/LON0 map to the origin
  assert.deepEqual(proj(40.78, -73.968), [0, 0])
  // Times Square: SHOTS.times_square = [40.7580, -73.9855] must land on the
  // documented local-metre position (-1476, -2433) that P2-075 fixed START to
  const [x, y] = proj(40.758, -73.9855)
  assert.ok(Math.abs(x - (-1476)) < 2, `x=${x}`)
  assert.ok(Math.abs(y - (-2433)) < 2, `y=${y}`)
  // 1 degree of latitude is 110574 m by the pipeline's own convention
  const [dx, dy] = proj(40.78 + 1, -73.968)
  assert.ok(Math.abs(dy - 110574) < 1e-6)
  assert.ok(Math.abs(dx) < 1e-6)
})

test('specToEyeAt builds a forward-looking camera', () => {
  const { eye, at, yaw } = specToEyeAt([40.758, -73.9855, 1.7, 0.30, 0.14, 'walk'])
  // world z = -y_m
  assert.ok(Math.abs(eye[2] + (-2433)) < 2, `eye.z=${eye[2]}`)
  // eye altitude above the land plane, kerb in walk mode
  assert.ok(Math.abs(eye[1] - (12 + 1.7)) < 1e-6)
  // forward is (-sin yaw, 0, -cos yaw); the aim point must be down that axis
  const fwd = [-Math.sin(yaw), 0, -Math.cos(yaw)]
  const d = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]]
  const len = Math.hypot(d[0], d[2])
  assert.ok(len > 400)
  assert.ok(Math.abs(d[0] / len - fwd[0]) < 1e-6)
  assert.ok(Math.abs(d[2] / len - fwd[2]) < 1e-6)
})

test('batterySpec sits inside the real world extent', () => {
  // city.json meta.bounds, read from the committed runtime payload
  const b = batterySpec({ x: [-8613.21, 5762.78], y: [-11108.03, 10855.22] })
  assert.equal(b.insideExtent, true)
  assert.equal(b.alt, 1500)
  assert.ok(b.eye[0] > -8613.21 && b.eye[0] < 5762.78)
  assert.ok(b.eye[1] === 1500)
  // off-extent bounds must be caught, not silently accepted
  const off = batterySpec({ x: [-500, 500], y: [-500, 500] })
  assert.equal(off.insideExtent, false)
})

test('nysp port round-trips known landmarks', () => {
  // scripts/phase2/nysp.py CONTROL list
  const controls = [
    ['Empire State Building', -73.985664, 40.74844],
    ['Grand Central Terminal', -73.977295, 40.752726],
    ['One World Trade Center', -74.013382, 40.712742],
    ['Columbus Circle', -73.981926, 40.768045],
    ['The Cloisters', -73.931553, 40.86485],
  ]
  for (const [name, lon, lat] of controls) {
    // convert the State Plane equivalent of the landmark and check the
    // result is within ~1 m of the known WGS84 coordinate (the Python verify
    // bounds this at 2e-8 m for round-trips; this exercises the forward half)
    const mErr = statePlaneError(lat, lon)
    assert.ok(mErr < 1.0, `${name}: ${mErr} m`)
  }
})

test('DOT count points stay near a LION street (the 808-point claim)', () => {
  const sp = statePlaneClaim()
  assert.equal(sp.claimedPoints, 808)
  assert.equal(sp.parsed, 808)
  // every converted point must land within 25 m of a drivable street
  assert.ok(sp.pctWithin25m > 99, `pct=${sp.pctWithin25m}`)
  assert.ok(sp.medianM <= 2.0, `median=${sp.medianM}`)
})

test('sidewalk shoelace matches the file and the report order', () => {
  const sw = sidewalkAreaClaim()
  assert.equal(sw.polygons, 5202)
  // our shoelace must agree with the builder's stated per-ring areas
  assert.ok(Math.abs(sw.statedSumM2 -
    (sw.outerAreaM2 + sw.holeAreaM2)) <
    Math.max(1000, sw.statedSumM2 * 0.001))
  // STREET_REPORT.json claims 6.97 km2 net; the honest recomputation must be
  // within a percent of it
  assert.ok(Math.abs(sw.netAreaM2 - 6969269) / 6969269 < 0.01,
    `net=${sw.netAreaM2}`)
})

test('segDist matches the reference geometry', () => {
  // a point 3 m off the middle of a 10 m horizontal segment
  const d = segDist(5, 3, 0, 0, 10, 0)
  assert.equal(d, 3)
  // beyond the ends, distance is to the nearest endpoint
  assert.equal(segDist(13, 0, 0, 0, 10, 0), 3)
  // degenerate segment
  assert.equal(segDist(2, 2, 1, 1, 1, 1), Math.hypot(1, 1))
})

// forward EPSG:2263, mirroring nysp.py's to_sp, to drive the inverse check
const FT_US = 1200 / 3937
const rad = (d) => (d * Math.PI) / 180
function statePlaneError(latDeg, lonDeg) {
  const lat = rad(latDeg)
  const lon = rad(lonDeg)
  const A = 6378137.0
  const F = 1 / 298.257222101
  const E2 = F * (2 - F)
  const E = Math.sqrt(E2)
  const mFn = (la) => Math.cos(la) / Math.sqrt(1 - E2 * Math.sin(la) ** 2)
  const tFn = (la) => {
    const es = E * Math.sin(la)
    return Math.tan(Math.PI / 4 - la / 2) / ((1 - es) / (1 + es)) ** (E / 2)
  }
  const LAT1 = rad(40 + 40 / 60)
  const LAT2 = rad(41 + 2 / 60 + 20 / 3600)
  const LAT0 = rad(40 + 10 / 60)
  const M1 = mFn(LAT1)
  const M2 = mFn(LAT2)
  const T1 = tFn(LAT1)
  const T2 = tFn(LAT2)
  const T0 = tFn(LAT0)
  const N = (Math.log(M1) - Math.log(M2)) / (Math.log(T1) - Math.log(T2))
  const F0 = M1 / (N * T1 ** N)
  const R0 = A * F0 * T0 ** N
  const r = A * F0 * tFn(lat) ** N
  const theta = N * (lon - rad(-74))
  const xFt = (984250.0 * FT_US + r * Math.sin(theta)) / FT_US
  const yFt = (R0 - r * Math.cos(theta)) / FT_US
  const [lon2, lat2] = toWgs84(xFt, yFt)
  const dx = (lon2 - lonDeg) * 111320 * Math.cos(rad(latDeg))
  const dy = (lat2 - latDeg) * 110574
  return Math.hypot(dx, dy)
}
