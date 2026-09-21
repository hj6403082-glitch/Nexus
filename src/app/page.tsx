'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { Boot } from '@/components/Boot';
import { HUD } from '@/components/hud/HUD';
import { MotionControl } from '@/components/hud/MotionControl';
import { CommandPalette } from '@/components/launcher/CommandPalette';
import { HolographicText } from '@/components/panels/HolographicText';
import { PresentedPanel } from '@/components/panels/PresentedPanel';
import { WakeOverlay } from '@/components/WakeOverlay';
import { Fallback, detectWebGL } from '@/components/Fallback';
import { SceneBoundary } from '@/components/SceneBoundary';
import { Controls } from '@/components/Controls';
import { useNexus } from '@/hooks/useNexus';
import { useGestureStore } from '@/stores/useGestureStore';
import { audio } from '@/audio/AudioEngine';

// The scene is loaded on the client only: it constructs a WebGL context and a
// render loop, neither of which mean anything during SSR.
const Scene = dynamic(() => import('@/scene/Scene').then((m) => m.Scene), { ssr: false });

export default function Page() {
  const [webgl, setWebgl] = useState<boolean | null>(null);
  /**
   * Why the scene is unavailable, if it is. Distinct from `webgl` because the
   * two happen at different times: `webgl` is a capability check before
   * anything is drawn, this is a failure DURING a session — a shader that
   * would not compile on this driver, or a context the browser took back.
   * Either way the modules are still reachable over HTTP, so the flat mode
   * takes over rather than the page going white.
   */
  const [sceneFailure, setSceneFailure] = useState<string | null>(null);
  const nexus = useNexus();

  useEffect(() => setWebgl(detectWebGL()), []);

  const onSceneFail = useCallback((reason: string) => {
    setSceneFailure((existing) => existing ?? reason);
  }, []);

  // Pointer fallback. The mouse only ever exists as a fallback, but a fallback
  // that does not work is not one.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      useGestureStore
        .getState()
        .setPointer(
          (e.clientX / window.innerWidth) * 2 - 1,
          1 - (e.clientY / window.innerHeight) * 2,
          true,
        );
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Audio needs a user gesture before it may start.
  useEffect(() => {
    const unlock = () => void audio.resume();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  if (webgl === null) return <div className="min-h-dvh bg-nexus-void" />;
  if (!webgl || sceneFailure) {
    return (
      <>
        <Fallback reason={sceneFailure ?? 'this browser or GPU cannot provide WebGL'} />
        <CommandPalette onCommand={nexus.submit} />
      </>
    );
  }

  return (
    <>
      <SceneBoundary onFail={onSceneFail}>
        <Scene onFail={onSceneFail} />
      </SceneBoundary>
      <Boot />
      <HUD />
      <MotionControl />
      <WakeOverlay />
      <HolographicText />
      <PresentedPanel />
      <Controls nexus={nexus} />
      {/*
        Mounted OUTSIDE the HUD visibility gate on purpose: hiding the HUD is
        what you do to look at the scene, and that is exactly when you most
        want a way to act without bringing the interface back.
      */}
      <CommandPalette onCommand={nexus.submit} />
    </>
  );
}
