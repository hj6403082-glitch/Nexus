'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { EYES, JAW } from './anatomy';
import { BUST_BOUNDS, BUST_SDF, sdMandibleCPU } from './sdf';
import { bakeLighting, type BakedLight } from './lighting';
import { CORE, FIGURE_NORMAL_MATRIX, FIGURE_PLACEMENT } from './placement';
import { measureSpread } from './spread';
import { bakeSurface } from './Baker';
import { selectPoisson } from './poisson';
import { KEY_DIR, makeBeadMaterial, MAX_CARDS } from './beadMaterial';
import { sampleCardFaces } from './sampleCards';
import { TIER_BUDGET, useSystemStore } from '@/stores/useSystemStore';
import { PHASE_BOUNDS, useTransformStore } from '@/stores/useTransformStore';
import { useAIStore } from '@/stores/useAIStore';
import { useGestureStore } from '@/stores/useGestureStore';
import { MODULES } from '@/core/constants/modules';
import { cardRegistry } from '@/scene/cardRegistry';
import { clamp01 } from '@/core/math/util';
import { damp } from '@/core/math/spring';
import { audio } from '@/audio/AudioEngine';

/**
 * Where the figure stands, and where the particles gather on the way.
 *
 * The bust is baked about its own origin at human scale, so the crown sits at
 * y = 1.76 and the chest at y = 1.14 — a person standing on a floor at y = 0.
 * The ring's camera sits at roughly y = 0.1 INSIDE that ring, so a figure left
 * at its authored origin is standing on top of the camera. It has to be moved
 * out in front and dropped to eye level.
 */
type BakeState = 'idle' | 'baking' | 'ready' | 'failed';

/**
 * THE HUMAN FORM.
 *
 * ONE BUFFER, ONE CLOCK. Every particle carries three keyframes — where it sat
 * on a card, where it gathers in the core, and where it lands on the figure —
 * and a single float moves it through them. There is no second particle system
 * and no hand-off: the beads that were the cards are, numerically, the beads
 * that are the face.
 */
export function HumanForm() {
  const { gl, size } = useThree();
  const points = useRef<THREE.Points>(null);
  const material = useMemo(() => makeBeadMaterial(), []);
  // A ShaderMaterial holds a compiled GPU program; React dropping the
  // component does not free it.
  useEffect(() => () => material.dispose(), [material]);
  const [bakeState, setBakeState] = useState<BakeState>('idle');

  /**
   * The particle count is FROZEN for the whole transformation.
   *
   * The adaptive monitor steps the tier whenever the frame time moves, and a
   * tier change rebuilds this buffer. Rebuilding it mid-choreography throws
   * away every particle's baked figure keyframe — the face collapses into a
   * cluster at the core and never recovers, because there is nothing left to
   * tell a bead where its place on the head was. So the count is captured once
   * and the monitor's judgement is suspended for the duration.
   */
  const frozenCount = useRef(0);

  const figure = useRef<{
    positions: Float32Array;
    normals: Float32Array;
    spacing: number;
    spread: Float32Array;
    light: BakedLight;
  } | null>(
    null,
  );

  // --- bake ----------------------------------------------------------------
  /**
   * The bake runs exactly once, guarded by a ref rather than by `bakeState`.
   *
   * Depending on `bakeState` here is a trap: the effect's own
   * `setBakeState('baking')` re-renders, React tears down the effect whose
   * cleanup sets `cancelled`, and the in-flight bake aborts at its next
   * checkpoint — silently, because cancellation is not an error. The symptom
   * was a transformation that dimmed the room, said "give me a moment", and
   * then waited forever.
   */
  const bakeStarted = useRef(false);

  useEffect(() => {
    if (bakeStarted.current) return;
    bakeStarted.current = true;
    let cancelled = false;
    setBakeState('baking');

    const tier = useSystemStore.getState().tier;
    const want = TIER_BUDGET[tier].figure;
    const candidates = Math.min(want * 3, 196608);

    const run = async () => {
      try {
        const bake = bakeSurface({
          renderer: gl,
          glsl: BUST_SDF,
          fn: 'sdBust',
          bounds: BUST_BOUNDS,
          candidates,
          rowsPerChunk: 24,
        });

        // Chunked across frames. A bake that stalls the main thread for 400 ms
        // is a bake the user watches happen.
        let bakeResult = bake.next();
        while (!bakeResult.done) {
          if (cancelled) return;
          await nextFrame();
          bakeResult = bake.next();
        }
        const baked = bakeResult.value;
        if (baked.count < 64) throw new Error('bake produced no surface');

        const selector = selectPoisson(baked.positions, baked.normals, baked.count, want, 16000);
        let selection = selector.next();
        while (!selection.done) {
          if (cancelled) return;
          await nextFrame();
          selection = selector.next();
        }

        if (cancelled) return;

        // Each bead measures its own neighbourhood, because the point set is
        // not uniform: the head came out solid and the chest, several times
        // the area, was 3% void. One radius cannot serve both.
        const spreader = measureSpread(
          selection.value.positions,
          selection.value.positions.length / 3,
          selection.value.spacing,
        );
        let spreadStep = spreader.next();
        while (!spreadStep.done) {
          if (cancelled) return;
          await nextFrame();
          spreadStep = spreader.next();
        }
        if (cancelled) return;

        // The dark is what makes a face read, and it is only affordable
        // because the figure does not deform: two floats per point, asked of
        // the same field that produced the surface, held for its lifetime.
        const lighter = bakeLighting(
          selection.value.positions,
          selection.value.normals,
          selection.value.positions.length / 3,
          KEY_DIR,
        );
        let lit = lighter.next();
        while (!lit.done) {
          if (cancelled) return;
          await nextFrame();
          lit = lighter.next();
        }

        if (cancelled) return;
        figure.current = {
          positions: selection.value.positions,
          normals: selection.value.normals,
          spacing: selection.value.spacing,
          spread: spreadStep.value,
          light: lit.value,
        };
        setBakeState('ready');
        useSystemStore
          .getState()
          .pushLog(
            `figure baked · ${want.toLocaleString()} points · ${(selection.value.spacing * 1000).toFixed(1)}mm`,
            'ok',
          );
      } catch (err) {
        if (cancelled) return;
        setBakeState('failed');
        useSystemStore
          .getState()
          .pushLog(`figure bake failed: ${err instanceof Error ? err.message : err}`, 'warn');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [gl]);

  // --- build the buffer at the instant of the command ----------------------
  const phase = useTransformStore((s) => s.phase);
  const built = useRef(false);

  useEffect(() => {
    if (phase === 'NORMAL') {
      built.current = false;
      return;
    }
    // Depends on `bakeState` as well as `phase`: if the command arrives before
    // the bake lands, the clock holds (see the frame loop) and this must run
    // again the moment the surface is ready.
    if (built.current || !figure.current || !points.current) return;
    built.current = true;

    const fig = figure.current;
    const count = fig.positions.length / 3;
    frozenCount.current = count;

    // Suspend the performance monitor's judgement for the whole sequence.
    useSystemStore.getState().lockTier(true);

    const cards = sampleCardFaces(count);
    const geometry = points.current.geometry;

    const stagger = new Float32Array(count);
    const jawWeight = new Float32Array(count);
    const seam = new Float32Array(count);
    const eye = new Float32Array(count);


    for (let i = 0; i < count; i++) {
      const x = fig.positions[i * 3];
      const y = fig.positions[i * 3 + 1];
      const z = fig.positions[i * 3 + 2];

      // Crown first, chest last. The head assembles while the shoulders are
      // still arriving; that ordering is what makes it read as a figure
      // gathering rather than a cloud resolving all at once.
      stagger[i] = clamp01((BUST_BOUNDS.max[1] - y) / (BUST_BOUNDS.max[1] - BUST_BOUNDS.min[1]));

      // Jaw membership is DISTANCE TO THE MANDIBLE, feathered so the hinge
      // has no hard edge. It used to be "below this height", which is also
      // true of the neck, the shoulders and the entire chest — so opening the
      // mouth swung the whole torso about a line through the ears. Nothing
      // caught it because a headless browser has no speech voices, so the
      // mouth never opened in any test that took a screenshot.
      jawWeight[i] = 1 - clamp01(sdMandibleCPU(x, y, z) / JAW.feather);

      // Distance to the lip seam → the thin line that lights when it speaks.
      const dy = Math.abs(y - JAW.seam.y);
      const dz = Math.abs(z - JAW.seam.z);
      const dx = Math.max(0, Math.abs(x) - JAW.seam.halfWidth);
      const d = Math.hypot(dx, dy * 2.2, dz * 1.4);
      seam[i] = clamp01(1 - d / 0.022);

      const dl = Math.hypot(x - EYES.left[0], y - EYES.left[1], z - EYES.left[2]);
      const dr = Math.hypot(x - EYES.right[0], y - EYES.right[1], z - EYES.right[2]);
      eye[i] = clamp01(1 - Math.min(dl, dr) / EYES.gather);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aCardLocal', new THREE.BufferAttribute(cards.local, 3));
    geometry.setAttribute('aTint', new THREE.BufferAttribute(cards.tint, 3));
    geometry.setAttribute('aCardIndex', new THREE.BufferAttribute(cards.index, 1));
    geometry.setAttribute('aKind', new THREE.BufferAttribute(cards.kind, 1));
    geometry.setAttribute('aFigure', new THREE.BufferAttribute(fig.positions, 3));
    geometry.setAttribute('aFigureNormal', new THREE.BufferAttribute(fig.normals, 3));
    geometry.setAttribute('aStagger', new THREE.BufferAttribute(stagger, 1));
    geometry.setAttribute('aJawWeight', new THREE.BufferAttribute(jawWeight, 1));
    geometry.setAttribute('aSeam', new THREE.BufferAttribute(seam, 1));
    geometry.setAttribute('aEye', new THREE.BufferAttribute(eye, 1));
    geometry.setAttribute('aSpread', new THREE.BufferAttribute(fig.spread, 1));
    geometry.setAttribute('aOcclusion', new THREE.BufferAttribute(fig.light.occlusion, 1));
    geometry.setAttribute('aShadow', new THREE.BufferAttribute(fig.light.shadow, 1));
    geometry.setDrawRange(0, count);
    // The bounding sphere cannot be derived from `position` (which is a dummy
    // buffer: every real position is computed in the vertex shader), so it is
    // set by hand. Without it the figure is frustum-culled at the worst moment.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.4, 1), 8);

    /**
     * The radius is now PER BEAD — see `spread.ts` — so this is only the
     * quality dial on top of it. It used to carry the tier's `beadScale` as
     * well, which double counted: a lower tier asks for fewer points, the
     * selection reports the wider spacing that results, and the radius already
     * grew to match.
     */
    material.uniforms.uBeadSize.value = 1.0;
  }, [phase, bakeState, material]);

  // Release the tier lock when the ring comes back, applying anything pending.
  useEffect(() => {
    if (phase === 'NORMAL') useSystemStore.getState().lockTier(false);
  }, [phase]);

  // --- per frame: a few dozen uniforms and ten matrices --------------------
  const jawOpen = useRef(0);
  const headYaw = useRef(0);
  const breath = useRef(0);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const transform = useTransformStore.getState();

    /**
     * THE CLOCK WAITS FOR THE SURFACE.
     *
     * If the command arrives before the bake has landed, the journey holds at
     * the end of COMMAND_DETECTED — the room has dimmed, NEXUS has said "give
     * me a moment", and that line is now literally true. Running on regardless
     * produced a completed transformation with nothing in it: every particle
     * had a card keyframe and a core keyframe and no figure keyframe at all.
     */
    const surfaceReady = figure.current !== null;
    if (surfaceReady || transform.t < PHASE_BOUNDS.command * 0.985) {
      transform.tick(dt);
    }
    transform.tickHand(dt);

    const p = points.current;
    if (!p) return;
    p.visible = transform.phase !== 'NORMAL' && built.current;
    if (!p.visible) return;

    const u = material.uniforms;
    const env = transform.env;

    // Ten matrices. That is the entire per-frame CPU cost of keeping every
    // particle pinned to its card pixel while the cards turn toward the core.
    const matrices = u.uCardMatrix.value as THREE.Matrix4[];
    const slots = Math.min(MAX_CARDS, MODULES.length);
    for (let i = 0; i < slots; i++) {
      const handle = cardRegistry.get(MODULES[i].id);
      if (handle?.matrix) matrices[i].copy(handle.matrix);
    }

    u.uCorePosition.value.copy(CORE);
    (u.uFigureMatrix.value as THREE.Matrix4).copy(FIGURE_PLACEMENT);
    (u.uFigureNormalMatrix.value as THREE.Matrix3).copy(FIGURE_NORMAL_MATRIX);
    u.uCollapse.value = env.collapse;
    u.uCore.value = env.core;
    u.uSkeleton.value = env.skeleton;
    u.uBody.value = env.body;
    u.uEyes.value = env.eyes;
    u.uPresence.value = env.presence;
    u.uTime.value = state.clock.elapsedTime;
    u.uViewportHeight.value = size.height;

    const camera = state.camera as THREE.PerspectiveCamera;
    u.uProjA.value = camera.projectionMatrix.elements[10];
    u.uProjB.value = camera.projectionMatrix.elements[14];

    // --- the mouth ---------------------------------------------------------
    // Openness follows the speech envelope with a FAST ATTACK and a SLOWER
    // RELEASE, then is held to five discrete steps. A continuous jaw reads as
    // rubber; quantising reads as a mechanism deciding how far to open.
    const level = useAIStore.getState().speechLevel;
    const attack = level > jawOpen.current ? 0.018 : 0.085;
    jawOpen.current = damp(jawOpen.current, level, attack, dt);
    const stepped = Math.round(clamp01(jawOpen.current) * JAW.steps) / JAW.steps;
    u.uJawAngle.value = stepped * JAW.maxAngle;
    u.uMouthLevel.value = stepped;

    // --- alive, not animated ----------------------------------------------
    // Breath in the chest, and a RIGID head turn toward the cursor or toward a
    // presented panel. No sway. No float. Rigid rotation cannot open gaps.
    breath.current = Math.sin(state.clock.elapsedTime * 0.72) * 0.5 + 0.5;
    u.uBreath.value = breath.current * env.presence;

    const pointer = useGestureStore.getState().pointer;
    const hand = useGestureStore.getState().hands[0];
    const lookX = hand.present ? hand.x : pointer.x;
    headYaw.current = damp(headYaw.current, lookX * 0.22 * env.presence, 0.35, dt);
    u.uHeadYaw.value = headYaw.current;

    // --- the spatial voice relocates to the face — in DIRECTION ------------
    // The panner attenuates with distance, and a head four metres out put the
    // voice at half its level. AudioEngine caps the distance; this only aims it.
    audio.placeVoice(
      CORE.x - camera.position.x,
      CORE.y + 0.05 - camera.position.y,
      CORE.z - camera.position.z,
    );
  });

  return (
    <points ref={points} visible={false} frustumCulled={false}>
      <bufferGeometry />
      <primitive object={material} attach="material" />
    </points>
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
