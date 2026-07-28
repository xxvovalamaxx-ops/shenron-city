/**
 * Applies the shadow budget to whatever is in the scene.
 *
 * Done as a pass over the graph rather than by editing `castShadow` on a
 * hundred JSX meshes: the rule is one decision in one place, it covers loaded
 * GLB props nobody wrote JSX for, and it re-evaluates when the quality preset
 * changes the shadow-map size. See world/shadow-budget.ts for why.
 *
 * The original value is stashed on userData, so raising quality restores
 * casters that a lower preset switched off. Without that, walking the graph
 * once would be a one-way door.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { shadowTexelSize, shouldCastShadow } from './shadow-budget'

const ORIGINAL = '__shadowBudgetOriginal'

/** Characters are exempt: a person with no shadow reads as a bug. */
function isCharacter(object: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object
  for (let i = 0; i < 8 && node; i++) {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh) return true
    node = node.parent
  }
  return false
}

export function ShadowBudget({ enabled, mapSize }: { enabled: boolean; mapSize: number }) {
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    // Re-run on a timer as well as on mount: props stream in from GLB loaders
    // after the first frame, and a pass that ran once would miss all of them.
    let cancelled = false

    const apply = () => {
      if (cancelled) return

      let extent = 0
      scene.traverse((object) => {
        const light = object as THREE.DirectionalLight
        if (!light.isDirectionalLight || !light.castShadow) return
        const camera = light.shadow.camera
        extent = Math.max(extent, camera.right - camera.left, camera.top - camera.bottom)
      })
      if (extent <= 0) return

      const texel = shadowTexelSize(extent, mapSize)

      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh && !(mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return

        const data = mesh.userData as Record<string, unknown>
        if (data[ORIGINAL] === undefined) data[ORIGINAL] = mesh.castShadow
        const original = data[ORIGINAL] === true

        if (!original || !enabled) {
          mesh.castShadow = original && enabled
          return
        }
        if (isCharacter(mesh)) {
          mesh.castShadow = true
          return
        }

        const geometry = mesh.geometry
        if (!geometry) return
        if (!geometry.boundingSphere) geometry.computeBoundingSphere()
        const sphere = geometry.boundingSphere
        if (!sphere) return

        mesh.updateWorldMatrix(true, false)
        const e = mesh.matrixWorld.elements
        const worldScale = Math.max(
          Math.hypot(e[0], e[1], e[2]),
          Math.hypot(e[4], e[5], e[6]),
          Math.hypot(e[8], e[9], e[10]),
        )
        mesh.castShadow = shouldCastShadow(sphere.radius * worldScale, texel)
      })
    }

    apply()
    const timer = setInterval(apply, 1500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [scene, enabled, mapSize])

  return null
}
