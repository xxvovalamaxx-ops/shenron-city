/**
 * The police helicopter's visual layer: a procedural airframe (no model
 * file), spinning rotors with a blur disc, a blinking anti-collision beacon
 * and the searchlight — a real SpotLight plus a faint additive beam cone so
 * the light reads in the air at night.
 *
 * The rig is built once with its light at zero intensity, so appearing and
 * leaving never changes the scene's light count (no shader recompiles). The
 * flight itself is gameplay/wanted/helicopter.ts.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { policeHeli } from '../gameplay/wanted/helicopter'
import { rt } from '../gameplay/runtime'
import { heliAudio } from '../audio/heli-audio'

const ROTOR_RATE = 42 // rad/s, main rotor
const TAIL_RATE = 160

function buildAirframe(): {
  root: THREE.Group
  body: THREE.Group
  rotor: THREE.Group
  tail: THREE.Group
  beacon: THREE.MeshBasicMaterial
  beam: THREE.Mesh
  light: THREE.SpotLight
  disposables: { dispose(): void }[]
} {
  const disposables: { dispose(): void }[] = []
  const mat = (o: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial(o)
    disposables.push(m)
    return m
  }
  const geo = <T extends THREE.BufferGeometry>(g: T) => {
    disposables.push(g)
    return g
  }
  const navy = mat({ color: 0x1b2333, roughness: 0.35, metalness: 0.4 })
  const white = mat({ color: 0xe8ebee, roughness: 0.4, metalness: 0.2 })
  const glass = mat({ color: 0x1a2a33, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.75 })
  const dark = mat({ color: 0x111316, roughness: 0.6, metalness: 0.5 })

  const root = new THREE.Group()
  root.name = 'police-helicopter'
  const body = new THREE.Group()
  root.add(body)

  // Fuselage: a stretched sphere, white belly band, canopy glass at the nose (+Z).
  const cabin = new THREE.Mesh(geo(new THREE.SphereGeometry(1, 24, 16)), navy)
  cabin.scale.set(1.15, 1.1, 2.3)
  body.add(cabin)
  const band = new THREE.Mesh(geo(new THREE.SphereGeometry(1.01, 24, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.2)), white)
  band.scale.copy(cabin.scale)
  body.add(band)
  const canopy = new THREE.Mesh(geo(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)), glass)
  canopy.scale.set(1.0, 0.95, 1.3)
  canopy.rotation.x = Math.PI * 0.5
  canopy.position.set(0, 0.15, 1.3)
  body.add(canopy)
  // Tail boom and fins.
  const boom = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.22, 0.4, 5.2, 12)), navy)
  boom.rotation.x = Math.PI * 0.5
  boom.position.set(0, 0.35, -4.2)
  body.add(boom)
  const fin = new THREE.Mesh(geo(new THREE.BoxGeometry(0.08, 1.4, 0.9)), navy)
  fin.position.set(0, 0.95, -6.6)
  fin.rotation.x = -0.35
  body.add(fin)
  const stab = new THREE.Mesh(geo(new THREE.BoxGeometry(1.8, 0.06, 0.5)), navy)
  stab.position.set(0, 0.4, -5.6)
  body.add(stab)
  // Skids.
  for (const side of [-1, 1]) {
    const skid = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 8)), dark)
    skid.rotation.x = Math.PI * 0.5
    skid.position.set(side * 0.95, -1.45, 0.1)
    body.add(skid)
    for (const z of [-0.8, 0.9]) {
      const strut = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6)), dark)
      strut.position.set(side * 0.82, -1.15, z)
      strut.rotation.z = side * 0.35
      body.add(strut)
    }
  }
  // Mast and main rotor: two blades and a faint blur disc.
  const mast = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.1, 0.12, 0.6, 8)), dark)
  mast.position.set(0, 1.35, 0)
  body.add(mast)
  const rotor = new THREE.Group()
  rotor.position.set(0, 1.62, 0)
  body.add(rotor)
  for (let i = 0; i < 2; i++) {
    const blade = new THREE.Mesh(geo(new THREE.BoxGeometry(10.2, 0.04, 0.32)), dark)
    blade.rotation.y = i * Math.PI * 0.5
    rotor.add(blade)
  }
  const blurMat = new THREE.MeshBasicMaterial({ color: 0x15181c, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })
  disposables.push(blurMat)
  const blur = new THREE.Mesh(geo(new THREE.CircleGeometry(5.1, 40)), blurMat)
  blur.rotation.x = -Math.PI * 0.5
  rotor.add(blur)
  const tail = new THREE.Group()
  tail.position.set(0.18, 0.95, -6.6)
  body.add(tail)
  for (let i = 0; i < 2; i++) {
    const blade = new THREE.Mesh(geo(new THREE.BoxGeometry(0.03, 1.5, 0.14)), dark)
    blade.rotation.x = i * Math.PI * 0.5
    tail.add(blade)
  }
  // Beacon on the tail.
  const beacon = new THREE.MeshBasicMaterial({ color: 0xff2a1a })
  disposables.push(beacon)
  const beaconMesh = new THREE.Mesh(geo(new THREE.SphereGeometry(0.12, 8, 6)), beacon)
  beaconMesh.position.set(0, 1.65, -6.85)
  body.add(beaconMesh)

  // Searchlight under the nose, aimed by world target.
  const light = new THREE.SpotLight(0xf4f6ff, 0, 220, 0.12, 0.45, 1.2)
  light.castShadow = false
  light.name = 'heli-searchlight'
  root.add(light, light.target)
  // A visible beam: an open cone with additive blending, pointed down its -Y.
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xdfe6ff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  disposables.push(beamMat)
  const beamGeo = geo(new THREE.ConeGeometry(1, 1, 24, 1, true))
  beamGeo.translate(0, -0.5, 0) // apex at the origin, opening toward -Y
  const beam = new THREE.Mesh(beamGeo, beamMat)
  beam.frustumCulled = false
  root.add(beam)

  return { root, body, rotor, tail, beacon, beam, light, disposables }
}

const _dir = new THREE.Vector3()
const _up = new THREE.Vector3(0, -1, 0)
const _q = new THREE.Quaternion()
const _cam = new THREE.Vector3()

export function PoliceHelicopter() {
  const holder = useRef<THREE.Group>(null)
  const rig = useMemo(() => buildAirframe(), [])
  const clock = useRef(0)

  useEffect(() => {
    const parent = holder.current
    if (!parent) return
    parent.add(rig.root)
    return () => {
      rig.root.removeFromParent()
      for (const d of rig.disposables) d.dispose()
      rig.light.dispose()
      heliAudio.stop()
    }
  }, [rig])

  useFrame(({ camera }, rawDt) => {
    const s = policeHeli
    const dt = rt.paused ? 0 : Math.min(rawDt, 0.05)
    clock.current += dt
    rig.root.visible = s.active
    if (!s.active) {
      rig.light.intensity = 0
      heliAudio.update(null, null)
      return
    }
    rig.root.position.set(s.x, s.y, s.z)
    rig.body.rotation.set(0, s.heading, 0)
    rig.body.rotateZ(s.bank)
    // nose down a touch with forward speed
    rig.body.rotateX(Math.min(0.18, Math.hypot(s.vx, s.vz) * 0.006))
    rig.rotor.rotation.y += ROTOR_RATE * dt
    rig.tail.rotation.x += TAIL_RATE * dt
    rig.beacon.color.setHex(Math.sin(clock.current * 6) > 0.7 ? 0xff2a1a : 0x330806)

    // Searchlight from under the nose to the ground spot.
    const groundY = s.y - 62
    const nose = { x: Math.sin(s.heading) * 1.8, z: Math.cos(s.heading) * 1.8 }
    rig.light.position.set(nose.x, -1.2, nose.z)
    rig.light.target.position.set(s.light.x - s.x, groundY - s.y, s.light.z - s.z)
    const hour = rt.clock.hour
    const night = hour < 6.5 || hour > 18.5 ? 1 : hour < 7.5 ? 7.5 - hour : hour > 17.5 ? hour - 17.5 : 0
    rig.light.intensity = s.leaving ? 0 : 6000 + 34000 * night
    _dir.set(s.light.x - s.x - nose.x, groundY - s.y + 1.2, s.light.z - s.z - nose.z)
    const len = _dir.length()
    rig.beam.position.copy(rig.light.position)
    rig.beam.scale.set(len * 0.12, len, len * 0.12)
    _q.setFromUnitVectors(_up, _dir.normalize())
    rig.beam.quaternion.copy(_q)
    rig.beam.visible = !s.leaving && night > 0.2
    ;(rig.beam.material as THREE.MeshBasicMaterial).opacity = 0.05 * night

    camera.getWorldDirection(_cam)
    const flen = Math.hypot(_cam.x, _cam.z) || 1
    heliAudio.update(
      { x: s.x, y: s.y, z: s.z },
      { pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, forward: { x: _cam.x / flen, z: _cam.z / flen } },
    )
  })

  return <group name="police-helicopter-holder" ref={holder} />
}
