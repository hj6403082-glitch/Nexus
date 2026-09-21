'use client';

import { useEffect, useState } from 'react';
import { useGestureStore } from '@/stores/useGestureStore';
import { useSystemStore } from '@/stores/useSystemStore';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { useAIStore } from '@/stores/useAIStore';
import { audio } from '@/audio/AudioEngine';
import type { useNexus } from '@/hooks/useNexus';

/**
 * The permission surface: camera, microphone and audio are OPT-IN, one button
 * each, and each says what it will do before it does it. A spatial interface
 * that opens the camera on load is a spatial interface nobody trusts.
 */
export function Controls({ nexus }: { nexus: ReturnType<typeof useNexus> }) {
  const tracking = useGestureStore((s) => s.tracking);
  const status = useAIStore((s) => s.status);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    /**
     * The ring, operable without a pointer.
     *
     * Arrows rotated it but nothing OPENED it, so a keyboard user could tour
     * the modules and never reach one. Enter and Space open the centred card;
     * Escape closes it and clears any multi-selection.
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'h') useSystemStore.getState().toggleHud();
      if (e.key === 'm') useSystemStore.getState().toggleDrift();
      if (e.key === 'ArrowLeft') nexus.submit('rotate left');
      if (e.key === 'ArrowRight') nexus.submit('rotate right');
      if (e.key === 'Enter' || e.key === ' ') {
        // Space scrolls the page by default, and the page is a 3D scene.
        e.preventDefault();
        nexus.openCentred();
      }
      if (e.key === 'Escape') {
        useCarouselStore.getState().close();
        useCarouselStore.getState().clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nexus]);

  const trackingLive = tracking === 'live' || tracking === 'lost' || tracking === 'starting';

  return (
    <div className="pointer-events-auto fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 gap-2">
      <Button
        active={trackingLive}
        onClick={() => {
          void audio.resume();
          if (trackingLive) nexus.stopTracking();
          else nexus.startTracking();
        }}
      >
        {trackingLive ? 'tracking on' : 'enable hands'}
      </Button>

      <Button
        active={listening}
        onClick={() => {
          void audio.resume();
          if (listening) {
            nexus.stopListening();
            setListening(false);
          } else {
            nexus.startListening();
            setListening(true);
          }
        }}
      >
        {listening ? `voice · ${status}` : 'enable voice'}
      </Button>

      <Button
        active={!muted}
        onClick={() => {
          void audio.resume();
          const next = !muted;
          setMuted(next);
          audio.setMuted(next);
        }}
      >
        {muted ? 'sound off' : 'sound on'}
      </Button>

      <Button active={false} onClick={() => nexus.submit('transform into a human shape')}>
        human form
      </Button>
    </div>
  );
}

function Button({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.18em] backdrop-blur-md transition-colors ${
        active
          ? 'border-nexus-accent/40 bg-nexus-accent/10 text-nexus-accent'
          : 'border-white/10 bg-white/[0.03] text-nexus-ink/75 hover:border-white/20 hover:text-nexus-ink'
      }`}
    >
      {children}
    </button>
  );
}
