import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { MANHATTAN_BASE_URL, MANHATTAN_TILES } from './manhattan-tiles'

let sharedLoader: GLTFLoader | null = null

function getGLTFLoader(): GLTFLoader {
  if (!sharedLoader) {
    const draco = new DRACOLoader()
    // Serve decoders locally — the external gstatic CDN often fails with
    // "Failed to fetch" in restricted networks or on slow connections.
    draco.setDecoderPath('/draco/')
    draco.preload()
    sharedLoader = new GLTFLoader()
    sharedLoader.setDRACOLoader(draco)
  }
  return sharedLoader
}

/**
 * The island is exported twice: a single combined `manhattan_world.glb` for
 * the `full` mode, and a `manhattan_base.glb` + per-tile files for the `tiles`
 * mode. The combined export has exactly the same triangle count as base plus
 * every tile, so both modes render the same island — `tiles` just spreads the
 * download over time instead of pulling 26 MB up front.
 *
 * Tile loading is distance-driven: tiles whose bounding box lies within
 * {@link TILE_LOAD_RADIUS} of the camera are requested, and tiles farther than
 * {@link TILE_UNLOAD_RADIUS} are disposed. Radii are hysteresis-paired so a
 * tile that just crossed the load threshold is not immediately evicted while
 * the camera idles on a boundary.
 */
const TILE_LOAD_RADIUS = 5200
const TILE_UNLOAD_RADIUS = 8200

function prepareMaterials(root: THREE.Group) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const hasColor = !!obj.geometry.attributes.color
      obj.material = new THREE.MeshStandardMaterial({
        vertexColors: hasColor,
        color: hasColor ? 0xffffff : 0x8a8f96,
        roughness: 0.78,
        metalness: 0.08,
      })
      obj.castShadow = false
      obj.receiveShadow = true
    }
  })
}

function disposeScene(root: THREE.Group) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose())
      } else {
        obj.material.dispose()
      }
    }
  })
  root.clear()
}

function distanceToTile(camera: THREE.Camera, tile: (typeof MANHATTAN_TILES)[number]) {
  const x = Math.max(tile.minX - camera.position.x, 0, camera.position.x - tile.maxX)
  const z = Math.max(tile.minZ - camera.position.z, 0, camera.position.z - tile.maxZ)
  return Math.hypot(x, z)
}

export function ManhattanCity({
  mode = 'full',
  position = [0, 0, 0],
  scale = 1,
}: {
  mode?: 'full' | 'tiles'
  position?: [number, number, number]
  scale?: number
}) {
  const groupRef = useRef<THREE.Group>(null)
  const tileRootRef = useRef<THREE.Group>(null)
  const loadedTiles = useRef(new Map<string, THREE.Group>())
  const inFlightTiles = useRef(new Set<string>())
  const baseLoaded = useRef(false)

  // Full mode: a single combined GLB. Simple, and the safest fallback when
  // tile streaming misbehaves in an unexpected browser.
  useEffect(() => {
    if (mode !== 'full') return
    const group = groupRef.current
    if (!group) return

    const loader = getGLTFLoader()
    loader.load(
      '/models/manhattan/manhattan_world.glb',
      (gltf) => {
        if (!groupRef.current) return
        prepareMaterials(gltf.scene)
        groupRef.current.add(gltf.scene)
      },
      undefined,
      (err) => console.warn('[ManhattanCity] Failed to load manhattan_world.glb:', err),
    )

    return () => {
      group.clear()
    }
  }, [mode])

  // Tiles mode: the base (water, land, landmarks, bridges) is loaded once and
  // stays; per-tile road/tree/building chunks stream in around the camera.
  useEffect(() => {
    if (mode !== 'tiles') return
    const group = groupRef.current
    if (!group) return

    const loader = getGLTFLoader()
    loader.load(
      MANHATTAN_BASE_URL,
      (gltf) => {
        if (!groupRef.current || baseLoaded.current) return
        baseLoaded.current = true
        prepareMaterials(gltf.scene)
        const base = gltf.scene
        base.name = 'manhattan-base'
        groupRef.current.add(base)
      },
      undefined,
      (err) => console.warn('[ManhattanCity] Failed to load manhattan_base.glb:', err),
    )

    const tileRoot = new THREE.Group()
    tileRoot.name = 'manhattan-tiles'
    group.add(tileRoot)
    tileRootRef.current = tileRoot

    const loaded = loadedTiles.current
    const inFlight = inFlightTiles.current

    return () => {
      baseLoaded.current = false
      tileRootRef.current = null
      for (const tileGroup of loaded.values()) {
        tileGroup.removeFromParent()
        disposeScene(tileGroup)
      }
      loaded.clear()
      inFlight.clear()
      group.clear()
    }
  }, [mode])

  useFrame(({ camera }) => {
    if (mode !== 'tiles') return
    const tileRoot = tileRootRef.current
    if (!tileRoot) return

    for (const tile of MANHATTAN_TILES) {
      const distance = distanceToTile(camera, tile)
      const group = loadedTiles.current.get(tile.url)

      if (!group && !inFlightTiles.current.has(tile.url) && distance < TILE_LOAD_RADIUS) {
        inFlightTiles.current.add(tile.url)
        getGLTFLoader().load(
          tile.url,
          (gltf) => {
            inFlightTiles.current.delete(tile.url)
            if (!tileRootRef.current) return
            prepareMaterials(gltf.scene)
            const tileGroup = new THREE.Group()
            tileGroup.name = tile.url
            tileGroup.add(gltf.scene)
            tileRootRef.current.add(tileGroup)
            loadedTiles.current.set(tile.url, tileGroup)
          },
          undefined,
          (err) => {
            inFlightTiles.current.delete(tile.url)
            console.warn(`[ManhattanCity] Failed to load ${tile.url}:`, err)
          },
        )
      } else if (group && distance > TILE_UNLOAD_RADIUS) {
        loadedTiles.current.delete(tile.url)
        tileRoot.remove(group)
        disposeScene(group)
      }
    }
  })

  return <group ref={groupRef} position={position} scale={scale} name="manhattan-city" />
}
