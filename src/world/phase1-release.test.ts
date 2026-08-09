import { describe, expect, it } from 'vitest'

import {
  parsePhase1Release,
  validatePhase1Tileset,
} from './phase1-release'

const HASH = 'a'.repeat(64)
const DERIVATION = 'b'.repeat(64)

function releaseFixture() {
  return {
    schemaVersion: 1,
    sourceHash: HASH,
    normalizedDerivationSha256: DERIVATION,
    tilesetUri: 'tileset.json',
    gameplayManifestUri: 'gameplay/manifest.json',
    requiredInitialTileIds: ['tile-a', 'tile-b'],
  }
}

function tilesetFixture() {
  const extras = { sourceHash: HASH, normalizedDerivationSha256: DERIVATION }
  return {
    root: {
      extras,
      children: [
        { content: { uri: 'visual/tile-a.glb' }, extras: { ...extras, tileId: 'tile-a' } },
        { content: { uri: 'visual/tile-b.glb' }, extras: { ...extras, tileId: 'tile-b' } },
      ],
    },
  }
}

describe('Phase-1 release descriptor', () => {
  it('locks the canonical runtime URIs and visual tile set to the release identity', () => {
    const release = parsePhase1Release(releaseFixture(), 'https://fixture.test/generated/release.json')
    expect(release.tilesetUrl).toBe('https://fixture.test/generated/tileset.json')
    expect(release.gameplayManifestUrl).toBe('https://fixture.test/generated/gameplay/manifest.json')
    expect(() => validatePhase1Tileset(tilesetFixture(), release)).not.toThrow()
  })

  it('rejects any tileset hash or required visual tile mismatch', () => {
    const release = parsePhase1Release(releaseFixture())
    const badHash = tilesetFixture()
    badHash.root.extras.sourceHash = 'c'.repeat(64)
    expect(() => validatePhase1Tileset(badHash, release)).toThrow(/source hash/i)

    const missingTile = tilesetFixture()
    missingTile.root.children.pop()
    expect(() => validatePhase1Tileset(missingTile, release)).toThrow(/tile IDs/i)
  })
})
