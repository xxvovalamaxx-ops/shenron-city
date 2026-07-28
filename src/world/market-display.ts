import { MARKET_STALLS } from './city-data'

export type MarketDisplayKind = 'ramen' | 'tea' | 'flowers' | 'books'

export interface MarketDisplay {
  kind: MarketDisplayKind
  primary: string
  secondary: string
  label: string
}

export const MARKET_DISPLAYS: Readonly<Record<string, MarketDisplay>> = {
  'stall-ramen': {
    kind: 'ramen',
    primary: '#d15b42',
    secondary: '#f4d6a0',
    label: 'HOT BOWLS',
  },
  'stall-tea': {
    kind: 'tea',
    primary: '#3f7c67',
    secondary: '#d7b46a',
    label: 'NIGHT TEA',
  },
  'stall-flowers': {
    kind: 'flowers',
    primary: '#d95f8d',
    secondary: '#74a76d',
    label: 'FRESH CUTS',
  },
  'stall-books': {
    kind: 'books',
    primary: '#4f6fa8',
    secondary: '#c98a52',
    label: 'LATE READS',
  },
}

export function marketDisplayFor(stallId: string): MarketDisplay {
  const display = MARKET_DISPLAYS[stallId]
  if (!display) throw new Error(`Missing market display for ${stallId}`)
  return display
}

/** Startup/test guard for authored stalls and their visible inventory. */
export function validateMarketDisplays(): string[] {
  const stallIds = new Set(MARKET_STALLS.map((stall) => stall.id))
  const displayIds = new Set(Object.keys(MARKET_DISPLAYS))
  const issues: string[] = []

  for (const id of stallIds) {
    if (!displayIds.has(id)) issues.push(`Missing display for ${id}`)
  }
  for (const id of displayIds) {
    if (!stallIds.has(id)) issues.push(`Display references unknown stall ${id}`)
  }
  return issues
}
