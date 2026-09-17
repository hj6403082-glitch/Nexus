'use client';

import { Suspense, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Atmosphere } from './Atmosphere';
import { Carousel } from './Carousel';
import { PresentationClock } from './PresentationClock';
import { TargetingBracket } from './TargetingBracket';
import { Rig } from './Rig';
import { PostChain } from './post/PostChain';
import { HumanForm } from './human/HumanForm';
import { PresentingHand } from './human/PresentingHand';
import { WORLDS } from '@/core/constants/worlds';
import { useSystemStore } from '@/stores/useSystemStore';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { damp } from '@/core/math/spring';

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

export function Scene() {
  return (
    <Canvas
      gl={{
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
      }}
      dpr={[1, 1.85]}
      camera={{ fov: 46, near: 0.05, far: 80, position: [0, 0.12, -0.35] }}
      onCreated={({ gl }) => {
        gl.setClearColor(new THREE.Color('#04060b'), 1);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <SceneBody />
    </Canvas>
  );
}

function SceneBody() {
  const world = useSystemStore((s) => s.world);
  const grade = WORLDS[world];

  return (
    <>
      <Probe />
      <MotionGate />
      <PerformanceMonitor />

      <fog attach="fog" args={['#070b12', 3, 26]} />
      <ambientLight intensity={0.22} color="#7fa8e8" />
      <directionalLight position={[-3, 5, 4]} intensity={0.9} color={grade.keyLight} />
      <pointLight position={[0, 1.4, 0.5]} intensity={0.5} color="#6ea8ff" distance={9} />

      <Rig />
      <PresentationClock />

      <Suspense fallback={null}>
        <Atmosphere />
        <Carousel />
        <TargetingBracket />
        <HumanForm />
        <PresentingHand />
      </Suspense>

      {POST_ENABLED && <PostChain />}
    </>
  );
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
      transform: useTransformStore.getState().phase,
      log: useSystemStore.getState().log.map((l) => l.text),
    });

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
