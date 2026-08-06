import type { Camera, Scene, WebGLRenderer } from 'three'

export declare class Weather {
  constructor(scene: Scene, renderer: WebGLRenderer, lights: { sun: unknown; hemi: unknown; fill: unknown }, city: unknown)
  scene: Scene
  renderer: WebGLRenderer
  lights: { sun: unknown; hemi: unknown; fill: unknown }
  groundY: number
  hour: number
  timeScale: number
  cover: number
  rain: number
  wind: { x: number; y: number }
  clouds: Array<unknown>
  drops: unknown
  splashes: unknown
  ready: boolean
  skyColor: unknown
  stats: { hour: number; clouds: number; drops: number; wet: number }
  load(url?: string): Promise<Weather>
  setTime(hour: number): void
  setCover(c: number): void
  setRain(r: number): void
  apply(): void
  bindSurfaces(...streamers: Array<{
    tiles: Map<string, { state: string; group: import('three').Group | null; [k: string]: unknown }>
  } | null | undefined>): void
  update(dt: number, camera: Camera): { hour: number; clouds: number; drops: number; wet: number }
}
