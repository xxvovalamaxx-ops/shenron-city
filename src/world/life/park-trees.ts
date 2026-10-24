/**
 * Where the park trees stand.
 *
 * Every streamed world tile carries a merged `TREE_<tile>` mesh: the park
 * trees as low-poly double cones (five or six sided bipyramids), one per
 * tree, exported by the Phase 1 pipeline. Those cones are the placeholder
 * forest over Central Park. The positions they encode are good data, though,
 * so the runtime reads the trees back out of the mesh, hides it, and plants
 * real trees in the same spots (tree-field.ts).
 *
 * A cone is one connected component of the mesh: its apex is the tree top,
 * its lowest vertex the ground. Components are found by union-find over the
 * triangles, with vertices welded by position because the export does not
 * share them.
 */

export interface ConeTree {
  x: number
  z: number
  ground: number
  height: number
}

function find(parent: Int32Array, i: number): number {
  let r = i
  while (parent[r] !== r) r = parent[r]
  // path compression
  while (parent[i] !== r) {
    const n = parent[i]
    parent[i] = r
    i = n
  }
  return r
}

function union(parent: Int32Array, a: number, b: number): void {
  const ra = find(parent, a)
  const rb = find(parent, b)
  if (ra !== rb) parent[rb] = ra
}

/**
 * Trees from a TREE_ mesh's positions (x, y, z triples, world space) and
 * optional triangle index. Components smaller than a triangle fan are ignored.
 */
export function extractConeTrees(pos: ArrayLike<number>, index: ArrayLike<number> | null): ConeTree[] {
  const n = Math.floor(pos.length / 3)
  if (n < 3) return []
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i

  // Weld coincident vertices on a 2 cm grid. The key packs x (19 bits),
  // z (20 bits) and y (12 bits) into one exact double — a string key per
  // vertex cost seconds over a dense park tile.
  const weld = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    const ix = Math.round(pos[i * 3] * 50) + 262144
    const iy = Math.round(pos[i * 3 + 1] * 50) & 4095
    const iz = Math.round(pos[i * 3 + 2] * 50) + 524288
    const k = (ix * 1048576 + iz) * 4096 + iy
    const j = weld.get(k)
    if (j === undefined) weld.set(k, i)
    else union(parent, j, i)
  }
  const tris = index ? Math.floor(index.length / 3) : Math.floor(n / 3)
  for (let t = 0; t < tris; t++) {
    const a = index ? index[t * 3] : t * 3
    const b = index ? index[t * 3 + 1] : t * 3 + 1
    const c = index ? index[t * 3 + 2] : t * 3 + 2
    union(parent, a, b)
    union(parent, b, c)
  }

  const top = new Map<number, { x: number; z: number; ymax: number; ymin: number; count: number }>()
  for (let i = 0; i < n; i++) {
    const r = find(parent, i)
    const x = pos[i * 3]
    const y = pos[i * 3 + 1]
    const z = pos[i * 3 + 2]
    const t = top.get(r)
    if (!t) {
      top.set(r, { x, z, ymax: y, ymin: y, count: 1 })
      continue
    }
    t.count++
    if (y > t.ymax) {
      t.ymax = y
      t.x = x
      t.z = z
    }
    if (y < t.ymin) t.ymin = y
  }

  const out: ConeTree[] = []
  for (const t of top.values()) {
    if (t.count < 9) continue
    const height = t.ymax - t.ymin
    if (height < 1) continue
    out.push({ x: t.x, z: t.z, ground: t.ymin, height })
  }
  // stable order regardless of Map iteration details
  out.sort((a, b) => a.x - b.x || a.z - b.z)
  return out
}
