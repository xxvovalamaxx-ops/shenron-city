export const KENNEY_CITIZEN_URL =
  '/models/characters/kenney-citizen/kenney-citizen.glb?v=fd4140f7'

export const KENNEY_CITIZEN_CLIPS = ['Idle', 'Jump', 'Run'] as const
export type KenneyCitizenMotion = (typeof KENNEY_CITIZEN_CLIPS)[number]

export const KENNEY_CITIZEN_SKINS = {
  criminalMale: '/models/characters/kenney-citizen/skins/criminal-male.png',
  cyborgFemale: '/models/characters/kenney-citizen/skins/cyborg-female.png',
  humanFemale: '/models/characters/kenney-citizen/skins/human-female.png',
  humanMale: '/models/characters/kenney-citizen/skins/human-male.png',
  skaterFemale: '/models/characters/kenney-citizen/skins/skater-female.png',
  skaterMale: '/models/characters/kenney-citizen/skins/skater-male.png',
} as const

export type KenneyCitizenSkin = keyof typeof KENNEY_CITIZEN_SKINS
