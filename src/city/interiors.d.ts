import type {
  Camera,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  Object3D,
  Vector3,
} from 'three'

/** One placed room: an authored interior instanced inside a real building. */
export interface Room {
  key: string
  label: string
  /** The room's own scene node, hidden until the player is inside. */
  group: Group
  /** Heading of the glazed wall, radians about world up. */
  yaw: number
  eyeWorld: Vector3
  lookAt: Vector3
  /** World point just outside the entrance. */
  door: Vector3
  shot: { eye: Vector3; at: Vector3 }
  /** Authored-frame (x into, y left, z up) -> world. */
  local: (x: number, y: number, z: number) => Vector3
  links: Array<{ to: string; label: string; at: Vector3; room: Room | null }>
  atStreet: boolean
  building: unknown
  /** True once Phase 3B has cut a real opening: the action key stops answering. */
  doorway?: boolean
  lamp?: number
  [extra: string]: unknown
}

export interface InteriorStats {
  rooms: number
  inside: string | null
  near: string | null
  link: string | null
  physical?: boolean
}

export declare class Interiors {
  constructor(scene: Object3D, city: unknown)
  scene: Object3D
  groundY: number
  rooms: Room[]
  inside: Room | null
  near: Room | null
  ready: boolean
  material: Material
  glassMaterial: Material
  lamp: HemisphereLight
  stats: InteriorStats
  /** Authored meshes by name, so other placers can reuse a room. */
  src?: Map<string, Mesh>
  load(url?: string, graphUrl?: string): Promise<Interiors>
  place(
    spec: Record<string, unknown>,
    src: Map<string, Mesh>,
    position: Vector3,
    yaw: number,
    extra?: Record<string, unknown>,
  ): Room | null
  /** Recompute a room's world-derived points after its group matrix moved. */
  rebase(room: Room | null): boolean
  linkRooms(): void
  enter(room: Room | null): boolean
  enterPhysical(room: Room | null): boolean
  exit(): Room | false
  exitPhysical(): Room | false
  update(camera: Camera): InteriorStats
  action(): { kind: 'enter' | 'exit' | 'link'; room: Room | null; link?: unknown } | null
  prompt(): string
  colliders(): Object3D[]
}
