import * as THREE from 'three';
import { GOLD, GOLD_RULES } from '@/core/constants/palette';

/**
 * The card frame: animated border, energy pulse on select, and the gold term.
 *
 * The gold rules from `palette.ts` are enforced HERE, in the only place that
 * can break them:
 *
 *   - `uGold` arrives already gated on the warning flag (CPU side), so there
 *     is no path by which a warned card renders gold.
 *   - The gold contribution is mixed in at INTENSITY_RATIO, i.e. dimmer than
 *     the blue it replaces. The temptation is `border * 1.4` to make the
 *     centred card pop; that clips R and G and the gold resolves to white.
 *     Prominence is bought with hue and with a wider outer falloff instead.
 */
export const cardFrameShader = {
  uniforms: {
    uTime: { value: 0 },
    uAccent: { value: new THREE.Color(0.35, 0.6, 1.0) },
    uGoldColor: { value: new THREE.Color(GOLD.rgb[0], GOLD.rgb[1], GOLD.rgb[2]) },
    uGold: { value: 0 },
    uPulse: { value: 0 },
    uOpacity: { value: 1 },
    uSelected: { value: 0 },
    uScan: { value: -1 },
    uDissolve: { value: 0 },
    // A ripple impulse: 0 at rest, driven 0 → 1 once when something happens
    // TO this card. The wave travels outward from the impact as it decays.
    uRipple: { value: 0 },
    uRippleAt: { value: new THREE.Vector2(0.5, 0.5) },
    uRadius: { value: 0.07 },
    uAspect: { value: 0.727 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vViewDir;
    void main() {
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vViewDir = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    varying vec3 vViewDir;

    uniform float uTime;
    uniform vec3  uAccent;
    uniform vec3  uGoldColor;
    uniform float uGold;
    uniform float uPulse;
    uniform float uOpacity;
    uniform float uSelected;
    uniform float uScan;
    uniform float uDissolve;
    uniform float uRipple;
    uniform vec2  uRippleAt;
    uniform float uRadius;
    uniform float uAspect;

    // Signed distance to a rounded rectangle, in UV space corrected for aspect.
    float roundedBox(vec2 p, vec2 b, float r) {
      vec2 q = abs(p) - b + r;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 p = (vUv - 0.5) * vec2(1.0, 1.0 / uAspect);
      vec2 b = vec2(0.5, 0.5 / uAspect);
      float d = roundedBox(p, b, uRadius);

      // --- edge-first erosion (Phase 7) ----------------------------------
      // The face must erode from its OUTSIDE inward on the same curve its
      // particles leave on, so the pixels are never in two places at once.
      float edgeDistance = 1.0 - clamp(-d * 2.6, 0.0, 1.0);
      float eroded = step(uDissolve, 1.0 - edgeDistance + hash(vUv * 320.0) * 0.16);
      if (uDissolve > 0.001 && eroded < 0.5) discard;

      // --- border ---------------------------------------------------------
      float border = smoothstep(0.012, 0.0, abs(d));
      float innerGlow = smoothstep(0.16, 0.0, abs(d)) * 0.35;

      // Animated travelling highlight around the perimeter.
      float around = atan(p.y, p.x) / 6.2831853 + 0.5;
      float travel = smoothstep(0.86, 1.0, sin((around - uTime * 0.09) * 6.2831853) * 0.5 + 0.5);
      border += travel * smoothstep(0.03, 0.0, abs(d)) * 0.8;

      // --- gold -------------------------------------------------------------
      // uGold is already zero for any warned card. RULE 1 is a gate, upstream.
      vec3 blueTerm = uAccent;
      vec3 goldTerm = uGoldColor * GOLD_RATIO;
      vec3 colour = mix(blueTerm, goldTerm, uGold);

      // Prominence for the centred card comes from a WIDER OUTER FALLOFF, not
      // from more energy. RULE 2: never multiply the border above 1.0.
      float outerRadius = mix(0.055, 0.055 * GOLD_BLOOM, uGold);
      float outerBloom = smoothstep(outerRadius, 0.0, abs(d)) * (0.30 + uGold * 0.22);

      float intensity = clamp(border + innerGlow + outerBloom, 0.0, GOLD_MAX);

      // --- energy pulse on select ------------------------------------------
      float pulseRing = smoothstep(0.05, 0.0, abs(d + uPulse * 0.45));
      intensity += pulseRing * (1.0 - uPulse) * 0.9 * uSelected;

      // --- ripple -----------------------------------------------------------
      // A ring expanding from the point of impact. It reads as the surface
      // being STRUCK rather than merely lighting up, which is the difference
      // between glass and a lamp.
      if (uRipple > 0.001) {
        float fromImpact = length((vUv - uRippleAt) * vec2(1.0, 1.0 / uAspect));
        float front = uRipple * 0.9;
        float ring = smoothstep(0.10, 0.0, abs(fromImpact - front));
        intensity += ring * (1.0 - uRipple) * 0.55;
      }

      // --- approach scan line (Phase 6) -------------------------------------
      // Hard-edged on purpose: a soft gradient reads as a lighting change, a
      // hard line reads as a machine scanning the surface.
      float scanBand = step(abs(vUv.y - uScan), 0.012);
      intensity += scanBand * 0.85;

      // Fresnel rim on the glass, clamped — see safePow in util.ts for why.
      float facing = clamp(dot(normalize(vViewDir), vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
      float fres = pow(clamp(1.0 - facing, 0.0, 1.0), 2.5);
      intensity += fres * 0.18;

      float alpha = clamp(intensity, 0.0, 1.0) * uOpacity;
      if (alpha < 0.004) discard;

      gl_FragColor = vec4(colour * intensity, alpha);
      #include <colorspace_fragment>
    }
  `
    .replace(/GOLD_RATIO/g, GOLD_RULES.INTENSITY_RATIO.toFixed(3))
    .replace(/GOLD_BLOOM/g, GOLD_RULES.BLOOM_RADIUS_MULTIPLIER.toFixed(3))
    .replace(/GOLD_MAX/g, GOLD_RULES.MAX_BORDER_MULTIPLIER.toFixed(3)),
};
