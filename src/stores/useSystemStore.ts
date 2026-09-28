'use client';

import { create } from 'zustand';
import type { WorldId } from '@/core/constants/modules';
import { DEFAULT_WORLD } from '@/core/constants/worlds';

export type QualityTier = 0 | 1 | 2 | 3;

export interface LogEntry {
  id: number;
  at: number;
  level: 'info' | 'warn' | 'ok';
  text: string;
}

export type BootStage = 'black' | 'lattice' | 'atmosphere' | 'cards' | 'live';

interface SystemState {
  // ---- boot ----------------------------------------------------------------
  bootStage: BootStage;
  bootProgress: number;
  setBootStage: (s: BootStage) => void;
  setBootProgress: (p: number) => void;

  // ---- render health -------------------------------------------------------
  fps: number;
  frameMs: number;
  tier: QualityTier;
  /**
   * The adaptive monitor steps the tier on its own. During the Phase 7
   * transformation that is catastrophic: a tier change rebuilds the particle
   * buffer, and rebuilding the buffer throws away every particle's baked
   * figure keyframe. The face collapses into a cluster at the origin and never
   * recovers. So the monitor's JUDGEMENT is suspended for the duration of the
   * sequence and any pending tier is applied when the ring comes back.
   */
  tierLocked: boolean;
  pendingTier: QualityTier | null;
  gpu: string;
  webgl: boolean;
  reportFrame: (ms: number) => void;
  setTier: (t: QualityTier) => void;
  lockTier: (locked: boolean) => void;
  setGPU: (name: string, webgl: boolean) => void;

  // ---- motion gating (Phase 6) --------------------------------------------
  /**
   * Ambient motion is OFF BY DEFAULT. NEXUS is used for an hour at a time, and
   * a room that never stops breathing is exhausting to read text in.
   */
  driftEnabled: boolean;
  /**
   * The gate is a 0..1 MULTIPLIER, not the boolean above. Toggling the boolean
   * moves this over ~1 second, so the scene settles instead of stopping dead
   * mid-drift — a hard stop is the single most artificial thing a 3D scene can
   * do. Every ambient term in the app multiplies by this, and when it reaches
   * exactly 0 every one of those terms contributes exactly 0: drift is not
   * "very small", it is zero, and the carousel angle and camera transform are
   * bit-identical frame over frame.
   */
  motionMultiplier: number;
  setMotionMultiplier: (m: number) => void;
  toggleDrift: () => void;

  // ---- hud -----------------------------------------------------------------
  hudVisible: boolean;
  toggleHud: () => void;
  log: LogEntry[];
  pushLog: (text: string, level?: LogEntry['level']) => void;

  // ---- world ---------------------------------------------------------------
  world: WorldId;
  previousWorld: WorldId;
  worldBlend: number;
  setWorld: (w: WorldId) => void;
  setWorldBlend: (t: number) => void;
}

let logId = 0;
const FRAME_WINDOW = 45;
const frameTimes: number[] = [];

/** A tier pinned from the query string, or null to adapt. See `sample()`. */
const PINNED_TIER: QualityTier | null = (() => {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('tier');
  if (raw === null) return null;
  const n = Number(raw);
  return n === 0 || n === 1 || n === 2 || n === 3 ? (n as QualityTier) : null;
})();

export const useSystemStore = create<SystemState>()((set, get) => ({
  bootStage: 'black',
  bootProgress: 0,
  setBootStage: (bootStage) => set({ bootStage }),
  setBootProgress: (bootProgress) => set({ bootProgress }),

  fps: 60,
  frameMs: 16.7,
  tier: PINNED_TIER ?? 2,
  tierLocked: false,
  pendingTier: null,
  gpu: 'detecting…',
  webgl: true,

  reportFrame: (ms) => {
    frameTimes.push(ms);
    if (frameTimes.length < FRAME_WINDOW) return;

    let total = 0;
    for (const t of frameTimes) total += t;
    const avg = total / frameTimes.length;
    frameTimes.length = 0;

    const fps = Math.round(1000 / avg);
    const { tier, tierLocked } = get();

    /**
     * `?tier=0..3` pins quality and stops the monitor moving it.
     *
     * Two uses. Verifying a change to an expensive shader needs the tier held
     * still, or the monitor quietly switches the thing being looked at off and
     * the screenshot shows the fallback. And a user on a fast machine whose
     * frame rate dips during a heavy moment can pin the quality they want
     * rather than watch it ratchet down and stay there.
     */
    if (PINNED_TIER !== null) {
      if (tier !== PINNED_TIER) set({ tier: PINNED_TIER });
      set({ fps, frameMs: avg });
      return;
    }

    // Hysteresis: step down below 48, step up only above 58. Without the gap
    // the tier oscillates once per window at exactly the threshold.
    let next = tier;
    if (fps < 48 && tier > 0) next = (tier - 1) as QualityTier;
    else if (fps > 58 && tier < 3) next = (tier + 1) as QualityTier;

    if (next === tier) {
      set({ fps, frameMs: avg });
      return;
    }

    if (tierLocked) {
      // Remember it; do not act on it. See `tierLocked`.
      set({ fps, frameMs: avg, pendingTier: next });
      return;
    }
    set({ fps, frameMs: avg, tier: next });
  },

  setTier: (tier) => set({ tier }),
  lockTier: (locked) => {
    if (locked) {
      set({ tierLocked: true });
      return;
    }
    const { pendingTier } = get();
    set({
      tierLocked: false,
      tier: pendingTier ?? get().tier,
      pendingTier: null,
    });
  },
  setGPU: (gpu, webgl) => set({ gpu, webgl }),

  driftEnabled: false,
  motionMultiplier: 0,
  setMotionMultiplier: (motionMultiplier) => set({ motionMultiplier }),
  toggleDrift: () => {
    const next = !get().driftEnabled;
    set({ driftEnabled: next });
    get().pushLog(next ? 'ambient drift enabled' : 'scene locked', 'ok');
  },

  hudVisible: true,
  toggleHud: () => set({ hudVisible: !get().hudVisible }),
  log: [],
  pushLog: (text, level = 'info') =>
    set((s) => ({
      log: [...s.log, { id: ++logId, at: Date.now(), level, text }].slice(-40),
    })),

  world: DEFAULT_WORLD,
  previousWorld: DEFAULT_WORLD,
  worldBlend: 1,
  setWorld: (w) => {
    const { world } = get();
    if (w === world) return;
    set({ previousWorld: world, world: w, worldBlend: 0 });
  },
  setWorldBlend: (worldBlend) => set({ worldBlend }),
}));

/** Particle and geometry budgets per tier. Lower tiers get FEWER, LARGER beads. */
export const TIER_BUDGET: Record<
  QualityTier,
  { dust: number; figure: number; hand: number; beadScale: number; bloom: boolean; dof: boolean }
> = {
  0: { dust: 900, figure: 12000, hand: 2600, beadScale: 1.8, bloom: false, dof: false },
  1: { dust: 2200, figure: 20000, hand: 4200, beadScale: 1.4, bloom: true, dof: false },
  2: { dust: 4800, figure: 32000, hand: 6800, beadScale: 1.15, bloom: true, dof: true },
  3: { dust: 8000, figure: 48000, hand: 10000, beadScale: 1.0, bloom: true, dof: true },
};
