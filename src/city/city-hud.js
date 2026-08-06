// The rich HUD readout, written at ~2 Hz by the city pipeline and read by
// ui/Hud.tsx. A plain mutable object on purpose: nothing here needs React
// re-render cadence, and the HUD polls it at its own rate.
export const cityHud = {
  tiles: '',
  lod: '',
  cars: '',
  peds: '',
  props: 0,
  sky: '',
  where: '',
}
