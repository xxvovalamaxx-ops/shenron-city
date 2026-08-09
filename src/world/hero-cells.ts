/**
 * Replacing one procedurally-generated building with an authored one.
 *
 * Stage 1. The city is 56,476 buildings decoded from a 20-byte-per-record
 * `core.bin` and drawn as merged 1400 m tiles carrying a per-vertex `_bid`
 * attribute that says which building every triangle belongs to. That is
 * excellent for streaming a whole island and useless for making one corner of
 * it look hand-built: there is no seam to cut on, no node to swap.
 *
 * A tile is *several* meshes, not one — measured on the running game: 116
 * meshes carry a `_bid`, named `BLD_<tier>_<tx>_<ty>_<part>`, split by height
 * tier (lowrise, midrise, highrise) and then again by part. Building 34877
 * appears in both `BLD_lowrise_-01_-01_1` and `BLD_lowrise_-01_-01_2`. So
 * suppression has to run over every mesh belonging to the building's tile, and
 * a version that stopped at the first match would leave part of the generated
 * building standing inside the authored one.
 *
 * A hero cell is that seam. It names a building id, supplies authored geometry
 * to stand in its lot, and — this is the part that has to be right —
 * suppresses the generated version *only inside the tile that actually
 * contains it*. A building near a tile edge is still one building; hiding its
 * id everywhere would be free to write and would silently remove whatever else
 * shares that id in a neighbouring tile's mesh.
 *
 * Three properties the rest of the stage depends on, all tested below:
 *
 *   Confinement. Suppression applies to one tile, chosen from the building's
 *   own lot coordinates, never to the whole scene.
 *
 *   Reversibility. Suppression rewrites an index buffer and keeps the original,
 *   so removing an override restores exactly the geometry that was there —
 *   including its collision, because the BVH is built from the same indices.
 *   Nothing is deleted and no vertex data is touched.
 *
 *   Coherence. The override carries the building's identity — id, lot centre,
 *   address — rather than inventing a new one, so collision, traffic,
 *   navigation, address lookup and save state keep referring to the same
 *   building they always did.
 *
 * Free of THREE and React so the arithmetic is testable without a renderer.
 */

/** The tile grid the streamer uses. 1400 m, from city.json `tiles.size_m`. */
export const TILE_SIZE_M = 1400

export interface HeroCellSpec {
  /** Index into core.bin — the same value the `_bid` attribute carries. */
  buildingId: number
  /** Authored replacement, near tier. */
  lod0: string
  /**
   * Authored replacement, far tier. Optional: a hero cell with only LOD0 is a
   * legitimate work-in-progress, and refusing it would mean no hero building
   * could ever be looked at until both tiers were finished.
   */
  lod1?: string
  /** Metres at which LOD1 takes over from LOD0. */
  lod1FromMetres?: number
  /** Y-rotation applied to the authored asset, radians. */
  rotationY?: number
  /** Vertical nudge, metres, for sitting the asset on its lot. */
  yOffset?: number
  /** Why this building was chosen. Recorded, not used. */
  note?: string
}

export interface HeroCellPlacement {
  buildingId: number
  /** World position of the lot centre. */
  position: { x: number; y: number; z: number }
  rotationY: number
  /** Which streaming tile contains the lot. */
  tile: { tx: number; ty: number }
  spec: HeroCellSpec
}

/**
 * The building fields a placement needs.
 *
 * Structural rather than importing City, so a test can supply three buildings
 * instead of 56,476.
 */
export interface BuildingLookup {
  count: number
  x(i: number): number
  y(i: number): number
  height(i: number): number
}

/**
 * Which streaming tile a lot falls in.
 *
 * `y` here is the local-plane northing from core.bin, not world z. The two
 * differ by a sign — city.json's projection note says "glTF is exported Y-up so
 * world y = -y_m" — and the tile grid is indexed in the plane's terms, which is
 * what the tile filenames encode.
 */
export function tileIndexFor(x: number, y: number, tileSize = TILE_SIZE_M): { tx: number; ty: number } {
  return { tx: Math.floor(x / tileSize), ty: Math.floor(y / tileSize) }
}

/** `manhattan_+00_-01.glb`-style tile filename, as city.json lists them. */
export function tileFileName(tx: number, ty: number, prefix = 'manhattan'): string {
  const sign = (n: number) => (n < 0 ? '-' : '+') + String(Math.abs(n)).padStart(2, '0')
  return `${prefix}_${sign(tx)}_${sign(ty)}.glb`
}

export interface MeshTile {
  tier: string
  tx: number
  ty: number
  /** Sub-index within the tier, when the exporter split the mesh. */
  part: number | null
}

/**
 * The tile a streamed building mesh belongs to, read from its name.
 *
 * Names look like `BLD_lowrise_-01_-01_2`: prefix, height tier, tx, ty, and an
 * optional part. Parsed rather than computed, because the tile a mesh *is* is a
 * fact the exporter already decided — re-deriving it from vertex positions
 * would be a second opinion that can disagree.
 *
 * Returns null for anything that is not a streamed building mesh, so a caller
 * can walk the whole scene and let this decide what is in scope.
 */
export function parseTileFromMeshName(name: string): MeshTile | null {
  const m = /^BLD_([A-Za-z]+)_([+-]\d+)_([+-]\d+)(?:_(\d+))?$/.exec(name)
  if (!m) return null
  return {
    tier: m[1],
    tx: Number(m[2]),
    ty: Number(m[3]),
    part: m[4] === undefined ? null : Number(m[4]),
  }
}

/**
 * Whether a mesh is one of the ones a building's suppression should touch.
 *
 * The confinement rule, applied per mesh. A building's geometry is split across
 * several meshes of its own tile — measured: 34877 lives in both
 * `BLD_lowrise_-01_-01_1` and `_2` — so this has to say yes to more than one
 * mesh, while still saying no to every mesh of every other tile.
 */
export function meshBelongsToTile(meshName: string, tile: { tx: number; ty: number }): boolean {
  const parsed = parseTileFromMeshName(meshName)
  return parsed !== null && parsed.tx === tile.tx && parsed.ty === tile.ty
}

export interface RegistryProblem {
  buildingId: number
  problem: string
}

/**
 * The set of hero cells in effect, and the arithmetic for applying them.
 *
 * A plain class rather than a module-level singleton: the QA harnesses need to
 * build one, and a singleton would make "what does an empty registry do" an
 * untestable question.
 */
export class HeroCellRegistry {
  private readonly byId = new Map<number, HeroCellSpec>()
  /** Ids whose authored geometry is loaded and in the scene. */
  private readonly ready = new Set<number>()

  add(spec: HeroCellSpec): void {
    this.byId.set(spec.buildingId, spec)
    // Declaring an override does not make it ready. A spec is a request; the
    // loader decides when it has been honoured.
    this.ready.delete(spec.buildingId)
  }

  remove(buildingId: number): boolean {
    this.ready.delete(buildingId)
    return this.byId.delete(buildingId)
  }

  /**
   * Say that a cell's authored geometry is loaded and placed.
   *
   * The gate on suppression, and the reason it exists: a hero cell that hides
   * the generated building before its replacement has arrived leaves a hole in
   * Manhattan. If the asset 404s — a renamed export, a typo in the manifest —
   * that hole is permanent and the only symptom is a missing building, which
   * looks like a streaming bug and is an asset bug.
   *
   * So the order is: load, place, then suppress. Nothing is removed until
   * something is standing in its place.
   */
  markReady(buildingId: number): void {
    if (this.byId.has(buildingId)) this.ready.add(buildingId)
  }

  markNotReady(buildingId: number): void {
    this.ready.delete(buildingId)
  }

  isReady(buildingId: number): boolean {
    return this.ready.has(buildingId)
  }

  /** Overrides whose replacement is actually in the scene. */
  readyIds(): number[] {
    return [...this.ready]
  }

  get(buildingId: number): HeroCellSpec | undefined {
    return this.byId.get(buildingId)
  }

  get size(): number {
    return this.byId.size
  }

  ids(): number[] {
    return [...this.byId.keys()]
  }

  clear(): void {
    this.byId.clear()
  }

  /**
   * Ids to suppress inside one tile.
   *
   * The confinement rule. An override only hides its building in the tile the
   * building's own lot falls in, so a hero cell can never blank geometry in a
   * tile it has nothing to do with.
   */
  suppressedInTile(tx: number, ty: number, city: BuildingLookup, tileSize = TILE_SIZE_M): Set<number> {
    const out = new Set<number>()
    for (const id of this.byId.keys()) {
      // Ready only — see markReady. A declared-but-unloaded cell must leave the
      // generated building exactly where it is.
      if (!this.ready.has(id)) continue
      if (!(id >= 0 && id < city.count)) continue
      const tile = tileIndexFor(city.x(id), city.y(id), tileSize)
      if (tile.tx === tx && tile.ty === ty) out.add(id)
    }
    return out
  }

  /** Where each override's authored asset goes, in world space. */
  placements(city: BuildingLookup, tileSize = TILE_SIZE_M): HeroCellPlacement[] {
    const out: HeroCellPlacement[] = []
    for (const [id, spec] of this.byId) {
      if (!(id >= 0 && id < city.count)) continue
      const x = city.x(id)
      const y = city.y(id)
      out.push({
        buildingId: id,
        // world z = -y_m, per city.json's projection note. Getting this sign
        // wrong puts the hero building an equal distance the wrong side of the
        // origin, which looks like a placement bug and is a projection bug.
        position: { x, y: spec.yOffset ?? 0, z: -y },
        rotationY: spec.rotationY ?? 0,
        tile: tileIndexFor(x, y, tileSize),
        spec,
      })
    }
    return out
  }

  /**
   * Everything wrong with the registry, as a list rather than a throw.
   *
   * A manifest check wants all the problems at once; failing on the first one
   * means finding them one commit at a time.
   */
  validate(city: BuildingLookup): RegistryProblem[] {
    const problems: RegistryProblem[] = []
    for (const [id, spec] of this.byId) {
      if (!Number.isInteger(id)) {
        problems.push({ buildingId: id, problem: 'building id is not an integer' })
        continue
      }
      if (id < 0 || id >= city.count) {
        problems.push({
          buildingId: id,
          problem: `building id out of range (city has ${city.count})`,
        })
        continue
      }
      if (!spec.lod0) problems.push({ buildingId: id, problem: 'no lod0 asset' })
      if (spec.lod1FromMetres !== undefined && !spec.lod1) {
        problems.push({
          buildingId: id,
          problem: 'lod1FromMetres set but no lod1 asset to switch to',
        })
      }
      if (spec.lod1FromMetres !== undefined && spec.lod1FromMetres <= 0) {
        problems.push({ buildingId: id, problem: 'lod1FromMetres must be positive' })
      }
    }
    return problems
  }
}

/**
 * The game's registry.
 *
 * Empty by default, and every path treats empty as "the city renders exactly as
 * it did" — so a build with no hero cells declared costs one `size === 0` check
 * per streamed tile and changes nothing.
 *
 * Exposed for the QA harnesses alongside __cityWorld / __rt / __simulation /
 * __hud / __vehicleSim: the only way to check confinement from outside is to
 * add an override, stream a tile, and count triangles in the tile next door.
 */
export const heroCells = new HeroCellRegistry()

if (typeof window !== 'undefined') {
  ;(window as unknown as { __heroCells: HeroCellRegistry }).__heroCells = heroCells
}

export interface SuppressionResult {
  /** The rewritten index array. */
  index: Uint32Array
  /** Triangles removed. */
  removed: number
  /** Triangles kept. */
  kept: number
  /** Ids that matched at least one triangle — the ones that did something. */
  hit: number[]
}

/**
 * Rewrite an index buffer so the named buildings' triangles are not drawn.
 *
 * A triangle is removed only when **all three** of its vertices belong to a
 * suppressed building. Two buildings that share a vertex — which happens on
 * merged tiles at party walls — would otherwise lose the wall between them when
 * only one of them is replaced, leaving a hole in the neighbour that nothing
 * put there.
 *
 * `_bid` is quantised by Draco and decodes as e.g. 34686.0039, so every read is
 * rounded. Comparing the raw float finds nothing, silently: the suppression
 * reports zero removed triangles and the generated building stays visible
 * underneath the authored one.
 *
 * Vertex data is untouched. Only the index changes, which is what makes this
 * reversible — see {@link restoreIndex}.
 */
export function suppressBuildings(
  index: ArrayLike<number> | null,
  bid: ArrayLike<number>,
  suppressed: ReadonlySet<number>,
  vertexCount = bid.length,
): SuppressionResult {
  const triangles = index ? Math.floor(index.length / 3) : Math.floor(vertexCount / 3)
  const out: number[] = []
  const hit = new Set<number>()
  let removed = 0

  for (let t = 0; t < triangles; t++) {
    const a = index ? index[t * 3] : t * 3
    const b = index ? index[t * 3 + 1] : t * 3 + 1
    const c = index ? index[t * 3 + 2] : t * 3 + 2
    const ba = Math.round(bid[a])
    const bb = Math.round(bid[b])
    const bc = Math.round(bid[c])
    if (suppressed.has(ba) && suppressed.has(bb) && suppressed.has(bc)) {
      hit.add(ba)
      removed++
      continue
    }
    out.push(a, b, c)
  }

  return {
    index: Uint32Array.from(out),
    removed,
    kept: triangles - removed,
    hit: [...hit].sort((p, q) => p - q),
  }
}

/**
 * Vertex indices belonging to one building, for callers that need the set
 * rather than a rewritten buffer — collision registration, bounds, a probe
 * asking "is it actually gone".
 */
export function verticesOfBuilding(bid: ArrayLike<number>, buildingId: number): Set<number> {
  const out = new Set<number>()
  for (let i = 0; i < bid.length; i++) {
    if (Math.round(bid[i]) === buildingId) out.add(i)
  }
  return out
}

/**
 * The original index, kept so an override can be lifted.
 *
 * Stored on the geometry's own userData rather than in a side table keyed by
 * mesh, because a tile that unloads takes its geometry with it and a side table
 * would hold the last reference to a disposed buffer.
 */
export interface RestorableGeometry {
  userData: Record<string, unknown>
}

const ORIGINAL_INDEX = '__heroCellOriginalIndex'

/** Remember the pre-suppression index, once. */
export function rememberIndex(geometry: RestorableGeometry, index: ArrayLike<number> | null): void {
  // Once: suppressing twice must not record the already-suppressed buffer as
  // the original, which would make the first removal unrecoverable.
  if (geometry.userData[ORIGINAL_INDEX] !== undefined) return
  geometry.userData[ORIGINAL_INDEX] = index ? Uint32Array.from(index as ArrayLike<number>) : null
}

/** The remembered index, or undefined when nothing was suppressed. */
export function rememberedIndex(geometry: RestorableGeometry): Uint32Array | null | undefined {
  return geometry.userData[ORIGINAL_INDEX] as Uint32Array | null | undefined
}

/** Forget the remembered index. Call after restoring it. */
export function restoreIndex(geometry: RestorableGeometry): Uint32Array | null | undefined {
  const original = rememberedIndex(geometry)
  delete geometry.userData[ORIGINAL_INDEX]
  return original
}
