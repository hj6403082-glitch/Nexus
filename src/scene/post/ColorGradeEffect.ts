import { BlendFunction, Effect } from 'postprocessing';
import * as THREE from 'three';
import { GREY_PIVOT, type WorldGrade } from '@/core/constants/worlds';

/**
 * THE CINEMATIC COLOUR GRADE (Phase 6).
 *
 * Applied after bloom, before the vignette. Four things happen here and the
 * order matters:
 *
 *   1. SPLIT THE ENDS OF THE RAMP. The scene is lit in blue, and a blue
 *      luminance ramp is the most boring image a renderer can produce: every
 *      pixel has the same hue, only the brightness differs. Violet goes into
 *      the shadows, warm white into the highlights, and — critically — the
 *      MID-TONES ARE LEFT ALONE. Grading the mid-tones is what makes graded
 *      footage look graded. Leaving them is what makes it look shot.
 *
 *   2. FILMIC CONTRAST PIVOTING AT 18% GREY. Not at 0.5. Pivoting at 0.5
 *      drags the mid-tones the split just protected; pivoting at 18% grey
 *      deepens the shadows and extends the highlights around them.
 *
 *   3. Saturation and warmth last, so the world's identity is applied to a
 *      picture that is already correctly shaped.
 *
 * HALATION IS NOT HERE. It reads neighbouring texels, which makes it a
 * convolution, and a convolution cannot share a pass with anything else — see
 * HalationEffect for what happened when it did.
 */
const fragment = /* glsl */ `
uniform vec3  uShadowTint;
uniform vec3  uHighlightTint;
uniform float uSplit;
uniform float uContrast;
uniform float uWarmth;
uniform float uSaturation;
uniform float uVignette;

const float PIVOT = ${GREY_PIVOT.toFixed(3)};

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;

  // ---- 1. split-tone the ends of the ramp, leave the mid-tones -----------
  float l = luma(c);
  // Shadow weight falls to zero by mid-grey; highlight weight starts there.
  // The gap between them IS the protected mid-tone band.
  float shadowW    = 1.0 - smoothstep(0.0, 0.42, l);
  float highlightW = smoothstep(0.58, 1.0, l);

  c = mix(c, c + uShadowTint * l, shadowW * uSplit);
  c = mix(c, c * uHighlightTint, highlightW * uSplit);

  // ---- 2. filmic contrast, pivoting at 18% grey ---------------------------
  c = max(vec3(0.0), (c - PIVOT) * uContrast + PIVOT);

  // ---- 3. warmth and saturation ------------------------------------------
  c.r *= 1.0 + uWarmth * 0.22;
  c.b *= 1.0 - uWarmth * 0.22;

  /**
   * SATURATION, AND THE CLAMP THAT MUST FOLLOW IT.
   *
   * Mixing toward grey with a factor above 1 extrapolates AWAY from grey, and
   * for a strongly saturated colour that drives the WEAKEST channel BELOW ZERO.
   * Cyan type on a dark card is the worst case: its red channel is already
   * near nothing, and at saturation 1.10 it lands at about -0.035.
   *
   * A negative channel survives everything downstream until the final sRGB
   * encode, where pow(negative, 1/2.2) is NaN — and a NaN pixel renders as a
   * hole. The symptom was that bright saturated type and thin accent lines
   * were ERASED from the card faces while the duller white text survived,
   * worst in the worlds with the highest saturation.
   *
   * Same family as safePow in core/math/util.ts: never hand a negative base
   * to a fractional power. Clamp at the source.
   */
  float greyLevel = luma(c);
  c = max(vec3(0.0), mix(vec3(greyLevel), c, uSaturation));

  // Vignette last. Phase 7 releases most of it while embodied: at full
  // strength it crops a bust that fills the frame into a black oval.
  float v = 1.0 - uVignette * smoothstep(0.35, 1.0, length(uv - 0.5) * 1.42);
  c *= v;

  // Belt to the braces above: nothing leaves this effect negative.
  outputColor = vec4(max(c, vec3(0.0)), inputColor.a);
}
`;

export class ColorGradeEffect extends Effect {
  constructor(grade: WorldGrade) {
    super('ColorGradeEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uShadowTint', new THREE.Uniform(new THREE.Vector3(...grade.shadowTint))],
        ['uHighlightTint', new THREE.Uniform(new THREE.Vector3(...grade.highlightTint))],
        ['uSplit', new THREE.Uniform(grade.split)],
        ['uContrast', new THREE.Uniform(grade.contrast)],
        ['uWarmth', new THREE.Uniform(grade.warmth)],
        ['uSaturation', new THREE.Uniform(grade.saturation)],
        ['uVignette', new THREE.Uniform(0.55)],
      ]),
    });
  }

  apply(grade: WorldGrade, vignette: number): void {
    const u = this.uniforms;
    (u.get('uShadowTint')!.value as THREE.Vector3).set(...grade.shadowTint);
    (u.get('uHighlightTint')!.value as THREE.Vector3).set(...grade.highlightTint);
    u.get('uSplit')!.value = grade.split;
    u.get('uContrast')!.value = grade.contrast;
    u.get('uWarmth')!.value = grade.warmth;
    u.get('uSaturation')!.value = grade.saturation;
    u.get('uVignette')!.value = vignette;
  }
}
