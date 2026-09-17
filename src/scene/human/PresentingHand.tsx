'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { HAND_HINGE_COUNT } from './anatomy';
import { HAND_BOUNDS, HAND_SDF } from './sdf';
import { bakeSurface } from './Baker';
import { selectPoisson } from './poisson';
import { assignHandBones, HandRig } from './handRig';
import { TIER_BUDGET, useSystemStore } from '@/stores/useSystemStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { MOTION } from '@/core/constants/motion';
import { advanceSpring, makeSpring } from '@/core/math/spring';
import { clamp01, hash11 } from '@/core/math/util';

/**
 * THE HAND.
 *
 * Built exactly as the bust: a second signed-distance field, baked and spread
 * through the same pipeline, drawn with the same beads under the same key.
 *
 * The panel it presents is NEVER in the hand. The panel is DOM — readability is
 * the entire point of presenting it — and it is carried as a HOLOGRAM: this rig
 * publishes where the held panel's centre should sit in screen space every
 * frame, and the DOM panel follows that anchor with motion values. No React
 * render per frame, and the moment the hand opens its fingers the panel springs
 * to its slot beside the figure and stays there, sharp and still.
 */
export function PresentingHand() {
  const { gl, camera, size } = useThree();
  const points = useRef<THREE.Points>(null);
  const rig = useMemo(() => new HandRig(), []);
  const [ready, setReady] = useState(false);

  const rise = useMemo(() => makeSpring(0), []);
  const curl = useMemo(() => makeSpring(0), []);
  const materialise = useRef(0);

  const material = useMemo(() => makeHandMaterial(), []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const tier = useSystemStore.getState().tier;
        const want = TIER_BUDGET[tier].hand;
        const bake = bakeSurface({
          renderer: gl,
          glsl: HAND_SDF,
          fn: 'sdHand',
          bounds: HAND_BOUNDS,
          candidates: Math.min(want * 3, 98304),
          rowsPerChunk: 24,
          seed: 31,
        });
        let step = bake.next();
        while (!step.done) {
          if (cancelled) return;
          await nextFrame();
          step = bake.next();
        }
        const baked = step.value;
        if (baked.count < 32) throw new Error('hand bake produced no surface');

        const selector = selectPoisson(baked.positions, baked.normals, baked.count, want, 16000);
        let sel = selector.next();
        while (!sel.done) {
          if (cancelled) return;
          await nextFrame();
          sel = selector.next();
        }
        if (cancelled || !points.current) return;

        const { positions, normals, spacing } = sel.value;
        const bones = assignHandBones(positions, want);
        const noise = new Float32Array(want);
        for (let i = 0; i < want; i++) noise[i] = hash11(i * 3.77);

        const g = points.current.geometry;
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        g.setAttribute('aNormal', new THREE.BufferAttribute(normals, 3));
        g.setAttribute('aBone', new THREE.BufferAttribute(bones, 1));
        g.setAttribute('aNoise', new THREE.BufferAttribute(noise, 1));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4);
        // Same coverage rule as the bust: the bead radius follows the spacing
        // the selection achieved, at 0.62 of it, so neighbouring beads overlap
        // by about a quarter of their diameter and the surface has no holes.
        material.uniforms.uBeadSize.value =
          (spacing / 0.0034) * 0.62 * TIER_BUDGET[tier].beadScale;
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          useSystemStore
            .getState()
            .pushLog(`hand bake failed: ${err instanceof Error ? err.message : err}`, 'warn');
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [gl, material]);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const p = points.current;
    if (!p) return;

    const transform = useTransformStore.getState();
    const visible = ready && transform.env.presence > 0.3;
    p.visible = visible;
    if (!visible) {
      if (transform.handAnchor.visible) transform.setHandAnchor(0, 0, false);
      return;
    }

    advanceSpring(rise, transform.handRise, MOTION.ARRIVING, dt);
    advanceSpring(curl, transform.handCurl, MOTION.LEAVING, dt);

    const anchor = rig.update(camera, clamp01(rise.value), clamp01(curl.value));
    transform.setHandAnchor(anchor.x, anchor.y, rise.value > 0.12);

    /**
     * Materialise STOCHASTICALLY over the first third of the rise, rather than
     * fading the whole hand in. A uniform fade reads as a ghost; beads popping
     * into existence in random order reads as something being assembled, which
     * is what everything else in this sequence is doing.
     */
    materialise.current = clamp01(rise.value / 0.34);

    const u = material.uniforms;
    u.uWorld.value.copy(rig.world);
    (u.uHinges.value as THREE.Matrix4[]).forEach((m, i) => m.copy(rig.hinges[i]));
    u.uMaterialise.value = materialise.current;
    u.uViewportHeight.value = size.height;
    const cam = camera as THREE.PerspectiveCamera;
    u.uProjA.value = cam.projectionMatrix.elements[10];
    u.uProjB.value = cam.projectionMatrix.elements[14];
  });

  return (
    <points ref={points} visible={false} frustumCulled={false}>
      <bufferGeometry />
      <primitive object={material} attach="material" />
    </points>
  );
}

function makeHandMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    uniforms: {
      uWorld: { value: new THREE.Matrix4() },
      uHinges: {
        value: Array.from({ length: HAND_HINGE_COUNT }, () => new THREE.Matrix4()),
      },
      uMaterialise: { value: 0 },
      uBeadSize: { value: 1 },
      uViewportHeight: { value: 1080 },
      uProjA: { value: -1 },
      uProjB: { value: -0.2 },
      uKeyDir: { value: new THREE.Vector3(-0.66, 0.52, 0.42).normalize() },
    },
    vertexShader: /* glsl */ `
      precision highp float;
      in vec3 aNormal;
      in float aBone;
      in float aNoise;

      uniform mat4 uWorld;
      uniform mat4 uHinges[${HAND_HINGE_COUNT}];
      uniform float uMaterialise;
      uniform float uBeadSize;
      uniform float uViewportHeight;

      out vec3 vNormal;
      out vec3 vViewPos;
      out float vRadius;
      out float vAlive;

      void main() {
        vec3 p = position;
        vec3 n = aNormal;

        // Rigid rotation about the bead's own hinge. A negative index is the
        // root — the palm and the forearm never curl.
        int bone = int(aBone + 0.5);
        if (aBone >= 0.0) {
          mat4 m = uHinges[bone];
          p = (m * vec4(p, 1.0)).xyz;
          n = normalize(mat3(m) * n);
        }

        vec4 world = uWorld * vec4(p, 1.0);
        vNormal = normalize(mat3(uWorld) * n);

        vAlive = step(aNoise, uMaterialise);

        vec4 mv = viewMatrix * world;
        vViewPos = mv.xyz;
        float radius = 0.0034 * uBeadSize;
        vRadius = radius;
        gl_PointSize = max(
          radius * 2.0 * 1.35 * projectionMatrix[1][1] * (uViewportHeight * 0.5) / max(-mv.z, 0.05),
          1.0
        );
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      in vec3 vNormal;
      in vec3 vViewPos;
      in float vRadius;
      in float vAlive;

      uniform vec3 uKeyDir;
      uniform float uProjA;
      uniform float uProjB;

      out vec4 fragColor;

      void main() {
        if (vAlive < 0.5) discard;
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0) discard;
        vec3 impostor = vec3(c.x, -c.y, sqrt(1.0 - r2));

        vec3 surface = vViewPos + impostor * vRadius;
        float ndcZ = (uProjA * surface.z + uProjB) / max(-surface.z, 1e-5);
        gl_FragDepth = clamp(ndcZ * 0.5 + 0.5, 0.0, 1.0);

        vec3 n = normalize(mix(impostor, vNormal, 0.65));
        float key = max(dot(n, normalize(uKeyDir)), 0.0);
        vec3 colour = mix(vec3(0.055, 0.105, 0.225), vec3(0.42, 0.62, 0.95), key);
        // Same key, same palette, no rim term — see beadMaterial.
        colour += vec3(0.30, 0.45, 0.70) * pow(clamp(key, 0.0, 1.0), 12.0) * 0.6;
        fragColor = vec4(colour, 1.0);
      }
    `,
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
