/**
 * GTA-style world markers: a soft glowing cylinder ("corona") standing on the
 * ground with a bobbing chevron above it.
 *
 * Markers are data (`missionMarkers.list`), written by whatever owns the
 * gameplay — the mission director, a race, a dev tool. This component only
 * draws them. One shared geometry and material per style, mutated in
 * useFrame, so a handful of markers costs a handful of draw calls and no
 * React re-renders per frame.
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { manhattanCollision } from './manhattan-collision'

export type MarkerStyle = 'mission' | 'objective' | 'checkpoint' | 'destination'

export interface WorldMarker {
  id: string
  x: number
  z: number
  radius: number
  style: MarkerStyle
}

/** The live marker list. Replace the array (or mutate it) from gameplay code. */
export const missionMarkers: { list: WorldMarker[]; revision: number } = { list: [], revision: 0 }

export function setMarkers(list: WorldMarker[]): void {
  missionMarkers.list = list
  missionMarkers.revision += 1
}

const STYLE_COLOR: Record<MarkerStyle, string> = {
  mission: '#f5c542', // GTA yellow: a job to pick up
  objective: '#f5c542',
  checkpoint: '#3fa9f5',
  destination: '#f5c542',
}

const MAX_MARKERS = 8

const coronaVertex = /* glsl */ `
  varying float vHeight;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    vHeight = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const coronaFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  varying float vHeight;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    // Bright at the base, fading to nothing at the top; brighter at the
    // silhouette so the cylinder reads as a volume, not a tube.
    float fade = pow(1.0 - vHeight, 1.6);
    float rim = 1.0 - abs(dot(vNormalV, vViewDir));
    float bands = 0.85 + 0.15 * sin(vHeight * 18.0 - uTime * 3.0);
    float a = fade * (0.25 + 0.75 * rim) * bands * 0.55;
    gl_FragColor = vec4(uColor * 2.2, a);
  }
`

interface MarkerSlot {
  group: THREE.Group
  corona: THREE.Mesh
  chevron: THREE.Mesh
  ring: THREE.Mesh
  material: THREE.ShaderMaterial
  chevronMaterial: THREE.MeshBasicMaterial
  ringMaterial: THREE.MeshBasicMaterial
}

function makeChevron(): THREE.BufferGeometry {
  // A flat downward arrow, extruded a little so it catches bloom from any side.
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(0.55, 0.55)
  shape.lineTo(0.3, 0.55)
  shape.lineTo(0, 0.25)
  shape.lineTo(-0.3, 0.55)
  shape.lineTo(-0.55, 0.55)
  shape.lineTo(0, 0)
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false })
  geometry.translate(0, 0, -0.06)
  return geometry
}

export function MissionMarkers() {
  const root = useRef<THREE.Group>(null)
  const seenRevision = useRef(-1)

  const slots = useMemo<MarkerSlot[]>(() => {
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true)
    cylinder.translate(0, 0.5, 0)
    const chevron = makeChevron()
    const ring = new THREE.RingGeometry(0.92, 1, 48)
    ring.rotateX(-Math.PI / 2)
    return Array.from({ length: MAX_MARKERS }, () => {
      const material = new THREE.ShaderMaterial({
        vertexShader: coronaVertex,
        fragmentShader: coronaFragment,
        uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
      const chevronMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        toneMapped: false,
      })
      const group = new THREE.Group()
      const corona = new THREE.Mesh(cylinder, material)
      corona.renderOrder = 10
      const chevronMesh = new THREE.Mesh(chevron, chevronMaterial)
      const ringMesh = new THREE.Mesh(ring, ringMaterial)
      ringMesh.position.y = 0.04
      group.add(corona, chevronMesh, ringMesh)
      group.visible = false
      return { group, corona, chevron: chevronMesh, ring: ringMesh, material, chevronMaterial, ringMaterial }
    })
  }, [])

  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime
    const list = missionMarkers.list
    const changed = seenRevision.current !== missionMarkers.revision
    seenRevision.current = missionMarkers.revision

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      const marker = list[i]
      if (!marker) {
        slot.group.visible = false
        continue
      }
      if (changed || !slot.group.visible) {
        const ground = manhattanCollision.groundHeightAt(marker.x, marker.z) ?? 12.4
        slot.group.position.set(marker.x, ground, marker.z)
        const color = new THREE.Color(STYLE_COLOR[marker.style])
        slot.material.uniforms.uColor.value.copy(color)
        slot.chevronMaterial.color.copy(color).multiplyScalar(1.6)
        slot.ringMaterial.color.copy(color).multiplyScalar(1.4)
        const height = marker.style === 'checkpoint' ? 6 : 2.4
        slot.corona.scale.set(marker.radius, height, marker.radius)
        slot.ring.scale.setScalar(marker.radius)
        slot.group.visible = true
      }
      slot.material.uniforms.uTime.value = t
      // The chevron bobs and always faces the camera about the vertical axis.
      slot.chevron.position.y = (marker.style === 'checkpoint' ? 7.2 : 3.1) + Math.sin(t * 2.2 + i) * 0.18
      slot.chevron.rotation.y = Math.atan2(
        camera.position.x - slot.group.position.x,
        camera.position.z - slot.group.position.z,
      )
      const pulse = 1 + Math.sin(t * 3 + i) * 0.04
      slot.ring.scale.setScalar(marker.radius * pulse)
    }
  })

  return (
    <group ref={root}>
      {slots.map((slot, i) => (
        <primitive key={i} object={slot.group} />
      ))}
    </group>
  )
}
