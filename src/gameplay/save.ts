/**
 * Session persistence for the standalone city.
 *
 * Two halves, deliberately separated. `encodeSave`/`decodeSave` are pure string
 * work with no environment at all, so every degradation path can be tested
 * directly; `saveGame`/`loadGame`/`clearSave` are a thin adapter over Web
 * Storage. Nothing here imports a renderer, and the storage object is a
 * parameter so the pure half stays testable under `environment: 'node'`, where
 * `localStorage` does not exist.
 *
 * Failure posture: a save system that crashes the game is worse than no save
 * system. Every storage call is guarded — private-browsing modes throw on the
 * property access itself, not merely on write — and every decode path returns a
 * usable `SaveData`. There is no throwing entry point in this module.
 *
 * Validation posture is split, and the split is the interesting part.
 * contracts/mission-control.ts degrades field by field because a dashboard
 * showing one zero beats a blank one. That is right for settings and wrong for
 * a position: a restored x paired with a defaulted z is a player inside a wall.
 * So scalars degrade individually and the position degrades whole.
 */
import { z } from 'zod'
import type { Vec3 } from './collision'
import type { QualityPreset } from '../world/palette'

// ── Public shape ─────────────────────────────────────────────────────────────

/**
 * Structurally identical to `Settings` in ui/Screens.tsx, and deliberately not
 * imported from it: that module is React, and gameplay/ stays renderer-free.
 * Its `DEFAULT_SETTINGS` is also unusable here because the default quality is
 * read from `location.search`, which no test environment has.
 */
export interface SavedSettings {
  quality: QualityPreset
  sensitivity: number
  fov: number
  volume: number
}

export interface SaveData {
  /** Player feet position, world metres. */
  pos: Vec3
  /** Camera forward on the horizontal plane, normalised. */
  forward: { x: number; z: number }
  settings: SavedSettings
}

/** The slice of the Web Storage API this module touches. */
export interface SaveStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * Why a stored save could not be used at all.
 *
 * Only whole-file problems appear here. A save that is readable but damaged
 * always loads with `fault: null` and the damaged fields listed in `repaired` —
 * one bad number should cost that number, not the session.
 */
export type SaveFault =
  /** Nothing has been saved yet. */
  | 'empty'
  /** Storage is unavailable, disabled, or threw on access. */
  | 'blocked'
  /** Not JSON, or JSON that is not a versioned save envelope. */
  | 'unreadable'
  /** A version this build has no migration path from — including a newer one. */
  | 'unsupported'

export interface LoadResult {
  /** Always safe to apply. Equals `defaultSave()` whenever `fault` is set. */
  data: SaveData
  /** Null when the stored save was used. */
  fault: SaveFault | null
  /** Fields that failed validation and fell back, e.g. `settings.fov`. */
  repaired: readonly string[]
}

export const SAVE_VERSION = 1

/** Version lives in the payload, not the key, or migration could never find it. */
export const SAVE_KEY = 'shenron-city:save'

const FALLBACK_SETTINGS: SavedSettings = { quality: 'high', sensitivity: 1, fov: 72, volume: 0.7 }

/** Spawn faces -Z, matching `rt.player.forward` in runtime.ts. */
const FALLBACK_FORWARD = { x: 0, z: -1 } as const

/** Default spawn in midtown Manhattan. Kept in sync with manhattan-collision.ts. */
const MANHATTAN_FALLBACK_POS = { x: 400, y: 12.4, z: 400 } as const

/**
 * A fresh, always-safe starting state.
 */
export function defaultSave(): SaveData {
  return {
    pos: { ...MANHATTAN_FALLBACK_POS },
    forward: { ...FALLBACK_FORWARD },
    settings: { ...FALLBACK_SETTINGS },
  }
}

// ── Where a save may put the player ──────────────────────────────────────────

/**
 * The island extents (LAND_context bounds, padded). A restored position must
 * sit inside the playable world or the player would spawn over open water.
 */
const ISLAND_BOUNDS = { minX: -14000, maxX: 17000, minZ: -23000, maxZ: 17000 } as const
/** Walkable or flyable vertical range — the island surface to above the skyline. */
const ISLAND_Y_RANGE = { min: -40, max: 800 } as const

/**
 * May this position be restored?
 *
 * Rejects rather than clamps. Clamping an absurd coordinate to the world edge
 * produces a plausible-looking number that is just as likely to be inside a
 * building; the spawn point is the only position known to be safe.
 */
export function isRestorablePosition(pos: Vec3): boolean {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
    return false
  }
  if (pos.x < ISLAND_BOUNDS.minX || pos.x > ISLAND_BOUNDS.maxX) return false
  if (pos.z < ISLAND_BOUNDS.minZ || pos.z > ISLAND_BOUNDS.maxZ) return false
  if (pos.y < ISLAND_Y_RANGE.min || pos.y > ISLAND_Y_RANGE.max) return false
  return true
}

// ── Stored payload ───────────────────────────────────────────────────────────

/** Enough to route by version. The rest is validated section by section. */
const Envelope = z.object({ v: z.number() })

/**
 * Pull one section out of a payload of unknown shape.
 *
 * Not a zod object of `z.unknown()` fields: that would fail the whole parse on
 * a single missing key, which is precisely the all-or-nothing behaviour the
 * section readers below exist to avoid. Anything absent arrives as `undefined`
 * and is repaired individually.
 */
function section(payload: unknown, key: string): unknown {
  if (typeof payload !== 'object' || payload === null) return undefined
  return (payload as Record<string, unknown>)[key]
}

const StoredPos = z.object({ x: z.number(), y: z.number(), z: z.number() })
const StoredForward = z.object({ x: z.number(), z: z.number() })

/**
 * Not `z.coerce`, unlike the Mission Control schemas. Those parse a foreign
 * backend; this module is the only writer of its own format, so a string where
 * a number belongs means corruption — and coercion would quietly turn `null`
 * into `0` instead of falling back to the default. The sentinels below are
 * values the real ranges can never contain.
 */
const StoredSettings = z.object({
  quality: z.string().catch(''),
  sensitivity: z.number().catch(Number.NaN),
  fov: z.number().catch(Number.NaN),
  volume: z.number().catch(Number.NaN),
})

/** Slider bounds from ui/Screens.tsx. Anything outside did not come from the menu. */
const SENSITIVITY_RANGE = { min: 0.3, max: 2.5 } as const
const FOV_RANGE = { min: 60, max: 100 } as const
const VOLUME_RANGE = { min: 0, max: 1 } as const

const QUALITY_PRESETS: readonly string[] = ['low', 'medium', 'high']

function inRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max
}

// ── Migration ────────────────────────────────────────────────────────────────

type Migration = (payload: unknown) => unknown

export type MigrationResult = { ok: true; payload: unknown } | { ok: false }

/**
 * How to add version 2.
 *
 * Write the v1 → v2 upgrade as `MIGRATIONS[1]`, bump `SAVE_VERSION` to 2, and
 * leave the v1 writer deleted but its shape documented in the migration. Steps
 * run in sequence from whatever is on disk up to the current version, so a save
 * written by any earlier build still loads.
 *
 * A version with no step — including one written by a *newer* build than this
 * one — is refused rather than guessed at. Half-applying a shape we have never
 * seen is how a save file teleports someone into a wall.
 */
const MIGRATIONS: Readonly<Record<number, Migration | undefined>> = {}

export function runMigrations(
  payload: unknown,
  from: number,
  migrations: Readonly<Record<number, Migration | undefined>> = MIGRATIONS,
  to: number = SAVE_VERSION,
): MigrationResult {
  if (!Number.isInteger(from) || from < 1 || from > to) return { ok: false }

  let current = payload
  for (let version = from; version < to; version++) {
    const migrate = migrations[version]
    if (!migrate) return { ok: false }
    current = migrate(current)
  }
  return { ok: true, payload: current }
}

// ── Pure encode / decode ─────────────────────────────────────────────────────

/**
 * Serialise one save.
 *
 * Fields are copied explicitly rather than spread: the caller passes live
 * runtime objects, and spreading would let an unrelated property drift into the
 * save format. A non-finite live coordinate becomes JSON `null` here and is
 * refused on load, so a bug elsewhere costs the position, not the whole save.
 */
export function encodeSave(data: SaveData): string {
  return JSON.stringify({
    v: SAVE_VERSION,
    pos: { x: data.pos.x, y: data.pos.y, z: data.pos.z },
    forward: { x: data.forward.x, z: data.forward.z },
    settings: {
      quality: data.settings.quality,
      sensitivity: data.settings.sensitivity,
      fov: data.settings.fov,
      volume: data.settings.volume,
    },
  })
}

export function decodeSave(raw: string | null | undefined): LoadResult {
  if (raw === null || raw === undefined || raw === '') return fault('empty')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fault('unreadable')
  }

  const envelope = Envelope.safeParse(parsed)
  if (!envelope.success) return fault('unreadable')

  // Migrations receive the original payload, not the envelope: `z.object`
  // strips unknown keys, and a v1 step needs the v1 fields it is upgrading.
  const migrated = runMigrations(parsed, envelope.data.v)
  if (!migrated.ok) return fault('unsupported')

  const payload = migrated.payload
  const repaired: string[] = []
  const data: SaveData = {
    pos: readPos(section(payload, 'pos'), repaired),
    forward: readForward(section(payload, 'forward'), repaired),
    settings: readSettings(section(payload, 'settings'), repaired),
  }
  return { data, fault: null, repaired }
}

function fault(reason: SaveFault): LoadResult {
  return { data: defaultSave(), fault: reason, repaired: [] }
}

function readPos(input: unknown, repaired: string[]): Vec3 {
  const parsed = StoredPos.safeParse(input)
  if (parsed.success && isRestorablePosition(parsed.data)) {
    const { x, y, z } = parsed.data
    return { x, y, z }
  }
  repaired.push('pos')
  return { ...MANHATTAN_FALLBACK_POS }
}

function readForward(input: unknown, repaired: string[]): { x: number; z: number } {
  const parsed = StoredForward.safeParse(input)
  if (parsed.success) {
    // Re-normalised rather than trusted: the camera basis divides by this
    // length, so a zero-length or denormalised pair would spread NaN through
    // every subsequent frame of movement.
    const length = Math.hypot(parsed.data.x, parsed.data.z)
    if (Number.isFinite(length) && length > 1e-6) {
      return { x: parsed.data.x / length, z: parsed.data.z / length }
    }
  }
  repaired.push('forward')
  return { ...FALLBACK_FORWARD }
}

function readSettings(input: unknown, repaired: string[]): SavedSettings {
  const parsed = StoredSettings.safeParse(input)
  if (!parsed.success) {
    repaired.push('settings')
    return { ...FALLBACK_SETTINGS }
  }

  const stored = parsed.data
  const settings = { ...FALLBACK_SETTINGS }

  if (QUALITY_PRESETS.includes(stored.quality)) settings.quality = stored.quality as QualityPreset
  else repaired.push('settings.quality')

  if (inRange(stored.sensitivity, SENSITIVITY_RANGE)) settings.sensitivity = stored.sensitivity
  else repaired.push('settings.sensitivity')

  if (inRange(stored.fov, FOV_RANGE)) settings.fov = stored.fov
  else repaired.push('settings.fov')

  if (inRange(stored.volume, VOLUME_RANGE)) settings.volume = stored.volume
  else repaired.push('settings.volume')

  return settings
}

// ── Storage adapter ──────────────────────────────────────────────────────────

/**
 * Web Storage, if this environment has any.
 *
 * The property read is inside the try: Safari's private mode and some
 * enterprise policies throw a SecurityError on access itself, not on write, and
 * under vitest's node environment the global is simply absent.
 */
function defaultStorage(): SaveStorage | null {
  try {
    return (globalThis as { localStorage?: SaveStorage }).localStorage ?? null
  } catch {
    return null
  }
}

/**
 * Persist one save. Returns false when storage refused it.
 *
 * Cheap enough for a periodic autosave: one small object literal and one
 * `JSON.stringify` of about ten numbers. The caller owns the throttle.
 */
export function saveGame(
  data: SaveData,
  storage: SaveStorage | null = defaultStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(SAVE_KEY, encodeSave(data))
    return true
  } catch {
    // Quota exhausted, or storage revoked since the last call. An autosave that
    // fails quietly and retries next tick is correct; one that throws into the
    // frame loop is not.
    return false
  }
}

export function loadGame(storage: SaveStorage | null = defaultStorage()): LoadResult {
  if (!storage) return fault('blocked')
  let raw: string | null
  try {
    raw = storage.getItem(SAVE_KEY)
  } catch {
    return fault('blocked')
  }
  return decodeSave(raw)
}

export function clearSave(storage: SaveStorage | null = defaultStorage()): boolean {
  if (!storage) return false
  try {
    storage.removeItem(SAVE_KEY)
    return true
  } catch {
    return false
  }
}
