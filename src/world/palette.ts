/**
 * Art direction in one place.
 *
 * The slice ships with no external art assets, so everything is procedural
 * geometry plus lighting. That makes the palette the single biggest lever on
 * whether the building reads as designed or as programmer-grey — hence it
 * being a real module rather than colours scattered through components.
 *
 * Direction: cold blue night outside, warm sodium-tinted interior, one teal
 * accent for anything Shenron-owned. State colour is reserved exclusively for
 * agent status so it always means the same thing.
 */
import type { AgentState } from '../contracts/mission-control'

export const PALETTE = {
  night: '#05070d',
  horizon: '#0b1626',
  cityGlow: '#1b3a5c',

  concrete: '#23272e',
  concreteDark: '#171a1f',
  stone: '#3a4049',
  metal: '#4a515c',

  lobbyFloor: '#0e1116',
  warmLight: '#ffd9a0',
  coolLight: '#8fb8ff',

  accent: '#2dd4bf',
  accentDim: '#0f766e',

  glass: '#8ab4d8',
} as const

/**
 * Agent state → colour. The only place this mapping exists.
 *
 * 'unknown' is deliberately magenta rather than a calm grey: an agent whose
 * state we failed to understand should be visually louder than a healthy one,
 * not quieter.
 */
export const STATE_COLOR: Record<AgentState, string> = {
  active: '#2dd4bf',
  idle: '#5b7089',
  blocked: '#f59e0b',
  failed: '#ef4444',
  offline: '#374151',
  unknown: '#d946ef',
}

export const STATE_LABEL: Record<AgentState, string> = {
  active: 'WORKING',
  idle: 'IDLE',
  blocked: 'BLOCKED',
  failed: 'FAILED',
  offline: 'OFFLINE',
  unknown: 'UNKNOWN',
}

/** Emissive intensity per state — working agents should glow, idle ones not. */
export const STATE_GLOW: Record<AgentState, number> = {
  active: 1.4,
  idle: 0.25,
  blocked: 1.0,
  failed: 1.6,
  offline: 0.05,
  unknown: 1.2,
}

export type QualityPreset = 'low' | 'medium' | 'high'

export interface QualitySettings {
  shadows: boolean
  shadowMapSize: number
  postprocessing: boolean
  reflections: boolean
  /** Renderer pixel-ratio ceiling. */
  maxDpr: number
  cityWindows: number
  ambientPedestrians: number
}

export const QUALITY: Record<QualityPreset, QualitySettings> = {
  low: {
    shadows: false,
    shadowMapSize: 512,
    postprocessing: false,
    reflections: false,
    maxDpr: 1,
    cityWindows: 400,
    ambientPedestrians: 5,
  },
  medium: {
    shadows: true,
    shadowMapSize: 1024,
    postprocessing: true,
    reflections: false,
    maxDpr: 1.25,
    cityWindows: 1200,
    ambientPedestrians: 11,
  },
  high: {
    shadows: true,
    shadowMapSize: 2048,
    postprocessing: true,
    reflections: true,
    maxDpr: 1.75,
    cityWindows: 2600,
    ambientPedestrians: 18,
  },
}
