'use client';

import { useEffect, useState } from 'react';
import { useGestureStore } from '@/stores/useGestureStore';
import { useSystemStore } from '@/stores/useSystemStore';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { useAIStore } from '@/stores/useAIStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { audio } from '@/audio/AudioEngine';
import type { useNexus } from '@/hooks/useNexus';

/**
 * THE DOCK.
 *
 * The permission surface: camera, microphone and audio are OPT-IN, one control
 * each, and each says what it will do before it does it. A spatial interface
 * that opens the camera on load is a spatial interface nobody trusts.
 *
 * Every control reports one of five states — off, arming, live, degraded,
 * refused — and looks different in each. The previous version had two, on and
 * off, which meant "the camera is warming up", "the camera lost your hands"
 * and "you denied the camera" were one indistinguishable shade of blue. A
 * permission control that cannot say it was refused is a control that looks
 * broken.
 */

type State = 'off' | 'arming' | 'live' | 'degraded' | 'refused';

export function Controls({ nexus }: { nexus: ReturnType<typeof useNexus> }) {
  const tracking = useGestureStore((s) => s.tracking);
  const status = useAIStore((s) => s.status);
  const phase = useTransformStore((s) => s.phase);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [touched, setTouched] = useState(false);

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
      setTouched(true);
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

  // The hint retires the moment the user does anything at all with the scene.
  useEffect(() => {
    const done = () => setTouched(true);
    window.addEventListener('pointerdown', done, { once: true });
    return () => window.removeEventListener('pointerdown', done);
  }, []);

  const handState: State =
    tracking === 'live'
      ? 'live'
      : tracking === 'starting'
        ? 'arming'
        : tracking === 'lost'
          ? 'degraded'
          : tracking === 'denied' || tracking === 'unsupported'
            ? 'refused'
            : 'off';

  const handLabel =
    tracking === 'live'
      ? 'hands live'
      : tracking === 'starting'
        ? 'opening camera'
        : tracking === 'lost'
          ? 'hands lost'
          : tracking === 'denied'
            ? 'camera refused'
            : tracking === 'unsupported'
              ? 'no camera'
              : 'enable hands';

  const voiceState: State = !listening
    ? 'off'
    : status === 'offline'
      ? 'degraded'
      : status === 'idle' || status === 'listening'
        ? 'live'
        : 'arming';

  const transforming = phase !== 'NORMAL' && phase !== 'HUMANOID_ACTIVE';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-3 px-4 pb-5">
      {!touched && (
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-nexus-dim/70">
          drag to turn · enter to open ·{' '}
          <kbd className="rounded border border-white/15 px-1 py-px text-nexus-ink/80">⌘K</kbd> for
          anything
        </p>
      )}

      <div
        role="toolbar"
        aria-label="Session controls"
        className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-full border border-white/10 bg-black/45 p-1.5 backdrop-blur-xl"
      >
        <Control
          state={handState}
          label={handLabel}
          title={
            handState === 'refused'
              ? 'Your browser is refusing camera access. Re-allow it in the site settings.'
              : 'Uses your camera on this device to track hand gestures. Nothing is uploaded.'
          }
          disabled={tracking === 'unsupported'}
          onClick={() => {
            void audio.resume();
            if (tracking === 'off' || tracking === 'denied') nexus.startTracking();
            else nexus.stopTracking();
          }}
        />

        <Control
          state={voiceState}
          label={listening ? `voice · ${status}` : 'enable voice'}
          title="Uses your microphone for wake-word and dictation. Say “Nexus” to interrupt."
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
        />

        <Control
          state={muted ? 'off' : 'live'}
          label={muted ? 'sound off' : 'sound on'}
          title="Ambient bed and spatial interface tones."
          onClick={() => {
            void audio.resume();
            const next = !muted;
            setMuted(next);
            audio.setMuted(next);
          }}
        />

        <span className="mx-0.5 h-5 w-px bg-white/10" aria-hidden />

        <Control
          state={phase === 'HUMANOID_ACTIVE' ? 'live' : transforming ? 'arming' : 'off'}
          label={
            phase === 'HUMANOID_ACTIVE'
              ? 'return to ring'
              : transforming
                ? phase.toLowerCase().replace(/_/g, ' ')
                : 'human form'
          }
          title="Dissolve the ring into particles and reassemble them as a figure."
          disabled={transforming}
          onClick={() =>
            nexus.submit(
              phase === 'HUMANOID_ACTIVE'
                ? 'return to spatial'
                : 'transform into a human shape',
            )
          }
        />
      </div>
    </div>
  );
}

/**
 * Colour carries the state, but never alone: the label changes too, and
 * `aria-pressed` carries it to a screen reader. A control whose only signal is
 * a hue is a control a colour-blind user cannot read.
 */
const TONE: Record<State, string> = {
  off: 'border-white/10 bg-white/[0.03] text-nexus-ink/70 hover:border-white/25 hover:bg-white/[0.06] hover:text-nexus-ink',
  arming: 'border-nexus-accent/30 bg-nexus-accent/[0.07] text-nexus-accent/85 nexus-busy',
  live: 'border-nexus-accent/45 bg-nexus-accent/[0.12] text-nexus-accent',
  degraded: 'border-nexus-warn/40 bg-nexus-warn/[0.08] text-nexus-warn',
  refused: 'border-nexus-bad/40 bg-nexus-bad/[0.08] text-nexus-bad',
};

function Control({
  state,
  label,
  title,
  onClick,
  disabled,
}: {
  state: State;
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={`${label} — ${title}`}
      aria-pressed={state === 'live'}
      className={`relative overflow-hidden rounded-full border px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.16em] transition-[color,background-color,border-color] duration-[var(--duration-half-beat)] ease-[var(--ease-nexus)] disabled:cursor-not-allowed disabled:opacity-45 ${TONE[state]} ${
        state === 'live' ? 'nexus-sweep' : ''
      }`}
    >
      <span className="relative z-10 flex items-center gap-2">
        <Dot state={state} />
        {label}
      </span>
    </button>
  );
}

/** A status lamp, so the state is legible without reading the label. */
function Dot({ state }: { state: State }) {
  const fill =
    state === 'live'
      ? 'bg-nexus-accent'
      : state === 'arming'
        ? 'bg-nexus-accent/60'
        : state === 'degraded'
          ? 'bg-nexus-warn'
          : state === 'refused'
            ? 'bg-nexus-bad'
            : 'bg-white/25';
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${fill}`} />;
}
