// facade.js — procedural building facades, evaluated in the fragment shader.
//
// Why in the shader and not in the mesh: 56,476 buildings with real window
// geometry is tens of millions of triangles, and baking a texture atlas means
// re-exporting the whole city every time the classifier changes its mind. The
// glb already carries _BID per vertex, so instead the shader looks each
// building up in a data texture and derives its facade from world position.
//
//   _BID -> data texture -> material family, floors, ground-floor type, seed
//   world position + face normal -> floor index, bay index
//   material family -> palette
//
// Cost is one texture fetch and some arithmetic per fragment. Triangle count
// is unchanged, so this works at every LOD including the far ones.
//
// The one thing it cannot do is silhouette: setbacks, cornice depth and window
// reveals are shading, not geometry. Those belong in the L0 mesh when the
// per-LOD export lands.

import * as THREE from 'three'

const TEX = 256 // data texture is TEX x TEX, so it holds TEX^2 buildings

// Per material family:
//   [wall colour, trim colour, glass colour, window width, window height]
// The window ratios are the fraction of a bay and of a floor that the opening
// takes. They matter more than the colours do: a masonry tenement is mostly
// wall with punched openings, a curtain-wall tower is mostly glass, and
// getting that ratio wrong makes every building read as the same thing.
// Sampled off real Manhattan stock rather than picked by eye. NYC common brick
// is a muted brown-red around #8d6a5c, not the fire-engine red a naive palette
// lands on -- the first pass turned half the island crimson from the air.
const PALETTE = {
  brick_dark: [0x6f5c50, 0x7e6a5d, 0x2b3138, 0.42, 0.46],
  brick_institutional: [0x9d8271, 0xb09585, 0x39424c, 0.36, 0.44],
  brick_red: [0x8d6a5c, 0xa08476, 0x323a44, 0.40, 0.46],
  brownstone: [0x8a6a56, 0x9c7f6b, 0x2f3640, 0.36, 0.48],
  buff_brick: [0xc4b39a, 0xd6c9b5, 0x39414c, 0.40, 0.46],
  cast_iron: [0x8c9490, 0xa2aaa6, 0x2c343c, 0.66, 0.62],
  concrete_grid: [0xaeada8, 0xc1c0bb, 0x39434f, 0.62, 0.52],
  concrete_open: [0xa3a29e, 0xb6b5b1, 0x22262b, 0.86, 0.72],
  curtain_glass: [0x74848f, 0x93a3ae, 0x3d6376, 0.90, 0.84],
  glass_stone: [0x9aa2a8, 0xb8c0c5, 0x436a7e, 0.76, 0.70],
  limestone: [0xd2cbba, 0xe2dcce, 0x3a4049, 0.38, 0.46],
  mixed_panel: [0xa2a6ab, 0xb8bcc1, 0x36414c, 0.62, 0.56],
  scaffold: [0x94897a, 0xa69c8e, 0x4a4a48, 0.28, 0.34],
  steel_shed: [0x8a9196, 0xa1a8ad, 0x333c42, 0.30, 0.34],
  stone_gothic: [0xafab9d, 0xc2beb1, 0x2c3138, 0.30, 0.58],
  white_brick: [0xdedbd3, 0xebe9e3, 0x3c454f, 0.44, 0.48],
}

const FALLBACK = [0xa0a5ac, 0xb6bbc2, 0x36414c, 0.44, 0.48]

function packPalette(materials) {
  // four float32 rows: wall rgb, trim rgb, glass rgb, and (winW, winH) in
  // the red and green channels of the fourth
  const n = materials.length
  const data = new Float32Array(n * 4 * 4)
  materials.forEach((m, i) => {
    const p = PALETTE[m] || FALLBACK
    const put = (slot, hex) => {
      const c = new THREE.Color(hex).convertSRGBToLinear()
      const o = (slot * n + i) * 4
      data[o] = c.r; data[o + 1] = c.g; data[o + 2] = c.b; data[o + 3] = 1
    }
    put(0, p[0]); put(1, p[1]); put(2, p[2])
    const o = (3 * n + i) * 4
    data[o] = p[3]
    data[o + 1] = p[4]
  })
  const tex = new THREE.DataTexture(data, n, 4, THREE.RGBAFormat,
    THREE.FloatType)
  tex.needsUpdate = true
  tex.minFilter = tex.magFilter = THREE.NearestFilter
  return tex
}

// R = material index, G = floors, B = ground-floor index, A = per-building seed
function packBuildings(city) {
  const data = new Uint8Array(TEX * TEX * 4)
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
  const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat,
    THREE.UnsignedByteType)
  tex.needsUpdate = true
  tex.minFilter = tex.magFilter = THREE.NearestFilter
  return tex
}

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

const FRAG_HEAD = /* glsl */`
uniform sampler2D uBuildings;
uniform sampler2D uPalette;
uniform float uMaterialCount;
uniform float uTexSize;
uniform float uNight;
uniform float uDetailFade;
uniform float uDetailNear;
uniform float uDetailFar;
uniform float uGroundLevel;
uniform vec3 uSkyColor;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vBid;

vec4 paletteRow(float slot, float mat) {
  float u = (mat + 0.5) / uMaterialCount;
  float v = (slot + 0.5) / 4.0;
  return texture2D(uPalette, vec2(u, v));
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  return fract(p * (p + p));
}

// A soft-edged rectangle. A hard step() aliases badly on a facade seen at a
// grazing angle, which is most of the city most of the time; fwidth gives one
// pixel of falloff and costs nothing.
float band(float x, float a, float b) {
  float w = max(fwidth(x), 1e-5);
  return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
}
`

// Runs after three has folded COLOR_0 into diffuseColor. The palette is the
// authority on colour; COLOR_0 is kept only as a light per-building tint, so
// that two brick tenements side by side are not identical. Multiplying the two
// together directly is what made the first version near-black: both are dark,
// and 0.3 * 0.3 is 0.09.
const FRAG_BODY = /* glsl */`
{
  float bid = max(vBid, 0.0);
  float bx = mod(bid, uTexSize);
  float by = floor(bid / uTexSize);
  vec4 info = texture2D(uBuildings,
    vec2((bx + 0.5) / uTexSize, (by + 0.5) / uTexSize));

  float matIx  = floor(info.r * 255.0 + 0.5);
  float floors = max(1.0, floor(info.g * 255.0 + 0.5));
  float ground = floor(info.b * 255.0 + 0.5);
  float seed   = info.a * 255.0;

  vec3 wallCol  = paletteRow(0.0, matIx).rgb;
  vec3 trimCol  = paletteRow(1.0, matIx).rgb;
  vec3 glassCol = paletteRow(2.0, matIx).rgb;
  vec4 ratios   = paletteRow(3.0, matIx);
  float winW = ratios.r;
  float winH = ratios.g;

  // COLOR_0 as a +-8% tint, not as a multiplier
  float tint = clamp(dot(diffuseColor.rgb, vec3(0.333)), 0.0, 1.0);
  vec3 col = wallCol * (0.92 + tint * 0.16);
  col *= 0.95 + hash11(seed + 3.0) * 0.10;

  // Facade detail fades out with distance. Without this the window grid
  // aliases into per-pixel speckle across the skyline, which is exactly the
  // artefact the Phase 1 renders were criticised for.
  float viewDist = length(vWorld - cameraPosition);
  float detail = uDetailFade *
    (1.0 - smoothstep(uDetailNear, uDetailFar, viewDist));

  float up = abs(vNrm.y);

  if (up < 0.7) {
    // ---- wall ------------------------------------------------------------
    // Horizontal run along the wall. This is a box mapping rather than a real
    // unwrap, but a building wall is a vertical plane, so for walls it is
    // exact. Pick the axis the face is *not* facing.
    float run = mix(vWorld.x, vWorld.z, step(abs(vNrm.z), abs(vNrm.x)));

    // Height above the *street*, not above the mesh origin. The land plane
    // sits at uGroundLevel and buildings extrude from 0, so without this the
    // whole ground-floor band is underground and the floor lines do not line
    // up with the pavement.
    float floorH = 3.4;
    float y = max(vWorld.y - uGroundLevel, 0.0);
    float fIx = floor(y / floorH);
    float fFrac = fract(y / floorH);

    float bay = 3.1 + hash11(seed) * 1.0;
    float bIx = floor(run / bay);
    float bFrac = fract(run / bay);

    if (detail > 0.002) {
      // spandrel / floor line, always present -- it is what gives a facade
      // its horizontal rhythm at a distance
      float line = band(fFrac, 0.0, 0.06);
      col = mix(col, trimCol * 0.72, line * 0.45 * detail);

      // vertical pier between bays, strong on masonry, weak on glass
      float pier = 1.0 - band(bFrac, 0.10, 0.90);
      col = mix(col, trimCol * 0.86, pier * 0.22 * (1.0 - winH) * detail);

      // punched opening
      float inW = band(bFrac, 0.5 - winW * 0.5, 0.5 + winW * 0.5);
      float inH = band(fFrac, 0.22, 0.22 + winH * 0.72);
      float win = inW * inH;

      // ---- ground floor --------------------------------------------------
      // A storefront is not just a bigger window. It is a bulkhead at the
      // pavement, a run of glass, and a sign fascia above -- that stack is
      // what makes a street read as a street. Without it the base of every
      // building was a single bright blue band.
      bool retail = (ground == 12.0 || ground == 13.0 || ground == 14.0);
      float groundH = floorH * 1.45;
      float storefront = 0.0;
      if (y < groundH) {
        float gf = y / groundH;                 // 0 at pavement, 1 at fascia
        col = mix(col, trimCol * 0.88, 0.28);
        if (retail) {
          storefront = band(bFrac, 0.05, 0.95) * band(gf, 0.17, 0.74);
          // sign fascia
          col = mix(col, trimCol * 0.55, band(gf, 0.78, 0.97) * 0.85);
          // bulkhead below the glass
          col = mix(col, wallCol * 0.55, band(gf, 0.0, 0.15) * 0.9);
          win = 0.0;
        } else {
          // a residential or office entrance: one wider opening per bay,
          // shorter than a shopfront
          storefront = band(bFrac, 0.22, 0.78) * band(gf, 0.14, 0.62);
          win = 0.0;
        }
      }

      // reveal: a thin darker frame just outside the glass reads as depth
      float frameW = band(bFrac, 0.5 - winW * 0.62, 0.5 + winW * 0.62);
      float frameH = band(fFrac, 0.17, 0.17 + winH * 0.86);
      col = mix(col, wallCol * 0.62, max(frameW * frameH - win, 0.0) * detail);

      // Glass. By day it is dark but picks up the sky at grazing angles,
      // which is most of what makes a window look like glass rather than a
      // black rectangle. By night a random subset is lit.
      vec3 viewDir = normalize(vWorld - cameraPosition);
      float fres = pow(1.0 - abs(dot(viewDir, normalize(vNrm))), 4.0);
      vec3 dayGlass = mix(glassCol, uSkyColor, 0.14 + fres * 0.38);
      float lit = step(0.58, hash11(fIx * 31.7 + bIx * 7.3 + seed));
      vec3 nightGlass = mix(glassCol * 0.30, vec3(1.0, 0.84, 0.58), lit);
      col = mix(col, mix(dayGlass, nightGlass, uNight), win * detail);

      // Shop glass is recessed and full of dark interior, so it reflects the
      // sky far less than an upper-floor window does.
      if (storefront > 0.0) {
        vec3 shopDay = mix(glassCol * 0.55, uSkyColor, 0.10 + fres * 0.16);
        vec3 shopNight = mix(vec3(0.95, 0.80, 0.55), glassCol,
          step(0.35, hash11(bIx * 5.1 + seed)));
        col = mix(col, mix(shopDay, shopNight, uNight), storefront * detail);
      }

      // cornice band on the top floor
      float topF = floors - 1.0;
      float cornice = band(fIx, topF - 0.5, topF + 0.5) * band(fFrac, 0.70, 1.0);
      col = mix(col, trimCol * 1.15, cornice * 0.7 * detail);
    }
  } else {
    // ---- roof ------------------------------------------------------------
    // Roofs in Manhattan are tar, gravel and mechanical plant, not the wall
    // material. Keeping them dark is what makes the skyline read from above.
    col = mix(wallCol, vec3(0.20, 0.20, 0.21), 0.78);
    float g = fract(vWorld.x * 0.10 + hash11(seed));
    float g2 = fract(vWorld.z * 0.10 + hash11(seed + 1.0));
    col *= 0.90 + 0.18 * abs(g - g2);
  }

  diffuseColor.rgb = col;
}
`

export class FacadeMaterial {
  constructor(city) {
    this.city = city
    this.buildings = packBuildings(city)
    this.palette = packPalette(city.meta.materials || Object.keys(PALETTE))

    this.uniforms = {
      uBuildings: { value: this.buildings },
      uPalette: { value: this.palette },
      uMaterialCount: {
        value: (city.meta.materials || Object.keys(PALETTE)).length,
      },
      uTexSize: { value: TEX },
      uNight: { value: 0.0 },
      uDetailFade: { value: 1.0 },
      // A 3.2 m window is under a pixel past roughly 1.5 km at a 62 degree
      // field of view on a 1080-wide canvas, so that is where the grid stops
      // carrying information and starts producing speckle.
      uDetailNear: { value: 900.0 },
      uDetailFar: { value: 2400.0 },
      uSkyColor: { value: new THREE.Color(0x8fb6dd).convertSRGBToLinear() },
      uGroundLevel: { value: city.meta.land_level_m ?? 12.0 },
    }

    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      color: 0xffffff,
    })
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
        .replace('#include <begin_vertex>',
          `#include <begin_vertex>\n${VERT_BODY}`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
        .replace('#include <color_fragment>',
          `#include <color_fragment>\n${FRAG_BODY}`)
      this.shader = shader
    }
    // three caches programs by a key built from the material's defines; a
    // distinct name keeps this from colliding with a plain Lambert
    this.material.customProgramCacheKey = () => 'manhattan-facade-v1'
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
    this.buildings.dispose()
    this.palette.dispose()
    this.material.dispose()
  }
}
