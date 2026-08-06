import { describe, expect, it } from 'vitest'
import {
  clearSave,
  decodeSave,
  defaultSave,
  encodeSave,
  isRestorablePosition,
  loadGame,
  runMigrations,
  SAVE_KEY,
  SAVE_VERSION,
  saveGame,
  type SaveData,
  type SaveStorage,
} from './save'

/** In-memory stand-in for Web Storage, which the node environment lacks. */
function fakeStorage(seed: Record<string, string> = {}): SaveStorage & {
  readonly entries: Map<string, string>
} {
  const entries = new Map(Object.entries(seed))
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  }
}

/** Storage that has been revoked mid-session, as private-browsing modes do. */
function hostileStorage(): SaveStorage {
  const boom = (): never => {
    throw new DOMException('denied', 'SecurityError')
  }
  return { getItem: boom, setItem: boom, removeItem: boom }
}

/** A player standing on a midtown street. */
const SAMPLE: SaveData = {
  pos: { x: 1000, y: 12.4, z: -3000 },
  forward: { x: 0, z: -1 },
  settings: { quality: 'medium', sensitivity: 1.5, fov: 90, volume: 0.7 },
  vehicle: null,
}

/** Build a stored payload with one section replaced by something unusable. */
function withSection(section: string, value: unknown): string {
  const payload = JSON.parse(encodeSave(SAMPLE)) as Record<string, unknown>
  payload[section] = value
  return JSON.stringify(payload)
}

describe('encode and decode', () => {
  it('round trips a complete save without repairs', () => {
    const result = decodeSave(encodeSave(SAMPLE))

    expect(result.fault).toBeNull()
    expect(result.repaired).toEqual([])
    expect(result.data).toEqual(SAMPLE)
  })

  it('stamps the current version into the payload', () => {
    expect(JSON.parse(encodeSave(SAMPLE))).toMatchObject({ v: SAVE_VERSION })
  })

  it('never hands back a shared default the frame loop could mutate', () => {
    const first = decodeSave(null).data
    const second = decodeSave(null).data

    first.pos.y += 180

    expect(second.pos.y).toBe(12.4)
    expect(defaultSave().pos.y).toBe(12.4)
  })
})

describe('unusable saves fall back to defaults', () => {
  it('reports nothing stored', () => {
    for (const empty of [null, undefined, '']) {
      const result = decodeSave(empty)
      expect(result.fault).toBe('empty')
      expect(result.data).toEqual(defaultSave())
    }
  })

  it('survives corrupt JSON', () => {
    for (const broken of ['{', 'not json at all', '{"v":1,', '\0']) {
      const result = decodeSave(broken)
      expect(result.fault).toBe('unreadable')
      expect(result.data).toEqual(defaultSave())
    }
  })

  it('rejects JSON that is not a versioned envelope', () => {
    for (const wrong of ['null', '42', '"save"', '[]', '{}', '{"v":"1"}']) {
      expect(decodeSave(wrong).fault).toBe('unreadable')
    }
  })

  it('refuses versions it has no migration path from', () => {
    for (const version of [0, -1, 1.5, 3, 99]) {
      const result = decodeSave(JSON.stringify({ v: version, ...SAMPLE }))
      expect(result.fault).toBe('unsupported')
      expect(result.data).toEqual(defaultSave())
    }
  })

  it('migrates a version-1 save by adding the vehicle section', () => {
    const legacy = JSON.stringify({ v: 1, pos: { x: 1000, y: 12.4, z: -3000 }, forward: { x: 0, z: -1 }, settings: SAMPLE.settings })
    const result = decodeSave(legacy)

    expect(result.fault).toBeNull()
    expect(result.repaired).toEqual([])
    expect(result.data).toEqual(SAMPLE)
  })

  it('treats a future save as unsupported rather than guessing its shape', () => {
    const future = JSON.stringify({ v: SAVE_VERSION + 1, pos: { x: 1, y: 0, z: 1 } })
    expect(decodeSave(future).fault).toBe('unsupported')
  })

  it('accepts a payload missing every section, defaulting each', () => {
    const result = decodeSave(JSON.stringify({ v: SAVE_VERSION }))

    expect(result.fault).toBeNull()
    expect(result.data).toEqual(defaultSave())
    expect(result.repaired).toEqual(['pos', 'forward', 'settings', 'vehicle'])
  })

  it('accepts a payload whose every section is the wrong type', () => {
    const garbage = JSON.stringify({
      v: SAVE_VERSION,
      pos: [],
      forward: 'north',
      settings: [1, 2, 3],
      vehicle: 'mine',
    })
    const result = decodeSave(garbage)

    expect(result.fault).toBeNull()
    expect(result.data).toEqual(defaultSave())
    expect(result.repaired).toEqual(['pos', 'forward', 'settings', 'vehicle'])
  })
})

describe('damaged fields degrade one at a time', () => {
  it('keeps the sections that are still valid', () => {
    const result = decodeSave(withSection('pos', 'somewhere'))

    expect(result.fault).toBeNull()
    expect(result.repaired).toEqual(['pos'])
    expect(result.data.pos).toEqual({ x: 1000, y: 12.4, z: -3000 })
    expect(result.data.settings).toEqual(SAMPLE.settings)
  })

  it('rejects a position with any wrong or missing component, never half of one', () => {
    const partial = [
      { x: 0, y: 0 },
      { x: 0, y: 0, z: '-12' },
      { x: null, y: 0, z: -12 },
      { x: 0, y: 0, z: [] },
      [0, 0, -12],
    ]
    for (const pos of partial) {
      const result = decodeSave(withSection('pos', pos))
      expect(result.repaired).toContain('pos')
      expect(result.data.pos).toEqual({ x: 1000, y: 12.4, z: -3000 })
    }
  })

  it('rejects non-finite coordinates, which JSON stores as null', () => {
    const broken: SaveData = { ...SAMPLE, pos: { x: Number.NaN, y: 0, z: Number.POSITIVE_INFINITY } }
    const encoded = encodeSave(broken)

    expect(encoded).toContain('null') // JSON cannot hold NaN or Infinity
    const result = decodeSave(encoded)
    expect(result.repaired).toEqual(['pos'])
    expect(result.data.pos).toEqual({ x: 1000, y: 12.4, z: -3000 })
  })

  it('normalises a stored forward vector and defaults a degenerate one', () => {
    const wide = decodeSave(withSection('forward', { x: 3, z: 0 }))
    expect(wide.repaired).toEqual([])
    expect(wide.data.forward.x).toBeCloseTo(1)
    expect(wide.data.forward.z).toBeCloseTo(0)

    for (const bad of [{ x: 0, z: 0 }, { x: 1 }, { x: 'east', z: 0 }, null]) {
      const result = decodeSave(withSection('forward', bad))
      expect(result.repaired).toContain('forward')
      expect(result.data.forward).toEqual({ x: 0, z: -1 })
    }
  })

  it('defaults each bad setting independently of the good ones', () => {
    const result = decodeSave(
      withSection('settings', { quality: 'ultra', sensitivity: 1.5, fov: 4000 }),
    )

    expect(result.fault).toBeNull()
    expect(result.repaired).toEqual(['settings.quality', 'settings.fov', 'settings.volume'])
    expect(result.data.settings).toEqual({ quality: 'high', sensitivity: 1.5, fov: 72, volume: 0.7 })
  })

  it('defaults settings that are out of the menu ranges or the wrong type', () => {
    const result = decodeSave(
      withSection('settings', { quality: 7, sensitivity: '2', fov: -1 }),
    )

    expect(result.data.settings).toEqual(defaultSave().settings)
    expect(result.repaired).toEqual([
      'settings.quality',
      'settings.sensitivity',
      'settings.fov',
      'settings.volume',
    ])
  })
})

describe('restorable positions', () => {
  it('accepts street, park and aerial positions inside the island', () => {
    expect(isRestorablePosition({ x: 1000, y: 12.4, z: -3000 })).toBe(true) // spawn
    expect(isRestorablePosition({ x: 300, y: 12.4, z: 100 })).toBe(true) // times square
    expect(isRestorablePosition({ x: -6447, y: 12.4, z: -10034 })).toBe(true) // statue
    expect(isRestorablePosition({ x: 0, y: 300, z: 0 })).toBe(true) // aerial
  })

  it('rejects non-finite, absurd and off-island coordinates', () => {
    const outside = [
      { x: Number.NaN, y: 0, z: 0 },
      { x: 0, y: Number.NaN, z: 0 },
      { x: 0, y: 0, z: Number.POSITIVE_INFINITY },
      { x: 1e9, y: 0, z: 0 },
      { x: 0, y: 0, z: -1e9 },
      { x: -20000, y: 12.4, z: 0 }, // west of the island
      { x: 0, y: 12.4, z: 25000 }, // north of the island
      { x: 0, y: -1000, z: 0 }, // below the sea floor
      { x: 0, y: 5000, z: 0 }, // above the skyline
    ]
    for (const pos of outside) expect(isRestorablePosition(pos)).toBe(false)
  })

  it('restores an aerial save intact', () => {
    const aerial: SaveData = { ...SAMPLE, pos: { x: 0, y: 300, z: 0 } }
    const result = decodeSave(encodeSave(aerial))

    expect(result.repaired).toEqual([])
    expect(result.data.pos).toEqual(aerial.pos)
  })
})

describe('migration', () => {
  const table: Record<number, (payload: unknown) => unknown> = {
    1: (payload) => ({ ...(payload as Record<string, unknown>), v: 2, one: true }),
    2: (payload) => ({ ...(payload as Record<string, unknown>), v: 3, two: true }),
  }

  it('runs every step between the stored version and the current one', () => {
    const result = runMigrations({ v: 1 }, 1, table, 3)

    expect(result).toEqual({ ok: true, payload: { v: 3, one: true, two: true } })
  })

  it('passes an already-current payload through untouched', () => {
    const payload = { v: 3, kept: true }
    expect(runMigrations(payload, 3, table, 3)).toEqual({ ok: true, payload })
  })

  it('fails rather than skipping a missing step', () => {
    expect(runMigrations({ v: 1 }, 1, {}, 2)).toEqual({ ok: false })
    expect(runMigrations({ v: 1 }, 1, { 2: table[2] }, 3)).toEqual({ ok: false })
  })

  it('fails on versions that cannot exist', () => {
    for (const from of [0, -3, 1.5, Number.NaN, 4]) {
      expect(runMigrations({}, from, table, 3)).toEqual({ ok: false })
    }
  })
})

describe('storage adapter', () => {
  it('saves, loads and clears through an injected storage', () => {
    const storage = fakeStorage()

    expect(saveGame(SAMPLE, storage)).toBe(true)
    expect(storage.entries.has(SAVE_KEY)).toBe(true)

    const loaded = loadGame(storage)
    expect(loaded.fault).toBeNull()
    expect(loaded.data).toEqual(SAMPLE)

    expect(clearSave(storage)).toBe(true)
    expect(storage.entries.has(SAVE_KEY)).toBe(false)
    expect(loadGame(storage).fault).toBe('empty')
  })

  it('reports an empty slot rather than inventing one', () => {
    const result = loadGame(fakeStorage())
    expect(result.fault).toBe('empty')
    expect(result.data).toEqual(defaultSave())
  })

  it('degrades a corrupt stored value on load', () => {
    const storage = fakeStorage({ [SAVE_KEY]: '{"v":1,"pos":' })
    const result = loadGame(storage)

    expect(result.fault).toBe('unreadable')
    expect(result.data).toEqual(defaultSave())
  })

  it('treats absent storage as blocked instead of throwing', () => {
    expect(saveGame(SAMPLE, null)).toBe(false)
    expect(clearSave(null)).toBe(false)
    expect(loadGame(null).fault).toBe('blocked')
    expect(loadGame(null).data).toEqual(defaultSave())
  })

  it('survives storage that throws on every call', () => {
    const storage = hostileStorage()

    expect(() => saveGame(SAMPLE, storage)).not.toThrow()
    expect(saveGame(SAMPLE, storage)).toBe(false)
    expect(clearSave(storage)).toBe(false)
    expect(loadGame(storage).fault).toBe('blocked')
  })

  it('does not throw when no storage exists in this environment', () => {
    // The node test environment has no localStorage, which is the same shape of
    // absence as a browser that has disabled it.
    expect(() => loadGame()).not.toThrow()
    expect(() => saveGame(SAMPLE)).not.toThrow()
    expect(() => clearSave()).not.toThrow()
  })
})
