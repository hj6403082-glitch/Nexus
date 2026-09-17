'use client';

import { create } from 'zustand';

export type GestureName =
  | 'none'
  | 'pinch'
  | 'release'
  | 'swipe-left'
  | 'swipe-right'
  | 'push'
  | 'pull'
  | 'palm-hold'
  | 'circle'
  | 'two-hand-zoom'
  | 'two-hand-throw'
  | 'two-hand-group'
  | 'two-hand-split'
  | 'two-hand-multi-select';

export type TrackingState = 'off' | 'starting' | 'live' | 'lost' | 'denied' | 'unsupported';

export interface HandSnapshot {
  /** Normalised device coords, -1..1, y up. */
  x: number;
  y: number;
  /** Depth proxy from hand span. Larger = closer. */
  z: number;
  pinch: number;
  /** 0 = fist, 1 = fully open. */
  openness: number;
  present: boolean;
}

export const EMPTY_HAND: HandSnapshot = {
  x: 0,
  y: 0,
  z: 0,
  pinch: 0,
  openness: 0,
  present: false,
};

interface GestureState {
  tracking: TrackingState;
  setTracking: (t: TrackingState) => void;

  hands: [HandSnapshot, HandSnapshot];
  setHands: (h: [HandSnapshot, HandSnapshot]) => void;

  gesture: GestureName;
  confidence: number;
  gestureAt: number;
  emit: (g: GestureName, confidence: number) => void;

  /** Pointer fallback, in the same -1..1 space as a hand. */
  pointer: { x: number; y: number; active: boolean };
  setPointer: (x: number, y: number, active: boolean) => void;

  /**
   * The active input resolved into a world-space point on the ring, published
   * by the picker once per frame.
   *
   * Hand and pointer are deliberately collapsed into ONE value here: a dragged
   * card should not care which of them is driving it, and the moment it does,
   * every consumer needs two code paths that will drift apart.
   */
  cursor: { x: number; y: number; z: number; live: boolean };
  setCursor: (x: number, y: number, z: number, live: boolean) => void;
}

export const useGestureStore = create<GestureState>()((set) => ({
  tracking: 'off',
  setTracking: (tracking) => set({ tracking }),

  hands: [EMPTY_HAND, EMPTY_HAND],
  setHands: (hands) => set({ hands }),

  gesture: 'none',
  confidence: 0,
  gestureAt: 0,
  emit: (gesture, confidence) =>
    set({ gesture, confidence, gestureAt: performance.now() }),

  pointer: { x: 0, y: 0, active: false },
  setPointer: (x, y, active) => set({ pointer: { x, y, active } }),

  cursor: { x: 0, y: 0, z: 0, live: false },
  setCursor: (x, y, z, live) => set({ cursor: { x, y, z, live } }),
}));
