/**
 * Module-level registry of breakable meshes for laser raycasting.
 *
 * DestructionSystem registers meshes here synchronously (in React ref
 * callbacks, not useFrame). useLaser reads from here directly — no
 * globalThis, no timing dependency on mount order.
 */
import type { Mesh } from 'three'

const breakableMeshes: Mesh[] = []

export function registerBreakableMesh(id: string, mesh: Mesh | null): void {
  const idx = breakableMeshes.findIndex((m) => (m as unknown as { __breakId?: string }).__breakId === id)
  if (mesh) {
    ;(mesh as unknown as { __breakId?: string }).__breakId = id
    if (idx === -1) breakableMeshes.push(mesh)
    else breakableMeshes[idx] = mesh
  } else if (idx !== -1) {
    breakableMeshes.splice(idx, 1)
  }
}

export function getBreakableMeshes(): Mesh[] {
  return breakableMeshes
}
