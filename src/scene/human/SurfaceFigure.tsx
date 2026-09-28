'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BUST_SDF, BUST_BOUNDS } from './sdf';
import { EYES, JAW } from './anatomy';
import { FACE_MARKINGS_GLSL, MOUTH } from './faceMarkings';
import { SURFACE_DETAIL_GLSL } from './surfaceDetail';
import { FILL_DIR, KEY_DIR, RIM_DIR } from './lights';
import { FIGURE_PLACEMENT } from './placement';
import { useTransformStore } from '@/stores/useTransformStore';
import { useAIStore } from '@/stores/useAIStore';
import { useSystemStore } from '@/stores/useSystemStore';
import { marchSteps } from './surfaceQuality';

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
  const steps = marchSteps(tier);

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
      uBlink: { value: 0 },
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
  const nextBlink = useRef(2.5);
  const blinkStart = useRef(-10);

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
    const want = transform.phase === 'HUMANOID_ACTIVE' ? 1 : 0;
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

    /**
     * THE BLINK.
     *
     * Scheduled rather than driven by a sine, because the shape matters: a
     * blink is a fast close and a slightly slower open, not a smooth
     * oscillation, and the gap between them is irregular. A perfectly
     * periodic blink is uncanny in its own right — it reads as a mechanism
     * keeping time rather than as a body doing something involuntary.
     */
    if (t >= nextBlink.current) {
      blinkStart.current = t;
      // Somewhere between three and seven seconds until the next one.
      nextBlink.current = t + 3.0 + Math.random() * 4.0;
    }
    const since = t - blinkStart.current;
    const CLOSE = 0.055;
    const OPEN = 0.085;
    u.uBlink.value =
      since < CLOSE
        ? since / CLOSE
        : since < CLOSE + OPEN
          ? 1 - (since - CLOSE) / OPEN
          : 0;
  });

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms,
        transparent: true,
        /**
         * ADDITIVE, and it does not write depth.
         *
         * A hologram is light added to whatever is behind it, not a surface
         * that hides it — so the far side of the head shows faintly through
         * the near side, and the room shows through both. That self-overlap
         * is most of what sells it, and it comes for free from the blend mode
         * rather than from marching the ray through multiple hits.
         *
         * Not writing depth is what allows it. It still TESTS depth, so
         * anything genuinely in front still occludes it.
         */
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        // The BACK faces, so the box still draws when the camera is inside it.
        // The march starts from the camera either way.
        side: THREE.BackSide,
        vertexShader: VERTEX,
        fragmentShader: fragmentShader(steps),
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
${SURFACE_DETAIL_GLSL}
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
uniform float uBlink;
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
  /**
   * Head turn, about the neck, falling off below it — plus a small permanent
   * downward tilt.
   *
   * Two degrees. A head held exactly level, facing exactly forward, and not
   * moving is the posture of something confronting you; the same head tipped a
   * fraction down is attentive. It costs nothing and it is a surprising amount
   * of the difference between being looked at and being stared at.
   */
  float head = smoothstep(1.46, 1.58, p.y);
  p = rotateAbout(p, vec3(0.0, 1.44, 0.0), vec3(0.0, 1.0, 0.0), -uHeadYaw * head);
  p = rotateAbout(p, vec3(0.0, 1.44, 0.0), vec3(1.0, 0.0, 0.0), 0.036 * head);

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

  /**
   * PLATING. See surfaceDetail.ts — a perfectly smooth blue glowing mass on
   * black is the vocabulary of an apparition no matter what its BRDF is, and
   * seams are the single most legible signal that a thing was manufactured.
   */
  float seam = panelSeams(p);
  n = machined(p, n);

  /**
   * A HOLOGRAM.
   *
   * Metal was the right answer to "it looks like a ghost" and the wrong answer
   * to what this object actually is. A solid opaque bust asks to be judged as
   * a person, and a stylised head judged as a person lands in the uncanny
   * valley no matter how carefully it is proportioned — every pass at making
   * it MORE convincing made it more unsettling, because the closer a not-quite
   * face gets, the more the remaining error costs.
   *
   * A hologram is exempt. It is understood to be a projection of something
   * rather than the thing, so simplification reads as the medium rather than
   * as deformity, and nobody looks at one and asks why the cheekbone is wrong.
   * It is also what the rest of this interface already is — the cards, the
   * panels and the text are all holographic, and the figure was the only solid
   * object in a room full of light.
   *
   * Four things make it one, and all four matter:
   *
   *   FRESNEL ALPHA   Transparent where it faces you, opaque at the edges.
   *                   This is the whole illusion: a projection has no mass, so
   *                   what you see of it is the places where your line of
   *                   sight passes through the most of it.
   *   SCANLINES       Fine horizontal banding, drifting slowly. The single
   *                   most recognisable signal that an image is projected.
   *   SWEEP           A brighter band travelling up the body — the refresh
   *                   passing through, which is what makes it feel live rather
   *                   than printed.
   *   INSTABILITY     A small irregular flicker. A perfectly steady hologram
   *                   is a statue made of light; an unsteady one is a signal.
   *
   * The form still has to read, so the key, the occlusion and the seams all
   * survive — they modulate the emission instead of reflecting a room.
   */
  float fres = pow(clamp(1.0 - max(dot(n, viewDir), 0.0), 0.0, 1.0), 2.1);
  float key = max(dot(n, keyDir), 0.0);

  // Core and edge. The edge is hotter and whiter, which is what makes the
  // silhouette draw itself.
  vec3 core = vec3(0.16, 0.52, 0.86);
  vec3 edge = vec3(0.62, 0.90, 1.12);
  vec3 colour = mix(core, edge, fres);

  // The form, carried in the emission rather than in reflected light.
  float form = 0.22 + 0.60 * key * mix(0.30, 1.0, shade) + 0.22 * occ;
  colour *= form;

  // Scanlines. In the figure's own frame, so they sit ON it and travel with
  // the head rather than being a filter over the screen.
  float scan = 0.5 + 0.5 * sin(p.y * 720.0 - uTime * 1.6);
  // Gentler than they were. At 0.62 the banding was carrying more contrast
  // than the lighting, so the head read as a striped surface rather than as a
  // form with stripes on it.
  colour *= mix(0.76, 1.05, scan);

  // The refresh sweep.
  float sweep = pow(clamp(sin(p.y * 6.2 - uTime * 0.75) * 0.5 + 0.5, 0.0, 1.0), 14.0);
  colour += edge * sweep * 0.55;

  // Seams read as brighter here, not darker: on a projection an edge is where
  // more of the surface lines up with your eye, so it collects light.
  colour += edge * seam * 0.30;

  // Instability. Two incommensurable rates so it never settles into a pulse.
  float flicker = 0.93
    + 0.05 * sin(uTime * 11.3)
    + 0.03 * sin(uTime * 27.7 + 1.7);
  colour *= flicker;

  /**
   * THE EYES — AND THE BLINK.
   *
   * Two things were making this frightening rather than merely synthetic.
   *
   * The first is that the eye was a hot pinprick at the bottom of a black
   * well. Small bright points in dark hollows are the exact construction used
   * for every predator, skull and possessed thing ever drawn; the fact that
   * the geometry underneath is a perfectly reasonable eye socket does not
   * matter, because the viewer is reading a contrast pattern, not an anatomy.
   * So the iris is wider and softer now, the socket around it is lifted well
   * off black, and the core is warmer — cold blue-white in a dark recess is
   * the specific combination that reads as a thing looking AT you rather than
   * a thing that can see.
   *
   * The second is that it never blinked. A face that holds a completely
   * motionless stare is uncanny no matter how well modelled it is, because
   * eyes that do not blink belong to something dead or something hunting. A
   * blink is cheap — a lid edge sweeping down over the socket and back — and
   * it is the single strongest signal available that the thing is ALIVE and
   * unbothered by you. uBlink runs 0 to 1 to 0 in about 130 ms, every few
   * seconds, on an irregular interval, because a perfectly periodic blink is
   * its own kind of wrong.
   */
  float eye = min(length(p - uEyeL), length(p - uEyeR));
  float eyeGlow = 0.0;

  // The lid: a hard edge that travels from the top of the socket to the
  // bottom. Everything above the edge is covered.
  float lidY = mix(1.6118, 1.5902, uBlink);
  float lid = smoothstep(lidY - 0.0007, lidY + 0.0007, p.y);
  float openEye = 1.0 - lid;

  // Calmer than the first pass at widening them: wide AND bright reads as
  // startled, which is its own kind of unsettling. Warm white rather than
  // blue-white, because a cool light behind an eye is the colour of something
  // powered rather than something present.
  /**
   * On a hologram the eye is the BRIGHTEST thing, not the darkest.
   *
   * The previous version darkened the iris first and lit a small core inside
   * it, which is correct for an opaque head lit from outside: the socket is a
   * recess and the light sits in it. On an emissive projection that same code
   * subtracts from the emission and punches two flat holes in the face — the
   * eye stops being a feature and becomes an absence, which is worse than
   * either. Here the whole iris is added, with a hotter core inside it.
   */
  float iris = (1.0 - smoothstep(0.0022, 0.0108, eye)) * openEye;
  float pupil = (1.0 - smoothstep(0.0, 0.0042, eye)) * openEye;
  float halo = (1.0 - smoothstep(0.006, 0.020, eye)) * openEye;
  colour += vec3(0.22, 0.52, 0.86) * halo * 0.40;
  colour += vec3(0.38, 0.74, 1.05) * iris * 1.45;
  colour += vec3(0.86, 0.97, 1.18) * pupil * 2.10;
  eyeGlow = max(max(iris * 0.80, pupil), halo * 0.22);

  // The lid edge itself catches a little light, so the blink is visible as a
  // movement rather than as the eye simply switching off.
  float lidEdge = (1.0 - smoothstep(0.0, 0.0016, abs(p.y - lidY)))
                * (1.0 - smoothstep(0.004, 0.0125, eye));
  colour += vec3(0.42, 0.58, 0.78) * lidEdge * 0.55;

  // The drawn line work: mouth, nostrils, brow crease.
  colour = faceMarkings(p, n, colour);

  // And the mouth lights from inside when it speaks.
  float seam = length((p - vec3(0.0, ${MOUTH.y.toFixed(4)}, 0.0800)) * vec3(0.55, 2.4, 1.5));
  colour += vec3(0.45, 0.66, 1.0) * (1.0 - smoothstep(0.0, 0.028, seam)) * uMouth * 0.9;

  // Depth is still WRITTEN to gl_FragDepth so the depth TEST is correct
  // against the beads and the room, even though the material does not commit
  // it to the buffer.
  vec3 world = (uPlacement * vec4(p, 1.0)).xyz;
  vec4 clip = uProj * uView * vec4(world, 1.0);
  gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);

  colour = max(colour, vec3(0.0)) * uExposure;

  /**
   * Alpha carries the Fresnel, not the colour.
   *
   * Under additive blending the alpha is what decides how much of the figure
   * reaches the frame, so putting the falloff here is what makes it actually
   * see-through rather than merely dim. A floor of 0.12 keeps the flat planes
   * of the forehead and cheek present — at zero the face develops holes where
   * it happens to face the camera squarely, which is exactly where a viewer
   * is looking.
   */
  float alpha = clamp(
    0.12 + fres * 0.78 + sweep * 0.35 + seam * 0.25 + eyeGlow * 0.85,
    0.0,
    1.0
  );
  fragColor = vec4(colour, alpha * uReveal);
}
`;
