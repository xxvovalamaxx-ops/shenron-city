/**
 * The contract an authored vehicle has to meet, and the code that binds one.
 *
 * Stage 2 replaces VehicleRig's nine procedural primitives per car — a
 * BoxGeometry body, a BoxGeometry cabin, BoxGeometry lights, a BoxGeometry
 * accent strip and four CylinderGeometry wheels — with authored geometry. That
 * is only useful if the runtime can still drive it, and the runtime drives four
 * specific things every frame:
 *
 *   the body pose        group position and heading
 *   wheel spin           rotation.x on each wheel
 *   front-wheel steer    rotation.y on a pivot the wheel hangs from
 *   light state          emissiveIntensity on brake and headlight materials
 *
 * So the asset convention is written down *first*, tested here, and the art is
 * authored to match it. The other order — model the car, then work out how to
 * animate it — is how you discover the wheels are welded to the body after the
 * modelling is finished.
 *
 * Node names, matched case-insensitively on a prefix so an exporter's `.001`
 * suffixes and collection nesting do not break the binding:
 *
 *   VEH_body          the shell. Everything unmatched ends up here too.
 *   VEH_wheel_fl      front left   — gets a steer pivot
 *   VEH_wheel_fr      front right  — gets a steer pivot
 *   VEH_wheel_rl      rear left
 *   VEH_wheel_rr      rear right
 *   VEH_light_head    material driven by the headlight flag
 *   VEH_light_brake   material driven by the braking flag
 *   VEH_glass         optional; excluded from collision like interior glazing
 *
 * A wheel's pivot is created at the wheel's own authored position, so the
 * steering axis is wherever the artist put the hub rather than wherever the
 * code guessed. Getting that wrong is not subtle — the wheel swings through an
 * arc around the car's centre instead of turning on the spot.
 */
import * as THREE from 'three'

export const VEHICLE_NODE_PREFIX = 'VEH_'

/** The four wheels, in the order the sim's steer indices expect. */
export const WHEEL_SLOTS = ['fl', 'fr', 'rl', 'rr'] as const
export type WheelSlot = (typeof WHEEL_SLOTS)[number]

/** Slots that steer. VehicleRig writes steer to indices 0 and 1. */
export const STEERING_SLOTS: readonly WheelSlot[] = ['fl', 'fr']

/** Doors the runtime opens. The front pair is what the player uses. */
export const DOOR_SLOTS = ['fl', 'fr'] as const
export type DoorSlot = (typeof DOOR_SLOTS)[number]

/**
 * How far a door opens, radians.
 *
 * 65 degrees is a conventional front-hinged swing — far enough to read as open
 * at a glance, short enough not to clip a car parked alongside.
 */
export const DOOR_OPEN_RADIANS = 1.134

export interface BoundWheel {
  slot: WheelSlot
  /** Rotates about Y for steering. Parent of the wheel. */
  pivot: THREE.Object3D
  /** Rotates about X for rolling. */
  wheel: THREE.Object3D
  steers: boolean
}

export interface BoundDoor {
  slot: DoorSlot
  /** Rotated about Y to swing. Its origin is the hinge. */
  node: THREE.Object3D
  /**
   * Which way this door swings, +1 or -1.
   *
   * Derived from the hinge's own X, not hardcoded per slot. glTF +X is the
   * car's left (right = cross(forward, up) = (0,0,1) x (0,1,0) = (-1,0,0)), and
   * a door hinged at the front swings its rear edge outward — so a left-hand
   * door needs a negative Y rotation and a right-hand one positive.
   *
   * Reading it off the geometry means an asset whose doors are mirrored, or
   * named the other way round, still opens outward instead of folding into the
   * cabin. The wheels taught this: a mapping worked out by hand was wrong the
   * first time, and measured positions were not.
   */
  openSign: 1 | -1
}

export interface BoundVehicle {
  root: THREE.Object3D
  wheels: BoundWheel[]
  doors: BoundDoor[]
  /** Materials driven by the braking flag. */
  brakeMaterials: THREE.Material[]
  /** Materials driven by the headlight flag. */
  headMaterials: THREE.Material[]
  /** Meshes excluded from collision, e.g. glass. */
  glass: THREE.Mesh[]
  /** Node names that matched nothing, for a check that wants to complain. */
  unmatched: string[]
}

export interface BindProblem {
  problem: string
}

function normalised(name: string): string {
  // Two layers of renaming to undo, not one.
  //
  // Blender appends `.001` to disambiguate duplicates. Then three.js's
  // GLTFLoader *sanitizes* node names on the way in, because a dot is reserved
  // in animation property paths — so `VEH_wheel_fl.001` reaches the runtime as
  // `VEH_wheel_fl001`, with no dot to strip.
  //
  // Handling only the dotted form was a real bug, and an asymmetric one: the
  // light slots match by prefix so they survived it, while the wheel slots
  // compare the whole slot and `fl001` matched nothing. The LOD1 export bound
  // its lights and lost all four wheels, which vehicleassetcheck caught and
  // reading the code did not.
  return name.toLowerCase().replace(/\.?\d+$/, '')
}

/** Which convention slot a node name declares, or null. */
export function classifyVehicleNode(
  name: string,
): {
  kind: 'body' | 'wheel' | 'door' | 'head' | 'brake' | 'glass' | 'interior'
  slot?: WheelSlot
  doorSlot?: DoorSlot
} | null {
  const n = normalised(name)
  if (!n.startsWith(VEHICLE_NODE_PREFIX.toLowerCase())) return null
  const rest = n.slice(VEHICLE_NODE_PREFIX.length)
  if (rest.startsWith('wheel_')) {
    const slot = rest.slice('wheel_'.length) as WheelSlot
    return WHEEL_SLOTS.includes(slot) ? { kind: 'wheel', slot } : null
  }
  if (rest.startsWith('door_')) {
    const slot = rest.slice('door_'.length) as DoorSlot
    return DOOR_SLOTS.includes(slot) ? { kind: 'door', doorSlot: slot } : null
  }
  if (rest.startsWith('light_head')) return { kind: 'head' }
  if (rest.startsWith('light_brake')) return { kind: 'brake' }
  if (rest.startsWith('glass')) return { kind: 'glass' }
  if (rest.startsWith('body')) return { kind: 'body' }
  // Cabin fittings. Not driven by the runtime, but part of the asset — the
  // cockpit camera sits inside the car, so without them the driver's view is
  // the inside of an empty shell. Classified so they are not reported as
  // strays by a check whose job is to notice geometry nobody accounted for.
  if (rest.startsWith('interior')) return { kind: 'interior' }
  if (rest.startsWith('steering')) return { kind: 'interior' }
  return null
}

function materialsOf(object: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = []
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const m = child.material
    for (const one of Array.isArray(m) ? m : [m]) if (one && !out.includes(one)) out.push(one)
  })
  return out
}

/**
 * Bind a loaded vehicle scene to the rig contract.
 *
 * Non-destructive to the geometry: the only structural change is inserting a
 * pivot above each steering wheel, which is what lets the wheel turn about its
 * own hub.
 */
export function bindVehicleAsset(root: THREE.Object3D): BoundVehicle {
  const wheels: BoundWheel[] = []
  const brakeMaterials: THREE.Material[] = []
  const headMaterials: THREE.Material[] = []
  const glass: THREE.Mesh[] = []
  const unmatched: string[] = []
  const found = new Map<WheelSlot, THREE.Object3D>()
  const doorNodes = new Map<DoorSlot, THREE.Object3D>()

  // Collected first, mutated after: inserting pivots during a traverse would
  // reparent nodes the traverse is still walking.
  const nodes: THREE.Object3D[] = []
  root.traverse((o) => nodes.push(o))

  for (const node of nodes) {
    if (node === root) continue
    const hit = classifyVehicleNode(node.name)
    if (!hit) {
      if (node instanceof THREE.Mesh) unmatched.push(node.name)
      continue
    }
    if (hit.kind === 'wheel' && hit.slot) found.set(hit.slot, node)
    else if (hit.kind === 'door' && hit.doorSlot) doorNodes.set(hit.doorSlot, node)
    else if (hit.kind === 'head') headMaterials.push(...materialsOf(node))
    else if (hit.kind === 'brake') brakeMaterials.push(...materialsOf(node))
    else if (hit.kind === 'glass' && node instanceof THREE.Mesh) glass.push(node)
  }

  for (const slot of WHEEL_SLOTS) {
    const wheel = found.get(slot)
    if (!wheel) continue
    const steers = STEERING_SLOTS.includes(slot)
    let pivot: THREE.Object3D = wheel
    if (steers) {
      // The pivot takes the wheel's transform and the wheel is zeroed inside
      // it, so rotating the pivot turns the wheel about its own hub. Placing
      // the pivot at the origin instead would swing the wheel through an arc
      // around the car's centre.
      pivot = new THREE.Object3D()
      pivot.name = `${wheel.name}_steer`
      pivot.position.copy(wheel.position)
      pivot.quaternion.copy(wheel.quaternion)
      pivot.scale.copy(wheel.scale)
      const parent = wheel.parent ?? root
      parent.add(pivot)
      wheel.position.set(0, 0, 0)
      wheel.quaternion.identity()
      wheel.scale.set(1, 1, 1)
      pivot.add(wheel)
    }
    wheels.push({ slot, pivot, wheel, steers })
  }

  const doors: BoundDoor[] = []
  for (const slot of DOOR_SLOTS) {
    const node = doorNodes.get(slot)
    if (!node) continue
    // The hinge is the node's own origin, so its X says which side it is on.
    // A hinge exactly on the centreline is meaningless for a door and would
    // pick a swing direction by rounding; treat it as left, and let
    // validateVehicleAsset report it.
    doors.push({ slot, node, openSign: node.position.x >= 0 ? -1 : 1 })
  }

  return { root, wheels, doors, brakeMaterials, headMaterials, glass, unmatched }
}

/**
 * Everything the convention requires and this asset does not provide.
 *
 * A list rather than a throw, and reported rather than silently tolerated: a
 * vehicle missing its rear wheels still drives, still looks almost right in a
 * screenshot, and is wrong in a way nobody notices until someone watches a car
 * corner.
 */
export function validateVehicleAsset(bound: BoundVehicle): BindProblem[] {
  const problems: BindProblem[] = []
  const slots = new Set(bound.wheels.map((w) => w.slot))
  for (const slot of WHEEL_SLOTS) {
    if (!slots.has(slot)) problems.push({ problem: `missing wheel ${slot}` })
  }
  for (const slot of STEERING_SLOTS) {
    const wheel = bound.wheels.find((w) => w.slot === slot)
    if (wheel && !wheel.steers) problems.push({ problem: `wheel ${slot} does not steer` })
  }
  for (const door of bound.doors) {
    if (Math.abs(door.node.position.x) < 0.05) {
      problems.push({
        problem: `door ${door.slot} hinge is on the centreline — it has no side to swing from`,
      })
    }
  }
  if (bound.headMaterials.length === 0) problems.push({ problem: 'no headlight material' })
  if (bound.brakeMaterials.length === 0) problems.push({ problem: 'no brake light material' })
  let meshes = 0
  bound.root.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes++
  })
  if (meshes === 0) problems.push({ problem: 'asset contains no meshes' })
  return problems
}

/** Drive one bound vehicle from the simulation's per-frame state. */
export function applyVehicleState(
  bound: BoundVehicle,
  state: {
    wheelSpin: number
    steerAngle: number
    braking: boolean
    headlights: boolean
    /** 0 shut, 1 fully open. Clamped, so a transition overshoot cannot fold a door through the sill. */
    doorOpen?: number
  },
): void {
  for (const wheel of bound.wheels) {
    wheel.wheel.rotation.x = state.wheelSpin
    if (wheel.steers) wheel.pivot.rotation.y = state.steerAngle
  }
  const open = Math.max(0, Math.min(1, state.doorOpen ?? 0))
  for (const door of bound.doors) {
    door.node.rotation.y = door.openSign * DOOR_OPEN_RADIANS * open
  }
  for (const m of bound.brakeMaterials) {
    if ('emissiveIntensity' in m) {
      ;(m as THREE.MeshStandardMaterial).emissiveIntensity = state.braking ? 1.6 : 0
    }
  }
  for (const m of bound.headMaterials) {
    if ('emissiveIntensity' in m) {
      ;(m as THREE.MeshStandardMaterial).emissiveIntensity = state.headlights ? 1.6 : 0
    }
  }
}
