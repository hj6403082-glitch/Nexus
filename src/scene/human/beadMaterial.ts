import * as THREE from 'three';
import { MODULES } from '@/core/constants/modules';
import { JAW } from './anatomy';

/**
 * The card-matrix uniform array is sized at SHADER COMPILE TIME, so it cannot
 * grow with the module registry. Deriving it from `MODULES.length` means
 * adding an eleventh module widens the array instead of silently indexing past
 * the end of it — GLSL does not bounds-check, and the failure would be a
 * handful of particles reading garbage transforms during the one sequence
 * nobody is looking at the console for.
 */
export const MAX_CARDS = MODULES.length;

/**
 * THE BEADS.
 *
 * Drawn as OPAQUE SPHERE IMPOSTORS that write a curved depth — not as additive
 * glowing discs. That single choice is the difference between a figure and a
 * cloud:
 *
 *   - Additive discs sum wherever they overlap, so the silhouette and every
 *     fold blow out to white while the interior stays dark. The result reads
 *     as an OUTLINE of a person, which is exactly how the first version failed.
 *   - Opaque impostors with curved depth meet along curved seams. Neighbouring
 *     beads can overlap enough to leave no gap and each still resolves as its
 *     own dot, because the one in front simply wins the depth test.
 *
 * And NO RIM TERM. A rim light is the standard way to separate a subject from
 * its background, and it is precisely what made the first version read as a
 * bright outline around an empty shape. The form here is carried by the key
 * falling across it, nothing else.
 *
 * Tens of thousands of beads, not hundreds of thousands. At 5 mm spacing the
 * beads merged and the surface went to plastic; the dots have to stay
 * individually legible for the figure to read as assembled rather than moulded.
 */
export function makeBeadMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    uniforms: {
      uCardMatrix: {
        value: Array.from({ length: MAX_CARDS }, () => new THREE.Matrix4()),
      },
      uCorePosition: { value: new THREE.Vector3(0, 0.55, 1.2) },
      /**
       * Bust space → world.
       *
       * The field is authored at human scale about its own origin, because
       * that is the only frame in which "the jaw hinges about a line through
       * the ears" is a statement about anatomy rather than about the scene.
       * The bust then has to be PLACED, and it cannot be placed by putting the
       * Points object in a transformed group: the same vertex shader also
       * reads card positions that are already in world space, and a group
       * transform would apply to those too.
       *
       * So the placement is a uniform, applied after every local pose op.
       */
      uFigureMatrix: { value: new THREE.Matrix4() },
      uFigureNormalMatrix: { value: new THREE.Matrix3() },
      uCollapse: { value: 0 },
      uCore: { value: 0 },
      uSkeleton: { value: 0 },
      uBody: { value: 0 },
      uEyes: { value: 0 },
      uPresence: { value: 0 },
      uTime: { value: 0 },
      uBeadSize: { value: 1.0 },
      uJawAngle: { value: 0 },
      uJawPivot: { value: new THREE.Vector3(...JAW.pivot) },
      uJawAxis: { value: new THREE.Vector3(...JAW.axis) },
      uMouthLevel: { value: 0 },
      uKeyDir: { value: new THREE.Vector3(-0.66, 0.52, 0.42).normalize() },
      uBreath: { value: 0 },
      uHeadYaw: { value: 0 },
      uViewportHeight: { value: 1080 },
      // Only two terms of the projection matrix are needed to rebuild NDC z in
      // the fragment stage; three.js does not inject projectionMatrix there.
      uProjA: { value: -1 },
      uProjB: { value: -0.2 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
}

const VERTEX = /* glsl */ `
precision highp float;

in vec3 aCardLocal;    // position on the card face, in the card's local frame
in vec3 aFigure;       // baked position on the bust
in vec3 aFigureNormal; // baked surface normal
in vec3 aTint;         // colour sampled from the card pixel
in float aCardIndex;
in float aStagger;     // 0 = leaves first, 1 = leaves last
in float aJawWeight;   // 1 = belongs to the jaw, 0 = cranium
in float aSeam;        // 0..1, 1 exactly on the lip seam
in float aEye;         // 1 for the two eye points
in float aKind;        // 0 pane glass · 1 type fragment · 2 accent stream

uniform mat4 uCardMatrix[${MAX_CARDS}];
uniform vec3 uCorePosition;
uniform float uCollapse;
uniform float uCore;
uniform float uSkeleton;
uniform float uBody;
uniform float uPresence;
uniform float uTime;
uniform float uBeadSize;
uniform float uJawAngle;
uniform vec3 uJawPivot;
uniform vec3 uJawAxis;
uniform float uBreath;
uniform float uHeadYaw;
uniform float uViewportHeight;
uniform mat4 uFigureMatrix;
uniform mat3 uFigureNormalMatrix;

out vec3 vTint;
out vec3 vNormal;
out float vKind;
out float vSeam;
out float vEye;
out float vFormed;
out vec3 vViewPos;
out float vRadius;

vec3 rotateAbout(vec3 p, vec3 pivot, vec3 axis, float angle) {
  vec3 v = p - pivot;
  float c = cos(angle);
  float s = sin(angle);
  return pivot + v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
  // ---- keyframe 1: on the card -------------------------------------------
  int ci = int(aCardIndex + 0.5);
  vec4 cardWorld = uCardMatrix[ci] * vec4(aCardLocal, 1.0);

  // ---- keyframe 2: in the core -------------------------------------------
  // Not a single point: a tight shell, so the core has volume and the beads
  // inside it are still individually visible.
  float a1 = hash(aStagger * 311.7) * 6.2831853;
  float a2 = hash(aStagger * 517.3) * 3.14159265;
  vec3 shell = vec3(sin(a2) * cos(a1), cos(a2), sin(a2) * sin(a1));
  vec3 corePos = uCorePosition + shell * (0.055 + hash(aStagger * 97.1) * 0.05);

  // ---- keyframe 3: on the figure -----------------------------------------
  vec3 figure = aFigure;

  // The jaw is a RIGID rotation about the ear-to-ear line. Rigid rotation
  // cannot open a gap in the surface, which is why the mouth is posed here
  // rather than re-baked per frame.
  figure = rotateAbout(figure, uJawPivot, normalize(uJawAxis), -uJawAngle * aJawWeight);

  // Breath lives in the chest only, and it is small. Anything larger, or
  // anywhere else, becomes "float" and the figure stops reading as present.
  float chest = smoothstep(1.34, 1.14, aFigure.y);
  figure.z += uBreath * 0.006 * chest;
  figure.x *= 1.0 + uBreath * 0.004 * chest;

  // A RIGID head turn. Not a lean, not a sway — a rotation of the whole head
  // mass about the neck, which again cannot tear the surface.
  float head = smoothstep(1.46, 1.58, aFigure.y);
  figure = rotateAbout(figure, vec3(0.0, 1.44, 0.0), vec3(0.0, 1.0, 0.0), uHeadYaw * head);

  // Local pose is done; place the bust in the room.
  figure = (uFigureMatrix * vec4(figure, 1.0)).xyz;
  vec3 figureNormal = normalize(uFigureNormalMatrix * aFigureNormal);

  // ---- the single float that moves a particle through all three ----------
  // Staggered crown-first, chest-last: the head assembles while the shoulders
  // are still arriving, which is what makes it read as a figure gathering
  // rather than a cloud resolving.
  float order = mix(0.0, 0.42, aStagger);
  float s = clamp((uCollapse - order) / max(1.0 - order, 0.001), 0.0, 1.0);
  float f = clamp((uBody - order * 0.5) / max(1.0 - order * 0.5, 0.001), 0.0, 1.0);

  vec3 p = mix(cardWorld.xyz, corePos, s);

  // Burst outward from the core before landing, so the form is assembled from
  // EVERY DIRECTION rather than extruded out of a point.
  vec3 outward = normalize(figure - uCorePosition + shell * 0.4);
  float burst = sin(f * 3.14159265) * 0.55 * (0.4 + hash(aStagger * 41.7) * 0.6);
  vec3 landing = mix(corePos, figure, smoothstep(0.0, 1.0, f)) + outward * burst;

  p = mix(p, landing, smoothstep(0.0, 0.2, uCore + uSkeleton + uBody));

  vFormed = f;
  vTint = aTint;
  vNormal = normalize(mix(normalize(p - uCorePosition + vec3(1e-5)), figureNormal, f));
  vKind = aKind;
  vSeam = aSeam;
  vEye = aEye;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vViewPos = mv.xyz;

  // Bead size. On the CARD, type fragments are small and hot and the pane is
  // larger and dim — that is what makes the dissolve read as pixels leaving a
  // surface rather than as a uniform cloud.
  //
  // On the FIGURE it must be the other way round: the bead size is governed by
  // the SPACING the Poisson selection achieved, because that is the only thing
  // that guarantees neighbouring beads still touch. Letting a bead stay small
  // because it happened to come from a glyph punched holes all over the face.
  float kindScale = aKind > 1.5 ? 0.9 : (aKind > 0.5 ? 0.72 : 1.15);
  float radius = 0.0042 * uBeadSize * mix(kindScale, 1.0, vFormed);
  vRadius = radius;

  // Point size in pixels for a sphere of this radius at this depth. Beads must
  // overlap slightly so the surface has no gaps; the 1.35 is that overlap.
  gl_PointSize = max(
    radius * 2.0 * 1.35 * projectionMatrix[1][1] * (uViewportHeight * 0.5) / max(-mv.z, 0.05),
    1.0
  );
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

in vec3 vTint;
in vec3 vNormal;
in float vKind;
in float vSeam;
in float vEye;
in float vFormed;
in vec3 vViewPos;
in float vRadius;

uniform vec3 uKeyDir;
uniform float uProjA;
uniform float uProjB;
uniform float uPresence;
uniform float uEyes;
uniform float uMouthLevel;

out vec4 fragColor;

void main() {
  // Sphere impostor. Reject outside the disc, then reconstruct the sphere
  // normal from the disc coordinate.
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float zc = sqrt(1.0 - r2);
  vec3 impostorNormal = vec3(c.x, -c.y, zc);

  // CURVED DEPTH. This is what lets two overlapping beads meet along a curved
  // seam instead of a straight disc edge: the nearer bead's centre is nearer,
  // its rim is further, and the depth test resolves the intersection as a
  // sphere-sphere one.
  vec3 surface = vViewPos + impostorNormal * vRadius;
  float ndcZ = (uProjA * surface.z + uProjB) / max(-surface.z, 1e-5);
  gl_FragDepth = clamp(ndcZ * 0.5 + 0.5, 0.0, 1.0);

  // Shading. Blue in shadow, lighter blue where the key lands, and a glow only
  // where the surface faces the key squarely. No rim term — see beadMaterial's
  // header for why that matters more than it sounds like it should.
  vec3 n = normalize(mix(impostorNormal, vNormal, 0.65));
  float key = max(dot(n, normalize(uKeyDir)), 0.0);

  vec3 shadowBlue = vec3(0.055, 0.105, 0.225);
  vec3 litBlue    = vec3(0.42, 0.62, 0.95);
  vec3 base = mix(shadowBlue, litBlue, key);

  // Squarely-facing glow. Clamped before the pow: two unit vectors can dot to
  // 1.0000001, pow of a negative is NaN, and one NaN pixel spreads through the
  // whole bloom pyramid and blacks out the frame.
  float square = pow(clamp(key, 0.0, 1.0), 12.0);
  base += vec3(0.30, 0.45, 0.70) * square * 0.6;

  // Before the figure has formed, the bead still carries the card pixel it
  // came from. That is the promise of the whole sequence: these ARE the cards.
  vec3 colour = mix(vTint, base, vFormed);

  // The lip seam lights — a THIN LINE that widens with the level. Keeping the
  // light on the seam is the difference between a mouth and a strip of tape
  // across the face.
  float seamGlow = smoothstep(1.0 - uMouthLevel * 0.55 - 0.08, 1.0, vSeam);
  colour += vec3(0.55, 0.72, 1.0) * seamGlow * uMouthLevel * vFormed;

  // Two faint points of light, settling last.
  colour += vec3(0.75, 0.88, 1.0) * vEye * uEyes * 1.4;

  fragColor = vec4(colour, 1.0);
}
`;
