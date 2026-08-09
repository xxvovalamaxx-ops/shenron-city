/**
 * WGS84 <-> HQ-local coordinate contract for the Manhattan runtime.
 *
 * Geographic positions are converted through Earth-centred, Earth-fixed
 * (ECEF) coordinates and an east/north/up tangent frame at the configured HQ
 * anchor. Runtime geometry therefore stays close to the origin while the CPU
 * retains a reversible geographic position. The tangent-plane approximation
 * is not used for the inverse: both directions use the WGS84 ellipsoid, which
 * keeps round trips stable well below a centimetre across the Phase 1 AOI.
 *
 * Axis contract:
 *   local X = east, local Y = up, local Z = north
 *   world X = east and world Z = south when yaw is zero
 *   world Y = up
 *
 * Positive `northYawDegrees` rotates local north clockwise toward world +X,
 * matching a conventional compass heading viewed from above.
 */

export interface Wgs84Position {
  readonly latitude: number
  readonly longitude: number
  readonly elevationMeters: number
}

export type Vec3Tuple = readonly [x: number, y: number, z: number]
export type LocalMeters = Vec3Tuple
export type WorldPosition = Vec3Tuple

export interface GeoTransformConfig {
  /** Geographic position represented by `localOriginMeters`. */
  readonly hqGeoAnchor: Wgs84Position
  /** World-space position represented by `localOriginMeters`. */
  readonly hqWorldPosition: WorldPosition
  /** Local [east, up, north] coordinate assigned to the HQ anchor. */
  readonly localOriginMeters: LocalMeters
  /** Clockwise rotation of local north toward world +X. */
  readonly northYawDegrees: number
  /** World-space units per physical metre. Must be finite and greater than 0. */
  readonly worldUnitsPerMeter: number
}

export const INTERNATIONAL_FOOT_TO_METERS = 0.3048
export const US_SURVEY_FOOT_NUMERATOR = 1200
export const US_SURVEY_FOOT_DENOMINATOR = 3937
export const US_SURVEY_FOOT_TO_METERS =
  US_SURVEY_FOOT_NUMERATOR / US_SURVEY_FOOT_DENOMINATOR

const WGS84_SEMI_MAJOR_METERS = 6_378_137
const WGS84_INVERSE_FLATTENING = 298.257223563
const WGS84_FLATTENING = 1 / WGS84_INVERSE_FLATTENING
const WGS84_SEMI_MINOR_METERS =
  WGS84_SEMI_MAJOR_METERS * (1 - WGS84_FLATTENING)
const WGS84_ECCENTRICITY_SQUARED =
  WGS84_FLATTENING * (2 - WGS84_FLATTENING)
const WGS84_SECOND_ECCENTRICITY_SQUARED =
  (WGS84_SEMI_MAJOR_METERS ** 2 - WGS84_SEMI_MINOR_METERS ** 2) /
  WGS84_SEMI_MINOR_METERS ** 2

const DEGREES_TO_RADIANS = Math.PI / 180
const RADIANS_TO_DEGREES = 180 / Math.PI

export class GeoTransformValidationError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'GeoTransformValidationError'
  }
}

function finite(label: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new GeoTransformValidationError(`${label} must be finite`)
  }
  return value
}

function finiteVector(label: string, value: Vec3Tuple): Vec3Tuple {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new GeoTransformValidationError(`${label} must contain exactly three numbers`)
  }
  return [
    finite(`${label}[0]`, value[0]),
    finite(`${label}[1]`, value[1]),
    finite(`${label}[2]`, value[2]),
  ]
}

export function validateWgs84Position(
  position: Wgs84Position,
  label = 'WGS84 position',
): void {
  if (!position || typeof position !== 'object') {
    throw new GeoTransformValidationError(`${label} must be an object`)
  }
  const latitude = finite(`${label}.latitude`, position.latitude)
  const longitude = finite(`${label}.longitude`, position.longitude)
  finite(`${label}.elevationMeters`, position.elevationMeters)

  if (latitude < -90 || latitude > 90) {
    throw new GeoTransformValidationError(`${label}.latitude must be in [-90, 90]`)
  }
  if (longitude < -180 || longitude > 180) {
    throw new GeoTransformValidationError(`${label}.longitude must be in [-180, 180]`)
  }
}

export function validateGeoTransformConfig(config: GeoTransformConfig): void {
  if (!config || typeof config !== 'object') {
    throw new GeoTransformValidationError('GeoTransform config must be an object')
  }
  validateWgs84Position(config.hqGeoAnchor, 'hqGeoAnchor')
  finiteVector('hqWorldPosition', config.hqWorldPosition)
  finiteVector('localOriginMeters', config.localOriginMeters)
  finite('northYawDegrees', config.northYawDegrees)
  const scale = finite('worldUnitsPerMeter', config.worldUnitsPerMeter)
  if (scale <= 0) {
    throw new GeoTransformValidationError('worldUnitsPerMeter must be greater than 0')
  }
}

function checkedScalar(label: string, value: number): number {
  return finite(label, value)
}

export function internationalFeetToMeters(feet: number): number {
  return checkedScalar('feet', feet) * INTERNATIONAL_FOOT_TO_METERS
}

export function metersToInternationalFeet(meters: number): number {
  return checkedScalar('meters', meters) / INTERNATIONAL_FOOT_TO_METERS
}

/**
 * Converts the retired US survey foot using its exact defining ratio:
 * 1 US survey foot = 1200 / 3937 metres.
 */
export function usSurveyFeetToMeters(feet: number): number {
  return (checkedScalar('US survey feet', feet) * US_SURVEY_FOOT_NUMERATOR) /
    US_SURVEY_FOOT_DENOMINATOR
}

export function metersToUsSurveyFeet(meters: number): number {
  return (checkedScalar('meters', meters) * US_SURVEY_FOOT_DENOMINATOR) /
    US_SURVEY_FOOT_NUMERATOR
}

function geodeticToEcef(position: Wgs84Position): Vec3Tuple {
  const latitude = position.latitude * DEGREES_TO_RADIANS
  const longitude = position.longitude * DEGREES_TO_RADIANS
  const sinLatitude = Math.sin(latitude)
  const cosLatitude = Math.cos(latitude)
  const sinLongitude = Math.sin(longitude)
  const cosLongitude = Math.cos(longitude)
  const primeVerticalRadius = WGS84_SEMI_MAJOR_METERS /
    Math.sqrt(1 - WGS84_ECCENTRICITY_SQUARED * sinLatitude ** 2)
  const radial = (primeVerticalRadius + position.elevationMeters) * cosLatitude

  return [
    radial * cosLongitude,
    radial * sinLongitude,
    (primeVerticalRadius * (1 - WGS84_ECCENTRICITY_SQUARED) +
      position.elevationMeters) * sinLatitude,
  ]
}

function normaliseLongitude(longitude: number): number {
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180
  // Preserve +180 for callers that supplied a coordinate on that side of the
  // antimeridian. Both values describe the same meridian, but this avoids a
  // surprising sign flip in a geographic round trip.
  return wrapped === -180 && longitude > 0 ? 180 : wrapped
}

/** Bowring's closed-form ECEF inverse, accurate well beyond the HQ AOI. */
function ecefToGeodetic(ecef: Vec3Tuple): Wgs84Position {
  const [x, y, z] = ecef
  const horizontal = Math.hypot(x, y)

  if (horizontal < 1e-9) {
    return {
      latitude: z >= 0 ? 90 : -90,
      longitude: 0,
      elevationMeters: Math.abs(z) - WGS84_SEMI_MINOR_METERS,
    }
  }

  const longitude = Math.atan2(y, x)
  const theta = Math.atan2(
    z * WGS84_SEMI_MAJOR_METERS,
    horizontal * WGS84_SEMI_MINOR_METERS,
  )
  const sinTheta = Math.sin(theta)
  const cosTheta = Math.cos(theta)
  const latitude = Math.atan2(
    z + WGS84_SECOND_ECCENTRICITY_SQUARED * WGS84_SEMI_MINOR_METERS * sinTheta ** 3,
    horizontal - WGS84_ECCENTRICITY_SQUARED * WGS84_SEMI_MAJOR_METERS * cosTheta ** 3,
  )
  const sinLatitude = Math.sin(latitude)
  const cosLatitude = Math.cos(latitude)
  const primeVerticalRadius = WGS84_SEMI_MAJOR_METERS /
    Math.sqrt(1 - WGS84_ECCENTRICITY_SQUARED * sinLatitude ** 2)
  const elevationMeters = Math.abs(cosLatitude) > 1e-12
    ? horizontal / cosLatitude - primeVerticalRadius
    : Math.abs(z) - WGS84_SEMI_MINOR_METERS

  return {
    latitude: latitude * RADIANS_TO_DEGREES,
    longitude: normaliseLongitude(longitude * RADIANS_TO_DEGREES),
    elevationMeters,
  }
}

function normaliseYawRadians(degrees: number): number {
  const turns = ((degrees % 360) + 360) % 360
  return turns * DEGREES_TO_RADIANS
}

export class GeoTransform {
  readonly config: GeoTransformConfig

  private readonly anchorEcef: Vec3Tuple
  private readonly sinLatitude: number
  private readonly cosLatitude: number
  private readonly sinLongitude: number
  private readonly cosLongitude: number
  private readonly sinYaw: number
  private readonly cosYaw: number

  constructor(config: GeoTransformConfig) {
    validateGeoTransformConfig(config)

    const hqGeoAnchor = { ...config.hqGeoAnchor }
    const hqWorldPosition = finiteVector('hqWorldPosition', config.hqWorldPosition)
    const localOriginMeters = finiteVector('localOriginMeters', config.localOriginMeters)
    this.config = {
      hqGeoAnchor,
      hqWorldPosition,
      localOriginMeters,
      northYawDegrees: config.northYawDegrees,
      worldUnitsPerMeter: config.worldUnitsPerMeter,
    }

    this.anchorEcef = geodeticToEcef(hqGeoAnchor)
    const latitude = hqGeoAnchor.latitude * DEGREES_TO_RADIANS
    const longitude = hqGeoAnchor.longitude * DEGREES_TO_RADIANS
    this.sinLatitude = Math.sin(latitude)
    this.cosLatitude = Math.cos(latitude)
    this.sinLongitude = Math.sin(longitude)
    this.cosLongitude = Math.cos(longitude)

    const yaw = normaliseYawRadians(config.northYawDegrees)
    this.sinYaw = Math.sin(yaw)
    this.cosYaw = Math.cos(yaw)
  }

  /** Converts WGS84 to local [east, up, north] metres. */
  geographicToLocal(position: Wgs84Position): LocalMeters {
    validateWgs84Position(position)
    const [x, y, z] = geodeticToEcef(position)
    const dx = x - this.anchorEcef[0]
    const dy = y - this.anchorEcef[1]
    const dz = z - this.anchorEcef[2]

    const east = -this.sinLongitude * dx + this.cosLongitude * dy
    const north =
      -this.sinLatitude * this.cosLongitude * dx -
      this.sinLatitude * this.sinLongitude * dy +
      this.cosLatitude * dz
    const up =
      this.cosLatitude * this.cosLongitude * dx +
      this.cosLatitude * this.sinLongitude * dy +
      this.sinLatitude * dz
    const origin = this.config.localOriginMeters

    return [origin[0] + east, origin[1] + up, origin[2] + north]
  }

  /** Converts local [east, up, north] metres back to WGS84. */
  localToGeographic(local: LocalMeters): Wgs84Position {
    const point = finiteVector('local', local)
    const origin = this.config.localOriginMeters
    const east = point[0] - origin[0]
    const up = point[1] - origin[1]
    const north = point[2] - origin[2]

    // Transpose of the ECEF -> ENU rotation used in geographicToLocal.
    const dx =
      -this.sinLongitude * east -
      this.sinLatitude * this.cosLongitude * north +
      this.cosLatitude * this.cosLongitude * up
    const dy =
      this.cosLongitude * east -
      this.sinLatitude * this.sinLongitude * north +
      this.cosLatitude * this.sinLongitude * up
    const dz = this.cosLatitude * north + this.sinLatitude * up

    return ecefToGeodetic([
      this.anchorEcef[0] + dx,
      this.anchorEcef[1] + dy,
      this.anchorEcef[2] + dz,
    ])
  }

  /** Applies local-origin removal, yaw, scale, and HQ world translation. */
  localToWorld(local: LocalMeters): WorldPosition {
    const point = finiteVector('local', local)
    const origin = this.config.localOriginMeters
    const east = point[0] - origin[0]
    const up = point[1] - origin[1]
    const north = point[2] - origin[2]
    const scale = this.config.worldUnitsPerMeter
    const hq = this.config.hqWorldPosition

    return [
      hq[0] + (this.cosYaw * east + this.sinYaw * north) * scale,
      hq[1] + up * scale,
      hq[2] + (this.sinYaw * east - this.cosYaw * north) * scale,
    ]
  }

  /** Reverses HQ translation, scale, and yaw into local metres. */
  worldToLocal(world: WorldPosition): LocalMeters {
    const point = finiteVector('world', world)
    const hq = this.config.hqWorldPosition
    const scale = this.config.worldUnitsPerMeter
    const worldX = (point[0] - hq[0]) / scale
    const up = (point[1] - hq[1]) / scale
    const worldZ = (point[2] - hq[2]) / scale
    // The east/north -> X/Z matrix is an orthonormal reflection, so it is its
    // own inverse. This is what preserves the game's world-Z = south contract
    // without giving up a conventional clockwise north yaw.
    const east = this.cosYaw * worldX + this.sinYaw * worldZ
    const north = this.sinYaw * worldX - this.cosYaw * worldZ
    const origin = this.config.localOriginMeters

    return [origin[0] + east, origin[1] + up, origin[2] + north]
  }

  geographicToWorld(position: Wgs84Position): WorldPosition {
    return this.localToWorld(this.geographicToLocal(position))
  }

  worldToGeographic(world: WorldPosition): Wgs84Position {
    return this.localToGeographic(this.worldToLocal(world))
  }
}
