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
 *   3. HALATION. Bright areas bleed into their neighbours with a warm bias,
 *      the way light scatters in a real lens stack. This is what stops the
 *      bloom reading as a post-process and starts it reading as glass.
 *
 *   4. Saturation and warmth last, so the world's identity is applied to a
 *      picture that is already correctly shaped.
 */
const fragment = /* glsl */ `
uniform vec3  uShadowTint;
uniform vec3  uHighlightTint;
uniform float uSplit;
uniform float uContrast;
uniform float uWarmth;
uniform float uHalation;
uniform float uSaturation;
uniform float uVignette;
uniform vec2  uTexel;

const float PIVOT = ${GREY_PIVOT.toFixed(3)};

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;

  // ---- 3. halation (sampled first; it needs the ungraded neighbourhood) ----
  if (uHalation > 0.001) {
    vec3 bleed = vec3(0.0);
    // A cheap 8-tap ring. A full gaussian here is invisible next to the bloom
    // pass that already ran; what matters is the WARM BIAS, not the kernel.
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853981;
      vec2 o = vec2(cos(a), sin(a)) * uTexel * 3.0;
      bleed += texture2D(inputBuffer, uv + o).rgb;
    }
    bleed /= 8.0;
    float bright = smoothstep(0.55, 1.0, luma(bleed));
    c += bleed * bright * uHalation * vec3(1.0, 0.72, 0.55);
  }

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

  // ---- 4. warmth and saturation ------------------------------------------
  c.r *= 1.0 + uWarmth * 0.22;
  c.b *= 1.0 - uWarmth * 0.22;

  float gl = luma(c);
  c = mix(vec3(gl), c, uSaturation);

  // Vignette last. Phase 7 releases most of it while embodied: at full
  // strength it crops a bust that fills the frame into a black oval.
  float v = 1.0 - uVignette * smoothstep(0.35, 1.0, length(uv - 0.5) * 1.42);
  c *= v;

  outputColor = vec4(c, inputColor.a);
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
        ['uHalation', new THREE.Uniform(grade.halation)],
        ['uSaturation', new THREE.Uniform(grade.saturation)],
        ['uVignette', new THREE.Uniform(0.55)],
        ['uTexel', new THREE.Uniform(new THREE.Vector2(1 / 1920, 1 / 1080))],
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
    u.get('uHalation')!.value = grade.halation;
    u.get('uSaturation')!.value = grade.saturation;
    u.get('uVignette')!.value = vignette;
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.get('uTexel')!.value as THREE.Vector2).set(1 / width, 1 / height);
  }
}
