import type { SpringConfig } from '@/core/math/spring';

/**
 * MOTION VOCABULARY (Phase 6)
 *
 * Before this file existed, every animated value in the scene carried its own
 * inline numbers — `(2.4, 0.9)` here, `(3.1, 0.7)` there — and nothing agreed
 * with anything else. The numbers were never the point. The INTENT was.
 *
 * Five intents cover everything NEXUS does:
 *
 *   ARRIVING     something comes to you and is allowed to overshoot slightly,
 *                because that is what mass does when it stops.
 *   LEAVING      something withdraws. Critically damped: a retreat that
 *                bounces reads as indecision.
 *   ACKNOWLEDGING a direct answer to an input. Fast, tight, no overshoot —
 *                the user's own action must not feel like it wobbled.
 *   REPORTING    a value changing because the world changed, not because the
 *                user did. Slow and utterly calm so it never steals focus.
 *   DRIFTING     ambient, unforced motion. So soft it is nearly a filter.
 *
 * Use the intent. If a surface needs a number that is not here, the surface is
 * either wrong or it is a new intent — and a new intent gets a name.
 */
export const MOTION = {
  ARRIVING: { stiffness: 9.0, damping: 0.72 },
  LEAVING: { stiffness: 7.0, damping: 1.0 },
  ACKNOWLEDGING: { stiffness: 16.0, damping: 0.95 },
  REPORTING: { stiffness: 3.4, damping: 1.0 },
  DRIFTING: { stiffness: 1.1, damping: 1.0 },
} as const satisfies Record<string, SpringConfig>;

export type MotionIntent = keyof typeof MOTION;

/**
 * THE BEAT.
 *
 * One duration constant that the boot choreography, the presentation clock and
 * the transformation clock all compose from. Every timing in this app is a
 * multiple of BEAT. Change this one number and the whole instrument slows down
 * or speeds up coherently; it is the single knob for "how urgent is NEXUS".
 */
export const BEAT = 0.42; // seconds

/** Boot choreography, composed from the beat. */
export const BOOT = {
  BLACK: BEAT * 0.5,
  LATTICE_IN: BEAT * 3,
  ATMOSPHERE_IN: BEAT * 4,
  CARDS_IN: BEAT * 5,
  HUD_IN: BEAT * 2,
  TOTAL: BEAT * 11,
} as const;

/**
 * PRESENTATION CLOCK (Phase 6) — asymmetric by design.
 *
 * Targeting is brisk: it is a machine deciding, and a machine decides fast.
 * Approach carries the distance: it is travel, and travel takes as long as the
 * distance is. Settle is the slow one — the text has to be READABLE before the
 * motion stops, not at the moment it stops, so the last beat is dead time on
 * purpose.
 */
export const PRESENT = {
  TARGETING: BEAT * 1.1,
  APPROACH: BEAT * 2.4,
  SETTLE: BEAT * 3.2,
} as const;

export const PRESENT_TOTAL = PRESENT.TARGETING + PRESENT.APPROACH + PRESENT.SETTLE;

/** Phase 7 transformation clock. Durations in seconds, sequential. */
export const TRANSFORM = {
  COMMAND_DETECTED: BEAT * 1.5,
  COLLAPSING: BEAT * 5.5,
  PARTICLE_CORE: BEAT * 1.6,
  SKELETON_FORMING: BEAT * 3.0,
  HUMANOID_FORMING: BEAT * 4.5,
} as const;

export const TRANSFORM_TOTAL =
  TRANSFORM.COMMAND_DETECTED +
  TRANSFORM.COLLAPSING +
  TRANSFORM.PARTICLE_CORE +
  TRANSFORM.SKELETON_FORMING +
  TRANSFORM.HUMANOID_FORMING;

/**
 * The return is the same clock run backward, faster. It is NOT a second
 * choreography — a second choreography is a second thing to keep in sync, and
 * it will drift the moment one of the two is edited.
 */
export const RETURN_RATE = 1.7;
