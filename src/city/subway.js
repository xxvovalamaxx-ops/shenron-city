// subway.js â€” 658 station entrances, and the footfall they generate.
//
// Two things, deliberately in one place because they are the same fact.
//
// The kiosks are street furniture: 619 stairs and 39 elevators, snapped to
// pavements wide enough to hold them and rotated to the kerb line. At 658
// instances and 698 triangles between two meshes this needs no streaming â€”
// the whole island's worth is two draw calls, always resident.
//
// The footfall is the reason the entrances matter more than they look. The
// demand field could already tell that Times Square is busier than Yorkville,
// because it reads floor area out of PLUTO. What it could not tell is that
// the busy blocks are the ones people *arrive* on. 868 entrances over 121
// station complexes is where a third of the city comes up out of the ground,
// and until now the model had no way to know.
//
// No MTA marks are drawn. See scripts/phase2/66_subway.py.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const bust = () => (import.meta.env && import.meta.env.DEV
  ? `?v=${Date.now()}` : '')

const FAR = 420          // m; a 3.4 m kiosk is a couple of pixels past this
const GLOBE = [0x2ecc63, 0xd13a2c]   // 24 hour, restricted

export class Subway {
  constructor(scene, city) {
    this.scene = scene
    this.groundY = (city?.meta?.land_level_m ?? 12.0) + 0.20
    this.entrances = []
    this.meshes = new Map()
    this.last = new THREE.Vector3(1e9, 1e9, 1e9)
    this.stats = { total: 0, drawn: 0, stations: 0 }
    this.enabled = true
  }

  async load(dataUrl = '/models/manhattan/subway/subway.json',
    footUrl = '/models/manhattan/subway/footfall.json', glbUrl = '/models/manhattan/subway.glb') {
    const [data, foot, gltf] = await Promise.all([
      fetch(dataUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(footUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      new GLTFLoader().loadAsync(glbUrl + bust()).catch(() => null),
    ])
    if (!data || !gltf) {
      console.warn('[subway] missing', !data && 'subway.json',
        !gltf && 'subway.glb')
      return this
    }
    this.entrances = data.entrances || []
    this.footfall = foot
    this.stats.total = this.entrances.length
    this.stats.stations = foot ? foot.stations : 0

    const src = new Map()
    gltf.scene.traverse((o) => { if (o.isMesh) src.set(o.name, o) })

    // Instance colour carries the globe: green for a 24-hour entrance, red
    // for one with restricted hours. That is a real distinction the dataset
    // publishes, and it is the only thing on the kiosk that varies.
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true, color: 0xffffff,
    })
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float lum = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  totalEmissiveRadiance += vColor.rgb * smoothstep(0.42, 0.86, lum) * 0.55;
}`)
    }
    mat.customProgramCacheKey = () => 'manhattan-subway-v1'
    this.material = mat

    const byMesh = { stair: 'PROP_subway_stair',
      elevator: 'PROP_subway_elevator' }
    const counts = { stair: 0, elevator: 0 }
    for (const e of this.entrances) counts[e.mesh] = (counts[e.mesh] || 0) + 1

    for (const [key, name] of Object.entries(byMesh)) {
      const g = src.get(name)
      if (!g) continue
      const n = Math.max(8, counts[key] || 0)
      const im = new THREE.InstancedMesh(g.geometry, mat, n)
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      im.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(n * 3).fill(1), 3)
      im.count = 0
      im.name = `SUBWAY_${key}`
      im.frustumCulled = false
      this.meshes.set(key, im)
      this.scene.add(im)
    }
    console.info('[subway]', this.entrances.length, 'entrances,',
      this.stats.stations, 'station complexes')
    return this
  }

  // Footfall at a world point, in entrances per 200 m cell, bilinear so the
  // crowd thickens toward a station instead of stepping at the cell edge.
  footfallAt(xM, yM) {
    const f = this.footfall
    if (!f || !f.cells) return 0
    const c = f.cell_m || 200
    const fx = xM / c
    const fy = yM / c
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const at = (i, j) => f.cells[`${i}_${j}`] || 0
    return at(x0, y0) * (1 - tx) * (1 - ty) +
      at(x0 + 1, y0) * tx * (1 - ty) +
      at(x0, y0 + 1) * (1 - tx) * ty +
      at(x0 + 1, y0 + 1) * tx * ty
  }

  update(camera) {
    if (!this.enabled || !this.meshes.size) return this.stats
    if (camera.position.distanceToSquared(this.last) < 400) return this.stats
    this.last.copy(camera.position)
    const cx = camera.position.x
    const cz = camera.position.z
    const r2 = FAR * FAR
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const one = new THREE.Vector3(1, 1, 1)
    const col = new THREE.Color()
    const ix = { stair: 0, elevator: 0 }

    for (const e of this.entrances) {
      const wx = e.x
      const wz = -e.y
      const d2 = (wx - cx) ** 2 + (wz - cz) ** 2
      if (d2 > r2) continue
      const im = this.meshes.get(e.mesh)
      if (!im || ix[e.mesh] >= im.instanceMatrix.count) continue
      // The kiosk is authored with +x along the kerb; the lane's heading is
      // measured in build space (x east, y north) and the world puts north at
      // -z, so the rotation is about -yaw.
      pos.set(wx, this.groundY, wz)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -e.yaw)
      m.compose(pos, q, one)
      im.setMatrixAt(ix[e.mesh], m)
      col.setHex(GLOBE[e.globe] ?? GLOBE[0])
      im.setColorAt(ix[e.mesh], col)
      ix[e.mesh]++
    }
    let drawn = 0
    for (const [key, im] of this.meshes) {
      im.count = ix[key]
      drawn += ix[key]
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
    }
    this.stats.drawn = drawn
    return this.stats
  }
}
