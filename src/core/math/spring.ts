/**
 * Frame-rate independent critically-damped-ish springs.
 *
 * Everything in NEXUS that moves, moves through one of these. There is no
 * `lerp(a, b, 0.1)` in the scene graph: that is frame-rate dependent and reads
 * as linear motion at high frame rates. These integrate with an analytic
 * solution so a 144 Hz machine and a 30 Hz machine settle on the same curve.
 */

export interface SpringState {
  value: number;
  velocity: number;
}

export interface SpringConfig {
  /** Angular frequency. Higher = tighter, faster. */
  stiffness: number;
  /** 1 = critical (no overshoot). < 1 overshoots. > 1 crawls in. */
  damping: number;
}

/** Clamp a timestep so a tab-switch stall cannot launch a spring to infinity. */
export const MAX_STEP = 1 / 20;

export function stepSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number,
): SpringState {
  const h = Math.min(dt, MAX_STEP);
  const { stiffness: w, damping: z } = config;

  const displacement = state.value - target;

  if (z < 1) {
    // Under-damped: overshoot and elasticity. This is what "physical" feels like.
    const wd = w * Math.sqrt(1 - z * z);
    const e = Math.exp(-z * w * h);
    const c1 = displacement;
    const c2 = (state.velocity + z * w * displacement) / wd;
    const cos = Math.cos(wd * h);
    const sin = Math.sin(wd * h);
    const value = e * (c1 * cos + c2 * sin) + target;
    const velocity =
      e * ((c2 * wd - c1 * z * w) * cos - (c1 * wd + c2 * z * w) * sin);
    return { value, velocity };
  }

  // Critically damped (z === 1 is the common case; z > 1 is treated the same,
  // which is visually indistinguishable and avoids a third branch).
  const e = Math.exp(-w * h);
  const c1 = displacement;
  const c2 = state.velocity + w * displacement;
  const value = (c1 + c2 * h) * e + target;
  const velocity = (state.velocity - c2 * w * h) * e;
  return { value, velocity };
}

/** Mutating variant — used in the render loop where allocation is not free. */
export function advanceSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number,
): void {
  const next = stepSpring(state, target, config, dt);
  state.value = next.value;
  state.velocity = next.velocity;
}

export function makeSpring(value = 0): SpringState {
  return { value, velocity: 0 };
}

/**
 * Exponential smoothing with a half-life, which — unlike a raw lerp factor —
 * means the same thing at every frame rate.
 */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0) return target;
  const k = Math.pow(0.5, Math.min(dt, MAX_STEP) / halfLife);
  return target + (current - target) * k;
}

/**
 * The shortest signed path between two angles. The carousel rotates through
 * this so a step from 350° to 10° travels 20°, not 340°.
 */
export function shortestAngle(from: number, to: number): number {
  const TAU = Math.PI * 2;
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}
