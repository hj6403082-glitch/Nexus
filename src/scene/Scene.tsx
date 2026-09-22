'use client';

import { Suspense, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Atmosphere } from './Atmosphere';
import { Precipitation } from './env/Precipitation';
import { Carousel } from './Carousel';
import { GestureTrail } from './GestureTrail';
import { Picker } from './Picker';
import { ReactiveLight } from './ReactiveLight';
import { FocusStage } from './focus/FocusStage';
import { PresentationClock } from './PresentationClock';
import { TargetingBracket } from './TargetingBracket';
import { Rig } from './Rig';
import { PostChain } from './post/PostChain';
import { HumanForm } from './human/HumanForm';
import { PresentingHand } from './human/PresentingHand';
import { WORLDS } from '@/core/constants/worlds';
import { useSystemStore } from '@/stores/useSystemStore';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { useGestureStore } from '@/stores/useGestureStore';
import { cardRegistry } from './cardRegistry';
import { useModuleData } from '@/stores/useModuleData';
import { useTransformStore } from '@/stores/useTransformStore';
import { damp } from '@/core/math/spring';
import { markContextLost, markContextRestored } from './gpuState';

/**
 * `?nopost` disables the entire post chain.
 *
 * Kept because the composer sits between the scene and the screen: when the
 * frame goes wrong, the first question is always "is the scene wrong, or is
 * the chain wrong", and this answers it in one reload. It is also a usable
 * low-power mode on a machine that cannot afford bloom.
 */
const POST_ENABLED =
  typeof window === 'undefined' || !window.location.search.includes('nopost');

export function Scene({ onFail }: { onFail?: (reason: string) => void } = {}) {
  return (
    <Canvas
      aria-label="NEXUS spatial interface. Use the left and right arrow keys to rotate the module ring, Enter to open the centred module, and Escape to close it. Press Command-K for a searchable list of everything."
      gl={{
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
      }}
      dpr={[1, 1.85]}
      /**
        * 54 degrees, not 46.
        *
        * Ten cards on a circle are 36 degrees apart, and a 46-degree vertical
        * frustum on a 16:9 window spans about 68 degrees across — so the two
        * cards either side of centre fell exactly on the frame edge and the
        * "circular orbit" rendered as one card with two slivers. At 54 the
        * horizontal span is about 80 degrees and the neighbours are wholly
        * inside it, which is the difference between a carousel you can read
        * and a card with decoration at the edges.
        */
      camera={{ fov: 54, near: 0.05, far: 80, position: [0, 0.12, -0.35] }}
      onCreated={({ gl }) => {
        gl.setClearColor(new THREE.Color('#04060b'), 1);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <SceneBody onFail={onFail} />
    </Canvas>
  );
}

function SceneBody({ onFail }: { onFail?: (reason: string) => void }) {
  const world = useSystemStore((s) => s.world);
  const grade = WORLDS[world];

  return (
    <>
      <Probe />
      <ContextGuard onLost={onFail ?? (() => {})} />
      <MotionGate />
      <PerformanceMonitor />

      <fog attach="fog" args={['#070b12', 3, 26]} />
      <ambientLight intensity={0.22} color="#7fa8e8" />
      <directionalLight position={[-3, 5, 4]} intensity={0.9} color={grade.keyLight} />
      <ReactiveLight />

      <Rig />
      <PresentationClock />

      <Suspense fallback={null}>
        <Atmosphere />
        <Precipitation />
        <Carousel />
        <Picker />
        <GestureTrail />
        <TargetingBracket />
        <FocusStage />
        <HumanForm />
        <PresentingHand />
      </Suspense>

      {POST_ENABLED && <PostChain />}
    </>
  );
}

/**
 * WebGL contexts are LENT, not owned.
 *
 * A driver reset, a laptop switching GPUs, too many live contexts in other
 * tabs — any of these takes the context away, and everything drawn with it
 * stops. The browser will usually give it back if asked, so the default
 * behaviour (do nothing, leave a frozen canvas) is worth overriding:
 * preventDefault on the loss event is what makes restoration possible at all.
 */
function ContextGuard({ onLost }: { onLost: (reason: string) => void }) {
  const { gl } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    let timer = 0;

    const lost = (event: Event) => {
      // Without this, the browser will not attempt to restore the context.
      event.preventDefault();
      markContextLost();
      useSystemStore.getState().pushLog('gpu context lost · attempting restore', 'warn');
      // If it has not returned after a few seconds it is not coming back on
      // its own; hand over to the flat mode rather than leave a dead canvas.
      timer = window.setTimeout(() => {
        onLost('the GPU context was lost and did not return');
      }, 6000);
    };

    const restored = () => {
      window.clearTimeout(timer);
      markContextRestored();
      useSystemStore.getState().pushLog('gpu context restored', 'ok');
    };

    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      window.clearTimeout(timer);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, [gl, onLost]);

  return null;
}


/**
 * Reports GPU identity into the HUD, and exposes a read-only snapshot of the
 * authoritative scene state on `window.__nexus`.
 *
 * The snapshot is what makes "zero drift with zero input" checkable from
 * outside the app rather than only by reading the code: a harness can sample
 * the carousel angle and the camera transform seconds apart and compare them
 * exactly. It reads state and never writes any.
 */
function Probe() {
  const { gl, camera } = useThree();

  useEffect(() => {
    const w = window as unknown as {
      __nexus?: () => unknown;
      __nexusTransform?: () => unknown;
    };

    w.__nexus = () => ({
      angle: useCarouselStore.getState().angle,
      camera: {
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
      },
      motionMultiplier: useSystemStore.getState().motionMultiplier,
      tier: useSystemStore.getState().tier,
      world: useSystemStore.getState().world,
      hovered: useCarouselStore.getState().hovered,
      dragging: useCarouselStore.getState().dragging,
      open: useCarouselStore.getState().open,
      focusPresence: useCarouselStore.getState().focusPresence,
      ring: {
        radius: useCarouselStore.getState().radius,
        spread: useCarouselStore.getState().spread,
      },
      cursor: useGestureStore.getState().cursor,
      // Where the dragged card actually IS. The store knowing a drag is in
      // progress proves nothing about whether the card moved, and the first
      // version of the drag passed a store-only check while the card sat
      // perfectly still in its slot.
      draggedAt: (() => {
        const id = useCarouselStore.getState().dragging;
        const mesh = id ? cardRegistry.get(id)?.mesh : undefined;
        if (!mesh) return null;
        mesh.updateWorldMatrix(true, false);
        return mesh.getWorldPosition(new THREE.Vector3()).toArray();
      })(),
      transform: useTransformStore.getState().phase,
      log: useSystemStore.getState().log.map((l) => l.text),
      // The row labels each module is currently carrying. Card faces are drawn
      // to a canvas, so this is the only way a harness can assert what a card
      // actually says.
      rows: Object.fromEntries(
        Object.entries(useModuleData.getState().records).map(([id, record]) => [
          id,
          (record?.face.rows ?? []).map(([label]) => label),
        ]),
      ),
    });

    /**
     * The raw card face, as a data URL.
     *
     * Card faces are drawn to a canvas, so when something on a face is missing
     * there are two very different possible culprits — the painter never drew
     * it, or the renderer lost it — and no amount of staring at the composite
     * can tell them apart. This hands the harness the painter's own pixels.
     */
    (window as unknown as { __nexusFace?: (id: string) => string | null }).__nexusFace = (
      id: string,
    ) => {
      const handle = cardRegistry.get(id as never);
      if (!handle) return null;
      try {
        return handle.painter.canvas.toDataURL();
      } catch {
        return null;
      }
    };

    w.__nexusTransform = () => {
      const t = useTransformStore.getState();
      return {
        phase: t.phase,
        t: t.t,
        rise: t.handRise,
        curl: t.handCurl,
        timeline: t.handTimeline,
        anchor: t.handAnchor,
      };
    };

    return () => {
      delete w.__nexus;
      delete w.__nexusTransform;
      delete (window as unknown as { __nexusFace?: unknown }).__nexusFace;
    };
  }, [camera]);

  useEffect(() => {
    const ctx = gl.getContext();
    const ext = ctx.getExtension('WEBGL_debug_renderer_info');
    const name = ext
      ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : `WebGL${gl.capabilities.isWebGL2 ? '2' : '1'}`;
    useSystemStore.getState().setGPU(shorten(name), true);
    useSystemStore.getState().pushLog(`renderer · ${shorten(name)}`, 'ok');
  }, [gl]);
  return null;
}

function shorten(name: string): string {
  return name
    .replace(/ANGLE \(|\)$/g, '')
    .replace(/Direct3D.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 38);
}

/**
 * THE MOTION GATE (Phase 6).
 *
 * The boolean the user toggles is not what the scene reads. This eases a 0..1
 * multiplier toward it over about a second, so enabling drift starts the room
 * breathing and disabling it lets the room SETTLE rather than stopping dead
 * mid-drift — a hard stop is the single most artificial thing a 3D scene can do.
 *
 * The multiplier is then snapped to exactly 0 or exactly 1 at the ends. That
 * snap is what makes "zero drift" mean zero: every ambient term in the app is
 * skipped, not scaled, when the multiplier is exactly 0, so the carousel angle
 * and the camera transform are bit-identical frame over frame.
 */
function MotionGate() {
  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const s = useSystemStore.getState();
    const target = s.driftEnabled ? 1 : 0;
    if (s.motionMultiplier === target) return;

    let next = damp(s.motionMultiplier, target, 0.28, dt);
    if (Math.abs(next - target) < 0.004) next = target;
    s.setMotionMultiplier(next);
  });
  return null;
}

/** Feeds frame times to the adaptive quality controller. */
function PerformanceMonitor() {
  useFrame((_, delta) => {
    useSystemStore.getState().reportFrame(delta * 1000);
  });
  return null;
}
