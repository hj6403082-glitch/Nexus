'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BUST_SDF, BUST_BOUNDS } from './sdf';
import { EYES, JAW } from './anatomy';
import { FACE_MARKINGS_GLSL, MOUTH } from './faceMarkings';
import { FILL_DIR, KEY_DIR, RIM_DIR } from './lights';
import { FIGURE_PLACEMENT } from './placement';
import { useTransformStore } from '@/stores/useTransformStore';
import { useAIStore } from '@/stores/useAIStore';
import { useSystemStore } from '@/stores/useSystemStore';
import { MARCH_STEPS } from './surfaceQuality';

/**
 * THE FIGURE, AS A SURFACE.
 *
 * WHY THE BEADS COULD NEVER GET THERE
 *
 * The particle figure is the whole point of the transformation — the beads
 * that were the cards are, numerically, the beads that are the face — and it
 * is the right thing to watch arrive. It is the wrong thing to then look AT.
 *
 * Thirty-two thousand beads over a bust is about 3.2 mm of spacing. A lip is
 * 8 mm thick, a lid edge is 2 mm, a nostril is 5 mm across. Those features are
 * one to three beads wide, and a feature three beads wide is not a feature: it
 * is three dots in roughly the right place. No amount of re-authoring the
 * anatomy fixes that, because the anatomy was never the limit — the sampling
 * was. Every pass spent adding lids and nostrils and lip masses was detail
 * being poured into a bucket that could not hold it.
 *
 * So once the beads have landed, the SAME FIELD is raymarched directly. There
 * is no second model and no export step: this shader calls `sdBust`, the exact
 * function the bake called, so the surface the beads flew to and the surface
 * that resolves out of them are the same surface by construction. What changes
 * is that it is now sampled per pixel instead of per bead, which means:
 *
 *   - the silhouette is exact at any zoom, with no crust on the edge;
 *   - normals come from the field's own gradient, so shading is smooth
 *     everywhere instead of being quantised to 32,000 facets;
 *   - ambient occlusion and shadows are marched live rather than baked at
 *     bead resolution, so the sockets, the nostrils and the lip seam actually
 *     have dark in them;
 *   - the eyes are analytic, not a cluster of beads that happened to land
 *     near the right place.
 *
 * The cost is confined by rendering it inside a BOX. Only fragments the box
 * covers run the march, so the shader is paid for the figure's screen area and
 * nothing else — and the step count is tiered, because this is the one thing
 * in the scene a weak machine cannot afford at full quality.
 */



export function SurfaceFigure() {
  const mesh = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const tier = useSystemStore((s) => s.tier);

  const inverse = useMemo(() => FIGURE_PLACEMENT.clone().invert(), []);
  const steps = MARCH_STEPS[tier as 0 | 1 | 2 | 3] ?? 64;

  const uniforms = useMemo(
    () => ({
      uInverse: { value: new THREE.Matrix4() },
      uPlacement: { value: new THREE.Matrix4() },
      uProj: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uKeyDir: { value: new THREE.Vector3(...KEY_DIR).normalize() },
      uFillDir: { value: new THREE.Vector3(...FILL_DIR).normalize() },
      uRimDir: { value: new THREE.Vector3(...RIM_DIR).normalize() },
      uJawAngle: { value: 0 },
      uJawPivot: { value: new THREE.Vector3(...JAW.pivot) },
      uJawAxis: { value: new THREE.Vector3(...JAW.axis) },
      uEyeL: { value: new THREE.Vector3(...EYES.left) },
      uEyeR: { value: new THREE.Vector3(...EYES.right) },
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uMouth: { value: 0 },
      uHeadYaw: { value: 0 },
      uBreath: { value: 0 },
      /**
       * Neutral, now that the surface is a metal.
       *
       * This started at 0.52 with a gamma on top of it, because a pale diffuse
       * mass came out of the app's bloom and grade a stop and a half too hot
       * and every one of those stops had to be taken out here. A metal is dark
       * by construction — its albedo is 0.17/0.22/0.31 and nearly all of its
       * brightness is a specular that only appears where the form turns into a
       * light — so the same correction applied to it just dimmed the
       * highlights that were doing the work and put the murk back.
       *
       * Left in place rather than deleted: it is the one dial for matching the
       * figure to a post chain, and the next change to bloom or the grade will
       * want it.
       */
      uExposure: { value: 1.0 },
    }),
    [],
  );

  // The box that bounds the march, in the figure's own frame, with a margin so
  // a grazing ray still enters it.
  const size = useMemo(
    () =>
      new THREE.Vector3(
        BUST_BOUNDS.max[0] - BUST_BOUNDS.min[0] + 0.08,
        BUST_BOUNDS.max[1] - BUST_BOUNDS.min[1] + 0.08,
        BUST_BOUNDS.max[2] - BUST_BOUNDS.min[2] + 0.08,
      ),
    [],
  );
  const centre = useMemo(
    () =>
      new THREE.Vector3(
        (BUST_BOUNDS.max[0] + BUST_BOUNDS.min[0]) / 2,
        (BUST_BOUNDS.max[1] + BUST_BOUNDS.min[1]) / 2,
        (BUST_BOUNDS.max[2] + BUST_BOUNDS.min[2]) / 2,
      ).applyMatrix4(FIGURE_PLACEMENT),
    [],
  );

  const jaw = useRef(0);
  const yaw = useRef(0);

  useFrame((state, rawDelta) => {
    const m = mesh.current;
    if (!m) return;
    const material = m.material as THREE.ShaderMaterial;
    const u = material.uniforms;
    const dt = Math.min(rawDelta, 1 / 20);
    const transform = useTransformStore.getState();

    /**
     * The surface only exists once the beads have finished arriving.
     *
     * Cross-faded rather than switched: the beads stay visible through the
     * handover and thin out as the surface comes up under them, so what the
     * eye sees is a cloud of points RESOLVING into a body — which is the thing
     * the whole sequence was always trying to say — instead of one object
     * being swapped for another between frames.
     */
    const want = transform.phase === 'HUMANOID_ACTIVE' && steps > 0 ? 1 : 0;
    // The real elapsed time, not the clamped `dt` — see the matching note in
    // `HumanForm`. The two constants must stay equal or the cross-fade dips
    // through a gap where neither the beads nor the surface is fully present.
    u.uReveal.value += (want - u.uReveal.value) * (1 - Math.exp(-rawDelta / 0.35));
    m.visible = u.uReveal.value > 0.002;
    if (!m.visible) return;

    u.uTime.value = state.clock.elapsedTime;
    (u.uInverse.value as THREE.Matrix4).copy(inverse);
    (u.uPlacement.value as THREE.Matrix4).copy(FIGURE_PLACEMENT);
    (u.uProj.value as THREE.Matrix4).copy(camera.projectionMatrix);
    (u.uView.value as THREE.Matrix4).copy(camera.matrixWorldInverse);

    // The mouth, quantised to five steps — a continuous jaw reads as rubber.
    const level = useAIStore.getState().speechLevel;
    jaw.current += (level - jaw.current) * Math.min(1, dt * 14);
    const stepped = Math.round(Math.max(0, Math.min(1, jaw.current)) * JAW.steps) / JAW.steps;
    u.uJawAngle.value = stepped * JAW.maxAngle;
    u.uMouth.value = stepped;

    // A slow head turn and a shallow breath, so it is present rather than
    // merely rendered. Both tiny; anything larger reads as an idle animation.
    const t = state.clock.elapsedTime;
    yaw.current += (Math.sin(t * 0.17) * 0.05 - yaw.current) * Math.min(1, dt * 1.2);
    u.uHeadYaw.value = yaw.current;
    u.uBreath.value = Math.sin(t * 0.62);
  });

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms,
        transparent: true,
        depthWrite: true,
        depthTest: true,
        // The BACK faces, so the box still draws when the camera is inside it.
        // The march starts from the camera either way.
        side: THREE.BackSide,
        vertexShader: VERTEX,
        fragmentShader: fragmentShader(Math.max(steps, 8)),
      }),
    [uniforms, tier],
  );

  /**
   * A ShaderMaterial holds a compiled GPU program, and this one is rebuilt
   * whenever the tier changes because the step count is compiled into it. On a
   * machine whose frame rate is moving, the monitor can walk the tier up and
   * down repeatedly — each step stranding another program on the GPU.
   */
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh ref={mesh} position={centre} material={material} visible={false} frustumCulled={false}>
      <boxGeometry args={[size.x, size.y, size.z]} />
    </mesh>
  );
}

const VERTEX = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = (steps: number) => /* glsl */ `
precision highp float;

in vec3 vWorld;

${BUST_SDF}
${FACE_MARKINGS_GLSL}

uniform mat4 uInverse;
uniform mat4 uPlacement;
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uKeyDir;
uniform vec3 uFillDir;
uniform vec3 uRimDir;
uniform vec3 uJawPivot;
uniform vec3 uJawAxis;
uniform vec3 uEyeL;
uniform vec3 uEyeR;
uniform float uTime;
uniform float uReveal;
uniform float uMouth;
uniform float uHeadYaw;
uniform float uBreath;
uniform float uExposure;

out vec4 fragColor;

/**
 * The posed field.
 *
 * The bake produces a field in rest pose and the beads are hinged afterwards,
 * which a raymarcher cannot do — it has no vertices to move. So the SAMPLE is
 * moved instead: a point near the mandible is rotated BACKWARDS through the
 * hinge before the field is evaluated, which is the same rotation seen from
 * the other side. Weighting that rotation by proximity to the jaw bends the
 * field smoothly into the skull instead of shearing it.
 */
float sdPosed(vec3 p) {
  // Head turn, about the neck, falling off below it.
  float head = smoothstep(1.46, 1.58, p.y);
  p = rotateAbout(p, vec3(0.0, 1.44, 0.0), vec3(0.0, 1.0, 0.0), -uHeadYaw * head);

  // Breath, in the chest only.
  float chest = smoothstep(1.34, 1.14, p.y);
  p.z -= uBreath * 0.004 * chest;

  // Jaw. The weight is a cheap stand-in for the mandible field: below the lip
  // line, forward of the hinge, falling off over 4 cm.
  float w = smoothstep(1.596, 1.516, p.y) * smoothstep(-0.055, 0.02, p.z);
  p = rotateAbout(p, uJawPivot, normalize(uJawAxis), uJawAngle * w);
  return sdBust(p);
}

vec3 fieldNormal(vec3 p) {
  const float e = 0.0006;
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * sdPosed(p + k.xyy * e) +
    k.yyx * sdPosed(p + k.yyx * e) +
    k.yxy * sdPosed(p + k.yxy * e) +
    k.xxx * sdPosed(p + k.xxx * e)
  );
}

/** Five taps along the normal. Exact here, unlike the baked version. */
float occlusion(vec3 p, vec3 n) {
  float sum = 0.0;
  float weight = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = float(i) * 0.010;
    sum += (h - sdPosed(p + n * h)) * weight;
    weight *= 0.7;
  }
  return clamp(1.0 - 2.4 * sum, 0.0, 1.0);
}

/** Soft shadow. d/t is the angle the nearest blocker subtends from the ray. */
float shadow(vec3 p, vec3 l) {
  float t = 0.012;
  float res = 1.0;
  // Twelve steps, not twenty. Beyond about a dozen the ray has either found a
  // blocker or is out past the 35 cm cutoff, and the extra eight were a fifth
  // of the shader for a difference no one could point at.
  for (int i = 0; i < 12; i++) {
    float d = sdPosed(p + l * t);
    if (d < 0.0004) return 0.0;
    res = min(res, 9.0 * d / t);
    t += clamp(d, 0.007, 0.06);
    if (t > 0.35) break;
  }
  return clamp(res, 0.0, 1.0);
}

void main() {
  // Ray, in the figure's own frame — the frame the field is authored in.
  vec3 originWorld = cameraPosition;
  vec3 dirWorld = normalize(vWorld - originWorld);
  vec3 origin = (uInverse * vec4(originWorld, 1.0)).xyz;
  vec3 dir = normalize((uInverse * vec4(dirWorld, 0.0)).xyz);

  // Sphere trace. The field is not a true distance field after smin, so each
  // step is shortened — a full step overshoots into a neighbouring lobe and
  // tunnels through thin features like a lid edge or the bridge of the nose.
  float t = 0.02;
  float d = 1.0;
  bool hit = false;
  for (int i = 0; i < ${steps}; i++) {
    vec3 p = origin + dir * t;
    d = sdPosed(p);
    if (d < 0.00035) { hit = true; break; }
    t += d * 0.90;
    if (t > 3.0) break;
  }
  if (!hit) discard;

  vec3 p = origin + dir * t;
  vec3 n = fieldNormal(p);
  vec3 keyDir = normalize(uKeyDir);
  vec3 viewDir = -dir;

  float occ = occlusion(p, n);
  float shade = shadow(p, keyDir);
  float key = max(dot(n, keyDir), 0.0);

  vec3 refl = reflect(dir, n);
  vec3 fillDir = normalize(uFillDir);
  vec3 rimDir = normalize(uRimDir);

  // The room, as seen by a mirror.
  vec3 env = mix(
    vec3(0.008, 0.013, 0.026),
    vec3(0.070, 0.105, 0.190),
    smoothstep(-0.55, 0.85, refl.y)
  );
  env += vec3(0.62, 0.78, 1.05) * pow(max(dot(refl, keyDir), 0.0), 52.0) * 2.6;
  env += vec3(0.10, 0.20, 0.44) * pow(max(dot(refl, rimDir), 0.0), 7.0) * 0.55;
  env += vec3(0.05, 0.07, 0.12) * pow(max(dot(refl, fillDir), 0.0), 4.0) * 0.35;

  // Dark blue steel. This is the colour the SPECULAR is tinted by, which is
  // what makes a metal look like a particular metal.
  vec3 albedo = vec3(0.17, 0.22, 0.31);

  // Fresnel. Every material goes mirror-like at a grazing angle; on a metal it
  // is the term that draws the edge of the form, which is why this does the
  // job the old rim light was hired for without the rim light's flatness.
  float fres = pow(clamp(1.0 - max(dot(n, viewDir), 0.0), 0.0, 1.0), 5.0);
  vec3 colour = mix(albedo, vec3(1.0), fres) * env * mix(0.35, 1.0, occ);

  // The little diffuse a real metal has, so the shadow side is form and not a
  // hole. A tenth of what a dielectric would get.
  float wrapped = pow(clamp(key * 0.90 + 0.10, 0.0, 1.0), 1.7);
  colour += albedo * wrapped * mix(0.05, 1.0, shade) * 0.30 * occ;
  colour += albedo * max(dot(n, fillDir), 0.0) * 0.10 * occ;

  // A tight glint on top, for the polish.
  vec3 halfVec = normalize(keyDir + viewDir);
  colour += vec3(0.85, 0.95, 1.15) * pow(clamp(dot(n, halfVec), 0.0, 1.0), 120.0) * shade * occ * 1.1;

  // The charge: a band travelling up the body, brightest where the key does
  // not reach, so it lights the half of the figure that is otherwise only dark.
  float band = sin(p.y * 5.6 - uTime * 0.8);
  colour += vec3(0.14, 0.38, 0.72) * pow(clamp(band * 0.5 + 0.5, 0.0, 1.0), 10.0)
          * (1.0 - wrapped) * occ * 0.45;

  /**
   * THE EYES, analytic — and DIM.
   *
   * At 1.7 they were headlights: two blown-out white discs that took the whole
   * face with them through the bloom pass. An eye is read from contrast, and
   * the sockets around these are already dark, so the light has almost no work
   * to do. The iris is darkened FIRST and only a small pupil is lit, which is
   * the arrangement that reads as a gaze rather than as two lamps.
   */
  /**
   * A DARK eye with a bright iris, not a pale eye with a bright dot.
   *
   * On a metal bust there is no sclera to be white — the whole head is one
   * material — so the eye is read entirely from the lamp inside it. Sinking
   * the surrounding sphere to near black and putting all of the light in a
   * 2 mm core is what turns two pale ovals into a gaze.
   */
  float eye = min(length(p - uEyeL), length(p - uEyeR));
  colour *= mix(1.0, 0.10, 1.0 - smoothstep(0.0020, 0.0088, eye));
  colour += vec3(0.55, 0.78, 1.15) * (1.0 - smoothstep(0.0, 0.0021, eye)) * 1.35;
  colour += vec3(0.08, 0.20, 0.48) * (1.0 - smoothstep(0.002, 0.0075, eye)) * 0.34;

  // The drawn line work: mouth, nostrils, brow crease.
  colour = faceMarkings(p, n, colour);

  // And the mouth lights from inside when it speaks.
  float seam = length((p - vec3(0.0, ${MOUTH.y.toFixed(4)}, 0.0800)) * vec3(0.55, 2.4, 1.5));
  colour += vec3(0.45, 0.66, 1.0) * (1.0 - smoothstep(0.0, 0.028, seam)) * uMouth * 0.9;

  // Depth, so the surface occludes and is occluded correctly by the beads and
  // by everything else in the scene.
  vec3 world = (uPlacement * vec4(p, 1.0)).xyz;
  vec4 clip = uProj * uView * vec4(world, 1.0);
  gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);

  // The contrast gamma that used to sit here is gone. It existed to widen the
  // gap between lit and shadow on a flat diffuse surface; a metal's specular
  // already supplies that gap, and squaring it up only crushed the highlights.
  colour = max(colour, vec3(0.0)) * uExposure;
  fragColor = vec4(colour, uReveal);
}
`;
