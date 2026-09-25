// facade.js — procedural building facades, evaluated in the fragment shader.
//
// Why in the shader and not in the mesh: 56,476 buildings with real window
// geometry is tens of millions of triangles, and baking a texture atlas means
// re-exporting the whole city every time the classifier changes its mind. The
// glb already carries _BID per vertex, so instead the shader looks each
// building up in a data texture and derives its facade from world position.
//
//   _BID -> data textures -> material family, floors, ground-floor type,
//                            seed, footprint centre, height, year
//   world position + face normal -> storey, bay, wall-space UV
//   material family -> palette + a layer of the shared surface texture array
//   _BID -> building-lighting.bin -> night personality (city-lighting.ts)
//
// This is the ONE building material: day, dusk, night and rain, at every
// distance. It is a MeshStandardMaterial with the facade patched in through
// onBeforeCompile, so the sky environment (IBL and reflections), the sun's
// shadow map, fog and tone mapping all apply to it unchanged. The shader only
// decides albedo, roughness, the shading normal, a glass F0 and emission.
//
// What it draws, near to far:
//   - weathered brick / stone / concrete from a texture array, tinted to the
//     building's palette colour, with its normal and roughness maps
//   - recessed windows: the glass sits behind the wall plane, and a view ray
//     that misses it lands on a jamb, head or sill that is shaded with its own
//     normal, so reveals catch the sun like real ones
//   - frames, mullions and meeting rails; glass that reflects the environment
//     with Fresnel and a per-pane tilt
//   - interior mapping: every pane opens onto a raymarched box room (floor,
//     ceiling, walls, furniture band, curtains or blinds), faint by day and
//     lamp-lit at night from the deterministic occupancy model
//   - storefronts with bulkheads, awnings, abstract lit signage and roll-down
//     shutters; lobby doors, residential window bars, garage shutters
//   - grime at the street, streaks from the parapet, macro variation, cornices
//   - past a few pixels per storey all of that collapses to an aggregate: the
//     palette mixed with the glass share, and at night the expected lit share
//     of the floor, so distant towers glow at the right level without speckle.
//
// Cost is a handful of texture fetches and some arithmetic per fragment.
// Triangle count is unchanged, so this works at every LOD including the far
// ones. Silhouette is the one thing it cannot do: cornice depth and setbacks
// are shading, not geometry.

import * as THREE from 'three'
import { cityLightingUniforms } from '../world/city-lighting-uniforms'
import {
  CITY_HASH_GLSL, CITY_WINDOW_GLSL, SURFACE_NOISE_GLSL,
} from '../world/surfaces/city-glsl'
import {
  SurfaceLayer, SURFACE_LAYER_SIZE_M, attachSurfaceUniforms,
  ensureSurfaceTextures,
} from '../world/surfaces/surface-textures'
import {
  registerSurfaceMaterial, unregisterSurfaceMaterial,
} from '../world/surfaces/surface-quality'

const TEX = 256 // data texture is TEX x TEX, so it holds TEX^2 buildings

// Styles: how a family builds its openings.
const PUNCHED = 0 // masonry wall with punched windows
const CURTAIN = 1 // glass curtain wall, spandrels and mullions
const FRAMED = 2 // exposed frame (concrete grid, stone piers, cast iron)
const SHED = 3 // industrial: few, high windows in cladding

// Per material family:
//   [wall, trim, glass, winW, winH, layer, roughness, style, texture amount,
//    coated glass 0..1, bay metres]
// The window ratios are the fraction of a bay and of a floor that the opening
// takes. They matter more than the colours do: a masonry tenement is mostly
// wall with punched openings, a curtain-wall tower is mostly glass, and
// getting that ratio wrong makes every building read as the same thing.
// Sampled off real Manhattan stock rather than picked by eye. NYC common brick
// is a muted brown-red around #8d6a5c, not the fire-engine red a naive palette
// lands on -- the first pass turned half the island crimson from the air.
const L = SurfaceLayer
const PALETTE = {
  brick_dark: [0x6f5c50, 0x9a8c7c, 0x2b3138, 0.42, 0.46, L.BRICK_RED, 0.9, PUNCHED, 0.95, 0.0, 3.3],
  brick_institutional: [0x9d8271, 0xc2b4a0, 0x39424c, 0.36, 0.44, L.BRICK_RED, 0.88, PUNCHED, 0.85, 0.0, 3.6],
  brick_red: [0x8d6a5c, 0xb8a894, 0x323a44, 0.40, 0.46, L.BRICK_RED, 0.9, PUNCHED, 0.95, 0.0, 3.3],
  brownstone: [0x7d5f4c, 0x8c6f5b, 0x2f3640, 0.36, 0.48, L.LIMESTONE, 0.85, PUNCHED, 0.8, 0.0, 3.4],
  buff_brick: [0xc4b39a, 0xe0d6c4, 0x39414c, 0.40, 0.46, L.BRICK_BUFF, 0.88, PUNCHED, 0.85, 0.0, 3.3],
  cast_iron: [0x8c9490, 0xa2aaa6, 0x2c343c, 0.66, 0.62, L.CONCRETE, 0.5, FRAMED, 0.4, 0.0, 3.8],
  concrete_grid: [0xaeada8, 0xc1c0bb, 0x39434f, 0.62, 0.52, L.CONCRETE, 0.85, FRAMED, 0.8, 0.3, 3.6],
  concrete_open: [0xa3a29e, 0xb6b5b1, 0x22262b, 0.86, 0.72, L.CONCRETE, 0.85, FRAMED, 0.75, 0.3, 4.2],
  curtain_glass: [0x55646f, 0x93a3ae, 0x3d6376, 0.90, 0.84, L.CONCRETE, 0.3, CURTAIN, 0.2, 1.0, 3.0],
  glass_stone: [0x9aa2a8, 0xb8c0c5, 0x436a7e, 0.76, 0.70, L.LIMESTONE, 0.75, FRAMED, 0.7, 0.7, 3.6],
  limestone: [0xd2cbba, 0xe2dcce, 0x3a4049, 0.38, 0.46, L.LIMESTONE, 0.82, PUNCHED, 0.8, 0.0, 3.4],
  mixed_panel: [0xa2a6ab, 0xb8bcc1, 0x36414c, 0.62, 0.56, L.CONCRETE, 0.7, FRAMED, 0.6, 0.5, 3.6],
  scaffold: [0x94897a, 0xa69c8e, 0x4a4a48, 0.28, 0.34, L.CONCRETE, 0.9, PUNCHED, 0.6, 0.0, 3.4],
  steel_shed: [0x8a9196, 0xa1a8ad, 0x333c42, 0.30, 0.34, L.SHUTTER, 0.6, SHED, 0.8, 0.0, 6.0],
  stone_gothic: [0xafab9d, 0xc2beb1, 0x2c3138, 0.30, 0.58, L.LIMESTONE, 0.85, PUNCHED, 0.85, 0.0, 3.6],
  white_brick: [0xdedbd3, 0xebe9e3, 0x3c454f, 0.44, 0.48, L.BRICK_BUFF, 0.85, PUNCHED, 0.75, 0.0, 3.3],
}

const FALLBACK = [0xa0a5ac, 0xb6bbc2, 0x36414c, 0.44, 0.48, L.CONCRETE, 0.85, PUNCHED, 0.7, 0.0, 3.4]
const DEFAULT_MATERIALS = Object.keys(PALETTE)

// five float rows per family:
//   0 wall rgb, 1 trim rgb, 2 glass rgb,
//   3 (winW, winH, layer, roughness), 4 (style, texture amount, coated, bay)
function packPalette(materials) {
  const n = materials.length
  const data = new Float32Array(n * 5 * 4)
  materials.forEach((m, i) => {
    const p = PALETTE[m] || FALLBACK
    const put = (slot, hex) => {
      const c = new THREE.Color(hex).convertSRGBToLinear()
      const o = (slot * n + i) * 4
      data[o] = c.r; data[o + 1] = c.g; data[o + 2] = c.b; data[o + 3] = 1
    }
    put(0, p[0]); put(1, p[1]); put(2, p[2])
    let o = (3 * n + i) * 4
    data[o] = p[3]; data[o + 1] = p[4]; data[o + 2] = p[5]; data[o + 3] = p[6]
    o = (4 * n + i) * 4
    data[o] = p[7]; data[o + 1] = p[8]; data[o + 2] = p[9]; data[o + 3] = p[10]
  })
  const tex = new THREE.DataTexture(data, n, 5, THREE.RGBAFormat,
    THREE.FloatType)
  tex.needsUpdate = true
  tex.minFilter = tex.magFilter = THREE.NearestFilter
  return tex
}

// Deterministic integer hash for the no-city fallback, so a building keeps
// its family across reloads even without the runtime payload.
function hashInt(i) {
  let h = Math.imul(i ^ 0x5bd1e995, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  return (h ^ (h >>> 13)) >>> 0
}

// R = material index, G = floors, B = ground-floor index, A = per-building seed
function packBuildings(city, materialCount) {
  const data = new Uint8Array(TEX * TEX * 4)
  if (!city) {
    // No runtime payload (the single-GLB fallback): every id still gets a
    // plausible family and a storefront share, so the city is not uniform.
    for (let i = 0; i < TEX * TEX; i++) {
      const h = hashInt(i)
      const o = i * 4
      data[o] = h % Math.max(1, materialCount)
      data[o + 1] = 6 + ((h >>> 8) % 14)
      data[o + 2] = (h >>> 16) % 3 === 0 ? 12 : 9
      data[o + 3] = (i * 2654435761) % 251
    }
  } else {
    const traits = city.meta.traits || []
    for (let i = 0; i < city.count && i < TEX * TEX; i++) {
      const a = city.archetypeIx(i)
      const t = traits[a] || [0, 0, 0]
      const h = city.height(i)
      let floors = city.floors(i)
      if (!floors) floors = Math.max(1, Math.round(h / 3.4))
      const o = i * 4
      data[o] = t[0]
      data[o + 1] = Math.min(255, floors)
      data[o + 2] = t[2]
      // deterministic per-building jitter so identical archetypes do not tile
      data[o + 3] = (i * 2654435761) % 251
    }
  }
  const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat,
    THREE.UnsignedByteType)
  tex.needsUpdate = true
  tex.minFilter = tex.magFilter = THREE.NearestFilter
  return tex
}

// R, G = footprint centre in world x, z; B = height, metres; A = year built.
// The centre anchors the bay grid, so a facade's windows are symmetric about
// the building rather than about the world origin; the height puts the
// cornice and parapet on the real roof line and sets the storey height.
function packGeometry(city) {
  const data = new Float32Array(TEX * TEX * 4)
  if (city) {
    for (let i = 0; i < city.count && i < TEX * TEX; i++) {
      const o = i * 4
      data[o] = city.x(i)
      data[o + 1] = -city.y(i)
      data[o + 2] = city.height(i)
      data[o + 3] = city.year(i)
    }
  }
  const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat,
    THREE.FloatType)
  tex.needsUpdate = true
  tex.minFilter = tex.magFilter = THREE.NearestFilter
  return tex
}

const glf = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v))

const VERT_HEAD = /* glsl */`
attribute float _bid;
uniform sampler2D uBuildings;
uniform float uTexSize;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vBid;
`

// A building whose floors byte is zero is suppressed: something authored
// stands on its lot instead. packBuildings() never writes zero (floors is
// clamped to at least 1), so it is a free sentinel, and collapsing the
// vertices costs nothing -- a triangle whose corners coincide covers no
// pixels, so the building disappears with no branch in the fragment shader
// and no change to the tile geometry on disk.
const VERT_BODY = /* glsl */`
vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
vNrm = normalize(mat3(modelMatrix) * normal);
vBid = _bid;
{
  float _b = max(_bid, 0.0);
  vec2 _uv = (vec2(mod(_b, uTexSize), floor(_b / uTexSize)) + 0.5) / uTexSize;
  if (texture2D(uBuildings, _uv).g < 0.5 / 255.0) transformed = vec3(0.0);
}`

export const FACADE_FRAG_HEAD = /* glsl */`
uniform sampler2D uBuildings;
uniform sampler2D uBuildingsB;
uniform sampler2D uPalette;
uniform float uTexSize;
uniform float uDetailFade;
uniform float uGroundLevel;
uniform float uCityPractical;
uniform float uCityWetness;
uniform int uCityWorldSeed;
uniform sampler2D uCityBuildingData;
uniform float uCityDataWidth;
uniform float uCityDataHeight;
uniform float uCityOcc[ 8 ];
uniform sampler2DArray uSurfAlbedo;
uniform sampler2DArray uSurfData;
uniform vec3 uSurfInvMean[ 7 ];
varying vec3 vWorld;
varying vec3 vNrm;
varying float vBid;

const float SURF_SIZE[ 7 ] = float[ 7 ]( ${SURFACE_LAYER_SIZE_M.map(glf).join(', ')} );

${CITY_HASH_GLSL}
${CITY_WINDOW_GLSL}
${SURFACE_NOISE_GLSL}

// Results of the facade pass, read back at the later injection points.
vec3 fNormalW;
float fRough;
vec3 fEmissive;
vec3 fF0;

// Interior wall colours: a small, believable set of paint and panelling.
const vec3 ROOM_WALL[ 6 ] = vec3[ 6 ](
	vec3( 0.62, 0.55, 0.44 ),
	vec3( 0.50, 0.52, 0.53 ),
	vec3( 0.68, 0.62, 0.52 ),
	vec3( 0.42, 0.47, 0.40 ),
	vec3( 0.56, 0.40, 0.30 ),
	vec3( 0.30, 0.20, 0.13 )
);

// Interior mapping (van Dongen 2008): the view ray through a pane is
// intersected with a box room behind it, so every window shows a floor, a
// ceiling, side walls and a back wall that shift correctly with the camera.
//   p     where the ray crosses the glass, room space (x 0..W, y 0..H)
//   rd    the ray in wall space: x along the wall, y up, z into the room
//   room  W, H, D in metres;  style = cityRoomStyle()
//   use   0 home, 1 office, 2 shop
// Returns the radiance leaving the room toward the glass.
vec3 facadeRoom( vec2 p, vec3 rd, vec3 room, vec4 style, float lit, vec3 lamp, float day, float use ) {
	vec3 r = vec3(
		abs( rd.x ) < 1e-4 ? 1e-4 : rd.x,
		abs( rd.y ) < 1e-4 ? 1e-4 : rd.y,
		max( rd.z, 1e-3 ) );
	float tx = ( ( r.x > 0.0 ? room.x : 0.0 ) - p.x ) / r.x;
	float ty = ( ( r.y > 0.0 ? room.y : 0.0 ) - p.y ) / r.y;
	float tz = room.z / r.z;
	float t = min( min( tx, ty ), tz );
	vec3 h = vec3( p, 0.0 ) + r * t;

	vec3 wall = ROOM_WALL[ int( style.z ) ];
	vec3 alb;
	float fitting = 0.0;
	if ( t == tz ) {
		alb = wall * 0.9;
		if ( use > 1.5 ) {
			// shop: shelving with a run of product colours
			float shelf = step( 0.35, fract( h.y / 0.42 ) ) * step( h.y, 2.3 ) * step( 0.25, h.y );
			vec3 goods = 0.25 + 0.55 * vec3( sHash11( floor( h.x / 0.28 ) + style.w * 40.0 ),
				sHash11( floor( h.x / 0.28 ) + 7.0 ), sHash11( floor( h.y / 0.42 ) + 3.0 ) );
			alb = mix( alb * 0.55, goods, shelf * 0.85 );
		} else if ( use > 0.5 ) {
			// office: desks and low partitions
			alb = mix( alb, vec3( 0.16, 0.17, 0.18 ), step( h.y, 1.15 ) );
		} else {
			// home: sofa / sideboard band and a picture
			float furn = step( h.y, 0.8 + 0.3 * style.w ) * step( 0.1 * room.x, h.x ) * step( h.x, ( 0.55 + 0.35 * style.y ) * room.x );
			alb = mix( alb, vec3( 0.13, 0.1, 0.08 ) + 0.12 * vec3( style.y, style.w, 0.5 ), furn );
			float pic = step( 1.35, h.y ) * step( h.y, 1.8 ) * step( 0.62 * room.x, h.x ) * step( h.x, 0.84 * room.x );
			alb = mix( alb, vec3( 0.2, 0.26, 0.32 ) * ( 0.6 + style.w ), pic );
		}
	} else if ( t == ty ) {
		if ( r.y < 0.0 ) {
			float plank = step( 0.5, fract( h.x * 4.0 + floor( h.z * 0.7 ) * 0.37 ) );
			alb = use > 1.5 ? vec3( 0.42, 0.41, 0.38 )
				: use > 0.5 ? vec3( 0.15, 0.15, 0.16 )
				: mix( vec3( 0.26, 0.16, 0.08 ), vec3( 0.33, 0.21, 0.11 ), plank );
		} else {
			alb = use > 1.5 ? vec3( 0.45 ) : vec3( 0.76, 0.75, 0.72 );
			if ( use > 0.5 ) {
				// fluorescent / downlight grid
				vec2 g = fract( vec2( h.x / 1.8, h.z / 1.8 ) );
				fitting = step( 0.2, g.x ) * step( g.x, 0.8 ) * step( 0.35, g.y ) * step( g.y, 0.65 );
			}
		}
	} else {
		alb = wall * 0.8;
	}

	// Lit: a fitting at the middle of the ceiling, falling off with distance.
	// Day: sky through the window, falling off with depth into the room.
	vec3 dl = vec3( room.x * 0.5, room.y - 0.1, room.z * 0.45 ) - h;
	float fall = 1.0 / ( 1.0 + dot( dl, dl ) * 0.16 );
	vec3 light = lamp * lit * ( 0.2 + 1.3 * fall + fitting * 1.4 );
	light += vec3( day ) * ( 0.85 - 0.6 * clamp( h.z / room.z, 0.0, 1.0 ) );
	return alb * light;
}

// A recessed opening: the glass sits \`depth\` behind the wall plane, so the
// first thing a view ray meets inside the opening may be a reveal (jamb, head
// or sill) rather than glass. Returns x = in the opening, y = glass visible,
// z = reveal face (1 left jamb, 2 right jamb, 3 head, 4 sill), and the point
// where the ray crosses the glass plane in pg.
vec3 facadeRecess( vec2 p, vec2 lo, vec2 hi, float depth, vec3 v, vec2 fw, out vec2 pg ) {
	vec2 shift = v.xy / max( v.z, 0.12 ) * depth;
	pg = p + shift;
	float inOpen = sRectW( p, lo, hi, fw );
	float inGlass = sRectW( pg, lo, hi, fw ) * inOpen;
	float face = 0.0;
	if ( inOpen > inGlass ) {
		vec2 ax = max( abs( shift ), vec2( 1e-5 ) );
		vec2 cr = vec2(
			shift.x > 0.0 ? hi.x - p.x : p.x - lo.x,
			shift.y > 0.0 ? hi.y - p.y : p.y - lo.y ) / ax;
		if ( cr.x < cr.y ) face = shift.x > 0.0 ? 2.0 : 1.0;
		else face = shift.y > 0.0 ? 3.0 : 4.0;
	}
	return vec3( inOpen, inGlass, face );
}

struct Opening {
	vec2 lo;          // opening, cell-local metres
	vec2 hi;
	float depth;      // recess depth to the glass
	vec3 frameCol;
	float frameW;
	float mullions;   // vertical mullions inside the glass
	float rail;       // horizontal rail height as a share of the opening, 0 = none
	vec2 roomLo;      // room box origin, cell-local
	vec3 room;        // W, H, D
	vec4 style;       // cityRoomStyle()
	float lit;
	vec3 lamp;
	float use;        // 0 home, 1 office, 2 shop
	vec3 f0;          // glass reflectance at normal incidence
	vec3 glassCol;
};

// Shades one opening into the running wall result. Returns the glass share.
float facadeOpening( Opening o, vec2 p, vec3 v, vec2 fw, vec3 t, vec3 wn, vec3 revealCol,
	float roomDetail, float day,
	inout vec3 col, inout float rough, inout vec3 nW, inout vec3 emis, inout vec3 f0 ) {
	vec2 pg = p;
#if SURFACE_Q > 0
	vec3 rc = facadeRecess( p, o.lo, o.hi, o.depth, v, fw, pg );
#else
	float inside = sRectW( p, o.lo, o.hi, fw );
	vec3 rc = vec3( inside, inside, 0.0 );
#endif
	if ( rc.x <= 0.0 ) return 0.0;
	float rev = rc.x - rc.y;
	if ( rev > 0.0 ) {
		vec3 fn = rc.z < 1.5 ? t : rc.z < 2.5 ? -t : rc.z < 3.5 ? vec3( 0.0, -1.0, 0.0 ) : vec3( 0.0, 1.0, 0.0 );
		col = mix( col, revealCol * ( rc.z > 3.5 ? 1.05 : 0.85 ), rev );
		nW = normalize( mix( nW, fn, rev ) );
	}
	if ( rc.y <= 0.0 ) return 0.0;

	vec2 size = o.hi - o.lo;
	vec2 q = pg - o.lo;
	float frame = 1.0 - sRectW( pg, o.lo + o.frameW, o.hi - o.frameW, fw );
	float panes = o.mullions + 1.0;
	if ( o.mullions > 0.5 ) {
		float d = abs( fract( q.x / size.x * panes + 0.5 ) - 0.5 ) * size.x / panes;
		frame = max( frame, 1.0 - smoothstep( o.frameW * 0.45 - fw.x, o.frameW * 0.45 + fw.x, d ) );
	}
	if ( o.rail > 0.0 ) {
		float d = abs( q.y - o.rail * size.y );
		frame = max( frame, 1.0 - smoothstep( o.frameW * 0.55 - fw.y, o.frameW * 0.55 + fw.y, d ) );
	}
	col = mix( col, o.frameCol, rc.y * frame );
	rough = mix( rough, 0.45, rc.y * frame );
	nW = normalize( mix( nW, wn, rc.y ) );
	float pane = rc.y * ( 1.0 - frame );
	if ( pane <= 0.0 ) return 0.0;

	// Each pane is tilted a hair differently, the way real glazing is, so
	// neighbouring windows reflect slightly different sky.
	vec2 paneId = vec2( floor( q.x / size.x * panes ), floor( q.y / size.y * ( o.rail > 0.0 ? 2.0 : 1.0 ) ) );
	vec2 tilt = ( sHash22( paneId + o.roomLo * 3.17 + o.style.zw * 17.0 ) - 0.5 ) * 0.035;
	vec3 gN = normalize( wn + t * tilt.x + vec3( 0.0, tilt.y, 0.0 ) );
	float fres = pow( 1.0 - clamp( v.z, 0.0, 1.0 ), 5.0 );

	vec3 lampLit = o.lamp * o.lit;
	vec3 avg = ROOM_WALL[ int( o.style.z ) ] * ( lampLit * 0.55 + vec3( day * 0.4 ) );
	vec3 rad = avg;
#if SURFACE_Q > 0
	if ( roomDetail > 0.01 ) {
		vec3 rd = normalize( v );
		vec2 rp = clamp( pg - o.roomLo, vec2( 0.02 ), o.room.xy - 0.02 );
		rad = facadeRoom( rp, rd, o.room, o.style, o.lit, o.lamp, day, o.use );
		// dressing at the glass: curtains, blinds, drawn curtains
		vec2 g = q / size;
		vec3 fabric = o.style.y < 0.3 ? vec3( 0.34, 0.1, 0.08 )
			: mix( vec3( 0.58, 0.46, 0.33 ), vec3( 0.66, 0.64, 0.58 ), o.style.w );
		float cover = 0.0;
		if ( o.use < 1.5 ) {
			if ( o.style.x > 2.5 ) cover = 1.0;
			else if ( o.style.x > 1.5 ) {
				cover = step( 1.0 - ( 0.25 + 0.6 * o.style.w ), g.y ) * step( 0.28, fract( q.y / 0.05 ) );
				fabric = vec3( 0.7, 0.68, 0.62 );
			} else if ( o.style.x > 0.5 ) {
				float c = 0.13 + 0.2 * o.style.w;
				cover = 1.0 - step( c, g.x ) * step( g.x, 1.0 - c );
			}
		}
		float folds = 0.8 + 0.2 * sin( q.x * 36.0 + o.style.w * 6.0 );
		vec3 dressed = fabric * folds * ( lampLit * 0.85 + vec3( day * 0.35 ) );
		rad = mix( rad, dressed, cover );
		rad = mix( avg, rad, roomDetail );
	}
#endif

	col = mix( col, o.glassCol * 0.05, pane );
	rough = mix( rough, 0.04 + 0.03 * tilt.x * 20.0, pane );
	nW = normalize( mix( nW, gN, pane ) );
	f0 = mix( f0, o.f0, pane );
	emis += rad * ( 1.0 - fres ) * pane;
	return pane;
}

// Abstract sign lettering: a run of 3x5 glyph cells whose strokes come from a
// hash, so every shop has its own "name" and none of them is a real brand.
float facadeGlyphs( vec2 p, vec2 size, float seed ) {
	float glyphW = size.y * 0.62;
	float count = clamp( floor( size.x * ( 0.45 + 0.4 * sHash11( seed ) ) / glyphW ), 2.0, 14.0 );
	float textW = count * glyphW;
	vec2 q = p - vec2( ( size.x - textW ) * 0.5, size.y * 0.18 );
	float h = size.y * 0.64;
	if ( q.x < 0.0 || q.x > textW || q.y < 0.0 || q.y > h ) return 0.0;
	float gi = floor( q.x / glyphW );
	vec2 c = vec2( fract( q.x / glyphW ) * 1.25, q.y / h ); // 0..1.25 so glyphs get spacing
	if ( c.x > 1.0 ) return 0.0;
	vec2 cell = floor( c * vec2( 3.0, 5.0 ) );
	float bits = sHash11( gi * 7.31 + seed * 13.7 );
	float on = step( 0.42, sHash11( cell.x + cell.y * 3.0 + bits * 91.0 ) );
	// keep the verticals mostly on so shapes read as letters, not noise
	if ( cell.x != 1.0 ) on = max( on, step( 0.3, bits ) * step( 0.5, sHash11( cell.y + gi ) ) );
	return on;
}
`

export const FACADE_FRAG_BODY = /* glsl */`
fNormalW = normalize( vNrm );
fRough = 0.85;
fEmissive = vec3( 0.0 );
fF0 = vec3( 0.04 );
{
	int bid = int( max( vBid, 0.0 ) + 0.5 );
	int ts = int( uTexSize );
	ivec2 bxy = ivec2( bid % ts, bid / ts );
	vec4 info = texelFetch( uBuildings, bxy, 0 );
	vec4 infoB = texelFetch( uBuildingsB, bxy, 0 );
	int mi = int( info.r * 255.0 + 0.5 );
	float floors = max( 1.0, floor( info.g * 255.0 + 0.5 ) );
	float groundT = floor( info.b * 255.0 + 0.5 );
	float seed = info.a * 255.0;
	vec2 centre = infoB.xy;
	float bHeight = infoB.z;
	float year = infoB.w;

	vec3 wallCol = texelFetch( uPalette, ivec2( mi, 0 ), 0 ).rgb;
	vec3 trimCol = texelFetch( uPalette, ivec2( mi, 1 ), 0 ).rgb;
	vec3 glassCol = texelFetch( uPalette, ivec2( mi, 2 ), 0 ).rgb;
	vec4 shape = texelFetch( uPalette, ivec2( mi, 3 ), 0 );
	vec4 props = texelFetch( uPalette, ivec2( mi, 4 ), 0 );
	int layer = int( shape.b + 0.5 );
	int style = int( props.r + 0.5 );

	float hA = sHash11( seed + 3.7 );
	float hB = sHash11( seed * 1.73 + 11.1 );
	float hC = sHash11( seed * 2.31 + 5.3 );
	float hD = sHash11( seed * 0.61 + 29.9 );
	// 0 = new, 1 = a century of soot. Unknown years get a middling age.
	float age = year > 1000.0 ? clamp( ( 2030.0 - year ) / 130.0, 0.05, 1.0 ) : 0.35 + 0.4 * hA;
	age = clamp( age * ( 0.7 + 0.6 * hB ), 0.0, 1.0 );

	// COLOR_0 as a light per-building tint, not a multiplier: both are dark,
	// and multiplying them is what once made the whole city near-black.
	float tint = clamp( dot( diffuseColor.rgb, vec3( 0.333 ) ), 0.0, 1.0 );
	wallCol *= ( 0.92 + tint * 0.16 ) * ( 0.93 + hC * 0.14 );

	vec3 n = fNormalW;
	vec3 toFrag = vWorld - cameraPosition;
	float viewDist = length( toFrag );
	vec3 viewDir = toFrag / max( viewDist, 1e-4 );
	float wet = uCityWetness;
	float practical = uCityPractical;
	// daylight inside a room reads far darker than the facade outside it
	float day = ( 1.0 - practical ) * ( 1.0 - 0.45 * wet ) * 0.16;
	CityBuilding cb = cityBuilding( bid );

	// Wall frame and every derivative, taken before any branch: derivatives
	// inside divergent control flow are undefined, and a building edge is
	// exactly where wall and roof pixels share a quad.
	vec3 t = vec3( n.z, 0.0, -n.x );
	float tl = length( t );
	t = tl > 1e-4 ? t / tl : vec3( 1.0, 0.0, 0.0 );
	vec3 wn = tl > 1e-4 ? vec3( n.x, 0.0, n.z ) / tl : vec3( 0.0, 0.0, 1.0 );
	float u = dot( vWorld.xz - centre, t.xz );
	float y = max( vWorld.y - uGroundLevel, 0.0 );
	vec2 fw = vec2( fwidth( u ), fwidth( y ) );
	float layerSize = SURF_SIZE[ layer ];
	vec2 tuv = vec2( u, -y ) / layerSize + vec2( hA, hD ) * 13.0;
	vec2 tuvX = dFdx( tuv );
	vec2 tuvY = dFdy( tuv );
	vec2 ruv = vWorld.xz / 3.0 + vec2( hA, hB ) * 11.0;
	vec2 ruvX = dFdx( ruv );
	vec2 ruvY = dFdy( ruv );

	vec3 col = wallCol;
	float rough = shape.a;
	vec3 nW = n;
	vec3 emis = vec3( 0.0 );
	vec3 f0 = vec3( 0.04 );

	if ( abs( n.y ) < 0.7 ) {
		// ======================================================== WALL ====
		vec3 v = vec3( dot( viewDir, t ), viewDir.y, max( -dot( viewDir, wn ), 1e-3 ) );

		// storey schedule from the real height and floor count
		bool retail = groundT > 11.5;
		float groundH = groundT == 13.0 ? 5.4 : retail ? 4.6 : 4.0;
		if ( bHeight > 0.5 ) groundH = min( groundH, max( bHeight - 0.5, 2.8 ) );
		float typ = 3.4;
		if ( floors > 1.5 && bHeight > groundH + 2.5 ) typ = clamp( ( bHeight - groundH ) / ( floors - 1.0 ), 2.8, 4.6 );
		float yUp = y - groundH;
		bool isGround = yUp < 0.0;
		float rowF = isGround ? 0.0 : 1.0 + floor( yUp / typ );
		float fy = isGround ? y : yUp - ( rowF - 1.0 ) * typ;
		int row = int( rowF );
		float topY = bHeight > 0.5 ? bHeight : floors * 3.4 + 0.6;
		float below = topY - y;

		// bays, centred on the building's own axis so a facade is symmetric
		float bay = props.a * ( 0.9 + 0.25 * hA );
		float bIx = floor( u / bay + 0.5 );
		float bx = u - bIx * bay;
		int colIx = int( bIx );

		// how much structure a pixel can carry: storeys per pixel
		float cellPx = fw.y / min( typ, bay );
		float detail = uDetailFade * ( 1.0 - smoothstep( 0.2, 0.5, cellPx ) );
#if SURFACE_Q >= 2
		float roomDetail = 1.0 - smoothstep( 0.035, 0.09, cellPx );
#elif SURFACE_Q == 1
		float roomDetail = 1.0 - smoothstep( 0.02, 0.05, cellPx );
#else
		float roomDetail = 0.0;
#endif

		// ---- wall material: textured, tinted to the palette
		vec3 texA = textureGrad( uSurfAlbedo, vec3( tuv, float( layer ) ), tuvX, tuvY ).rgb * uSurfInvMean[ layer ];
		col = wallCol * mix( vec3( 1.0 ), texA, props.g );
#if SURFACE_Q > 0
		vec4 td = textureGrad( uSurfData, vec3( tuv, float( layer ) ), tuvX, tuvY );
		vec3 nT = sUnpackNormal( td.rg, props.g * ( 1.0 - smoothstep( 60.0, 500.0, viewDist ) ) );
		nW = normalize( t * nT.x + vec3( 0.0, 1.0, 0.0 ) * nT.y + wn * nT.z );
		rough = mix( rough, clamp( td.b * 1.05, 0.35, 1.0 ), props.g * 0.6 );
#endif

		// ---- macro variation and weathering
		col *= 0.87 + 0.26 * sFbm( vec2( u, y ) * 0.08 + seed );
		col = mix( col, col * vec3( 1.07, 1.0, 0.93 ), smoothstep( 0.6, 0.8, sNoise( vec2( u, y ) * 0.045 + hB * 50.0 ) ) * 0.7 );
		float grime = ( 1.0 - smoothstep( 0.0, 3.4, y ) ) * ( 0.45 + 0.5 * sNoise( vec2( u * 0.8, y * 1.6 ) ) );
		float streak = smoothstep( 0.4, 0.95, sNoise( vec2( u * 2.1, y * 0.06 + hC * 9.0 ) ) );
		grime += smoothstep( 8.0, 0.6, below ) * streak * 0.9;
		grime += 0.3 * sFbm( vec2( u * 0.3, y * 0.1 ) + hD * 30.0 );
		float ageK = 0.35 + 0.8 * age;
		if ( style == 1 ) ageK *= 0.35;

		vec3 farCol = col;
		float winShare = clamp( shape.r * ( 0.3 + 0.55 * shape.g ) * ( style == 1 ? 1.15 : 1.0 ), 0.05, 0.9 );
		vec3 detailCol = col;

		if ( detail > 0.002 ) {
			vec2 cellFw = fw;
			vec3 revealCol = col;
			bool lit = cityWindowLit( cb, row, colIx );
			vec4 rs = cityRoomStyle( cb.seed, row, colIx );
			float jit = rs.w * 2.0 - 1.0;
			vec3 lamp = cityLampColour( cb.kind, jit ) * mix( vec3( 0.82, 0.92, 1.12 ), vec3( 1.1, 0.95, 0.8 ), rs.y ) * 1.05 * practical;
			vec3 frameCol = hC < 0.3 ? vec3( 0.75, 0.74, 0.7 ) : hC < 0.55 ? vec3( 0.03, 0.03, 0.03 )
				: hC < 0.72 ? vec3( 0.04, 0.09, 0.06 ) : hC < 0.86 ? vec3( 0.18, 0.1, 0.06 ) : vec3( 0.42, 0.43, 0.44 );
			if ( style == 1 || style == 2 ) frameCol = mix( trimCol * 0.5, vec3( 0.12 ), 0.5 );
			vec3 glassF0 = mix( vec3( 0.05 ), glassCol * 0.45 + 0.05, props.b );

			if ( !isGround ) {
				// ------------------------------------------------ upper floors
				float glassy = style == 1 ? 1.0 : style == 2 ? 0.45 : 0.0;
				float sill = mix( 0.27, 0.05, glassy ) * typ;
				float head = min( sill + ( 0.3 + 0.55 * shape.g ) * typ, typ - 0.28 );
				float hw = 0.5 * shape.r * bay;
				if ( style == 3 ) { sill = typ * 0.55; head = typ - 0.3; }
				vec2 lo = vec2( -hw, sill );
				vec2 hi = vec2( hw, head );
				vec2 p = vec2( bx, fy );

				if ( style == 0 ) {
					// stone sill under the window and a lintel over it
					float sillB = sRectW( p, vec2( -hw - 0.1, sill - 0.09 ), vec2( hw + 0.1, sill ), cellFw );
					float lintel = sRectW( p, vec2( -hw - 0.06, head ), vec2( hw + 0.06, head + 0.22 ), cellFw );
					float shadowB = sRectW( p, vec2( -hw - 0.1, sill - 0.2 ), vec2( hw + 0.1, sill - 0.09 ), cellFw );
					col *= 1.0 - 0.35 * shadowB;
					col = mix( col, trimCol * ( 0.85 + 0.2 * texA.r ), max( sillB, lintel * ( layer < 2 ? 1.0 : 0.5 ) ) );
					nW = normalize( mix( nW, normalize( wn + vec3( 0.0, 0.9, 0.0 ) ), sillB * 0.7 ) );
					// soot streaks washing down from each sill
					float under = sBandW( p.x, -hw, hw, cellFw.x ) * smoothstep( sill - 1.9, sill - 0.2, p.y ) * step( p.y, sill - 0.09 );
					grime += under * smoothstep( 0.35, 0.85, sNoise( vec2( u * 7.0, y * 0.35 ) ) ) * 0.9;
					// string course on stone buildings
					if ( layer == 2 ) col = mix( col, trimCol, sBandW( p.y, sill - 0.09, sill, cellFw.y ) * 0.8 );
				} else if ( style == 1 ) {
					// spandrel: dark back-painted glass between the floors
					float spandrel = 1.0 - sRectW( p, lo, hi, cellFw );
					col = mix( col, glassCol * 0.25 + wallCol * 0.15, spandrel );
					rough = mix( rough, 0.2, spandrel );
					f0 = mix( f0, glassF0, spandrel );
					nW = normalize( mix( nW, wn, spandrel ) );
				} else if ( style == 2 ) {
					// exposed frame: a slab edge and piers, a little proud
					float slab = sBandW( p.y, -0.01, 0.32, cellFw.y ) + sBandW( p.y, typ - 0.02, typ + 0.01, cellFw.y );
					col = mix( col, trimCol * 0.95, clamp( slab, 0.0, 1.0 ) * 0.7 );
				}

				Opening o;
				o.lo = lo; o.hi = hi;
				o.depth = style == 1 ? 0.03 : style == 2 ? 0.12 : 0.17;
				o.frameCol = frameCol;
				o.frameW = style == 1 ? 0.05 : 0.065;
				o.mullions = style == 1 ? 1.0 : style == 2 ? ( shape.r > 0.7 ? 2.0 : 1.0 ) : ( hD < 0.25 ? 1.0 : 0.0 );
				o.rail = style == 0 ? 0.52 : style == 2 ? 0.78 : 0.0;
				o.roomLo = vec2( -0.5 * bay, 0.0 );
				o.room = vec3( bay, typ - 0.25, style == 1 ? 7.0 : 4.2 );
				o.style = rs;
				o.lit = lit ? 1.0 : 0.0;
				o.lamp = lamp;
				o.use = ( cb.kind == 2 || style == 1 ) ? 1.0 : 0.0;
				o.f0 = glassF0;
				o.glassCol = glassCol;
				float g = facadeOpening( o, p, v, cellFw, t, wn, revealCol * 0.9, roomDetail, day, col, rough, nW, emis, f0 );
				grime *= 1.0 - g;

				// cornice, parapet and coping on the roof line
				if ( below < 2.0 ) {
					if ( style == 1 ) {
						// mechanical screen: louvres
						float louvre = step( 0.5, fract( y / 0.18 ) );
						col = mix( col, vec3( 0.1, 0.11, 0.12 ) * ( 0.7 + 0.5 * louvre ), smoothstep( 2.0, 1.8, below ) );
					} else {
						float coping = sBandW( below, -1.0, 0.14, cellFw.y );
						float cornice = style == 0 ? sBandW( below, 0.75, 1.3, cellFw.y ) : 0.0;
						float under = style == 0 ? sBandW( below, 1.3, 1.55, cellFw.y ) : 0.0;
						float dentil = cornice * step( 0.5, fract( u / 0.22 ) ) * sBandW( below, 1.12, 1.3, cellFw.y );
						col = mix( col, trimCol * 1.05, max( coping, cornice ) );
						col *= 1.0 - 0.5 * under - 0.3 * dentil;
						nW = normalize( mix( nW, normalize( wn + vec3( 0.0, below < 1.02 ? 1.2 : -1.2, 0.0 ) ), cornice * 0.8 ) );
						grime += 0.35 * sBandW( below, 0.14, 0.75, cellFw.y );
					}
				}
			} else {
				// ------------------------------------------------ ground floor
				vec2 p = vec2( bx, y );
				float shopW = bay * ( hB < 0.5 ? 1.0 : 2.0 );
				float sIx = floor( u / shopW + 0.5 );
				float sx = u - sIx * shopW;
				int shop = int( sIx );
				bool storefront = retail || groundT == 2.0;
				if ( storefront ) {
					float hs = sHash11( sIx * 1.37 + seed * 3.1 );
					float hs2 = sHash11( sIx * 2.71 + seed * 0.7 + 5.0 );
					float pier = 0.32;
					vec2 sp = vec2( sx, y );
					float signLo = groundH - 1.12;
					float signHi = groundH - 0.3;
					float glassTop = signLo - 0.08;
					bool lobby = groundT == 2.0;
					bool shut = !lobby && cityShutterClosed( cb.seed, shop );
					// bulkhead, piers, then the display glass
					col = mix( col, trimCol * 0.35, sBandW( y, -1.0, 0.5, cellFw.y ) );
					vec2 lo = vec2( -0.5 * shopW + pier, lobby ? 0.02 : 0.5 );
					vec2 hi = vec2( 0.5 * shopW - pier, glassTop );
					vec3 shopLamp = vec3( 1.0, 0.86, 0.66 ) * mix( 0.85, 1.2, hs2 ) * ( 0.16 + 0.5 * practical );
					if ( hs < 0.2 ) shopLamp = vec3( 0.85, 0.93, 1.05 ) * ( 0.18 + 0.55 * practical );
					float open = shut ? 0.0 : 1.0;
					if ( shut ) {
						// roll-down shutter over the whole opening, housing above
						float cover = sRectW( sp, lo - vec2( 0.05, 0.5 ), hi + vec2( 0.05, 0.02 ), cellFw );
						vec2 suv = vec2( sx, -y ) / 2.0 + hs * 5.0;
						vec3 st = textureGrad( uSurfAlbedo, vec3( suv, 4.0 ), tuvX * layerSize / 2.0, tuvY * layerSize / 2.0 ).rgb * uSurfInvMean[ 4 ];
						vec3 paint = hs2 < 0.5 ? vec3( 0.32, 0.33, 0.33 ) : hs2 < 0.75 ? vec3( 0.12, 0.2, 0.17 ) : vec3( 0.16, 0.19, 0.25 );
						vec3 shutterCol = paint * st;
						// tags: a little colour on some shutters
						float tag = smoothstep( 0.66, 0.7, sNoise( sp * vec2( 1.3, 2.2 ) + hs * 40.0 ) ) * step( 0.55, hs2 );
						shutterCol = mix( shutterCol, 0.4 * vec3( sHash11( hs * 9.0 ), sHash11( hs * 19.0 ), sHash11( hs * 29.0 ) ), tag );
						col = mix( col, shutterCol, cover );
						rough = mix( rough, 0.55, cover );
						nW = normalize( mix( nW, wn + vec3( 0.0, ( fract( y / 0.075 ) - 0.5 ) * 0.5, 0.0 ), cover ) );
						grime *= 1.0 - cover * 0.5;
					} else {
						Opening o;
						o.lo = lo; o.hi = hi;
						o.depth = 0.35;
						o.frameCol = hs < 0.5 ? vec3( 0.05 ) : vec3( 0.28, 0.2, 0.1 );
						o.frameW = 0.07;
						o.mullions = shopW > 5.0 ? 2.0 : 1.0;
						o.rail = 0.0;
						o.roomLo = vec2( -0.5 * shopW, 0.0 );
						o.room = vec3( shopW, glassTop + 0.4, 6.5 );
						o.style = vec4( 0.0, hs2, floor( hs * 5.99 ), hs );
						o.lit = lobby ? ( lit ? 1.0 : 0.5 ) : open;
						o.lamp = shopLamp;
						o.use = lobby ? 1.0 : 2.0;
						o.f0 = vec3( 0.05 );
						o.glassCol = glassCol;
						facadeOpening( o, sp, v, cellFw, t, wn, trimCol * 0.5, roomDetail, day, col, rough, nW, emis, f0 );
					}
					if ( !lobby ) {
						// sign fascia with abstract lettering, lit at dusk
						float fascia = sRectW( sp, vec2( -0.5 * shopW + pier * 0.5, signLo ), vec2( 0.5 * shopW - pier * 0.5, signHi ), cellFw );
						vec3 board = hs2 < 0.3 ? vec3( 0.02 ) : hs2 < 0.5 ? vec3( 0.02, 0.06, 0.04 ) : hs2 < 0.7 ? vec3( 0.03, 0.035, 0.07 ) : hs2 < 0.85 ? vec3( 0.1, 0.02, 0.02 ) : vec3( 0.6, 0.58, 0.55 );
						float hue = sHash11( hs * 77.0 + 1.0 );
						vec3 neon = hue < 0.2 ? vec3( 1.0, 0.25, 0.2 ) : hue < 0.38 ? vec3( 0.25, 0.85, 1.0 ) : hue < 0.55 ? vec3( 1.0, 0.72, 0.3 )
							: hue < 0.7 ? vec3( 0.95, 0.95, 0.9 ) : hue < 0.85 ? vec3( 1.0, 0.3, 0.75 ) : vec3( 0.4, 1.0, 0.45 );
						vec2 fp = sp - vec2( -0.5 * shopW + pier * 0.5, signLo );
						float letters = facadeGlyphs( fp, vec2( shopW - pier, signHi - signLo ), hs * 131.0 );
						bool lightbox = hs2 > 0.85;
						col = mix( col, board, fascia );
						col = mix( col, lightbox ? vec3( 0.05 ) : neon * 0.6, fascia * letters );
						rough = mix( rough, 0.35, fascia );
						nW = normalize( mix( nW, wn, fascia ) );
						float signOn = ( shut ? 0.35 : 1.0 ) * ( 0.12 + 2.6 * practical );
						vec3 glow = lightbox ? vec3( 0.95, 0.93, 0.85 ) * ( 1.0 - letters ) * 0.7 : neon * letters;
						emis += glow * fascia * signOn;
						grime *= 1.0 - fascia;

						// awning over the glass on some shops
						if ( hs2 > 0.35 && hs2 < 0.8 && !shut ) {
							float aLo = glassTop - 0.85;
							float awn = sRectW( sp, vec2( -0.5 * shopW + pier, aLo ), vec2( 0.5 * shopW - pier, glassTop + 0.02 ), cellFw );
							float ah = sHash11( hs * 51.0 );
							vec3 cloth = ah < 0.25 ? vec3( 0.32, 0.03, 0.03 ) : ah < 0.45 ? vec3( 0.02, 0.14, 0.06 ) : ah < 0.6 ? vec3( 0.02, 0.04, 0.14 )
								: ah < 0.75 ? vec3( 0.2, 0.02, 0.06 ) : ah < 0.9 ? vec3( 0.02, 0.02, 0.02 ) : vec3( 0.45, 0.3, 0.05 );
							if ( sHash11( hs * 63.0 ) < 0.3 ) cloth = mix( cloth, vec3( 0.7, 0.68, 0.62 ), step( 0.5, fract( sx / 0.5 ) ) );
							float slope = ( sp.y - aLo ) / 0.87;
							vec3 awnN = normalize( wn * 0.8 + vec3( 0.0, 1.0, 0.0 ) );
							float valance = sBandW( sp.y, aLo, aLo + 0.16, cellFw.y );
							col = mix( col, cloth * ( 0.75 + 0.35 * slope ) * ( 1.0 - 0.35 * valance ), awn );
							nW = normalize( mix( nW, mix( awnN, wn, valance ), awn ) );
							rough = mix( rough, 0.85, awn );
							emis *= 1.0 - awn;
							// the shadow it throws on the glass below
							float shade = sRectW( sp, vec2( -0.5 * shopW + pier, aLo - 0.7 ), vec2( 0.5 * shopW - pier, aLo ), cellFw );
							col *= 1.0 - 0.45 * shade * smoothstep( aLo - 0.7, aLo, sp.y );
							grime *= 1.0 - awn;
						}
					}
				} else {
					// base course: rusticated stone on masonry, plain elsewhere
					if ( style == 0 && layer >= 2 ) col *= 1.0 - 0.35 * ( 1.0 - sBandW( fract( y / 0.46 ), 0.05, 1.0, fw.y / 0.46 ) );
					// the entrance sits in the centre bay; garages and docks get a wide shutter
					bool wide = groundT == 1.0 || groundT == 7.0;
					bool entry = bIx == 0.0;
					if ( entry ) {
						vec2 lo = wide ? vec2( -1.7, 0.0 ) : vec2( -0.8, 0.0 );
						vec2 hi = wide ? vec2( 1.7, min( 3.2, groundH - 0.4 ) ) : vec2( 0.8, min( 2.7, groundH - 0.5 ) );
						if ( wide ) {
							float cover = sRectW( p, lo, hi, cellFw );
							vec3 st = textureGrad( uSurfAlbedo, vec3( vec2( u, -y ) / 2.0, 4.0 ), tuvX * layerSize / 2.0, tuvY * layerSize / 2.0 ).rgb * uSurfInvMean[ 4 ];
							col = mix( col, vec3( 0.3, 0.31, 0.3 ) * st, cover );
							rough = mix( rough, 0.55, cover );
						} else {
							Opening o;
							o.lo = lo; o.hi = hi;
							o.depth = 0.3;
							o.frameCol = groundT == 0.0 ? vec3( 0.12, 0.07, 0.04 ) : vec3( 0.05 );
							o.frameW = 0.08;
							o.mullions = 1.0;
							o.rail = 0.0;
							o.roomLo = vec2( -1.6, 0.0 );
							o.room = vec3( 3.2, groundH - 0.2, 5.0 );
							o.style = vec4( 0.0, 0.8, 2.0, hA );
							o.lit = 1.0;
							o.lamp = vec3( 1.0, 0.82, 0.58 ) * ( 0.2 + 0.9 * practical );
							o.use = 1.0;
							o.f0 = vec3( 0.05 );
							o.glassCol = glassCol;
							facadeOpening( o, p, v, cellFw, t, wn, trimCol * 0.8, roomDetail, day, col, rough, nW, emis, f0 );
							// hotel canopy / grand entry lintel
							if ( groundT == 5.0 || groundT == 3.0 ) {
								float canopy = sRectW( p, vec2( -1.8, hi.y + 0.1 ), vec2( 1.8, hi.y + 0.55 ), cellFw );
								col = mix( col, vec3( 0.02 ), canopy );
								emis += vec3( 1.0, 0.8, 0.45 ) * sBandW( p.y, hi.y + 0.1, hi.y + 0.16, cellFw.y ) * canopy * 3.0 * practical;
							}
						}
					} else if ( groundT == 4.0 ) {
						// construction hoarding: painted plywood with posters
						float hoard = sBandW( y, -1.0, 2.5, cellFw.y );
						vec3 ply = hA < 0.5 ? vec3( 0.06, 0.14, 0.08 ) : vec3( 0.12, 0.13, 0.16 );
						float posterI = floor( u / 1.3 );
						float poster = sRectW( vec2( fract( u / 1.3 ) * 1.3, y ), vec2( 0.15, 0.8 ), vec2( 1.15, 2.2 ), cellFw ) * step( 0.45, sHash11( posterI + seed ) );
						vec3 pc = 0.15 + 0.6 * vec3( sHash11( posterI * 3.1 ), sHash11( posterI * 5.7 ), sHash11( posterI * 7.3 ) );
						col = mix( col, mix( ply, pc, poster ), hoard );
						grime *= 1.0 - hoard * 0.7;
					} else {
						// ground-floor windows, barred on residential blocks
						float sill = 1.05;
						float head = min( groundH - 0.75, 3.0 );
						float hw = 0.5 * shape.r * bay;
						Opening o;
						o.lo = vec2( -hw, sill ); o.hi = vec2( hw, head );
						o.depth = 0.2;
						o.frameCol = frameCol;
						o.frameW = 0.065;
						o.mullions = 0.0;
						o.rail = 0.5;
						o.roomLo = vec2( -0.5 * bay, 0.0 );
						o.room = vec3( bay, groundH - 0.3, 4.5 );
						o.style = rs;
						o.lit = lit ? 1.0 : 0.0;
						o.lamp = lamp;
						o.use = cb.kind == 2 ? 1.0 : 0.0;
						o.f0 = glassF0;
						o.glassCol = glassCol;
						float g = facadeOpening( o, p, v, cellFw, t, wn, revealCol * 0.9, roomDetail, day, col, rough, nW, emis, f0 );
						if ( ( groundT == 9.0 || groundT == 11.0 ) && g > 0.0 ) {
							float bar = 1.0 - smoothstep( 0.012 - fw.x, 0.012 + fw.x, abs( fract( p.x / 0.13 ) - 0.5 ) * 0.13 );
							col = mix( col, vec3( 0.02 ), bar * g );
							emis *= 1.0 - bar * g;
							rough = mix( rough, 0.5, bar * g );
						}
					}
				}
			}
			detailCol = col;
		}

		// weathering over whatever the facade ended up being
		col *= 1.0 - clamp( grime, 0.0, 1.0 ) * 0.4 * ageK;
		rough = min( 1.0, rough + clamp( grime, 0.0, 1.0 ) * 0.06 * ageK );
		farCol *= 1.0 - clamp( 0.25 + 0.3 * sFbm( vec2( u * 0.3, y * 0.1 ) + hD * 30.0 ), 0.0, 1.0 ) * 0.4 * ageK;

		// ---- the far aggregate: palette + glass share, and at night the
		// expected lit share of the floor (then of the whole building once
		// the floors themselves are sub-pixel)
		vec3 aggGlass = glassCol * 0.3 + vec3( 0.02 );
		vec3 farMix = mix( farCol, aggGlass, winShare * 0.7 );
		float rowShare = cityRowLitShare( cb, row );
		float avgShare = cb.kind == 6 ? 0.0 : clamp( uCityOcc[ cb.kind ] * cb.density * cb.floorFill + 0.08 * step( 1e-4, uCityOcc[ cb.kind ] ), 0.0, 1.0 );
		float share = mix( avgShare, rowShare, 1.0 - smoothstep( 0.45, 1.1, cellPx ) );
		vec3 farEmis = cityLampColour( cb.kind, 0.0 ) * share * winShare * practical * 1.5;
		col = mix( farMix, col, detail );
		emis = mix( farEmis, emis, detail );
		rough = mix( mix( rough, 0.5, winShare * 0.6 ), rough, detail );
		nW = normalize( mix( wn, nW, max( detail, 0.35 ) ) );
		f0 = mix( mix( f0, mix( vec3( 0.05 ), glassCol * 0.45 + 0.05, props.b ), winShare ), f0, detail );

		// rain: a wet wall darkens and gains a sheen
		col *= 1.0 - 0.2 * wet;
		rough = mix( rough, rough * 0.55, wet );
	} else if ( n.y > 0.0 ) {
		// ======================================================== ROOF ====
		// Tar, gravel and silver-coated membranes, laid along Manhattan's
		// grid (29 degrees off true north), which is what the island reads as
		// from the air.
		vec3 rt = textureGrad( uSurfAlbedo, vec3( ruv, 5.0 ), ruvX, ruvY ).rgb * uSurfInvMean[ 5 ];
		vec3 roofCol = hD < 0.34 ? vec3( 0.34, 0.34, 0.33 ) : hD < 0.7 ? vec3( 0.045, 0.045, 0.05 )
			: hD < 0.93 ? vec3( 0.19, 0.17, 0.14 ) : vec3( 0.07, 0.1, 0.045 );
		float rr = hD < 0.34 ? 0.5 : 0.9;
		col = roofCol * mix( vec3( 1.0 ), rt, 0.75 );
		vec2 grid = vec2( dot( vWorld.xz, vec2( 0.875, 0.485 ) ), dot( vWorld.xz, vec2( 0.485, -0.875 ) ) );
		float seam = 1.0 - sBandW( fract( grid.x / 1.0 ), 0.03, 0.97, max( fw.x, 0.002 ) );
		col *= 1.0 - 0.3 * seam * step( hD, 0.7 );
		col *= 0.8 + 0.4 * sFbm( grid * 0.07 + seed );
		// soot and patching, heavier on old roofs
		col *= 1.0 - 0.25 * age * smoothstep( 0.5, 0.8, sNoise( grid * 0.15 + hC * 20.0 ) );
		rough = rr;
#if SURFACE_Q > 0
		vec4 td = textureGrad( uSurfData, vec3( ruv, 5.0 ), ruvX, ruvY );
		vec3 nT = sUnpackNormal( td.rg, 0.6 * ( 1.0 - smoothstep( 60.0, 400.0, viewDist ) ) );
		nW = normalize( vec3( nT.x, nT.z, -nT.y ) );
#endif
		// standing water on flat roofs
		float pond = smoothstep( 0.55, 0.7, sFbm( grid * 0.12 + seed * 0.3 ) ) * wet;
		col *= 1.0 - 0.25 * wet - 0.3 * pond;
		rough = mix( rough, 0.05, pond );
		rough = mix( rough, rough * 0.6, wet );
		nW = normalize( mix( nW, vec3( 0.0, 1.0, 0.0 ), pond ) );
	} else {
		// soffits, undersides of overhangs
		col = wallCol * 0.45;
	}

	diffuseColor.rgb = col;
	fRough = rough;
	fNormalW = nW;
	fEmissive = emis;
	fF0 = f0;
}
`

export class FacadeMaterial {
  constructor(city) {
    this.city = city
    const materials = (city && city.meta.materials) || DEFAULT_MATERIALS
    this.buildings = packBuildings(city, materials.length)
    this.geometry = packGeometry(city)
    this.palette = packPalette(materials)
    ensureSurfaceTextures()

    this.uniforms = {
      uBuildings: { value: this.buildings },
      uBuildingsB: { value: this.geometry },
      uPalette: { value: this.palette },
      uTexSize: { value: TEX },
      uDetailFade: { value: 1.0 },
      uGroundLevel: { value: (city && city.meta.land_level_m) ?? 12.0 },
      // kept for API compatibility; the ramp now comes from the shared
      // practicals curve in cityLightingUniforms
      uNight: { value: 0.0 },
    }

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.0,
    })
    this.material.name = 'city-facade'
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms)
      for (const [name, uniform] of Object.entries(cityLightingUniforms)) {
        shader.uniforms[name] = uniform
      }
      attachSurfaceUniforms(shader)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
        .replace('#include <begin_vertex>',
          `#include <begin_vertex>\n${VERT_BODY}`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FACADE_FRAG_HEAD}`)
        .replace('#include <color_fragment>',
          `#include <color_fragment>\n${FACADE_FRAG_BODY}`)
        .replace('#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
        .replace('#include <metalnessmap_fragment>',
          '#include <metalnessmap_fragment>\nmetalnessFactor = 0.0;')
        .replace('#include <normal_fragment_maps>',
          '#include <normal_fragment_maps>\nnormal = normalize( ( viewMatrix * vec4( fNormalW, 0.0 ) ).xyz );')
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmissive;')
        .replace('#include <lights_physical_fragment>',
          '#include <lights_physical_fragment>\nmaterial.specularColor = fF0;\nmaterial.specularColorBlended = fF0;')
      this.shader = shader
    }
    // three caches programs by a key built from the material's defines; a
    // distinct name keeps this from colliding with a plain standard material
    this.material.customProgramCacheKey = () => 'manhattan-facade-v2'
    registerSurfaceMaterial(this.material)
  }

  setNight(v) { this.uniforms.uNight.value = v }
  setDetail(v) { this.uniforms.uDetailFade.value = v }

  // Hide specific buildings, by id, everywhere they appear -- every tile and
  // every LOD tier at once, because they all read the same texture. Used
  // where authored geometry stands on a registry lot; see hq.js.
  suppress(bids) {
    const data = this.buildings.image.data
    if (!this._floors) this._floors = new Map()
    for (const bid of bids) {
      if (!(bid >= 0 && bid < TEX * TEX)) continue
      const o = bid * 4 + 1
      if (!this._floors.has(bid)) this._floors.set(bid, data[o])
      data[o] = 0
    }
    this.buildings.needsUpdate = true
    return this._floors.size
  }

  isSuppressed(bid) {
    return !!(this._floors && this._floors.has(bid))
  }

  // The collapse hides a building on the GPU and leaves its triangles in the
  // CPU geometry, so it stays solid to the walk collider and still answers
  // the building inspector. An invisible wall is worse than a visible one.
  // Everything that raycasts tile geometry runs its hits through here.
  hitSuppressed(hit) {
    if (!this._floors || !this._floors.size || !hit || !hit.face) return false
    const a = hit.object.geometry.attributes._bid ||
              hit.object.geometry.attributes._BID
    if (!a) return false
    // Draco quantises _BID, so it comes back as 34686.0039, not 34686. The
    // shader survives that -- it lands in the same nearest-filtered texel --
    // but a Map lookup does not.
    return this._floors.has(Math.round(a.getX(hit.face.a)))
  }

  unsuppress() {
    if (!this._floors) return 0
    const data = this.buildings.image.data
    for (const [bid, floors] of this._floors) data[bid * 4 + 1] = floors
    const n = this._floors.size
    this._floors.clear()
    this.buildings.needsUpdate = true
    return n
  }

  dispose() {
    unregisterSurfaceMaterial(this.material)
    this.buildings.dispose()
    this.geometry.dispose()
    this.palette.dispose()
    this.material.dispose()
  }
}
