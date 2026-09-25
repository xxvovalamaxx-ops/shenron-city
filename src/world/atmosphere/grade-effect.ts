/**
 * The cinematic grade: runs after tone mapping, on display-referred colour.
 *
 *   - contrast and a lift / gamma / gain (ASC-CDL style) curve;
 *   - a teal-orange split tone: cool shadows, warm highlights — the look
 *     almost every modern open-world game is graded with, kept subtle here;
 *   - saturation;
 *   - very light film grain, luminance-weighted so it lives in the mid-tones
 *     and never sparkles in the sky.
 *
 * The parameters are driven per frame from the atmosphere (a warmer, lifted
 * grade at golden hour; bluer shadows and more contrast at night), see
 * `gradeFor` in grade.ts.
 */
import * as THREE from 'three'
import { BlendFunction, Effect } from 'postprocessing'

const FRAGMENT = /* glsl */ `
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uSplit;
uniform float uContrast;
uniform float uSaturation;
uniform float uGrain;
uniform float uSeed;

float gradeHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}

void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
	// Grade in a roughly perceptual space (gamma 2), then return to linear.
	vec3 g = sqrt( clamp( inputColor.rgb, 0.0, 1.0 ) );

	g = ( g - 0.5 ) * uContrast + 0.5;
	g = g * uGain + uLift * ( 1.0 - g );
	g = pow( max( g, 0.0 ), 1.0 / uGamma );

	float l = dot( g, vec3( 0.2126, 0.7152, 0.0722 ) );
	float hi = smoothstep( 0.18, 0.85, l );
	g += uSplit * ( ( 1.0 - hi ) * uShadowTint + hi * uHighlightTint );

	l = dot( g, vec3( 0.2126, 0.7152, 0.0722 ) );
	g = mix( vec3( l ), g, uSaturation );

	float n = gradeHash( gl_FragCoord.xy + uSeed * 97.0 ) - 0.5;
	g += n * uGrain * ( 1.0 - abs( l * 2.0 - 1.0 ) * 0.7 );

	g = clamp( g, 0.0, 1.0 );
	outputColor = vec4( g * g, inputColor.a );
}
`

export interface GradeParams {
  lift: [number, number, number]
  gamma: [number, number, number]
  gain: [number, number, number]
  shadowTint: [number, number, number]
  highlightTint: [number, number, number]
  split: number
  contrast: number
  saturation: number
  grain: number
}

export class CinematicGradeEffect extends Effect {
  /** Frozen captures keep the grain still so repeated shots are identical. */
  animateGrain = true
  private time = 0

  constructor() {
    super('CinematicGradeEffect', FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uLift', new THREE.Uniform(new THREE.Vector3(0, 0, 0))],
        ['uGamma', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uGain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uShadowTint', new THREE.Uniform(new THREE.Vector3(-0.02, 0.005, 0.03))],
        ['uHighlightTint', new THREE.Uniform(new THREE.Vector3(0.03, 0.01, -0.025))],
        ['uSplit', new THREE.Uniform(1)],
        ['uContrast', new THREE.Uniform(1.05)],
        ['uSaturation', new THREE.Uniform(1.08)],
        ['uGrain', new THREE.Uniform(0.018)],
        ['uSeed', new THREE.Uniform(0)],
      ]),
    })
  }

  setParams(p: GradeParams): void {
    const u = this.uniforms
    ;(u.get('uLift')!.value as THREE.Vector3).fromArray(p.lift)
    ;(u.get('uGamma')!.value as THREE.Vector3).fromArray(p.gamma)
    ;(u.get('uGain')!.value as THREE.Vector3).fromArray(p.gain)
    ;(u.get('uShadowTint')!.value as THREE.Vector3).fromArray(p.shadowTint)
    ;(u.get('uHighlightTint')!.value as THREE.Vector3).fromArray(p.highlightTint)
    u.get('uSplit')!.value = p.split
    u.get('uContrast')!.value = p.contrast
    u.get('uSaturation')!.value = p.saturation
    u.get('uGrain')!.value = p.grain
  }

  override update(_renderer: THREE.WebGLRenderer, _input: THREE.WebGLRenderTarget, deltaTime?: number): void {
    if (!this.animateGrain) return
    this.time += deltaTime ?? 0
    // Step the grain at 24 fps like film, not at the display rate.
    this.uniforms.get('uSeed')!.value = Math.floor(this.time * 24) % 1000
  }
}
