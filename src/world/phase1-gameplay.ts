import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

import type { Vec3 } from '../gameplay/collision'
import { manhattanCollision } from './manhattan-collision'
import {
  PHASE1_AOI_SIZE_METERS,
  PHASE1_GEO_TRANSFORM,
} from './phase1-contract'

export const PHASE1_GAMEPLAY_MANIFEST_URL =
  '/tests/fixtures/manhattan-phase1/generated/gameplay/manifest.json'

interface GameplayBounds {
  minEast: number
  minNorth: number
  maxEast: number
  maxNorth: number
}

interface GameplayManifestTile {
  tileId: string
  boundsHqLocal: GameplayBounds
  collisionUri: string
  buildingCount: number
  buildingIds: string[]
}

interface GameplayManifest {
  schemaVersion: 2
  generatedBy: string
  sourceId: string
  sourceHash: string
  normalizedDerivationSha256: string
  coordinateSpace: 'hq-local-meters'
  activationRadiusMeters: number
  tiles: GameplayManifestTile[]
}

interface ColliderRecord {
  buildingId: string
  footprintLocal: [number, number][]
  minY: number
  maxY: number
}

interface ColliderTile {
  schemaVersion: 2
  tileId: string
  sourceId: string
  tileOriginMeters: [number, number]
  sourceHash: string
  normalizedDerivationSha256: string
  colliders: ColliderRecord[]
}

export interface Phase1GameplayDiagnostics {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'disposed'
  residentTileIds: string[]
  pendingTileIds: string[]
  colliderCount: number
  loads: number
  disposals: number
  errors: number
}

interface CollisionRegistry {
  baseReady: boolean
  registerGround(mesh: THREE.Mesh): void
  unregisterGround(mesh: THREE.Mesh): void
  registerInterior(root: THREE.Object3D): void
  unregisterTileBuildings(root: THREE.Object3D): void
}

interface PendingTile {
  controller: AbortController
  promise: Promise<void>
}

interface ResidentTile {
  root: THREE.Group
  colliderCount: number
}

export interface Phase1GameplayOptions {
  manifestUrl?: string
  expectedSourceHash?: string
  expectedNormalizedDerivationSha256?: string
  expectedTileIds?: readonly string[]
  fetchJson?: (url: string, signal: AbortSignal) => Promise<unknown>
  collision?: CollisionRegistry
  onDiagnostics?: (diagnostics: Readonly<Phase1GameplayDiagnostics>) => void
}

const UNLOAD_HYSTERESIS_METERS = 64
const CONTRACT_EPSILON = 1e-6
const SHA256 = /^[a-f0-9]{64}$/
const TILE_ID = /^([1-9][0-9]*)_([pm])([0-9]{3})_([pm])([0-9]{3})$/
const AXIS_CONVENTION = 'x-east-y-up-z-negative-north'
const COLLIDER_COORDINATE_SPACE = 'tile-local-horizontal-plus-hq-local-y-up-meters'
const FOOTPRINT_AXIS_ORDER = ['tile-local-east', 'tile-local-negative-north']
const TILE_ORIGIN_AXIS_ORDER = ['hq-local-east', 'hq-local-north']

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite`)
  }
  return value
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function hash(value: unknown, label: string): string {
  const parsed = string(value, label)
  if (!SHA256.test(parsed)) throw new Error(`${label} must be a lowercase SHA-256 hash`)
  return parsed
}

function exactStringArray(value: unknown, expected: readonly string[], label: string): void {
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw new Error(`${label} must contain ${expected.join(', ')}`)
  }
  value.forEach((entry, index) => {
    if (entry !== expected[index]) throw new Error(`${label} must contain ${expected.join(', ')}`)
  })
}

function sortedUniqueStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  const parsed = value.map((entry, index) => string(entry, `${label}[${index}]`))
  const sorted = [...parsed].sort()
  if (new Set(parsed).size !== parsed.length || parsed.some((entry, index) => entry !== sorted[index])) {
    throw new Error(`${label} must be unique and lexically sorted`)
  }
  return parsed
}

function exactStringList(value: unknown, expected: readonly string[], label: string): void {
  const parsed = sortedUniqueStrings(value, label)
  if (parsed.length !== expected.length || parsed.some((entry, index) => entry !== expected[index])) {
    throw new Error(`${label} does not match the gameplay manifest`)
  }
}

function expectedNumber(value: unknown, expected: number, label: string): number {
  const parsed = finite(value, label)
  if (Math.abs(parsed - expected) > CONTRACT_EPSILON) {
    throw new Error(`${label} must be ${expected}`)
  }
  return parsed
}

function parseVerticalReference(value: unknown, label: string): void {
  const raw = object(value, label)
  const expected = {
    hqAnchorVerticalDatum: 'NAVD88',
    normalizedUpFormula: 'sourceGroundElevationMeters - hqGeoAnchor.elevationMeters',
    sourceDatumRelation: 'same-as-hq-anchor',
    sourceGroundElevationVerticalDatum: 'NAVD88',
  } as const
  for (const [field, contract] of Object.entries(expected)) {
    if (raw[field] !== contract) throw new Error(`${label}.${field} must be ${contract}`)
  }
}

function tileOrigin(tileId: string, label: string): [number, number] {
  const match = TILE_ID.exec(tileId)
  if (!match) throw new Error(`${label} must use <size>_<p|m><xxx>_<p|m><xxx> notation`)
  const size = Number(match[1])
  if (size !== 256) throw new Error(`${label} tile size must be 256`)
  const eastIndex = Number(match[3]) * (match[2] === 'm' ? -1 : 1)
  const northIndex = Number(match[5]) * (match[4] === 'm' ? -1 : 1)
  if ((match[2] === 'm' && eastIndex === 0) || (match[4] === 'm' && northIndex === 0)) {
    throw new Error(`${label} must encode zero with p000`)
  }
  return [eastIndex * size, northIndex * size]
}

function orientation(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function onSegment(a: [number, number], b: [number, number], point: [number, number]): boolean {
  return (
    Math.min(a[0], b[0]) - CONTRACT_EPSILON <= point[0] &&
    point[0] <= Math.max(a[0], b[0]) + CONTRACT_EPSILON &&
    Math.min(a[1], b[1]) - CONTRACT_EPSILON <= point[1] &&
    point[1] <= Math.max(a[1], b[1]) + CONTRACT_EPSILON
  )
}

function segmentsIntersect(
  a0: [number, number],
  a1: [number, number],
  b0: [number, number],
  b1: [number, number],
): boolean {
  const aa = orientation(a0, a1, b0)
  const ab = orientation(a0, a1, b1)
  const ba = orientation(b0, b1, a0)
  const bb = orientation(b0, b1, a1)
  const crosses =
    ((aa > CONTRACT_EPSILON && ab < -CONTRACT_EPSILON) ||
      (aa < -CONTRACT_EPSILON && ab > CONTRACT_EPSILON)) &&
    ((ba > CONTRACT_EPSILON && bb < -CONTRACT_EPSILON) ||
      (ba < -CONTRACT_EPSILON && bb > CONTRACT_EPSILON))
  return crosses ||
    (Math.abs(aa) <= CONTRACT_EPSILON && onSegment(a0, a1, b0)) ||
    (Math.abs(ab) <= CONTRACT_EPSILON && onSegment(a0, a1, b1)) ||
    (Math.abs(ba) <= CONTRACT_EPSILON && onSegment(b0, b1, a0)) ||
    (Math.abs(bb) <= CONTRACT_EPSILON && onSegment(b0, b1, a1))
}

function parseFootprint(value: unknown, label: string): [number, number][] {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`${label} needs at least three points`)
  }
  const points = value.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new Error(`${label} point ${index} must contain two numbers`)
    }
    return [
      finite(point[0], `${label} point ${index}[0]`),
      finite(point[1], `${label} point ${index}[1]`),
    ] as [number, number]
  })
  if (new Set(points.map(([east, negativeNorth]) => `${east},${negativeNorth}`)).size !== points.length) {
    throw new Error(`${label} repeats vertices`)
  }
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      if (
        second === first + 1 ||
        (first === 0 && second === points.length - 1)
      ) continue
      if (segmentsIntersect(
        points[first],
        points[(first + 1) % points.length],
        points[second],
        points[(second + 1) % points.length],
      )) {
        throw new Error(`${label} self-intersects`)
      }
    }
  }
  const signedArea = points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length]
    return area + point[0] * next[1] - next[0] * point[1]
  }, 0) / 2
  if (signedArea >= -CONTRACT_EPSILON) {
    throw new Error(`${label} must be clockwise in tile-local east/negative-north coordinates`)
  }
  return points
}

function parseBounds(value: unknown, label: string): GameplayBounds {
  const raw = object(value, label)
  const bounds = {
    minEast: finite(raw.minEast, `${label}.minEast`),
    minNorth: finite(raw.minNorth, `${label}.minNorth`),
    maxEast: finite(raw.maxEast, `${label}.maxEast`),
    maxNorth: finite(raw.maxNorth, `${label}.maxNorth`),
  }
  if (bounds.minEast > bounds.maxEast || bounds.minNorth > bounds.maxNorth) {
    throw new Error(`${label} minimums must not exceed maximums`)
  }
  return bounds
}

function parseManifest(value: unknown): GameplayManifest {
  const raw = object(value, 'gameplay manifest')
  if (raw.schemaVersion !== 2) throw new Error('gameplay manifest schemaVersion must be 2')
  if (raw.coordinateSpace !== 'hq-local-meters') {
    throw new Error('gameplay manifest coordinateSpace must be hq-local-meters')
  }
  if (raw.axisConvention !== AXIS_CONVENTION) {
    throw new Error(`gameplay manifest axisConvention must be ${AXIS_CONVENTION}`)
  }
  if (raw.colliderCoordinateSpace !== COLLIDER_COORDINATE_SPACE) {
    throw new Error(`gameplay manifest colliderCoordinateSpace must be ${COLLIDER_COORDINATE_SPACE}`)
  }
  if (raw.verticalAxis !== 'hq-local-y-up') {
    throw new Error('gameplay manifest verticalAxis must be hq-local-y-up')
  }
  exactStringArray(raw.tileOriginAxisOrder, TILE_ORIGIN_AXIS_ORDER, 'gameplay manifest tileOriginAxisOrder')
  exactStringArray(raw.footprintLocalAxisOrder, FOOTPRINT_AXIS_ORDER, 'gameplay manifest footprintLocalAxisOrder')
  expectedNumber(raw.tileSizeMeters, 256, 'gameplay manifest tileSizeMeters')
  expectedNumber(raw.activationRadiusMeters, 384, 'gameplay manifest activationRadiusMeters')
  parseVerticalReference(raw.verticalReference, 'gameplay manifest verticalReference')
  if (!Array.isArray(raw.tiles)) throw new Error('gameplay manifest tiles must be an array')
  const seen = new Set<string>()
  const tiles = raw.tiles.map((value, index) => {
    const tile = object(value, `gameplay manifest tiles[${index}]`)
    const tileId = string(tile.tileId, `gameplay manifest tiles[${index}].tileId`)
    tileOrigin(tileId, `gameplay manifest tiles[${index}].tileId`)
    if (seen.has(tileId)) throw new Error(`duplicate gameplay tile ${tileId}`)
    seen.add(tileId)
    const buildingCount = finite(
      tile.buildingCount,
      `gameplay manifest tiles[${index}].buildingCount`,
    )
    if (!Number.isInteger(buildingCount) || buildingCount < 0) {
      throw new Error(`gameplay manifest tile ${tileId} buildingCount must be a non-negative integer`)
    }
    const buildingIds = sortedUniqueStrings(
      tile.buildingIds,
      `gameplay manifest tile ${tileId} buildingIds`,
    )
    if (buildingIds.length !== buildingCount) {
      throw new Error(`gameplay manifest tile ${tileId} buildingIds must match buildingCount`)
    }
    const collisionUri = string(tile.collisionUri, `gameplay manifest tile ${tileId} collisionUri`)
    if (collisionUri !== `tiles/${tileId}.json`) {
      throw new Error(`gameplay manifest tile ${tileId} collisionUri must be canonical`)
    }
    return {
      tileId,
      boundsHqLocal: parseBounds(tile.boundsHqLocal, `gameplay tile ${tileId} boundsHqLocal`),
      collisionUri,
      buildingCount,
      buildingIds,
    }
  })
  return {
    schemaVersion: 2,
    generatedBy: string(raw.generatedBy, 'gameplay manifest generatedBy'),
    sourceId: string(raw.sourceId, 'gameplay manifest sourceId'),
    sourceHash: hash(raw.sourceHash, 'gameplay manifest sourceHash'),
    normalizedDerivationSha256: hash(
      raw.normalizedDerivationSha256,
      'gameplay manifest normalizedDerivationSha256',
    ),
    coordinateSpace: 'hq-local-meters',
    activationRadiusMeters: 384,
    tiles,
  }
}

function parseColliderTile(
  value: unknown,
  expected: GameplayManifestTile,
  manifest: GameplayManifest,
): ColliderTile {
  const raw = object(value, `collider tile ${expected.tileId}`)
  if (raw.schemaVersion !== 2) throw new Error(`collider tile ${expected.tileId} schemaVersion must be 2`)
  if (raw.tileId !== expected.tileId) throw new Error(`collider tile ID mismatch for ${expected.tileId}`)
  if (raw.sourceId !== manifest.sourceId) throw new Error(`collider tile ${expected.tileId} source ID mismatch`)
  if (raw.sourceHash !== manifest.sourceHash) throw new Error(`collider tile ${expected.tileId} source hash mismatch`)
  if (raw.normalizedDerivationSha256 !== manifest.normalizedDerivationSha256) {
    throw new Error(`collider tile ${expected.tileId} normalized derivation hash mismatch`)
  }
  expectedNumber(raw.tileSizeMeters, 256, `collider tile ${expected.tileId} tileSizeMeters`)
  if (raw.coordinateSpace !== COLLIDER_COORDINATE_SPACE) {
    throw new Error(`collider tile ${expected.tileId} coordinateSpace mismatch`)
  }
  if (raw.axisConvention !== AXIS_CONVENTION) {
    throw new Error(`collider tile ${expected.tileId} axisConvention mismatch`)
  }
  if (raw.verticalAxis !== 'hq-local-y-up') {
    throw new Error(`collider tile ${expected.tileId} verticalAxis mismatch`)
  }
  exactStringArray(raw.tileOriginAxisOrder, TILE_ORIGIN_AXIS_ORDER, `collider tile ${expected.tileId} tileOriginAxisOrder`)
  exactStringArray(raw.footprintLocalAxisOrder, FOOTPRINT_AXIS_ORDER, `collider tile ${expected.tileId} footprintLocalAxisOrder`)
  if (raw.buildingCount !== expected.buildingCount) {
    throw new Error(`collider tile ${expected.tileId} buildingCount mismatch`)
  }
  exactStringList(raw.buildingIds, expected.buildingIds, `collider tile ${expected.tileId} buildingIds`)
  if (!Array.isArray(raw.tileOriginMeters) || raw.tileOriginMeters.length !== 2) {
    throw new Error(`collider tile ${expected.tileId} tileOriginMeters must contain two numbers`)
  }
  if (!Array.isArray(raw.colliders)) throw new Error(`collider tile ${expected.tileId} colliders must be an array`)
  const colliders = raw.colliders.map((value, index) => {
    const collider = object(value, `collider tile ${expected.tileId} colliders[${index}]`)
    const footprintLocal = parseFootprint(
      collider.footprintLocal,
      `collider ${expected.tileId}[${index}] footprintLocal`,
    )
    const minY = finite(collider.minY, `collider ${expected.tileId}[${index}].minY`)
    const maxY = finite(collider.maxY, `collider ${expected.tileId}[${index}].maxY`)
    if (minY > maxY) throw new Error(`collider ${expected.tileId}[${index}] minY exceeds maxY`)
    const bounds = object(collider.boundsLocal, `collider ${expected.tileId}[${index}].boundsLocal`)
    const minEast = finite(bounds.minEast, `collider ${expected.tileId}[${index}].boundsLocal.minEast`)
    const maxEast = finite(bounds.maxEast, `collider ${expected.tileId}[${index}].boundsLocal.maxEast`)
    const minNegativeNorth = finite(
      bounds.minNegativeNorth,
      `collider ${expected.tileId}[${index}].boundsLocal.minNegativeNorth`,
    )
    const maxNegativeNorth = finite(
      bounds.maxNegativeNorth,
      `collider ${expected.tileId}[${index}].boundsLocal.maxNegativeNorth`,
    )
    const boundsMinY = finite(bounds.minY, `collider ${expected.tileId}[${index}].boundsLocal.minY`)
    const boundsMaxY = finite(bounds.maxY, `collider ${expected.tileId}[${index}].boundsLocal.maxY`)
    if (minEast > maxEast || minNegativeNorth > maxNegativeNorth || boundsMinY > boundsMaxY) {
      throw new Error(`collider ${expected.tileId}[${index}] boundsLocal minimums exceed maximums`)
    }
    const actualBounds = [
      Math.min(...footprintLocal.map(([east]) => east)),
      Math.min(...footprintLocal.map(([, north]) => north)),
      minY,
      Math.max(...footprintLocal.map(([east]) => east)),
      Math.max(...footprintLocal.map(([, north]) => north)),
      maxY,
    ]
    const declaredBounds = [minEast, minNegativeNorth, boundsMinY, maxEast, maxNegativeNorth, boundsMaxY]
    if (actualBounds.some((value, boundsIndex) => (
      Math.abs(value - declaredBounds[boundsIndex]) > CONTRACT_EPSILON
    ))) {
      throw new Error(`collider ${expected.tileId}[${index}] boundsLocal does not match its footprint`)
    }
    return {
      buildingId: string(collider.buildingId, `collider ${expected.tileId}[${index}].buildingId`),
      footprintLocal,
      minY,
      maxY,
    }
  })
  if (colliders.length !== expected.buildingCount) {
    throw new Error(
      `collider tile ${expected.tileId} expected ${expected.buildingCount} buildings, got ${colliders.length}`,
    )
  }
  const colliderIds = colliders.map((collider) => collider.buildingId)
  if (colliderIds.some((id, index) => id !== expected.buildingIds[index])) {
    throw new Error(`collider tile ${expected.tileId} collider IDs do not match the gameplay manifest`)
  }
  const parsedOrigin: [number, number] = [
    finite(raw.tileOriginMeters[0], `collider tile ${expected.tileId} origin east`),
    finite(raw.tileOriginMeters[1], `collider tile ${expected.tileId} origin north`),
  ]
  const canonicalOrigin = tileOrigin(expected.tileId, `collider tile ${expected.tileId} tileId`)
  if (parsedOrigin.some((value, index) => (
    Math.abs(value - canonicalOrigin[index]) > CONTRACT_EPSILON
  ))) {
    throw new Error(`collider tile ${expected.tileId} tileOriginMeters does not match its tile ID`)
  }
  if (colliders.length > 0) {
    const hqPoints = colliders.flatMap((collider) => collider.footprintLocal.map(
      ([east, negativeNorth]) => [
        parsedOrigin[0] + east,
        parsedOrigin[1] - negativeNorth,
      ] as [number, number],
    ))
    const actualManifestBounds = [
      Math.min(...hqPoints.map(([east]) => east)),
      Math.min(...hqPoints.map(([, north]) => north)),
      Math.max(...hqPoints.map(([east]) => east)),
      Math.max(...hqPoints.map(([, north]) => north)),
    ]
    const declaredManifestBounds = [
      expected.boundsHqLocal.minEast,
      expected.boundsHqLocal.minNorth,
      expected.boundsHqLocal.maxEast,
      expected.boundsHqLocal.maxNorth,
    ]
    if (actualManifestBounds.some((value, index) => (
      Math.abs(value - declaredManifestBounds[index]) > CONTRACT_EPSILON
    ))) {
      throw new Error(`collider tile ${expected.tileId} does not match its manifest bounds`)
    }
  }
  return {
    schemaVersion: 2,
    tileId: expected.tileId,
    sourceId: manifest.sourceId,
    tileOriginMeters: parsedOrigin,
    sourceHash: manifest.sourceHash,
    normalizedDerivationSha256: manifest.normalizedDerivationSha256,
    colliders,
  }
}

function pushDoubleSidedTriangle(target: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
  target.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  target.push(c.x, c.y, c.z, b.x, b.y, b.z, a.x, a.y, a.z)
}

function colliderGeometry(tile: ColliderTile, collider: ColliderRecord): THREE.BufferGeometry {
  const [originEast, originNorth] = tile.tileOriginMeters
  const bottom = collider.footprintLocal.map(([localEast, localNegativeNorth]) => {
    const east = originEast + localEast
    const north = originNorth - localNegativeNorth
    const world = PHASE1_GEO_TRANSFORM.localToWorld([east, collider.minY, north])
    return new THREE.Vector3(...world)
  })
  const top = collider.footprintLocal.map(([localEast, localNegativeNorth]) => {
    const east = originEast + localEast
    const north = originNorth - localNegativeNorth
    const world = PHASE1_GEO_TRANSFORM.localToWorld([east, collider.maxY, north])
    return new THREE.Vector3(...world)
  })
  // ManhattanCollision.isInsideBuilding casts upward only six metres from the
  // feet. Facade walls and a distant roof correctly stop movement but cannot
  // answer that occupancy query at a tall building's centre. This invisible
  // cap follows the exact footprint one metre above the floor, which leaves
  // horizontal sweeps and roof queries unchanged while making spawn rejection
  // use the same manifest collider.
  const probeUp = collider.minY + Math.min(1, (collider.maxY - collider.minY) / 2)
  const occupancyProbe = collider.footprintLocal.map(([localEast, localNegativeNorth]) => {
    const east = originEast + localEast
    const north = originNorth - localNegativeNorth
    const world = PHASE1_GEO_TRANSFORM.localToWorld([east, probeUp, north])
    return new THREE.Vector3(...world)
  })
  const contour = bottom.map((point) => new THREE.Vector2(point.x, point.z))
  const capTriangles = THREE.ShapeUtils.triangulateShape(contour, [])
  const positions: number[] = []
  for (const [a, b, c] of capTriangles) {
    pushDoubleSidedTriangle(positions, bottom[a], bottom[b], bottom[c])
    pushDoubleSidedTriangle(positions, top[a], top[b], top[c])
    pushDoubleSidedTriangle(positions, occupancyProbe[a], occupancyProbe[b], occupancyProbe[c])
  }
  for (let index = 0; index < bottom.length; index++) {
    const next = (index + 1) % bottom.length
    pushDoubleSidedTriangle(positions, bottom[index], bottom[next], top[next])
    pushDoubleSidedTriangle(positions, bottom[index], top[next], top[index])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function buildColliderRoot(
  tile: ColliderTile,
  material: THREE.MeshBasicMaterial,
): THREE.Group {
  const root = new THREE.Group()
  root.name = `phase1-colliders-${tile.tileId}`
  root.visible = false
  for (const collider of tile.colliders) {
    const mesh = new THREE.Mesh(colliderGeometry(tile, collider), material)
    mesh.name = `BLD_PHASE1_${collider.buildingId}`
    mesh.userData.buildingId = collider.buildingId
    root.add(mesh)
  }
  root.updateMatrixWorld(true)
  return root
}

function buildGround(material: THREE.MeshBasicMaterial): THREE.Mesh {
  const half = PHASE1_AOI_SIZE_METERS / 2
  const corners = [
    PHASE1_GEO_TRANSFORM.localToWorld([-half, 0, -half]),
    PHASE1_GEO_TRANSFORM.localToWorld([half, 0, -half]),
    PHASE1_GEO_TRANSFORM.localToWorld([half, 0, half]),
    PHASE1_GEO_TRANSFORM.localToWorld([-half, 0, half]),
  ].map((point) => new THREE.Vector3(...point))
  const positions: number[] = []
  pushDoubleSidedTriangle(positions, corners[0], corners[1], corners[2])
  pushDoubleSidedTriangle(positions, corners[0], corners[2], corners[3])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.boundsTree = new MeshBVH(geometry, { strategy: 2 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'phase1-ground-collider'
  mesh.visible = false
  return mesh
}

function distanceToBounds(east: number, north: number, bounds: GameplayBounds): number {
  const dx = Math.max(bounds.minEast - east, 0, east - bounds.maxEast)
  const dz = Math.max(bounds.minNorth - north, 0, north - bounds.maxNorth)
  return Math.hypot(dx, dz)
}

async function defaultFetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json()
}

function absoluteUrl(url: string): string {
  const base = typeof location === 'undefined' ? 'http://phase1.invalid/' : location.href
  return new URL(url, base).toString()
}

function disposeRoot(root: THREE.Group): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) object.geometry.dispose()
  })
  root.clear()
}

export class Phase1GameplayTileSystem {
  private readonly manifestUrl: string
  private readonly expectedSourceHash?: string
  private readonly expectedNormalizedDerivationSha256?: string
  private readonly expectedTileIds?: readonly string[]
  private readonly fetchJson: (url: string, signal: AbortSignal) => Promise<unknown>
  private readonly collision: CollisionRegistry
  private readonly onDiagnostics?: (diagnostics: Readonly<Phase1GameplayDiagnostics>) => void
  private readonly rootController = new AbortController()
  private readonly residents = new Map<string, ResidentTile>()
  private readonly pending = new Map<string, PendingTile>()
  private manifest: GameplayManifest | null = null
  private ground: THREE.Mesh | null = null
  private colliderMaterial: THREE.MeshBasicMaterial | null = new THREE.MeshBasicMaterial({
    visible: false,
  })
  private disposed = false
  private diagnostics: Phase1GameplayDiagnostics = {
    status: 'idle',
    residentTileIds: [],
    pendingTileIds: [],
    colliderCount: 0,
    loads: 0,
    disposals: 0,
    errors: 0,
  }

  constructor(options: Phase1GameplayOptions = {}) {
    this.manifestUrl = absoluteUrl(options.manifestUrl ?? PHASE1_GAMEPLAY_MANIFEST_URL)
    this.expectedSourceHash = options.expectedSourceHash
      ? hash(options.expectedSourceHash, 'expected gameplay sourceHash')
      : undefined
    this.expectedNormalizedDerivationSha256 = options.expectedNormalizedDerivationSha256
      ? hash(options.expectedNormalizedDerivationSha256, 'expected gameplay normalizedDerivationSha256')
      : undefined
    this.expectedTileIds = options.expectedTileIds
      ? Object.freeze(sortedUniqueStrings(options.expectedTileIds, 'expected gameplay tile IDs'))
      : undefined
    this.fetchJson = options.fetchJson ?? defaultFetchJson
    this.collision = options.collision ?? manhattanCollision
    this.onDiagnostics = options.onDiagnostics
  }

  snapshot(): Readonly<Phase1GameplayDiagnostics> {
    return Object.freeze({
      ...this.diagnostics,
      residentTileIds: [...this.diagnostics.residentTileIds],
      pendingTileIds: [...this.diagnostics.pendingTileIds],
    })
  }

  private publish(): void {
    this.diagnostics.residentTileIds = [...this.residents.keys()].sort()
    this.diagnostics.pendingTileIds = [...this.pending.keys()].sort()
    this.diagnostics.colliderCount = [...this.residents.values()]
      .reduce((total, tile) => total + tile.colliderCount, 0)
    this.onDiagnostics?.(this.snapshot())
  }

  async load(initialWorldPosition: Vec3): Promise<void> {
    if (this.disposed) throw new Error('Phase1GameplayTileSystem is disposed')
    if (this.manifest) return
    this.diagnostics.status = 'loading'
    this.publish()
    try {
      const manifest = parseManifest(
        await this.fetchJson(this.manifestUrl, this.rootController.signal),
      )
      if (this.expectedSourceHash && manifest.sourceHash !== this.expectedSourceHash) {
        throw new Error('gameplay manifest source hash does not match the release descriptor')
      }
      if (
        this.expectedNormalizedDerivationSha256 &&
        manifest.normalizedDerivationSha256 !== this.expectedNormalizedDerivationSha256
      ) {
        throw new Error('gameplay manifest normalized derivation hash does not match the release descriptor')
      }
      if (this.expectedTileIds) {
        const actualTileIds = manifest.tiles.map((tile) => tile.tileId).sort()
        if (
          actualTileIds.length !== this.expectedTileIds.length ||
          actualTileIds.some((tileId, index) => tileId !== this.expectedTileIds?.[index])
        ) {
          throw new Error('gameplay manifest tile IDs do not match the release descriptor')
        }
      }
      const material = this.colliderMaterial
      if (!material) throw new Error('Phase-1 gameplay collider material is unavailable')
      this.manifest = manifest
      this.ground = buildGround(material)
      this.collision.registerGround(this.ground)
      this.collision.baseReady = true
      await this.update(initialWorldPosition)
      if (this.disposed) return
      if (this.diagnostics.colliderCount === 0) {
        throw new Error('Phase-1 gameplay loaded no colliders at the initial position')
      }
      this.diagnostics.status = 'ready'
      this.publish()
    } catch (error) {
      if (this.disposed) return
      this.rollbackInitialLoad()
      this.diagnostics.status = 'error'
      if (this.diagnostics.errors === 0) this.diagnostics.errors = 1
      this.publish()
      throw error
    }
  }

  async update(worldPosition: Vec3): Promise<void> {
    const manifest = this.manifest
    if (!manifest || this.disposed) return
    const [east, , north] = PHASE1_GEO_TRANSFORM.worldToLocal([
      worldPosition.x,
      worldPosition.y,
      worldPosition.z,
    ])
    const loads: Promise<void>[] = []
    for (const tile of manifest.tiles) {
      const distance = distanceToBounds(east, north, tile.boundsHqLocal)
      if (distance <= manifest.activationRadiusMeters) {
        if (!this.residents.has(tile.tileId) && !this.pending.has(tile.tileId)) {
          loads.push(this.startTileLoad(tile, manifest))
        }
      } else if (distance > manifest.activationRadiusMeters + UNLOAD_HYSTERESIS_METERS) {
        this.abortPending(tile.tileId)
        this.unload(tile.tileId)
      }
    }
    await Promise.all(loads)
  }

  private startTileLoad(tile: GameplayManifestTile, manifest: GameplayManifest): Promise<void> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    this.rootController.signal.addEventListener('abort', abort, { once: true })
    const url = new URL(tile.collisionUri, this.manifestUrl).toString()
    const promise = Promise.resolve().then(async () => {
      try {
        const parsed = parseColliderTile(
          await this.fetchJson(url, controller.signal),
          tile,
          manifest,
        )
        if (this.disposed || controller.signal.aborted) return
        const material = this.colliderMaterial
        if (!material) throw new Error('Phase-1 gameplay collider material is unavailable')
        const root = buildColliderRoot(parsed, material)
        this.collision.registerInterior(root)
        this.residents.set(tile.tileId, { root, colliderCount: parsed.colliders.length })
        this.diagnostics.loads += 1
      } catch (error) {
        if (!controller.signal.aborted) {
          this.diagnostics.errors += 1
          console.error(`[phase1-gameplay] failed to load ${tile.tileId}:`, error)
          throw error
        }
      } finally {
        this.rootController.signal.removeEventListener('abort', abort)
        this.pending.delete(tile.tileId)
        this.publish()
      }
    })
    this.pending.set(tile.tileId, { controller, promise })
    this.publish()
    return promise
  }

  private disposeGround(): void {
    if (!this.ground) return
    this.collision.unregisterGround(this.ground)
    this.ground.geometry.boundsTree = undefined
    this.ground.geometry.dispose()
    this.ground = null
  }

  private disposeColliderMaterial(): void {
    if (!this.colliderMaterial) return
    this.colliderMaterial.dispose()
    this.colliderMaterial = null
  }

  /** Leave no collision state behind when the first playable residency cannot form. */
  private rollbackInitialLoad(): void {
    this.rootController.abort()
    for (const { controller } of this.pending.values()) controller.abort()
    this.pending.clear()
    for (const tileId of [...this.residents.keys()]) this.unload(tileId)
    this.disposeGround()
    this.collision.baseReady = false
    this.manifest = null
    this.disposeColliderMaterial()
  }

  private abortPending(tileId: string): void {
    this.pending.get(tileId)?.controller.abort()
  }

  private unload(tileId: string): void {
    const resident = this.residents.get(tileId)
    if (!resident) return
    this.collision.unregisterTileBuildings(resident.root)
    disposeRoot(resident.root)
    this.residents.delete(tileId)
    this.diagnostics.disposals += 1
    this.publish()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.rollbackInitialLoad()
    this.diagnostics.status = 'disposed'
    this.publish()
  }
}
