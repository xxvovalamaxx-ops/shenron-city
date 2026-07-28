export const QUATERNIUS_HERO_URL =
  '/models/characters/quaternius-hero/quaternius-hero.glb?v=b542c36d'

export const QUATERNIUS_HERO_CLIPS = [
  'Chest_Open',
  'Consume',
  'Dance_Loop',
  'Driving_Loop',
  'Farm_Harvest',
  'Farm_PlantSeed',
  'Farm_Watering',
  'Fixing_Kneeling',
  'Idle_FoldArms_Loop',
  'Idle_Loop',
  'Idle_TalkingPhone_Loop',
  'Idle_Talking_Loop',
  'Interact',
  'Jog_Fwd_Loop',
  'Jump_Land',
  'Jump_Loop',
  'Jump_Start',
  'OverhandThrow',
  'PickUp_Table',
  'Sitting_Enter',
  'Sitting_Exit',
  'Sitting_Idle_Loop',
  'Sitting_Talking_Loop',
  'Sprint_Loop',
  'TreeChopping_Loop',
  'Walk_Carry_Loop',
  'Walk_Formal_Loop',
  'Walk_Loop',
  'Yes',
] as const

export type QuaterniusHeroMotion = (typeof QUATERNIUS_HERO_CLIPS)[number]
