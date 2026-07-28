/**
 * The detailed tree — @dgreenheck/ez-tree, with real bark and leaf textures.
 *
 * This module is the single reason the ez-tree dependency exists, and ez-tree
 * inlines its bark and leaf textures as base64 inside one ~3.9 MB line of
 * JavaScript. That is more than three.js itself, for six planter trees at the
 * headquarters entrance.
 *
 * So this file is a default export and nothing imports it directly: callers go
 * through `lazy(() => import('./Tree'))` so the cost lands in its own chunk,
 * off the path to first frame, and never downloads at all on the low preset.
 * PlanterTree covers the gap. Do not add a static import of this module.
 */
import { useEffect, useRef } from 'react'
import { Box3, Mesh, Vector3, type Group, type Material } from 'three'
import { Tree as EzTree } from '@dgreenheck/ez-tree'
import { DEFAULT_TREE_HEIGHT, type TreeProps } from './PlanterTree'

type EzTreeOptions = NonNullable<ConstructorParameters<typeof EzTree>[0]>

function disposeTree(tree: EzTree): void {
  tree.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.dispose()
    const materials: Material[] = Array.isArray(object.material)
      ? object.material
      : [object.material]
    for (const material of materials) material.dispose()
  })
}

const PRESETS: Record<string, object> = {
  oak: {
    type: 'deciduous',
    bark: { type: 'oak', tint: 16774097, flatShading: false, textured: true, textureScale: { x: 1, y: 10 } },
    branch: {
      levels: 3,
      angle: { 1: 54, 2: 43, 3: 32 },
      children: { 0: 9, 1: 5, 2: 3 },
      force: { direction: { x: 0, y: 1, z: 0 }, strength: -0.025 },
      gnarliness: { 0: -0.04, 1: 0.16, 2: -0.06, 3: 0.09 },
      length: { 0: 47.7, 1: 29.39, 2: 17.62, 3: 7.16 },
      radius: { 0: 3, 1: 0.69, 2: 0.69, 3: 1.19 },
      sections: { 0: 16, 1: 9, 2: 8, 3: 3 },
      segments: { 0: 12, 1: 5, 2: 3, 3: 3 },
      start: { 1: 0.35, 2: 0.1, 3: 0.0 },
      taper: { 0: 0.73, 1: 0.42, 2: 0.69, 3: 0.75 },
      twist: { 0: -0.23, 1: 0.42, 2: 0, 3: 0 },
    },
    leaves: { type: 'oak', billboard: 'double', angle: 36, count: 20, start: 0.16, size: 4.5, sizeVariance: 0.7, tint: 14013901, alphaTest: 0.5 },
    trellis: { enabled: false },
  },
  pine: {
    type: 'evergreen',
    bark: { type: 'pine', tint: 16774097, flatShading: false, textured: true, textureScale: { x: 1, y: 10 } },
    branch: {
      levels: 3,
      angle: { 1: 45, 2: 35, 3: 25 },
      children: { 0: 7, 1: 4, 2: 2 },
      force: { direction: { x: 0, y: 1, z: 0 }, strength: -0.02 },
      gnarliness: { 0: -0.02, 1: 0.1, 2: -0.03, 3: 0.05 },
      length: { 0: 40, 1: 24, 2: 14, 3: 6 },
      radius: { 0: 2.5, 1: 0.5, 2: 0.5, 3: 0.8 },
      sections: { 0: 14, 1: 8, 2: 6, 3: 3 },
      segments: { 0: 10, 1: 5, 2: 3, 3: 3 },
      start: { 1: 0.3, 2: 0.1, 3: 0.0 },
      taper: { 0: 0.7, 1: 0.4, 2: 0.6, 3: 0.7 },
      twist: { 0: -0.15, 1: 0.3, 2: 0, 3: 0 },
    },
    leaves: { type: 'pine', billboard: 'double', angle: 36, count: 35, start: 0.1, size: 3.0, sizeVariance: 0.5, tint: 14013901, alphaTest: 0.5 },
    trellis: { enabled: false },
  },
  birch: {
    type: 'deciduous',
    bark: { type: 'birch', tint: 16774097, flatShading: false, textured: true, textureScale: { x: 1, y: 10 } },
    branch: {
      levels: 3,
      angle: { 1: 50, 2: 40, 3: 30 },
      children: { 0: 8, 1: 4, 2: 2 },
      force: { direction: { x: 0, y: 1, z: 0 }, strength: -0.03 },
      gnarliness: { 0: -0.02, 1: 0.12, 2: -0.04, 3: 0.07 },
      length: { 0: 42, 1: 26, 2: 15, 3: 6 },
      radius: { 0: 2, 1: 0.5, 2: 0.5, 3: 0.9 },
      sections: { 0: 14, 1: 8, 2: 6, 3: 3 },
      segments: { 0: 10, 1: 5, 2: 3, 3: 3 },
      start: { 1: 0.3, 2: 0.1, 3: 0.0 },
      taper: { 0: 0.65, 1: 0.4, 2: 0.6, 3: 0.7 },
      twist: { 0: -0.18, 1: 0.35, 2: 0, 3: 0 },
    },
    leaves: { type: 'aspen', billboard: 'double', angle: 36, count: 20, start: 0.16, size: 4.0, sizeVariance: 0.6, tint: 14013901, alphaTest: 0.5 },
    trellis: { enabled: false },
  },
  willow: {
    type: 'deciduous',
    bark: { type: 'willow', tint: 16774097, flatShading: false, textured: true, textureScale: { x: 1, y: 10 } },
    branch: {
      levels: 3,
      angle: { 1: 60, 2: 50, 3: 40 },
      children: { 0: 8, 1: 5, 2: 3 },
      force: { direction: { x: 0, y: 1, z: 0 }, strength: 0.02 },
      gnarliness: { 0: -0.03, 1: 0.14, 2: -0.05, 3: 0.08 },
      length: { 0: 45, 1: 28, 2: 16, 3: 7 },
      radius: { 0: 2.5, 1: 0.6, 2: 0.6, 3: 1.0 },
      sections: { 0: 14, 1: 8, 2: 7, 3: 3 },
      segments: { 0: 10, 1: 5, 2: 3, 3: 3 },
      start: { 1: 0.3, 2: 0.1, 3: 0.0 },
      taper: { 0: 0.7, 1: 0.42, 2: 0.65, 3: 0.72 },
      twist: { 0: -0.2, 1: 0.4, 2: 0, 3: 0 },
    },
    leaves: { type: 'ash', billboard: 'double', angle: 36, count: 22, start: 0.12, size: 4.0, sizeVariance: 0.6, tint: 14013901, alphaTest: 0.5 },
    trellis: { enabled: false },
  },
}

export default function Tree({
  position,
  seed = 42,
  height = DEFAULT_TREE_HEIGHT,
  variant = 'oak',
  shadows = true,
}: TreeProps) {
  const groupRef = useRef<Group>(null)
  const treeRef = useRef<EzTree | null>(null)

  useEffect(() => {
    const group = groupRef.current
    if (!group) return

    if (treeRef.current) {
      group.remove(treeRef.current)
      disposeTree(treeRef.current)
      treeRef.current = null
    }

    const preset = JSON.parse(JSON.stringify(PRESETS[variant]))
    const tree = new EzTree({ ...preset, seed } as EzTreeOptions)
    tree.generate()

    tree.traverse((child) => {
      child.castShadow = shadows
      child.receiveShadow = shadows
    })

    // ez-tree's presets are authored in their own units — the stock oak comes
    // out roughly 98 m tall — and each preset and seed differs. Measure what
    // was actually generated and normalise to the requested height, so this
    // never drifts from PlanterTree when a preset is tweaked.
    const natural = new Box3().setFromObject(tree).getSize(new Vector3()).y
    if (natural > 0) tree.scale.setScalar(height / natural)

    group.add(tree)
    treeRef.current = tree

    return () => {
      group.remove(tree)
      disposeTree(tree)
      if (treeRef.current === tree) {
        treeRef.current = null
      }
    }
  }, [seed, variant, shadows, height])

  // No scale here — the generated tree is normalised to `height` above.
  return <group ref={groupRef} position={position} />
}
