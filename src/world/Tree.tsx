/**
 * Tree wrapper — uses @dgreenheck/ez-tree for high-quality procedural trees
 * with real bark and leaf textures.
 */
import { useEffect, useRef } from 'react'
import type { Group } from 'three'
import { Tree as EzTree } from '@dgreenheck/ez-tree'

interface TreeProps {
  position: [number, number, number]
  seed?: number
  scale?: number
  variant?: 'oak' | 'pine' | 'birch' | 'willow'
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

export function Tree({
  position,
  seed = 42,
  scale = 1,
  variant = 'oak',
}: TreeProps) {
  const groupRef = useRef<Group>(null)
  const treeRef = useRef<EzTree | null>(null)

  useEffect(() => {
    if (!groupRef.current) return

    if (treeRef.current) {
      groupRef.current.remove(treeRef.current)
      treeRef.current = null
    }

    const preset = JSON.parse(JSON.stringify(PRESETS[variant]))
    const tree = new EzTree({ ...preset, seed } as any)
    tree.generate()

    tree.traverse((child) => {
      child.castShadow = true
      child.receiveShadow = true
    })

    groupRef.current.add(tree)
    treeRef.current = tree

    return () => {
      if (treeRef.current && groupRef.current) {
        groupRef.current.remove(treeRef.current)
        treeRef.current = null
      }
    }
  }, [seed, variant])

  return <group ref={groupRef} position={position} scale={scale} />
}
