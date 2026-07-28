declare module 'yuka' {
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number)
    x: number
    y: number
    z: number
    set(x: number, y: number, z: number): this
    copy(v: { x: number; y: number; z: number }): this
    squaredDistanceTo(v: Vector3): number
    distanceTo(v: Vector3): number
    length(): number
    normalize(): this
    multiplyScalar(s: number): this
    sub(v: Vector3): this
    add(v: Vector3): this
    clone(): Vector3
    toArray(): number[]
  }

  export class GameEntity {
    position: Vector3
    update(dt: number): void
  }

  export class Vehicle extends GameEntity {
    maxSpeed: number
    maxForce: number
    boundingRadius: number
    velocity: Vector3
    steering: SteeringManager
  }

  export class SteeringManager {
    add(behavior: SteeringBehavior): void
    obstacles: GameEntity[]
  }

  export class Path {
    add(point: Vector3): void
    current(): Vector3 | null
    advance(): void
    finished(): boolean
    loop: boolean
  }

  export class SteeringBehavior {
    active: boolean
    weight: number
  }

  export class FollowPathBehavior extends SteeringBehavior {
    constructor(path: Path)
    nextWaypointDistance: number
  }

  export class ObstacleAvoidanceBehavior extends SteeringBehavior {
    obstacles: GameEntity[]
    dBoxMinLength: number
    brakingWeight: number
  }
}
