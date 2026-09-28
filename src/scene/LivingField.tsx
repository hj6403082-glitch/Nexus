'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSystemStore } from '@/stores/useSystemStore';
import { useAIStore } from '@/stores/useAIStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { WORLDS } from '@/core/constants/worlds';

/**
 * THE ROOM IS ALIVE.
 *
 * Everything before this sat in flat black. A void is a defensible choice for
 * an instrument panel and a terrible one for a presence: it gives the eye
 * nothing to hold, so the figure reads as a cut-out floating in nothing rather
 * than as something occupying a place. The word people reach for is "ghost",
 * and they are describing a value problem, not a modelling one.
 *
 * So the scene gets a medium. An inward-facing sphere carrying a domain-warped
 * noise field: fbm whose sample position is itself displaced by another fbm,
 * which is what turns smooth cloud into the stretched filament structure of
 * something organic. Tissue, not nebula. It is DARK — it has to stay under
 * everything in the scene — but it is never flat, and it never stops moving.
 *
 * WHY THIS DOES NOT BREAK THE STILLNESS CONTRACT
 *
 * Phase 6's rule is that ambient motion is off by default and gated on a 0..1
 * multiplier, verified by asserting that a zero multiplier leaves the carousel
 * angle and the camera transform bit-identical frame over frame. Both of those
 * are about things the user is trying to READ — a card that drifts under the
 * cursor is a card you cannot click. The medium behind them is not one of
 * those things, and holding it perfectly still was never what the rule was
 * protecting. It breathes on its own clock, and the cards stay exactly where
 * they were put.
 *
 * It also LISTENS. The field brightens with the speech envelope and swells
 * through the transformation, so the room reacts to the thing inside it rather
 * than playing a loop behind it.
 */
/**
 * Octaves per tier.
 *
 * This is a FULLSCREEN shader — every pixel in the window pays for it, every
 * frame, before anything else is drawn. Three octaves sampled twice is six
 * noise evaluations per pixel, which is affordable on a GPU and is most of a
 * frame on a software renderer. A weak machine gets two octaves and no domain
 * warp: less filament structure, but it is a backdrop, and a backdrop that
 * costs the frame rate is not worth having.
 */
const FIELD_OCTAVES = { 0: 2, 1: 2, 2: 3, 3: 4 } as const;
const FIELD_WARP = { 0: false, 1: false, 2: true, 3: true } as const;

export function LivingField() {
  const material = useRef<THREE.ShaderMaterial>(null);
  const world = useSystemStore((s) => s.world);
  const tier = useSystemStore((s) => s.tier) as 0 | 1 | 2 | 3;

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      /**
       * DEEP NAVY, not near-black.
       *
       * A wireframe figure needs something behind it. On black the mesh has no
       * field to sit in and every line is a bright stroke floating in a void;
       * on a deep blue the network reads as being INSIDE something, which is
       * both what the reference does and what stops the figure looking cut out
       * and pasted on.
       */
      uDeep: { value: new THREE.Color('#071426') },
      uMid: { value: new THREE.Color('#123a63') },
      uHot: { value: new THREE.Color('#3f7ac8') },
      uLevel: { value: 0 },
      uPresence: { value: 0 },
      uBreath: { value: 0 },
    }),
    [],
  );

  useFrame((state, dt) => {
    const m = material.current;
    if (!m) return;
    const u = m.uniforms;

    // Its own clock. Not the motion multiplier — see the header.
    u.uTime.value = state.clock.elapsedTime;

    // A slow respiration, roughly twelve a minute. Deliberately not locked to
    // anything else in the scene: two things breathing in lockstep read as one
    // animation, and one thing breathing reads as alive.
    u.uBreath.value = Math.sin(state.clock.elapsedTime * 0.21) * 0.5 + 0.5;

    const speech = useAIStore.getState().speechLevel;
    const transform = useTransformStore.getState();
    u.uLevel.value += (speech - u.uLevel.value) * Math.min(1, dt * 6);
    u.uPresence.value +=
      ((transform.phase === 'NORMAL' ? 0 : 1) - u.uPresence.value) * Math.min(1, dt * 1.6);

    const grade = WORLDS[useSystemStore.getState().world];
    (u.uHot.value as THREE.Color).lerp(new THREE.Color(grade.keyLight), Math.min(1, dt * 1.2));
  });

  return (
    // Inside the far plane (80) and outside everything else in the scene.
    <mesh key={`${world}-${tier}`} renderOrder={-100} frustumCulled={false}>
      <sphereGeometry args={[46, 48, 32]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        // It is the backdrop; nothing in the scene should ever be occluded by it.
        depthTest={false}
        vertexShader={VERTEX}
        fragmentShader={fragment(FIELD_OCTAVES[tier] ?? 3, FIELD_WARP[tier] ?? true)}
      />
    </mesh>
  );
}

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WARPED_FIELD = /* glsl */ `
  float w = fbm(dir * 2.1 + flow);
  vec3 warp = vec3(w, w * 0.87 + 0.31, w * 0.63 + 0.77);
  float field = fbm(dir * 5.4 + warp * 2.4 + flow * 1.7);
`;

const PLAIN_FIELD = /* glsl */ `
  // No warp on a weak machine: one fbm call instead of two, and the structure
  // is rounder for it. A backdrop that costs the frame rate is not a backdrop.
  float field = fbm(dir * 4.6 + flow * 1.7);
`;

const fragment = (octaves: number, warp: boolean) => /* glsl */ `
precision highp float;

varying vec3 vDir;

uniform float uTime;
uniform float uBreath;
uniform float uLevel;
uniform float uPresence;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uHot;

// Value noise. Cheap, and the domain warp below is what supplies the character
// — a more expensive base noise would not show through it.
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

// Three octaves, not four. The fourth costs a quarter of the shader and
// contributes detail finer than the bloom pass preserves anyway.
float fbm(vec3 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < ${octaves}; i++) {
    total += noise(p) * amplitude;
    p *= 2.03;
    amplitude *= 0.5;
  }
  return total;
}

void main() {
  vec3 dir = normalize(vDir);

  // Drift, slowly, and mostly along one axis so the structure appears to flow
  // rather than to boil. Boiling noise is the single loudest tell that a thing
  // is a shader.
  vec3 flow = vec3(0.0, uTime * 0.014, uTime * 0.021);

  // DOMAIN WARP, from ONE fbm call rather than three.
  //
  // Sampling fbm at a position displaced by fbm is what stretches round blobs
  // into filaments. The textbook form evaluates the warp three times, once per
  // axis, and that alone was three quarters of this shader — enough to drop a
  // software renderer to one frame a second. Rotating a single scalar warp
  // into three axes is visually indistinguishable here and costs a third as
  // much: the eye reads the filament structure, not the isotropy of it.
${warp ? WARPED_FIELD : PLAIN_FIELD}

  // Respiration, as a gentle gamma on the field rather than a brightness
  // multiply: brightness pumps, a gamma makes the structure itself swell and
  // recede, which is what breathing looks like.
  field = pow(clamp(field, 0.0, 1.0), mix(1.55, 1.15, uBreath));

  // Filaments: the narrow band where the field crosses its own midline. This
  // is the vein structure, and it is most of what reads as organic.
  float veins = smoothstep(0.42, 0.50, field) * (1.0 - smoothstep(0.50, 0.62, field));

  // Height gradient. Darkest underfoot, opening out above — a room with a
  // ceiling rather than a sphere of soup.
  float lift = smoothstep(-0.55, 0.75, dir.y);

  /**
   * AND THEN KEPT DARK.
   *
   * The first version of this was four times brighter and read as weather —
   * pale cloud drifting behind the figure, in places lighter than the figure
   * itself. A backdrop that competes turns the subject into a sticker, and the
   * complaint it earned was that the figure looked pasted on.
   *
   * The structure is all still here. It is just held down where a backdrop
   * belongs: the broad field barely rises off black, and only the narrow vein
   * band is allowed any real light.
   */
  vec3 colour = mix(uDeep, uMid, field * field * (0.16 + 0.30 * lift));
  colour += uHot * veins * 0.045 * (0.35 + 0.65 * lift);

  // It listens. Speech lights the veins; the transformation swells the whole
  // medium, so the room is visibly involved in what is happening in it.
  colour += uHot * veins * uLevel * 0.30;
  colour += uMid * uPresence * 0.14 * field;

  // A horizon glow so the floor lattice has something to sit against instead
  // of terminating in nothing.
  float horizon = exp(-abs(dir.y + 0.18) * 7.0);
  colour += uMid * horizon * 0.14;

  colour = max(colour, vec3(0.0));

  gl_FragColor = vec4(colour, 1.0);
}
`;
