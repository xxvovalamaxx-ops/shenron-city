/**
 * The first-person driving view's interior: dashboard, steering wheel,
 * instrument cluster, a navigation screen, pillars and headliner, and a
 * windscreen that collects rain and is cleared by two wipers.
 *
 * Everything is procedural and built once. The rig is anchored to the
 * cockpit camera itself (not to the car body), so the camera's easing never
 * makes the dashboard swim. Shown only while the player drives in cockpit
 * view (V).
 *
 * Wiper and drop timing: see gameplay/vehicles/cockpit-math.ts, whose
 * `timeSinceWipe` the windscreen shader repeats.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../../gameplay/runtime'
import { getVehicleHud, vehicleSim } from '../../gameplay/vehicles/vehicle-session'
import { vehicleSpec } from '../../gameplay/vehicles/vehicle-specs'
import { COCKPIT_EYE_HEIGHT } from '../../gameplay/vehicles/vehicle-camera'
import { gaugeAngle, WIPER_RAIN_ON, WIPER_SWEEP, wheelTurn, wiperPeriod } from '../../gameplay/vehicles/cockpit-math'
import { cityLightingUniforms } from '../city-lighting-uniforms'
import { streetDataNow, cellKey, INDEX_CELL } from '../../ui/radar/street-data'
import { worldToRadar } from '../../ui/radar/radar-math'
import { gps } from '../../ui/radar/gps'

// ── Windscreen shader ──────────────────────────────────────────────────────

const SCREEN_VERT = /* glsl */ `
varying vec2 vM;
uniform vec2 uSize;
void main() {
  vM = uv * uSize;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`

const SCREEN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vM;
uniform vec2 uSize;
uniform float uTime;
uniform float uRain;
uniform float uPeriod;
uniform float uPhase;
uniform float uSweep;
uniform float uWiping;
uniform float uSpeed;
uniform float uPractical;
uniform vec2 uPivotA;
uniform vec2 uPivotB;
uniform float uBlade;

float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }

const float PI = 3.14159265;

// seconds since the blade last crossed angle phi; mirrors cockpit-math.ts
float sinceWipe( float phi ) {
  float T = uPeriod;
  float c = clamp( 1.0 - 2.0 * phi / uSweep, -1.0, 1.0 );
  float t1 = acos( c ) * T / ( 2.0 * PI );
  float ph = uPhase;
  if ( ph >= T - t1 ) return ph - ( T - t1 );
  if ( ph >= t1 ) return ph - t1;
  return ph + t1;
}

// how long ago this point was wiped by a blade on a pivot; 1e3 if never
float wiped( vec2 p, vec2 pivot ) {
  vec2 d = p - pivot;
  float r = length( d );
  if ( r < 0.1 || r > uBlade ) return 1e3;
  float phi = atan( d.y, d.x );
  if ( phi < 0.0 || phi > uSweep ) return 1e3;
  return uWiping > 0.5 ? sinceWipe( phi ) : 1e3;
}

float bladeLine( vec2 p, vec2 pivot, float ang, float w ) {
  vec2 dir = vec2( cos( ang ), sin( ang ) );
  vec2 d = p - pivot;
  float along = dot( d, dir );
  float off = abs( d.x * dir.y - d.y * dir.x );
  float onBlade = step( 0.0, along ) * step( along, uBlade );
  return onBlade * ( 1.0 - smoothstep( w * 0.5, w, off ) );
}

// one layer of drops on a grid of cell size s
vec4 drops( vec2 p, float s, float since, float fill, float seed ) {
  // at speed the airflow drags the drops up the glass
  vec2 q = p + vec2( 0.0, -uTime * uSpeed * 0.004 );
  vec2 cell = floor( q / s );
  vec2 f = fract( q / s ) - 0.5;
  float a = h21( cell + seed );
  float b = h21( cell * 1.7 + seed + 3.1 );
  float c = h21( cell * 2.3 + seed + 7.7 );
  // appears once enough time has passed since the last wipe
  float present = step( a * fill, since ) * step( b, 0.35 + 0.6 * uRain );
  vec2 o = ( vec2( b, c ) - 0.5 ) * 0.5;
  float rad = mix( 0.12, 0.34, c );
  vec2 dv = f - o;
  dv.y *= mix( 1.0, 0.6, clamp( uSpeed / 30.0, 0.0, 1.0 ) );
  float d = length( dv ) / rad;
  float body = 1.0 - smoothstep( 0.8, 1.0, d );
  float rim = smoothstep( 0.45, 0.95, d ) * body;
  // a lens: dark rim, a bright fleck where the sky catches it
  float fleck = 1.0 - smoothstep( 0.0, 0.35, length( dv - vec2( -0.08, 0.1 ) * rad ) / rad );
  vec3 col = mix( vec3( 0.55, 0.6, 0.66 ), vec3( 0.04, 0.05, 0.06 ), rim );
  col += fleck * mix( vec3( 0.8 ), vec3( 1.0, 0.85, 0.6 ), uPractical );
  float alpha = present * body * ( 0.28 + 0.4 * rim + 0.3 * fleck );
  return vec4( col, alpha );
}

void main() {
  vec2 p = vM;
  float rain = uRain;
  float since = min( wiped( p, uPivotA ), wiped( p, uPivotB ) );
  // seconds to fill a dry patch: quick in a downpour
  float fill = 2.6 / max( rain, 0.02 );

  vec4 acc = vec4( 0.0 );
  if ( rain > 0.01 ) {
    vec4 d1 = drops( p, 0.034, since, fill, 1.0 );
    vec4 d2 = drops( p, 0.019, since, fill * 0.7, 9.0 );
    acc = d1.a > d2.a ? d1 : d2;
    // a thin film of water where the blades have not reached
    float film = since > 500.0 ? 0.07 * rain : 0.0;
    acc.rgb = mix( vec3( 0.6, 0.64, 0.7 ), acc.rgb, acc.a / max( acc.a + film, 1e-4 ) );
    acc.a = max( acc.a, film );
  }

  // the blades themselves
  float ang = uWiping > 0.5 ? uSweep * ( 1.0 - cos( 2.0 * PI * uPhase / uPeriod ) ) * 0.5 : 0.0;
  float blade = max( bladeLine( p, uPivotA, ang, 0.022 ), bladeLine( p, uPivotB, ang, 0.022 ) );
  acc.rgb = mix( acc.rgb, vec3( 0.015 ), blade );
  acc.a = max( acc.a, blade );

  // the glass tint at the very top edge (shade band)
  float band = smoothstep( uSize.y - 0.09, uSize.y, p.y ) * 0.55;
  acc.rgb = mix( acc.rgb, vec3( 0.02, 0.05, 0.07 ), band / max( acc.a + band, 1e-4 ) );
  acc.a = max( acc.a, band );

  gl_FragColor = vec4( acc.rgb, acc.a );
}
`

// ── Canvas faces: instrument cluster and nav screen ───────────────────────

function drawCluster(ctx: CanvasRenderingContext2D, w: number, h: number, kmh: number, rpm: number, redline: number, gear: string, night: number): void {
  ctx.fillStyle = '#050607'
  ctx.fillRect(0, 0, w, h)
  const glow = night > 0.2
  const ink = glow ? '#e8f2ff' : '#d8dde2'
  const accent = '#ff5a36'
  const dial = (cx: number, cy: number, r: number, value: number, max: number, step: number, label: string, red: number | null) => {
    const from = Math.PI * 0.75
    const to = Math.PI * 2.25
    ctx.lineWidth = 3
    ctx.strokeStyle = '#2a2e33'
    ctx.beginPath()
    ctx.arc(cx, cy, r, from, to)
    ctx.stroke()
    if (red !== null) {
      ctx.strokeStyle = accent
      ctx.beginPath()
      ctx.arc(cx, cy, r, gaugeAngle(red, max, from, to), to)
      ctx.stroke()
    }
    ctx.fillStyle = ink
    ctx.font = `600 ${Math.round(r * 0.16)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let v = 0; v <= max + 1e-6; v += step) {
      const a = gaugeAngle(v, max, from, to)
      ctx.strokeStyle = ink
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86)
      ctx.lineTo(cx + Math.cos(a) * r * 0.97, cy + Math.sin(a) * r * 0.97)
      ctx.stroke()
      const lab = label === 'rpm' ? String(Math.round(v / 1000)) : String(Math.round(v))
      ctx.fillText(lab, cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7)
    }
    const a = gaugeAngle(value, max, from, to)
    ctx.strokeStyle = accent
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(cx - Math.cos(a) * r * 0.12, cy - Math.sin(a) * r * 0.12)
    ctx.lineTo(cx + Math.cos(a) * r * 0.92, cy + Math.sin(a) * r * 0.92)
    ctx.stroke()
    ctx.fillStyle = '#16191c'
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#7d868f'
    ctx.font = `500 ${Math.round(r * 0.12)}px system-ui, sans-serif`
    ctx.fillText(label === 'rpm' ? 'x1000 rpm' : 'km/h', cx, cy + r * 0.45)
  }
  const r = h * 0.42
  dial(w * 0.22, h * 0.52, r, kmh, 240, 40, 'kmh', null)
  dial(w * 0.78, h * 0.52, r, rpm, Math.max(redline * 1.15, 1000), 1000, 'rpm', redline)
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.font = `700 ${Math.round(h * 0.26)}px system-ui, sans-serif`
  ctx.fillText(String(Math.round(kmh)), w * 0.5, h * 0.42)
  ctx.font = `600 ${Math.round(h * 0.1)}px system-ui, sans-serif`
  ctx.fillStyle = '#7d868f'
  ctx.fillText('KM/H', w * 0.5, h * 0.6)
  ctx.fillStyle = gear === 'R' ? accent : ink
  ctx.font = `700 ${Math.round(h * 0.16)}px system-ui, sans-serif`
  ctx.fillText(gear, w * 0.5, h * 0.82)
}

const _cells: number[] = []
function drawNav(ctx: CanvasRenderingContext2D, w: number, h: number, x: number, z: number, heading: number): void {
  ctx.fillStyle = '#0b1016'
  ctx.fillRect(0, 0, w, h)
  const data = streetDataNow()
  const scale = 0.55 // px per metre
  const cx = w * 0.5
  const cy = h * 0.68
  if (data) {
    const reach = Math.max(w, h) / scale
    const c0x = Math.floor((x - reach) / INDEX_CELL)
    const c1x = Math.floor((x + reach) / INDEX_CELL)
    const c0z = Math.floor((z - reach) / INDEX_CELL)
    const c1z = Math.floor((z + reach) / INDEX_CELL)
    _cells.length = 0
    const seen = new Set<number>()
    for (let gx = c0x; gx <= c1x; gx++) {
      for (let gz = c0z; gz <= c1z; gz++) {
        const list = data.cells.get(cellKey(gx, gz))
        if (!list) continue
        for (const e of list) if (!seen.has(e)) { seen.add(e); _cells.push(e) }
      }
    }
    ctx.lineCap = 'round'
    for (const idx of _cells) {
      const e = data.edges[idx]
      if (!e.drivable) continue
      ctx.strokeStyle = e.cls === 'avenue' || e.cls === 'highway' ? '#5b6672' : '#36404a'
      ctx.lineWidth = Math.max(2, e.width * scale * 0.9)
      ctx.beginPath()
      for (let i = 0; i < e.pts.length; i += 2) {
        const o = worldToRadar(e.pts[i] - x, e.pts[i + 1] - z, heading)
        if (i === 0) ctx.moveTo(cx + o.x * scale, cy + o.y * scale)
        else ctx.lineTo(cx + o.x * scale, cy + o.y * scale)
      }
      ctx.stroke()
    }
    const route = gps.route?.pts
    if (route && route.length >= 4) {
      ctx.strokeStyle = '#f2c94c'
      ctx.lineWidth = 4
      ctx.beginPath()
      for (let i = 0; i < route.length; i += 2) {
        const o = worldToRadar(route[i] - x, route[i + 1] - z, heading)
        if (i === 0) ctx.moveTo(cx + o.x * scale, cy + o.y * scale)
        else ctx.lineTo(cx + o.x * scale, cy + o.y * scale)
      }
      ctx.stroke()
    }
  }
  // the car: an arrow pointing up
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(cx, cy - 9)
  ctx.lineTo(cx + 6, cy + 6)
  ctx.lineTo(cx, cy + 3)
  ctx.lineTo(cx - 6, cy + 6)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, 0, w, 18)
  ctx.fillStyle = '#cfd6dd'
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const hh = Math.floor(rt.clock.hour)
  const mm = Math.floor((rt.clock.hour - hh) * 60)
  ctx.fillText(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, 8, 9)
  ctx.textAlign = 'right'
  ctx.fillText(gps.route ? 'ROUTE' : 'MAP', w - 8, 9)
}

// ── The rig ─────────────────────────────────────────────────────────────────

interface Rig {
  root: THREE.Group
  wheel: THREE.Group
  screen: THREE.ShaderMaterial
  clusterCtx: CanvasRenderingContext2D
  clusterTex: THREE.CanvasTexture
  clusterMat: THREE.MeshStandardMaterial
  navCtx: CanvasRenderingContext2D
  navTex: THREE.CanvasTexture
  navMat: THREE.MeshStandardMaterial
  disposables: { dispose(): void }[]
  /** Eye position in the rig's own frame. */
  eye: THREE.Vector3
  kind: string
}

function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): THREE.BufferGeometry {
  // a bottom-left, b bottom-right, c top-right, d top-left
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.computeVertexNormals()
  return g
}

/**
 * Build the interior for a vehicle kind. The rig's frame matches the car's
 * three.js group: +Z forward, +X the driver's left (vehicle-model's right is
 * world -X at heading 0), origin on the car's ground point.
 */
function buildRig(kind: string): Rig {
  const spec = vehicleSpec(kind)
  const disposables: { dispose(): void }[] = []
  const keep = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x)
    return x
  }
  const root = new THREE.Group()
  root.name = 'cockpit'
  const hw = spec.halfWidth
  const eye = new THREE.Vector3(-spec.seat.x, spec.seat.y + COCKPIT_EYE_HEIGHT, spec.seat.z)
  const roofY = Math.min(spec.height - 0.06, eye.y + 0.3)
  const sz = spec.seat.z

  const leather = keep(new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 0.72, metalness: 0 }))
  const trim = keep(new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.45, metalness: 0 }))
  const metal = keep(new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.32, metalness: 0.9 }))
  const head = keep(new THREE.MeshStandardMaterial({ color: 0x2b2926, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }))
  const pillar = keep(new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.9, metalness: 0 }))

  // Windscreen corners: the base far ahead over the dash, the top raked back over the driver.
  const baseY = eye.y - 0.26
  const baseZ = sz + 1.12
  const topY = roofY - 0.02
  const topZ = sz + 0.36
  const wB = hw - 0.08
  const wT = hw - 0.16
  const bl = new THREE.Vector3(wB, baseY, baseZ)
  const br = new THREE.Vector3(-wB, baseY, baseZ)
  const tr = new THREE.Vector3(-wT, topY, topZ)
  const tl = new THREE.Vector3(wT, topY, topZ)
  const screenW = wB * 2
  const screenH = Math.hypot(topY - baseY, topZ - baseZ)

  // Dashboard: a slab from the screen base back toward the driver, a lip on top.
  const dashDepth = baseZ - (sz + 0.5)
  const dash = new THREE.Mesh(keep(new THREE.BoxGeometry(hw * 2 - 0.04, 0.34, dashDepth)), leather)
  dash.position.set(0, baseY - 0.17, sz + 0.5 + dashDepth / 2)
  root.add(dash)
  const lip = new THREE.Mesh(keep(new THREE.BoxGeometry(hw * 2 - 0.06, 0.03, 0.06)), trim)
  lip.position.set(0, baseY - 0.2, sz + 0.52)
  root.add(lip)
  const vent = new THREE.Mesh(keep(new THREE.BoxGeometry(hw * 2 - 0.3, 0.012, 0.02)), metal)
  vent.position.set(0, baseY - 0.12, sz + 0.505)
  root.add(vent)

  // Binnacle hood over the cluster, in front of the driver.
  const hood = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 24, 1, true, -Math.PI / 2, Math.PI)), leather)
  hood.rotation.z = Math.PI / 2
  hood.rotation.y = Math.PI / 2
  hood.scale.set(1, 1, 0.45)
  hood.position.set(eye.x, baseY - 0.02, sz + 0.66)
  root.add(hood)

  // Instrument cluster and nav screen: canvas faces.
  const cc = document.createElement('canvas')
  cc.width = 512
  cc.height = 192
  const clusterCtx = cc.getContext('2d') as CanvasRenderingContext2D
  const clusterTex = keep(new THREE.CanvasTexture(cc))
  clusterTex.colorSpace = THREE.SRGBColorSpace
  const clusterMat = keep(new THREE.MeshStandardMaterial({ map: clusterTex, emissiveMap: clusterTex, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.3 }))
  const cluster = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.33, 0.124)), clusterMat)
  cluster.position.set(eye.x, baseY - 0.1, sz + 0.68)
  cluster.rotation.set(-0.35, Math.PI, 0)
  root.add(cluster)

  const nc = document.createElement('canvas')
  nc.width = 320
  nc.height = 192
  const navCtx = nc.getContext('2d') as CanvasRenderingContext2D
  const navTex = keep(new THREE.CanvasTexture(nc))
  navTex.colorSpace = THREE.SRGBColorSpace
  const navMat = keep(new THREE.MeshStandardMaterial({ map: navTex, emissiveMap: navTex, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.25 }))
  const nav = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.25, 0.15)), navMat)
  nav.position.set(eye.x - 0.42, baseY - 0.1, sz + 0.62)
  nav.rotation.set(-0.25, Math.PI + 0.18, 0)
  root.add(nav)
  const bezel = new THREE.Mesh(keep(new THREE.BoxGeometry(0.27, 0.17, 0.015)), pillar)
  bezel.position.copy(nav.position).add(new THREE.Vector3(0, 0, 0.009))
  bezel.rotation.copy(nav.rotation)
  root.add(bezel)

  // Steering wheel: rim, hub and three spokes, tilted toward the driver.
  const wheelTilt = new THREE.Group()
  wheelTilt.position.set(eye.x, eye.y - 0.36, sz + 0.44)
  wheelTilt.rotation.x = 0.42
  root.add(wheelTilt)
  const wheel = new THREE.Group()
  wheelTilt.add(wheel)
  const rim = new THREE.Mesh(keep(new THREE.TorusGeometry(0.185, 0.019, 12, 48)), leather)
  wheel.add(rim)
  const hub = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.055, 0.06, 0.04, 20)), leather)
  hub.rotation.x = Math.PI / 2
  wheel.add(hub)
  const badge = new THREE.Mesh(keep(new THREE.CircleGeometry(0.018, 16)), metal)
  badge.position.z = -0.021
  badge.rotation.y = Math.PI
  wheel.add(badge)
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const spoke = new THREE.Mesh(keep(new THREE.BoxGeometry(0.15, 0.022, 0.012)), a === -Math.PI / 2 ? leather : metal)
    spoke.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0)
    spoke.rotation.z = a
    wheel.add(spoke)
  }
  const column = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 12)), leather)
  column.rotation.x = Math.PI / 2 + 0.42
  column.position.set(eye.x, eye.y - 0.42, sz + 0.58)
  root.add(column)

  // A-pillars along the screen's sides, headliner above, door tops beside.
  for (const side of [1, -1]) {
    const a = new THREE.Vector3(side * wB, baseY, baseZ)
    const b = new THREE.Vector3(side * wT, topY, topZ)
    const len = a.distanceTo(b)
    const p = new THREE.Mesh(keep(new THREE.BoxGeometry(0.09, len, 0.07)), pillar)
    p.position.copy(a).add(b).multiplyScalar(0.5)
    p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    root.add(p)
    const door = new THREE.Mesh(keep(new THREE.BoxGeometry(0.1, 0.06, 1.6)), trim)
    door.position.set(side * (hw - 0.03), baseY - 0.05, sz)
    root.add(door)
    const mirror = new THREE.Mesh(keep(new THREE.BoxGeometry(0.03, 0.09, 0.15)), pillar)
    mirror.position.set(side * (hw + 0.06), baseY + 0.02, baseZ - 0.1)
    root.add(mirror)
  }
  const liner = new THREE.Mesh(keep(new THREE.PlaneGeometry(hw * 2, 1.4)), head)
  liner.rotation.x = Math.PI / 2
  liner.position.set(0, roofY, topZ - 0.68)
  root.add(liner)
  const rearMirror = new THREE.Mesh(keep(new THREE.BoxGeometry(0.24, 0.065, 0.02)), pillar)
  rearMirror.position.set(0, topY - 0.07, topZ + 0.05)
  root.add(rearMirror)

  // The windscreen itself: rain and wipers in a transparent layer.
  const screen = keep(
    new THREE.ShaderMaterial({
      vertexShader: SCREEN_VERT,
      fragmentShader: SCREEN_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uSize: { value: new THREE.Vector2(screenW, screenH) },
        uTime: { value: 0 },
        uRain: { value: 0 },
        uPeriod: { value: 1.6 },
        uPhase: { value: 0 },
        uSweep: { value: WIPER_SWEEP },
        uWiping: { value: 0 },
        uSpeed: { value: 0 },
        uPractical: { value: 0 },
        // pivots under the bottom edge, blades resting to the right (u = 1 is the passenger side)
        uPivotA: { value: new THREE.Vector2(screenW * 0.08, -0.02) },
        uPivotB: { value: new THREE.Vector2(screenW * 0.52, -0.02) },
        uBlade: { value: Math.min(screenH * 0.95, screenW * 0.46) },
      },
    }),
  )
  const glass = new THREE.Mesh(keep(quad(bl, br, tr, tl)), screen)
  glass.renderOrder = 10
  glass.frustumCulled = false
  root.add(glass)

  root.traverse((o) => {
    o.frustumCulled = false
  })
  root.visible = false
  return { root, wheel, screen, clusterCtx, clusterTex, clusterMat, navCtx, navTex, navMat, disposables, eye, kind }
}

function disposeRig(rig: Rig): void {
  rig.root.removeFromParent()
  for (const d of rig.disposables) d.dispose()
}

const _q = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)
const _off = new THREE.Vector3()

export function Cockpit() {
  const { scene, camera } = useThree()
  const rig = useRef<Rig | null>(null)
  const time = useRef(0)
  const phase = useRef(0)
  const faceTimer = useRef(0)
  const holder = useMemo(() => new THREE.Group(), [])

  useEffect(() => {
    holder.name = 'cockpit-holder'
    scene.add(holder)
    return () => {
      if (rig.current) disposeRig(rig.current)
      rig.current = null
      holder.removeFromParent()
    }
  }, [scene, holder])

  useFrame((_, rawDt) => {
    const id = vehicleSim.registry.playerVehicleId
    const entity = id !== null ? vehicleSim.registry.vehicles.get(id) : undefined
    const show = !!entity && vehicleSim.cameraMode === 'cockpit' && vehicleSim.camera.lookBack < 0.5
    if (!show || !entity) {
      if (rig.current) rig.current.root.visible = false
      return
    }
    if (!rig.current || rig.current.kind !== entity.kind) {
      if (rig.current) disposeRig(rig.current)
      rig.current = buildRig(entity.kind)
      holder.add(rig.current.root)
    }
    const r = rig.current
    r.root.visible = true
    const dt = rt.paused ? 0 : Math.min(rawDt, 0.05)

    // Anchor to the camera: the eye point sits exactly on it.
    _q.setFromAxisAngle(_up, entity.pose.heading)
    _off.copy(r.eye).applyQuaternion(_q)
    r.root.position.copy(camera.position).sub(_off)
    r.root.quaternion.copy(_q)

    r.wheel.rotation.z = wheelTurn(entity.motion.steerAngle)

    // Rain and wipers.
    const rain = rt.clock.weather.rain
    const wiping = rain > WIPER_RAIN_ON
    const period = wiperPeriod(rain)
    time.current += dt
    if (wiping || phase.current > 1e-3) {
      // finish the stroke back to rest when the rain stops
      phase.current += dt
      if (!wiping && phase.current >= period) phase.current = 0
      phase.current %= period
    }
    const u = r.screen.uniforms
    u.uTime.value = time.current
    u.uRain.value = rain
    u.uPeriod.value = period
    u.uPhase.value = phase.current
    u.uWiping.value = wiping || phase.current > 1e-3 ? 1 : 0
    u.uSpeed.value = Math.abs(entity.motion.speed)
    u.uPractical.value = cityLightingUniforms.uCityPractical.value

    // Dash faces at ~12 Hz.
    faceTimer.current -= rawDt
    if (faceTimer.current <= 0) {
      faceTimer.current = 0.08
      const hud = getVehicleHud()
      const night = cityLightingUniforms.uCityPractical.value
      drawCluster(r.clusterCtx, 512, 192, hud.speedKmh, hud.rpm, hud.redlineRpm, hud.gear, night)
      r.clusterTex.needsUpdate = true
      r.clusterMat.emissiveIntensity = 0.25 + 1.1 * night
      // compass bearing of the car: forward (sin h, cos h) with north at -z
      const bearing = Math.PI - entity.pose.heading
      drawNav(r.navCtx, 320, 192, entity.pose.pos.x, entity.pose.pos.z, bearing)
      r.navTex.needsUpdate = true
      r.navMat.emissiveIntensity = 0.35 + 1.0 * night
    }
  }, -40)

  return null
}
