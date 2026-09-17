'use client';

import { create } from 'zustand';
import { MODULES, type ModuleId } from '@/core/constants/modules';

export type CardState =
  | 'idle'
  | 'hovered'
  | 'selected'
  | 'expanded'
  | 'focused'
  | 'dragging';

/** Phase 6 presentation clock phases. One clock, three beats. */
export type PresentPhase = 'none' | 'targeting' | 'approach' | 'settle';

interface CarouselState {
  /** Authoritative carousel angle in radians. Written only by the rig. */
  angle: number;
  /** Where the carousel wants to be. The spring closes the gap. */
  targetAngle: number;
  angleVelocity: number;
  setAngle: (a: number, v: number) => void;
  rotate: (steps: number) => void;
  rotateTo: (id: ModuleId) => void;

  /** Which card the pointer/hand is over. */
  hovered: ModuleId | null;
  setHovered: (id: ModuleId | null) => void;

  /** Card being pinch-dragged. */
  dragging: ModuleId | null;
  setDragging: (id: ModuleId | null) => void;

  /** The opened module, once the presentation clock has committed it. */
  open: ModuleId | null;
  /** The module the presentation clock is currently bringing in. */
  pending: ModuleId | null;

  presentPhase: PresentPhase;
  presentT: number;
  setPresent: (phase: PresentPhase, t: number) => void;

  present: (id: ModuleId) => void;
  /**
   * A deliberate gesture during a sequence cancels the choreography — but
   * COMMITS the pending open. Cancelling the animation must never cancel the
   * user's intent; they asked for the module, they get the module, just
   * without the flourish.
   */
  cancelPresentation: () => void;
  close: () => void;

  frozen: boolean;
  setFrozen: (f: boolean) => void;

  expanded: Set<ModuleId>;
  toggleExpanded: (id: ModuleId, on?: boolean) => void;

  stateOf: (id: ModuleId) => CardState;
}

const STEP = (Math.PI * 2) / MODULES.length;

export const useCarouselStore = create<CarouselState>()((set, get) => ({
  angle: 0,
  targetAngle: 0,
  angleVelocity: 0,
  setAngle: (angle, angleVelocity) => set({ angle, angleVelocity }),

  rotate: (steps) => set((s) => ({ targetAngle: s.targetAngle + STEP * steps })),

  rotateTo: (id) => {
    const index = MODULES.findIndex((m) => m.id === id);
    if (index < 0) return;
    const { targetAngle } = get();
    const desired = -index * STEP;
    // Travel the short way round, measured from where we are HEADING, not from
    // where we currently are — otherwise two fast commands fight each other.
    const TAU = Math.PI * 2;
    let delta = (desired - targetAngle) % TAU;
    if (delta > Math.PI) delta -= TAU;
    if (delta < -Math.PI) delta += TAU;
    set({ targetAngle: targetAngle + delta });
  },

  hovered: null,
  setHovered: (hovered) => set({ hovered }),
  dragging: null,
  setDragging: (dragging) => set({ dragging }),

  open: null,
  pending: null,
  presentPhase: 'none',
  presentT: 0,
  setPresent: (presentPhase, presentT) => set({ presentPhase, presentT }),

  present: (id) => {
    get().rotateTo(id);
    set({ pending: id, presentPhase: 'targeting', presentT: 0 });
  },

  cancelPresentation: () => {
    const { pending } = get();
    set({
      presentPhase: 'none',
      presentT: 0,
      pending: null,
      open: pending ?? get().open, // commit the intent
    });
  },

  close: () =>
    set({ open: null, pending: null, presentPhase: 'none', presentT: 0 }),

  frozen: false,
  setFrozen: (frozen) => set({ frozen }),

  expanded: new Set<ModuleId>(),
  toggleExpanded: (id, on) =>
    set((s) => {
      const next = new Set(s.expanded);
      const want = on ?? !next.has(id);
      if (want) next.add(id);
      else next.delete(id);
      return { expanded: next };
    }),

  stateOf: (id) => {
    const s = get();
    if (s.dragging === id) return 'dragging';
    if (s.open === id) return 'focused';
    if (s.pending === id) return 'selected';
    if (s.expanded.has(id)) return 'expanded';
    if (s.hovered === id) return 'hovered';
    return 'idle';
  },
}));

export const CAROUSEL_STEP = STEP;
