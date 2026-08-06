#!/usr/bin/env node
/**
 * Bake per-building night-lighting data for the Phase 3C city.
 *
 * Reads public/models/manhattan/building_manifest.csv (the real OSM import
 * behind the 56k-building island) and writes one RGBA texel per building id:
 *   R = kind, G = flags (storefront, core glow), B = window density,
 *   A = floor fill.
 *
 * Everything derives from the manifest columns plus the deterministic hash
 * from src/world/city-lighting.ts — there is no randomness, so regenerating
 * produces byte-identical output (use --check to prove it).
 *
 * Outputs:
 *   public/models/manhattan/building-lighting.bin          RGBA8 texture data
 *   public/models/manhattan/building-lighting.json         header
 *   public/models/manhattan/building-lighting-summary.json classification
 *                                                          evidence
 *
 * Usage:
 *   node scripts/build-city-lighting.mjs            # bake
 *   node scripts/build-city-lighting.mjs --check    # compare against committed
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BuildingKind, hash01, packBuildingData } from '../src/world/city-lighting.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const MANIFEST = join(ROOT, 'public', 'models', 'manhattan', 'building_manifest.csv')
const OUT_BIN = join(ROOT, 'public', 'models', 'manhattan', 'building-lighting.bin')
const OUT_JSON = join(ROOT, 'public', 'models', 'manhattan', 'building-lighting.json')
const OUT_SUMMARY = join(ROOT, 'public', 'models', 'manhattan', 'building-lighting-summary.json')

const TEXTURE_WIDTH = 512

/* ------------------------------------------------------------ classification */

/** Districts where the street-level grain is commercial, not residential. */
const COMMERCIAL_DISTRICTS = new Set([
  'Financial District',
  'Midtown West / Times Sq',
  'Midtown East',
  'Turtle Bay / Sutton',
  'Garment / Midtown South',
  'Hudson Yards',
  'Gramercy / Flatiron',
  'Chelsea',
  'SoHo / Hudson Square',
  'Tribeca / Civic Center',
  'Murray Hill / Kips Bay',
])

const HOTEL_OSM = new Set(['hotel'])
const OFFICE_OSM = new Set(['office', 'commercial', 'bank', 'government', 'police', 'fire_station'])
const RETAIL_OSM = new Set(['retail', 'kiosk', 'market'])
const RESIDENTIAL_OSM = new Set([
  'apartments', 'dormitory', 'residential', 'house', 'detached',
  'semidetached_house', 'mansion', 'bungalow', 'static_caravan', 'hut',
])
const INDUSTRIAL_OSM = new Set([
  'industrial', 'warehouse', 'works', 'factory', 'data_center', 'depot',
  'garage', 'garages', 'parking', 'boathouse', 'ship',
])
const DARK_OSM = new Set([
  'shed', 'construction', 'proposed', 'transportation', 'ventilation_shaft',
  'toilets', 'ruins', 'tent', 'stable', 'roof', 'terrace', 'greenhouse',
  'subway_entrance', 'train_station', 'grandstand', 'fort', 'triumphal_arch',
  'bridge', 'church', 'chapel', 'cathedral', 'mosque', 'synagogue', 'temple',
  'religious', 'convent', 'school', 'college', 'university', 'kindergarten',
  'library', 'museum', 'art_gallery', 'cinema', 'theatre', 'civic', 'public',
  'sports_centre', 'pavilion', 'service', 'shed',
])
const HOSPITAL_OSM = new Set(['hospital'])

const OFFICE_CLASS = new Set(['glass', 'highrise', 'tower'])
const RESIDENTIAL_CLASS = new Set(['apartments', 'residential', 'small'])

const CLS_TO_KIND = {
  hotel: BuildingKind.HOTEL,
  retail: BuildingKind.RETAIL,
  apartments: BuildingKind.RESIDENTIAL,
  residential: BuildingKind.RESIDENTIAL,
  industrial: BuildingKind.INDUSTRIAL,
  glass: BuildingKind.OFFICE,
  highrise: BuildingKind.OFFICE,
  tower: BuildingKind.OFFICE,
  hospital: BuildingKind.HOTEL,
  civic: BuildingKind.DARK,
  train_station: BuildingKind.DARK,
}

function parseLevels(raw, heightRaw) {
  const direct = Number.parseInt(raw, 10)
  if (Number.isFinite(direct) && direct > 0) return direct
  const height = Number.parseFloat(String(heightRaw).trim().replace(/"/g, ''))
  if (Number.isFinite(height) && height > 2) return Math.max(1, Math.round(height / 3))
  return 3
}

/**
 * Deterministic OSM → night-personality classification. Every rule is a pure
 * function of the manifest row; the hash is only used for jitter inside a
 * kind, never to choose the kind itself.
 */
export function classifyBuilding(row, index) {
  const bid = row.bid !== '' && row.bid !== undefined ? Number.parseInt(row.bid, 10) : index
  const osm = String(row.osm_building_type || '').trim()
  const cls = String(row.class || '').trim()
  const district = String(row.district || '').trim()
  const name = String(row.name || '').trim()
  const levels = parseLevels(row.levels, row.height_m)
  const area = Number.parseFloat(String(row.area_m2)) || 0

  const nameLower = name.toLowerCase()
  const hotelLike = /hotel|inn|hostel|suites|plaza hotel/.test(nameLower)

  let kind
  if (HOSPITAL_OSM.has(osm)) kind = BuildingKind.HOTEL
  else if (HOTEL_OSM.has(osm) || hotelLike) kind = BuildingKind.HOTEL
  else if (OFFICE_OSM.has(osm)) kind = BuildingKind.OFFICE
  else if (RETAIL_OSM.has(osm)) kind = BuildingKind.RETAIL
  else if (RESIDENTIAL_OSM.has(osm)) kind = BuildingKind.RESIDENTIAL
  else if (INDUSTRIAL_OSM.has(osm)) kind = BuildingKind.INDUSTRIAL
  else if (DARK_OSM.has(osm)) kind = BuildingKind.DARK
  else if (CLS_TO_KIND[cls] !== undefined) kind = CLS_TO_KIND[cls]
  else if (OFFICE_CLASS.has(cls)) kind = BuildingKind.OFFICE
  else if (RESIDENTIAL_CLASS.has(cls) && !COMMERCIAL_DISTRICTS.has(district)) {
    kind = BuildingKind.RESIDENTIAL
  } else if (cls === 'small' || cls === 'lowrise') {
    // The big unclassified bucket. District grain decides the night feel:
    // midtown storefronts above apartments, uptown brownstones, etc.
    if (COMMERCIAL_DISTRICTS.has(district)) {
      kind = levels <= 6 ? BuildingKind.MIXED : BuildingKind.OFFICE
    } else {
      kind = BuildingKind.RESIDENTIAL
    }
  } else if (cls === 'midrise') {
    kind = COMMERCIAL_DISTRICTS.has(district)
      ? BuildingKind.MIXED
      : BuildingKind.RESIDENTIAL
  } else if (district === 'Context') {
    kind = BuildingKind.MIXED
  } else {
    kind = BuildingKind.RESIDENTIAL
  }

  // Jitter comes from the same stable hash the shader uses.
  const density =
    {
      [BuildingKind.RESIDENTIAL]: 0.68,
      [BuildingKind.OFFICE]: 0.48,
      [BuildingKind.HOTEL]: 0.82,
      [BuildingKind.RETAIL]: 0.6,
      [BuildingKind.INDUSTRIAL]: 0.34,
      [BuildingKind.MIXED]: 0.64,
      [BuildingKind.DARK]: 0,
    }[kind] * (0.85 + 0.3 * hash01(bid, 0xbeef))
  const floorFill =
    kind === BuildingKind.RETAIL ? 0.72 : 0.55
  const storefront =
    kind === BuildingKind.HOTEL ||
    ([BuildingKind.RETAIL, BuildingKind.MIXED, BuildingKind.OFFICE].includes(kind) &&
      levels <= 7 &&
      area >= 90)
  const coreGlow = (kind === BuildingKind.OFFICE || kind === BuildingKind.HOTEL) && levels >= 18

  return { kind, storefront, coreGlow, density, floorFill }
}

/* ------------------------------------------------------------------ parse -- */

function parseCsv(text) {
  const lines = text.split(/\r?\n/)
  const header = lines[0].split(',')
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue
    const cells = lines[i].split(',')
    if (cells.length < header.length) continue
    const row = {}
    for (let c = 0; c < header.length; c++) row[header[c]] = cells[c]
    rows.push(row)
  }
  return { header, rows }
}

/* ------------------------------------------------------------------- bake -- */

function bake() {
  const text = readFileSync(MANIFEST, 'utf8')
  const { rows } = parseCsv(text)
  const count = rows.length
  const height = Math.ceil(count / TEXTURE_WIDTH)
  const bytes = new Uint8Array(TEXTURE_WIDTH * height * 4)
  const summary = { buildings: count, kinds: {}, districts: {} }

  for (let i = 0; i < count; i++) {
    const row = rows[i]
    const bid = row.bid !== '' ? Number.parseInt(row.bid, 10) : i
    const packed = packBuildingData(classifyBuilding(row, i))
    const off = bid * 4
    bytes[off] = packed[0]
    bytes[off + 1] = packed[1]
    bytes[off + 2] = packed[2]
    bytes[off + 3] = packed[3]

    const label = { 0: 'mixed', 1: 'residential', 2: 'office', 3: 'hotel', 4: 'retail', 5: 'industrial', 6: 'dark' }[packed[0]] ?? 'unknown'
    summary.kinds[label] = (summary.kinds[label] ?? 0) + 1
    const district = String(row.district || '?').trim()
    if (!summary.districts[district]) summary.districts[district] = {}
    summary.districts[district][label] = (summary.districts[district][label] ?? 0) + 1
  }

  const header = {
    schema: 1,
    generated_by: 'scripts/build-city-lighting.mjs',
    source: 'public/models/manhattan/building_manifest.csv',
    building_count: count,
    texture: { width: TEXTURE_WIDTH, height, format: 'RGBA8' },
    byte_layout: 'per-bid texel: R=kind, G=flags(storefront|coreGlow), B=density, A=floorFill',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    generated_at: new Date().toISOString(),
  }

  writeFileSync(OUT_BIN, Buffer.from(bytes))
  writeFileSync(OUT_JSON, `${JSON.stringify(header, null, 2)}\n`)
  writeFileSync(OUT_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`)

  const total = Object.values(summary.kinds).reduce((a, b) => a + b, 0)
  const pct = (k) => `${Math.round((summary.kinds[k] ?? 0) / total * 1000) / 10}%`
  console.log(`baked ${count} buildings -> ${OUT_BIN} (${(bytes.length / 1024).toFixed(0)} KiB)`)
  for (const k of Object.keys(summary.kinds).sort()) {
    console.log(`  ${k.padEnd(12)} ${String(summary.kinds[k]).padStart(6)}  ${pct(k)}`)
  }
  console.log(`sha256 ${header.sha256.slice(0, 16)}…`)
  return header
}

/* ------------------------------------------------------------------ check -- */

function check(header) {
  if (!existsSync(OUT_BIN)) {
    console.error('building-lighting.bin missing — run without --check first')
    process.exit(1)
  }
  const committed = createHash('sha256')
    .update(readFileSync(OUT_BIN))
    .digest('hex')
  if (committed !== header.sha256) {
    console.error(
      `building-lighting.bin drift: committed ${committed.slice(0, 16)}… != baked ${header.sha256.slice(0, 16)}…`,
    )
    process.exit(1)
  }
  console.log(`building-lighting.bin deterministic (${committed.slice(0, 16)}…)`)
}

const header = bake()
if (process.argv.includes('--check')) check(header)
