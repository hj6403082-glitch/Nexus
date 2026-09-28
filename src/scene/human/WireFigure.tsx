'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EYES } from './anatomy';
import { FIGURE_PLACEMENT } from './placement';
import type { Wireframe } from './wireframe';
import { LINE_FRAGMENT, NODE_FRAGMENT, NODE_VERTEX, SHARED_VERTEX } from './wireShaders';
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
      eye[i] = Math.max(0, 1 - Math.min(dl, dr) / 0.030);
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
