import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';

/**
 * HALATION — bright areas bleeding into their neighbours with a warm bias, the
 * way light scatters between the layers of a real lens.
 *
 * This is a SEPARATE EFFECT from the colour grade, and it must be, because it
 * READS NEIGHBOURING TEXELS. An effect that samples `inputBuffer` at an offset
 * has to declare `EffectAttribute.CONVOLUTION`, which forces `postprocessing`
 * to give it its own pass so the buffer it reads is not the buffer it is
 * writing.
 *
 * Merged into the grade without that attribute, it read and wrote the same
 * target in one pass — undefined behaviour, and the driver's answer was a
 * directional feedback that ATE thin bright features. The symptom was not a
 * wrong colour: the headline figure and the sparkline on a focused card were
 * progressively erased from one side, while the duller body text survived. It
 * looked like a canvas bug for a long time, because the pixels were perfect
 * right up until they reached the composer.
 */
const fragment = /* glsl */ `
uniform float uHalation;
uniform vec2  uTexel;

float halationLuma(const in vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uHalation < 0.001) {
    outputColor = inputColor;
    return;
  }

  // Two rings of taps. One ring alone bands visibly on a soft gradient; two
  // at different radii is enough to read as scatter rather than as a stencil.
  vec3 bleed = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853981;
    vec2 dir = vec2(cos(a), sin(a));
    bleed += texture2D(inputBuffer, uv + dir * uTexel * 3.0).rgb;
    bleed += texture2D(inputBuffer, uv + dir * uTexel * 7.0).rgb;
  }
  bleed /= 16.0;

  float bright = smoothstep(0.55, 1.0, halationLuma(bleed));
  outputColor = vec4(
    inputColor.rgb + bleed * bright * uHalation * vec3(1.0, 0.72, 0.55),
    inputColor.a
  );
}
`;

export class HalationEffect extends Effect {
  constructor(halation = 0.2) {
    super('HalationEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      // Without this, the effect is merged into a pass that reads and writes
      // the same buffer. See the note above.
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uHalation', new THREE.Uniform(halation)],
        ['uTexel', new THREE.Uniform(new THREE.Vector2(1 / 1920, 1 / 1080))],
      ]),
    });
  }

  set amount(value: number) {
    this.uniforms.get('uHalation')!.value = value;
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.get('uTexel')!.value as THREE.Vector2).set(1 / width, 1 / height);
  }
}
