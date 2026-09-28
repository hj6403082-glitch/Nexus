'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EYES } from './anatomy';
import { FIGURE_PLACEMENT } from './placement';
import type { Wireframe } from './wireframe';
import { useTransformStore } from '@/stores/useTransformStore';
import { useAIStore } from '@/stores/useAIStore';

/**
 * THE FIGURE AS A NETWORK.
 *
 * Lines between the surface points, and a lit node at every point. Nothing is
 * shaded and nothing is filled — the head is transparent, so the mesh on its
 * far side shows through the near side, which is most of what makes it read as
 * a projection of a head rather than a head.
 *
 * WHAT CARRIES THE FORM
 *
 * With no surface there is no diffuse term to model with, so the drawing is
 * done entirely by where the lines get BRIGHTER:
 *
 *   SILHOUETTE   A line whose surface normal is perpendicular to the view is
 *                on the contour, and contours are what the eye reads as shape.
 *                This is the term that draws the profile, the brow, the edge
 *                of the nose and the jaw — the bright continuous curves that
 *                make the difference between a head and a cloud of triangles.
 *   DEPTH        Further lines dim. Without it the back of the skull competes
 *                with the face and the whole thing flattens into a tangle.
 *   KEY          A little directional lift, so one side is warmer than the
 *                other and the head has an orientation in the room.
 *
 * Additively blended and writing no depth, because every line has to be able
 * to show through every other one. Depth is still TESTED, so anything actually
 * in front of the figure still covers it.
 */

const NODE_COLOUR = new THREE.Color('#9fe4ff');
const LINE_COLOUR = new THREE.Color('#2b9fe0');
const EDGE_COLOUR = new THREE.Color('#bfefff');

export interface FigureSurface {
  positions: Float32Array;
  normals: Float32Array;
  spacing: number;
  wire: Wireframe;
}

export function WireFigure({ surface }: { surface: FigureSurface }) {
  const group = useRef<THREE.Group>(null);
  const reveal = useRef(0);

  /**
   * One position buffer, shared by the lines and the nodes.
   *
   * The line geometry is INDEXED into it rather than carrying its own copy of
   * every endpoint: at six neighbours a point appears in about three edges, so
   * a non-indexed buffer would hold each vertex three times and the figure
   * would cost three times the memory and upload for no benefit.
   */
  const { lineGeometry, nodeGeometry } = useMemo(() => {
    const count = surface.positions.length / 3;

    const position = new THREE.BufferAttribute(surface.positions, 3);
    const normal = new THREE.BufferAttribute(surface.normals, 3);

    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', position);
    lines.setAttribute('aNormal', normal);
    lines.setIndex(new THREE.BufferAttribute(surface.wire.edges, 1));

    const nodes = new THREE.BufferGeometry();
    nodes.setAttribute('position', position);
    nodes.setAttribute('aNormal', normal);

    /**
     * A per-node seed, so they do not all twinkle in unison.
     *
     * Also carries which nodes are EYES: the reference has the eyes as the one
     * place the network concentrates into something solid, and finding them by
     * distance here means they follow the anatomy rather than being painted on
     * at a fixed screen position.
     */
    const seed = new Float32Array(count);
    const eye = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seed[i] = Math.random();
      const x = surface.positions[i * 3];
      const y = surface.positions[i * 3 + 1];
      const z = surface.positions[i * 3 + 2];
      const dl = Math.hypot(x - EYES.left[0], y - EYES.left[1], z - EYES.left[2]);
      const dr = Math.hypot(x - EYES.right[0], y - EYES.right[1], z - EYES.right[2]);
      eye[i] = Math.max(0, 1 - Math.min(dl, dr) / 0.016);
    }
    nodes.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    nodes.setAttribute('aEye', new THREE.BufferAttribute(eye, 1));
    lines.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    lines.setAttribute('aEye', new THREE.BufferAttribute(eye, 1));

    // The buffers hold no real positions until the shader places them, so a
    // derived bounding sphere would be wrong and the figure would be culled at
    // the worst moment.
    const bounds = new THREE.Sphere(new THREE.Vector3(0, 0.2, 0.3), 3);
    lines.boundingSphere = bounds;
    nodes.boundingSphere = bounds;

    return { lineGeometry: lines, nodeGeometry: nodes };
  }, [surface]);

  const uniforms = useMemo(
    () => ({
      uPlacement: { value: FIGURE_PLACEMENT.clone() },
      uNormalMatrix: { value: new THREE.Matrix3().setFromMatrix4(FIGURE_PLACEMENT) },
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uLevel: { value: 0 },
      uLineColour: { value: LINE_COLOUR.clone() },
      uEdgeColour: { value: EDGE_COLOUR.clone() },
      uNodeColour: { value: NODE_COLOUR.clone() },
      uViewportHeight: { value: 1080 },
    }),
    [],
  );

  const lineMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        vertexShader: SHARED_VERTEX,
        fragmentShader: LINE_FRAGMENT,
      }),
    [uniforms],
  );

  const nodeMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        vertexShader: NODE_VERTEX,
        fragmentShader: NODE_FRAGMENT,
      }),
    [uniforms],
  );

  // Compiled GPU programs and uploaded buffers are not freed by React dropping
  // the component.
  useEffect(
    () => () => {
      lineMaterial.dispose();
      nodeMaterial.dispose();
      lineGeometry.dispose();
      nodeGeometry.dispose();
    },
    [lineMaterial, nodeMaterial, lineGeometry, nodeGeometry],
  );

  useFrame((state, rawDelta) => {
    const g = group.current;
    if (!g) return;

    const phase = useTransformStore.getState().phase;
    const want = phase === 'HUMANOID_ACTIVE' ? 1 : 0;
    // Real elapsed time, not a clamped delta: a fade has no stability problem
    // to protect and a clamp makes it frame-rate dependent.
    reveal.current += (want - reveal.current) * (1 - Math.exp(-rawDelta / 0.45));
    g.visible = reveal.current > 0.003;
    if (!g.visible) return;

    uniforms.uReveal.value = reveal.current;
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uLevel.value = useAIStore.getState().speechLevel;
    uniforms.uViewportHeight.value = state.size.height * state.viewport.dpr;
  });

  return (
    <group ref={group} visible={false}>
      <lineSegments geometry={lineGeometry} material={lineMaterial} frustumCulled={false} />
      <points geometry={nodeGeometry} material={nodeMaterial} frustumCulled={false} />
    </group>
  );
}

/**
 * Shared by both passes: place the point, and work out how much of the
 * silhouette it is on.
 */
const SHARED_VERTEX = /* glsl */ `
precision highp float;

in vec3 aNormal;
in float aSeed;
in float aEye;

uniform mat4 uPlacement;
uniform mat3 uNormalMatrix;
uniform float uTime;
uniform float uReveal;
uniform float uLevel;

out float vSilhouette;
out float vDepth;
out float vKey;
out float vSeed;
out float vEye;

void main() {
  vec4 world = uPlacement * vec4(position, 1.0);
  vec3 n = normalize(uNormalMatrix * aNormal);

  vec4 mv = modelViewMatrix * world;
  vec3 toEye = normalize(-mv.xyz);
  vec3 nView = normalize(normalMatrix * n);

  // 1 on the contour, 0 where the surface faces the camera squarely. This is
  // the term that draws the profile, the brow and the jaw — the bright curves
  // that separate a head from a tangle of triangles.
  vSilhouette = pow(1.0 - abs(dot(nView, toEye)), 2.4);

  // Nearer is brighter. Without this the far side of the skull competes with
  // the face and the whole figure flattens.
  vDepth = clamp(1.0 - (-mv.z - 0.18) / 0.62, 0.0, 1.0);

  vKey = max(dot(n, normalize(vec3(-0.82, 0.50, 0.14))), 0.0);
  vSeed = aSeed;
  vEye = aEye;

  gl_Position = projectionMatrix * mv;
}
`;

/**
 * The nodes. Same placement and same silhouette term as the lines, plus a
 * screen-space size that falls off with distance so the far side of the head
 * does not produce dots the same size as the near side.
 */
const NODE_VERTEX = /* glsl */ `
precision highp float;

in vec3 aNormal;
in float aSeed;
in float aEye;

uniform mat4 uPlacement;
uniform mat3 uNormalMatrix;
uniform float uTime;
uniform float uReveal;
uniform float uLevel;
uniform float uViewportHeight;

out float vSilhouette;
out float vDepth;
out float vKey;
out float vSeed;
out float vEye;

void main() {
  vec4 world = uPlacement * vec4(position, 1.0);
  vec3 n = normalize(uNormalMatrix * aNormal);

  vec4 mv = modelViewMatrix * world;
  vec3 toEye = normalize(-mv.xyz);
  vec3 nView = normalize(normalMatrix * n);

  vSilhouette = pow(1.0 - abs(dot(nView, toEye)), 2.4);
  vDepth = clamp(1.0 - (-mv.z - 0.18) / 0.62, 0.0, 1.0);
  vKey = max(dot(n, normalize(vec3(-0.82, 0.50, 0.14))), 0.0);
  vSeed = aSeed;
  vEye = aEye;

  // A fixed WORLD size, projected — so the dots keep their scale on the head
  // rather than staying a constant number of pixels as the figure moves.
  float radius = 0.0016 + 0.0022 * aEye;
  gl_PointSize = clamp(
    radius * 2.0 * projectionMatrix[1][1] * (uViewportHeight * 0.5) / max(-mv.z, 0.05),
    1.0,
    14.0
  );
  gl_Position = projectionMatrix * mv;
}
`;

const LINE_FRAGMENT = /* glsl */ `
precision highp float;

in float vSilhouette;
in float vDepth;
in float vKey;
in float vSeed;
in float vEye;

uniform vec3 uLineColour;
uniform vec3 uEdgeColour;
uniform float uReveal;
uniform float uTime;
uniform float uLevel;

out vec4 fragColor;

void main() {
  // The body of the mesh, dim and cool.
  vec3 colour = uLineColour * (0.20 + 0.34 * vKey);

  // And the contour, which is where nearly all of the drawing happens.
  colour += uEdgeColour * vSilhouette * 1.55;

  // A slow travelling brightening, so the network reads as powered rather than
  // printed. Irregular rate, so it never settles into a pulse.
  float pulse = 0.5 + 0.5 * sin(vSeed * 23.7 + uTime * 1.35);
  colour *= 0.80 + 0.26 * pulse;

  // It brightens when it speaks.
  colour *= 1.0 + uLevel * 0.55;

  float alpha = (0.16 + vSilhouette * 0.80) * vDepth * uReveal;
  fragColor = vec4(colour * vDepth, alpha);
}
`;

const NODE_FRAGMENT = /* glsl */ `
precision highp float;

in float vSilhouette;
in float vDepth;
in float vKey;
in float vSeed;
in float vEye;

uniform vec3 uNodeColour;
uniform float uReveal;
uniform float uTime;
uniform float uLevel;

out vec4 fragColor;

void main() {
  // Round, and soft at the rim. A square node reads as a rendering artefact.
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float core = 1.0 - smoothstep(0.0, 1.0, r);

  // Nodes twinkle individually. A third of them are noticeably brighter at any
  // moment, which is what gives the network its scattered-starfield quality
  // instead of looking like a regular grid of identical dots.
  float twinkle = 0.5 + 0.5 * sin(vSeed * 61.3 + uTime * 2.1);
  float bright = 0.34 + 0.52 * twinkle + 0.55 * vSilhouette;

  vec3 colour = uNodeColour * bright * (0.5 + 0.6 * vKey);

  // The eyes are the one place the network concentrates into something solid.
  colour += uNodeColour * vEye * 2.6;

  colour *= 1.0 + uLevel * 0.7;

  float alpha = core * (0.30 + 0.55 * twinkle + vEye) * vDepth * uReveal;
  fragColor = vec4(colour * vDepth, clamp(alpha, 0.0, 1.0));
}
`;
