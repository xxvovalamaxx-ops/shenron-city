export const PHASE1_RELEASE_URL =
  '/tests/fixtures/manhattan-phase1/generated/release.json'

const SHA256 = /^[a-f0-9]{64}$/
const RELEASE_FIELDS = [
  'schemaVersion',
  'sourceHash',
  'normalizedDerivationSha256',
  'tilesetUri',
  'gameplayManifestUri',
  'requiredInitialTileIds',
] as const

export interface Phase1Release {
  sourceHash: string
  normalizedDerivationSha256: string
  tilesetUrl: string
  gameplayManifestUrl: string
  requiredInitialTileIds: readonly string[]
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function sha256(value: unknown, label: string): string {
  const hash = nonEmptyString(value, label)
  if (!SHA256.test(hash)) throw new Error(`${label} must be a lowercase SHA-256 hash`)
  return hash
}

function exactFields(raw: Record<string, unknown>, fields: readonly string[], label: string): void {
  const actual = Object.keys(raw).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new Error(`${label} fields must be exactly ${expected.join(', ')}`)
  }
}

function canonicalRelativeUri(value: unknown, expected: string, label: string): string {
  const uri = nonEmptyString(value, label)
  if (uri !== expected) throw new Error(`${label} must be ${expected}`)
  return uri
}

function requiredTileIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('release requiredInitialTileIds must be a non-empty array')
  }
  const ids = value.map((tileId, index) =>
    nonEmptyString(tileId, `release requiredInitialTileIds[${index}]`),
  )
  const sorted = [...ids].sort()
  if (new Set(ids).size !== ids.length || ids.some((tileId, index) => tileId !== sorted[index])) {
    throw new Error('release requiredInitialTileIds must be unique and lexically sorted')
  }
  return ids
}

function absoluteUrl(url: string): string {
  const base = typeof location === 'undefined' ? 'http://phase1.invalid/' : location.href
  return new URL(url, base).toString()
}

export function parsePhase1Release(value: unknown, releaseUrl = PHASE1_RELEASE_URL): Phase1Release {
  const raw = record(value, 'Phase-1 release descriptor')
  exactFields(raw, RELEASE_FIELDS, 'Phase-1 release descriptor')
  if (raw.schemaVersion !== 1) throw new Error('Phase-1 release descriptor schemaVersion must be 1')

  const releaseBase = absoluteUrl(releaseUrl)
  return Object.freeze({
    sourceHash: sha256(raw.sourceHash, 'release sourceHash'),
    normalizedDerivationSha256: sha256(
      raw.normalizedDerivationSha256,
      'release normalizedDerivationSha256',
    ),
    tilesetUrl: new URL(
      canonicalRelativeUri(raw.tilesetUri, 'tileset.json', 'release tilesetUri'),
      releaseBase,
    ).toString(),
    gameplayManifestUrl: new URL(
      canonicalRelativeUri(
        raw.gameplayManifestUri,
        'gameplay/manifest.json',
        'release gameplayManifestUri',
      ),
      releaseBase,
    ).toString(),
    requiredInitialTileIds: Object.freeze(requiredTileIds(raw.requiredInitialTileIds)),
  })
}

function tileIdFromExtras(value: unknown, label: string): string {
  const extras = record(value, `${label} extras`)
  return nonEmptyString(extras.tileId, `${label} extras.tileId`)
}

function validateTileIdentity(value: unknown, release: Phase1Release, label: string): void {
  const extras = record(value, `${label} extras`)
  if (extras.sourceHash !== release.sourceHash) {
    throw new Error(`${label} source hash does not match the release descriptor`)
  }
  if (extras.normalizedDerivationSha256 !== release.normalizedDerivationSha256) {
    throw new Error(`${label} normalized derivation hash does not match the release descriptor`)
  }
}

function collectVisualTileIds(tileValue: unknown, release: Phase1Release, found: Set<string>): void {
  const tile = record(tileValue, 'tileset tile')
  if (tile.content !== undefined) {
    const id = tileIdFromExtras(tile.extras, 'tileset tile')
    validateTileIdentity(tile.extras, release, `tileset tile ${id}`)
    if (found.has(id)) throw new Error(`tileset has duplicate visual tile ${id}`)
    found.add(id)
  }
  if (tile.children === undefined) return
  if (!Array.isArray(tile.children)) throw new Error('tileset tile children must be an array')
  for (const child of tile.children) collectVisualTileIds(child, release, found)
}

/**
 * Validates the identity linkage before the renderer is allowed to make the
 * title enterable. The runtime reads the same tileset again, so the component
 * also revalidates the renderer event before handing off the base.
 */
export function validatePhase1Tileset(value: unknown, release: Phase1Release): void {
  const tileset = record(value, 'Phase-1 tileset')
  const root = record(tileset.root, 'Phase-1 tileset root')
  validateTileIdentity(root.extras, release, 'Phase-1 tileset root')
  const found = new Set<string>()
  collectVisualTileIds(root, release, found)
  const expected = [...release.requiredInitialTileIds]
  const actual = [...found].sort()
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    throw new Error('tileset visual tile IDs do not exactly match the release descriptor')
  }
}

export async function fetchPhase1Release(
  fetchJson: (url: string, signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
  releaseUrl = PHASE1_RELEASE_URL,
): Promise<Phase1Release> {
  const resolvedReleaseUrl = absoluteUrl(releaseUrl)
  const release = parsePhase1Release(
    await fetchJson(resolvedReleaseUrl, signal),
    resolvedReleaseUrl,
  )
  validatePhase1Tileset(await fetchJson(release.tilesetUrl, signal), release)
  return release
}

export function phase1TileId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const extras = (value as { extras?: unknown }).extras
  if (!extras || typeof extras !== 'object' || Array.isArray(extras)) return null
  const tileId = (extras as { tileId?: unknown }).tileId
  return typeof tileId === 'string' && tileId.length > 0 ? tileId : null
}
