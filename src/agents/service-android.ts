import type { AgentState } from '../contracts/mission-control'

export const SERVICE_ANDROID_URL =
  '/models/characters/service-android/service-android.glb'

export const SERVICE_ANDROID_CLIPS = [
  'Dance',
  'Death',
  'Idle',
  'Jump',
  'No',
  'Punch',
  'Running',
  'Sitting',
  'Standing',
  'ThumbsUp',
  'Walking',
  'WalkJump',
  'Wave',
  'Yes',
] as const

export type ServiceAndroidMotion = (typeof SERVICE_ANDROID_CLIPS)[number]

export const SERVICE_ANDROID_STYLES = {
  civilianBlue: { body: '#496a87', accent: '#9dc5e6', trim: '#273746' },
  civilianCopper: { body: '#8a5c43', accent: '#f0ba78', trim: '#38251f' },
  civilianGreen: { body: '#3e7364', accent: '#98dbc2', trim: '#223b35' },
  civilianPlum: { body: '#72516f', accent: '#d6a5d0', trim: '#342537' },
  civilianSand: { body: '#8b7657', accent: '#e6cc9d', trim: '#3d3428' },
  civilianSlate: { body: '#566273', accent: '#b7c5da', trim: '#29303a' },
  iris: { body: '#d6dce3', accent: '#2dd4bf', trim: '#17242b' },
  mira: { body: '#69475f', accent: '#f5b942', trim: '#2d2130' },
  kai: { body: '#263444', accent: '#49dbc7', trim: '#101820' },
  aegis: { body: '#334f5b', accent: '#48e0d0', trim: '#122128' },
  echo: { body: '#54426f', accent: '#bf9cff', trim: '#21192e' },
  sentry: { body: '#66512f', accent: '#ffc768', trim: '#2b2215' },
  nova: { body: '#4f465d', accent: '#e4b8ff', trim: '#241f2b' },
  atlas: { body: '#3c536d', accent: '#7dc7ff', trim: '#192637' },
  lyra: { body: '#685044', accent: '#ffad7c', trim: '#2c211c' },
} as const

export type ServiceAndroidStyle = keyof typeof SERVICE_ANDROID_STYLES

export function motionForAgentState(state: AgentState): ServiceAndroidMotion {
  switch (state) {
    case 'active':
      return 'Standing'
    case 'blocked':
      return 'No'
    case 'failed':
      return 'Sitting'
    case 'offline':
      return 'Sitting'
    case 'idle':
    case 'unknown':
      return 'Idle'
  }
}

export function styleForAgentName(name: string): ServiceAndroidStyle {
  switch (name.toLowerCase()) {
    case 'aegis':
      return 'aegis'
    case 'echo':
      return 'echo'
    case 'sentry':
      return 'sentry'
    case 'nova':
      return 'nova'
    case 'atlas':
      return 'atlas'
    case 'lyra':
      return 'lyra'
    default:
      return 'civilianSlate'
  }
}
