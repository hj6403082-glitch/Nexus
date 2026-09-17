'use client';

import { create } from 'zustand';
import { clamp01, smoothstep, window4 } from '@/core/math/util';
import { RETURN_RATE, TRANSFORM, TRANSFORM_TOTAL } from '@/core/constants/motion';

/**
 * PHASE 7 — THE HUMAN FORM
 *
 * One clock. Every layer in the app — cards, atmosphere, camera, post chain,
 * the figure itself — READS envelopes from this clock and WRITES NOTHING BACK.
 * That constraint is what makes the transformation impossible to desynchronise:
 * there is exactly one number in the system (`t`) and everything else is a
 * pure function of it.
 *
 * The return is this same clock run backward at RETURN_RATE. Not a second
 * choreography — a second choreography is a second thing to keep in sync, and
 * the day someone edits one and not the other it silently breaks.
 */
export type TransformPhase =
  | 'NORMAL'
  | 'COMMAND_DETECTED'
  | 'COLLAPSING'
  | 'PARTICLE_CORE'
  | 'SKELETON_FORMING'
  | 'HUMANOID_FORMING'
  | 'HUMANOID_ACTIVE'
  | 'RETURNING';

/** Cumulative phase boundaries, normalised to 0..1 over the whole journey. */
const B = (() => {
  const d = TRANSFORM;
  const acc: number[] = [];
  let sum = 0;
  for (const v of [
    d.COMMAND_DETECTED,
    d.COLLAPSING,
    d.PARTICLE_CORE,
    d.SKELETON_FORMING,
    d.HUMANOID_FORMING,
  ]) {
    sum += v;
    acc.push(sum / TRANSFORM_TOTAL);
  }
  return {
    command: acc[0],
    collapse: acc[1],
    core: acc[2],
    skeleton: acc[3],
    body: acc[4],
  };
})();

export const PHASE_BOUNDS = B;

export interface Envelopes {
  /** The room dims. Rises first, stays down. */
  dim: number;
  /** Overall progress of the journey, for anything that just needs "how far". */
  journey: number;
  /** Card faces erode edge-first. */
  dissolve: number;
  /** Particles travel card → core. */
  collapse: number;
  /** The core exists as a point of light. */
  core: number;
  /** Skeleton keyframe weight. */
  skeleton: number;
  /** Final figure keyframe weight. */
  body: number;
  /** The two points of light in the eyes. Settles last. */
  eyes: number;
  /** How present the figure is overall — drives voice, hand, panels. */
  presence: number;
}

interface TransformState {
  phase: TransformPhase;
  /** 0 → 1 across the whole journey. The only authoritative number. */
  t: number;
  /** +1 going out, -RETURN_RATE coming back, 0 when parked. */
  direction: number;
  env: Envelopes;

  begin: () => void;
  returnToSpatial: () => void;
  tick: (dt: number) => void;

  /** Screen-space anchor the held panel follows, published by the hand rig. */
  handAnchor: { x: number; y: number; visible: boolean };
  setHandAnchor: (x: number, y: number, visible: boolean) => void;
  /** 0 = retracted below frame, 1 = presenting. */
  handRise: number;
  /** 1 = fingers cupped around the panel, 0 = open, released. */
  handCurl: number;
  setHand: (rise: number, curl: number) => void;
  /**
   * Seconds into the presentation gesture, or -1 when idle.
   *
   * The gesture runs on the FRAME CLOCK, not on `setTimeout`. Wall-clock
   * timers and a frame-driven spring disagree the moment the frame rate does
   * anything interesting: on a slow machine the hand was told to open its
   * fingers and lower away before the spring had finished raising it, and the
   * whole gesture happened off-screen.
   */
  handTimeline: number;
  presentGesture: () => void;
  tickHand: (dt: number) => void;
}

export function envelopesFor(t: number): Envelopes {
  const x = clamp01(t);
  return {
    dim: smoothstep(0, B.command, x),
    journey: x,
    // The face erodes on the same curve its particles leave on, so the pixels
    // never appear in two places at once.
    dissolve: smoothstep(B.command * 0.6, B.collapse * 0.95, x),
    collapse: smoothstep(B.command, B.collapse, x),
    core: window4(x, B.collapse * 0.8, B.collapse, B.core, B.skeleton * 1.02),
    skeleton: window4(x, B.core, B.skeleton, B.skeleton, B.body),
    body: smoothstep(B.skeleton, B.body, x),
    eyes: smoothstep(B.body - (B.body - B.skeleton) * 0.18, 1, x),
    presence: smoothstep(B.skeleton, B.body, x),
  };
}

const ZERO = envelopesFor(0);

export const useTransformStore = create<TransformState>()((set, get) => ({
  phase: 'NORMAL',
  t: 0,
  direction: 0,
  env: ZERO,

  begin: () => {
    if (get().phase !== 'NORMAL') return;
    set({ phase: 'COMMAND_DETECTED', direction: 1 });
  },

  returnToSpatial: () => {
    const { phase } = get();
    if (phase === 'NORMAL' || phase === 'RETURNING') return;
    set({ phase: 'RETURNING', direction: -RETURN_RATE });
  },

  tick: (dt) => {
    const { direction, t } = get();
    if (direction === 0) return;

    const next = clamp01(t + (direction * dt) / TRANSFORM_TOTAL);
    const env = envelopesFor(next);

    if (next >= 1) {
      set({ t: 1, direction: 0, phase: 'HUMANOID_ACTIVE', env });
      return;
    }
    if (next <= 0) {
      set({ t: 0, direction: 0, phase: 'NORMAL', env: ZERO });
      return;
    }

    let phase: TransformPhase = get().phase;
    if (direction > 0) {
      phase =
        next < B.command
          ? 'COMMAND_DETECTED'
          : next < B.collapse
            ? 'COLLAPSING'
            : next < B.core
              ? 'PARTICLE_CORE'
              : next < B.skeleton
                ? 'SKELETON_FORMING'
                : 'HUMANOID_FORMING';
    }
    set({ t: next, env, phase });
  },

  handAnchor: { x: 0, y: 0, visible: false },
  setHandAnchor: (x, y, visible) => set({ handAnchor: { x, y, visible } }),
  handRise: 0,
  handCurl: 0,
  setHand: (handRise, handCurl) => set({ handRise, handCurl }),

  handTimeline: -1,
  presentGesture: () => set({ handTimeline: 0 }),
  tickHand: (dt) => {
    const { handTimeline } = get();
    if (handTimeline < 0) return;
    const t = handTimeline + dt;

    // rise · hold · open the fingers · lower away
    let rise: number;
    let curl: number;
    if (t < HAND_GESTURE.rise) {
      rise = t / HAND_GESTURE.rise;
      curl = CUP * rise;
    } else if (t < HAND_GESTURE.hold) {
      rise = 1;
      curl = CUP;
    } else if (t < HAND_GESTURE.release) {
      rise = 1;
      curl = CUP * (1 - (t - HAND_GESTURE.hold) / (HAND_GESTURE.release - HAND_GESTURE.hold));
    } else if (t < HAND_GESTURE.lower) {
      rise = 1 - (t - HAND_GESTURE.release) / (HAND_GESTURE.lower - HAND_GESTURE.release);
      curl = 0;
    } else {
      set({ handTimeline: -1, handRise: 0, handCurl: 0 });
      return;
    }
    set({ handTimeline: t, handRise: rise, handCurl: curl });
  },
}));

/** Cumulative gesture beats, in seconds. */
const HAND_GESTURE = { rise: 1.1, hold: 2.0, release: 2.6, lower: 3.6 } as const;

/**
 * How far the fingers close around the panel. The hinge gains compound down
 * each chain, so this is not the angle of any one joint: at 0.85 the fingers
 * curled through the palm and made a fist. A hand presenting something cups.
 */
const CUP = 0.34;

/** True whenever the ring is not the interaction surface. */
export const isEmbodied = (p: TransformPhase): boolean => p !== 'NORMAL';
