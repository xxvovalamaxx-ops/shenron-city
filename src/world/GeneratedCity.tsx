/**
 * The generated city around the hand-authored district.
 *
 * Three draw calls for 331 buildings: one instanced mesh for the masses, one
 * for the lit window faces, one for the roads. Loading the detailed CC0 kit
 * 331 times would cost thousands of draw calls to render geometry that is
 * mostly over 200 m away and reads as a silhouette either way.
 *
 * That is also the honest way to build background city: mass and lit windows
 * are what a skyline is at night. The detailed kit stays where the player can
 * walk up and touch it — Dragon Boulevard.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { generateCityPlan, type Lot } from './city-plan'
import { gradeToNight } from './night-grade'
import { PALETTE, type QualitySettings } from './palette'

/** Facade colours, before the night grade. Concrete, brick, glass, stone. */
const FACADES = ['#8d8f93', '#7a6a5f', '#6f7c88', '#95908a', '#66707a', '#847b70'] as const

/**
 * Window sheet.
 *
 * Drawn to a canvas rather than shipped as an image: it is a grid of lit
 * rectangles, it costs nothing to generate, and it keeps the project's
 * no-binary-assets rule intact. Used as an emissive map so the lights survive
 * the night grade that darkens the facades.
 */
const WINDOW_COLS = 16
const WINDOW_ROWS = 32

function useWindowTexture(seed = 7): THREE.Texture {
  return useMemo(() => {
    const cols = WINDOW_COLS
    const rows = WINDOW_ROWS
    const cell = 16
    const canvas = document.createElement('canvas')
    canvas.width = cols * cell
    canvas.height = rows * cell
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context is unavailable')

    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    let a = seed | 0
    const rand = () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        // Roughly half the windows lit, a few brighter — an office block at
        // night is neither fully lit nor fully dark.
        const r = rand()
        if (r < 0.42) continue
        const warm = r > 0.88
        ctx.fillStyle = warm ? '#fff0cc' : r > 0.66 ? '#ffe1a8' : '#8fb8e8'
        ctx.globalAlpha = 0.5 + rand() * 0.5
        ctx.fillRect(x * cell + 3, y * cell + 4, cell - 6, cell - 8)
      }
    }
    ctx.globalAlpha = 1

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    return texture
  }, [seed])
}

/** Window spacing in world metres: a 4 m bay, a 3.4 m storey. */
const BAY = 4
const STOREY = 3.4
/** One texture tile covers the whole grid, so a window is one bay wide. */
const TILE_W = BAY * WINDOW_COLS
const TILE_H = STOREY * WINDOW_ROWS

/**
 * Put the window grid in world space instead of UV space.
 *
 * A unit box scaled to a building stretches its UVs with it, so a 160 m tower
 * and an 8 m shop got the same number of window rows — smeared into vertical
 * streaks on the tall ones and across every roof. Deriving the lookup from
 * local position times instance scale makes a window the same size everywhere
 * in the city, and the normal masks the roof, which has no windows on it.
 */
function worldSpaceWindows(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vLocalPos;
         varying vec3 vLocalNrm;
         varying vec3 vInstScale;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vLocalPos = position;
         vLocalNrm = normal;
         #ifdef USE_INSTANCING
           vInstScale = vec3(
             length(instanceMatrix[0].xyz),
             length(instanceMatrix[1].xyz),
             length(instanceMatrix[2].xyz));
         #else
           vInstScale = vec3(1.0);
         #endif`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vLocalPos;
         varying vec3 vLocalNrm;
         varying vec3 vInstScale;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `vec3 wpos = vLocalPos * vInstScale;
         if (abs(vLocalNrm.y) > 0.5) {
           // Roofs and undersides: plant, not windows.
           totalEmissiveRadiance = vec3(0.0);
         } else {
           vec2 wuv = abs(vLocalNrm.x) > 0.5
             ? vec2(wpos.z / ${TILE_W.toFixed(1)}, wpos.y / ${TILE_H.toFixed(1)})
             : vec2(wpos.x / ${TILE_W.toFixed(1)}, wpos.y / ${TILE_H.toFixed(1)});
           totalEmissiveRadiance *= texture2D(emissiveMap, wuv).rgb;
         }`,
      )
  }
  material.needsUpdate = true
}

function Buildings({ lots, shadows }: { lots: Lot[]; shadows: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const windows = useWindowTexture()

  useLayoutEffect(() => {
    const target = mesh.current
    if (!target) return

    const node = new THREE.Object3D()
    const colour = new THREE.Color()

    lots.forEach((lot, i) => {
      node.position.set(lot.x, lot.height / 2, lot.z)
      node.rotation.set(0, lot.rotation, 0)
      node.scale.set(lot.width, lot.height, lot.depth)
      node.updateMatrix()
      target.setMatrixAt(i, node.matrix)

      const base = new THREE.Color(FACADES[i % FACADES.length])
      const graded = gradeToNight({ r: base.r, g: base.g, b: base.b })
      target.setColorAt(i, colour.setRGB(graded.r, graded.g, graded.b))
    })

    target.instanceMatrix.needsUpdate = true
    if (target.instanceColor) target.instanceColor.needsUpdate = true
    target.computeBoundingSphere()
  }, [lots])

  useLayoutEffect(() => () => windows.dispose(), [windows])

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, lots.length]}
      castShadow={shadows}
      receiveShadow={shadows}
    >
      {/* Unit box, scaled per instance — one geometry for the whole city. */}
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        ref={(m) => m && worldSpaceWindows(m)}
        roughness={0.82}
        metalness={0.05}
        emissiveMap={windows}
        emissive="#ffffff"
        emissiveIntensity={1.15}
      />
    </instancedMesh>
  )
}

function Roads({ plan }: { plan: ReturnType<typeof generateCityPlan> }) {
  const mesh = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const target = mesh.current
    if (!target) return
    const node = new THREE.Object3D()
    plan.roads.forEach((road, i) => {
      // Just above the ground plane; z-fighting on a 2 km surface is very
      // visible because it flickers across the whole view as the camera moves.
      node.position.set(road.x, 0.015, road.z)
      node.rotation.set(-Math.PI / 2, 0, 0)
      node.scale.set(road.width, road.depth, 1)
      node.updateMatrix()
      target.setMatrixAt(i, node.matrix)
    })
    target.instanceMatrix.needsUpdate = true
    target.computeBoundingSphere()
  }, [plan])

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, plan.roads.length]} receiveShadow>
      <planeGeometry args={[1, 1]} />
      <meshStandardMaterial color="#14171c" roughness={0.92} metalness={0.02} />
    </instancedMesh>
  )
}

export function GeneratedCity({ quality }: { quality: QualitySettings }) {
  const plan = useMemo(() => generateCityPlan(), [])

  return (
    <group>
      {/* Ground for the whole city, so the generated blocks are not floating
          over the void beyond the hand-authored district's slab. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 220]} receiveShadow>
        <planeGeometry args={[2200, 1800]} />
        <meshStandardMaterial color="#0e1116" roughness={0.95} />
      </mesh>

      {/* Harbour. The waterfront district needs something to front onto. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, plan.shorelineZ - 420]}>
        <planeGeometry args={[2600, 900]} />
        <meshStandardMaterial
          color={PALETTE.horizon}
          roughness={0.14}
          metalness={0.72}
        />
      </mesh>

      <Roads plan={plan} />
      <Buildings lots={plan.lots} shadows={quality.shadows} />
    </group>
  )
}
