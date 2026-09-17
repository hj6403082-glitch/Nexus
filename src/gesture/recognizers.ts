import { clamp01, remap } from '@/core/math/util';
import { LM, dist2d, spanOf, type Pt } from './landmarks';
import type { GestureName, HandSnapshot } from '@/stores/useGestureStore';

/** Normalised 0..1 pinch, 1 = closed. Span-relative, so depth-invariant. */
export function pinchAmount(lms: Pt[]): number {
  const span = spanOf(lms);
  const d = dist2d(lms[LM.THUMB_TIP], lms[LM.INDEX_TIP]) / span;
  return clamp01(remap(d, 0.62, 0.20, 0, 1));
}

/** 0 = fist, 1 = open hand. Mean of the four finger extensions. */
export function openness(lms: Pt[]): number {
  const span = spanOf(lms);
  const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
  const mcps = [LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    sum += clamp01(remap(dist2d(lms[tips[i]], lms[mcps[i]]) / span, 0.45, 1.15, 0, 1));
  }
  return sum / 4;
}

export function snapshotFrom(lms: Pt[]): HandSnapshot {
  const palm = lms[LM.MIDDLE_MCP];
  return {
    // MediaPipe gives 0..1 with origin top-left, mirrored for a selfie camera.
    x: (0.5 - palm.x) * 2,
    y: (0.5 - palm.y) * 2,
    z: clamp01(remap(spanOf(lms), 0.10, 0.34, 0, 1)),
    pinch: pinchAmount(lms),
    openness: openness(lms),
    present: true,
  };
}

const PINCH_ON = 0.72;
const PINCH_OFF = 0.42;

/** Schmitt-triggered pinch. One threshold chatters at the boundary. */
export class PinchLatch {
  private held = false;
  update(value: number): 'pinch' | 'release' | null {
    if (!this.held && value > PINCH_ON) {
      this.held = true;
      return 'pinch';
    }
    if (this.held && value < PINCH_OFF) {
      this.held = false;
      return 'release';
    }
    return null;
  }
  get isHeld(): boolean {
    return this.held;
  }
  reset(): void {
    this.held = false;
  }
}

interface Sample {
  x: number;
  y: number;
  z: number;
  t: number;
}

const HISTORY_MS = 420;
const SWIPE_MIN_DISTANCE = 0.55;
const SWIPE_MIN_SPEED = 1.6; // units/sec in the -1..1 space
const SWIPE_COOLDOWN_MS = 520;
const PUSH_MIN_DELTA = 0.26;
const PALM_STILL_RADIUS = 0.06;
const PALM_STILL_MS = 700;
const CIRCLE_MIN_TURN = Math.PI * 1.7;

/**
 * Trajectory-based recogniser for everything that is a MOVEMENT rather than a
 * POSE. Poses (pinch, openness) are read per frame; movements need history.
 */
export class MotionRecognizer {
  private history: Sample[] = [];
  private lastFire = 0;
  private stillSince = 0;
  private palmFired = false;

  reset(): void {
    this.history.length = 0;
    this.stillSince = 0;
    this.palmFired = false;
  }

  push(h: HandSnapshot, now: number): void {
    this.history.push({ x: h.x, y: h.y, z: h.z, t: now });
    while (this.history.length > 2 && now - this.history[0].t > HISTORY_MS) {
      this.history.shift();
    }
  }

  /** Returns a movement gesture, or null. Pose gestures are handled elsewhere. */
  detect(h: HandSnapshot, now: number): { name: GestureName; confidence: number } | null {
    if (!h.present || this.history.length < 4) return null;

    const first = this.history[0];
    const last = this.history[this.history.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return null;

    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const dz = last.z - first.z;

    const cooling = now - this.lastFire < SWIPE_COOLDOWN_MS;

    // --- palm held still ---------------------------------------------------
    const drift = Math.hypot(dx, dy);
    if (h.openness > 0.78 && drift < PALM_STILL_RADIUS) {
      if (this.stillSince === 0) this.stillSince = now;
      if (!this.palmFired && now - this.stillSince > PALM_STILL_MS) {
        this.palmFired = true;
        return { name: 'palm-hold', confidence: 0.9 };
      }
    } else {
      this.stillSince = 0;
      this.palmFired = false;
    }

    if (cooling) return null;

    // --- circle ------------------------------------------------------------
    const turn = this.accumulatedTurn();
    if (Math.abs(turn) > CIRCLE_MIN_TURN && h.openness > 0.5) {
      this.lastFire = now;
      this.history.length = 0;
      return { name: 'circle', confidence: clamp01(Math.abs(turn) / (Math.PI * 2)) };
    }

    // --- swipe -------------------------------------------------------------
    const speed = Math.abs(dx) / dt;
    if (
      Math.abs(dx) > SWIPE_MIN_DISTANCE &&
      speed > SWIPE_MIN_SPEED &&
      Math.abs(dx) > Math.abs(dy) * 1.6 &&
      h.pinch < 0.5
    ) {
      this.lastFire = now;
      this.history.length = 0;
      return {
        name: dx < 0 ? 'swipe-left' : 'swipe-right',
        confidence: clamp01(speed / 4),
      };
    }

    // --- push / pull -------------------------------------------------------
    if (Math.abs(dz) > PUSH_MIN_DELTA && Math.abs(dz) > Math.abs(dx) * 1.3) {
      this.lastFire = now;
      this.history.length = 0;
      return { name: dz > 0 ? 'pull' : 'push', confidence: clamp01(Math.abs(dz) / 0.5) };
    }

    return null;
  }

  /** Signed angle swept around the trajectory centroid. */
  private accumulatedTurn(): number {
    const pts = this.history;
    if (pts.length < 6) return 0;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;

    // A near-zero radius makes the angle meaningless — a still hand would
    // "turn" through noise alone.
    let radius = 0;
    for (const p of pts) radius += Math.hypot(p.x - cx, p.y - cy);
    radius /= pts.length;
    if (radius < 0.09) return 0;

    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const a0 = Math.atan2(pts[i - 1].y - cy, pts[i - 1].x - cx);
      const a1 = Math.atan2(pts[i].y - cy, pts[i].x - cx);
      let d = a1 - a0;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      total += d;
    }
    return total;
  }
}

/** Phase 4 two-hand interactions. Only meaningful when both hands are present. */
const MULTI_SELECT_HOLD_MS = 620;

export class TwoHandRecognizer {
  private baseline: number | null = null;
  private lastFire = 0;
  private holdSince = 0;
  private selectFired = false;

  detect(
    a: HandSnapshot,
    b: HandSnapshot,
    now: number,
  ): { name: GestureName; confidence: number; value: number } | null {
    if (!a.present || !b.present) {
      this.baseline = null;
      return null;
    }
    const separation = Math.hypot(a.x - b.x, a.y - b.y);
    if (this.baseline === null) {
      this.baseline = separation;
      return null;
    }

    const bothPinching = a.pinch > PINCH_ON && b.pinch > PINCH_ON;
    const bothOpen = a.openness > 0.8 && b.openness > 0.8;
    const ratio = separation / Math.max(0.05, this.baseline);

    if (bothPinching && Math.abs(ratio - 1) > 0.22) {
      return { name: 'two-hand-zoom', confidence: clamp01(Math.abs(ratio - 1)), value: ratio };
    }

    /**
     * MULTI-SELECT: both hands pinched and HELD, without the separation
     * changing. Zoom is the same pose in motion, so the two are told apart by
     * whether the hands are travelling — which means multi-select needs a dwell
     * before it can fire, or every zoom would select something on its way past.
     */
    if (bothPinching && Math.abs(ratio - 1) <= 0.12) {
      if (this.holdSince === 0) this.holdSince = now;
      if (!this.selectFired && now - this.holdSince > MULTI_SELECT_HOLD_MS) {
        this.selectFired = true;
        this.lastFire = now;
        // The value is the span between the hands, in the same -1..1 space the
        // cards are picked in, so the consumer can decide what falls inside it.
        return { name: 'two-hand-multi-select', confidence: 0.85, value: separation };
      }
    } else {
      this.holdSince = 0;
      this.selectFired = false;
    }

    if (now - this.lastFire < 700) return null;

    if (bothOpen && ratio > 1.55) {
      this.lastFire = now;
      this.baseline = separation;
      return { name: 'two-hand-split', confidence: 0.8, value: ratio };
    }
    if (bothOpen && ratio < 0.5) {
      this.lastFire = now;
      this.baseline = separation;
      return { name: 'two-hand-group', confidence: 0.8, value: ratio };
    }
    return null;
  }

  reset(): void {
    this.baseline = null;
    this.holdSince = 0;
    this.selectFired = false;
  }
}
