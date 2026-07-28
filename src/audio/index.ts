/**
 * Procedural spatial audio for Shenron City.
 *
 * Self-contained: no audio files, no fetches, no CDN. Every sound is
 * synthesised at runtime from oscillators, a generated noise buffer, biquad
 * filters and a mathematically generated reverb impulse. Nothing outside
 * `src/audio/` is modified by this module, and nothing here imports React or
 * three.js.
 *
 * Wiring it up, in four places:
 *
 * 1. From the click handler that captures the pointer (browsers refuse to start
 *    an AudioContext outside a gesture; calling it again is harmless):
 *
 *        void cityAudio.start()
 *
 * 2. Once a frame, at the end of `GameLoop`'s `useFrame`, after the player has
 *    moved. Footstep cadence is derived from the position delta, so this must
 *    see the post-collision position:
 *
 *        cityAudio.update(rt.player, dt)
 *
 * 3. On world events, with the source position so it attenuates and pans:
 *
 *        cityAudio.play('doorOpen', AUDIO_ANCHORS.entranceDoor)
 *        cityAudio.play('elevatorStart', AUDIO_ANCHORS.elevatorDoor(carY))
 *        cityAudio.play('elevatorStop', AUDIO_ANCHORS.elevatorDoor(carY))
 *        cityAudio.play('elevatorArrive', AUDIO_ANCHORS.elevatorDoor(carY))
 *
 *    The entrance and car doors have no event of their own: watch
 *    `rt.entranceDoor.openness` and `doorOpenness(rt.elevator)` cross a
 *    threshold, or the elevator phase change, and fire on the edge.
 *    `elevatorStart` and `elevatorStop` bracket a sustained motor, so they must
 *    be paired; re-issuing `elevatorStart` with a new position while the car is
 *    already moving just moves the source.
 *
 * 4. From the settings UI:
 *
 *        cityAudio.setMasterVolume(0.7)
 *        cityAudio.setEnabled(false)   // suspends the context, not just muted
 *
 * Caveats worth knowing before integrating:
 *
 * - `update`, `play` and `setMasterVolume` are no-ops until `start` resolves.
 *   That is deliberate — it keeps the integration free of ordering rules.
 * - Zone bounds are copied from `cityTourLocationEvents` and derived from
 *   `world/layout.ts`. If the lobby or the market moves, check `ZONE_SHAPES` in
 *   `mix.ts` still agrees.
 * - The beds run continuously and are crossfaded by gain, so switching zones
 *   never clicks, but the graph does hold roughly sixty live nodes while
 *   enabled. `setEnabled(false)` is the way to reclaim that.
 */
export { createCityAudio, cityAudio, type CityAudio } from './engine'

export {
  AUDIO_ANCHORS,
  ZONE_IDS,
  blendRoom,
  dominantZone,
  interiorAmount,
  masterGain,
  placeSource,
  zoneGains,
  zoneWeights,
  type AudioEvent,
  type ListenerPose,
  type PlayerPose,
  type RoomTone,
  type SourcePlacement,
  type ZoneId,
  type ZoneMix,
} from './mix'
