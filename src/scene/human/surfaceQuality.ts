/**
 * WHETHER THE RAYMARCHED SURFACE RUNS AT ALL, AND HOW HARD.
 *
 * One statement, in one place, because two components have to agree about it:
 * `SurfaceFigure` decides whether to draw the surface, and `HumanForm` decides
 * whether to retire the beads. When those were two separate expressions of the
 * same intent they disagreed the moment a machine dropped to tier 0 — the
 * beads handed over to a surface that tier refuses to draw, and the figure
 * disappeared completely. A user on a weak machine got an empty room.
 *
 * The step counts came down by a fifth when the face's blend radii did. A
 * polynomial smooth minimum understates distance in proportion to its own
 * radius, so 50 mm blends forced a heavily shortened march to stop it
 * tunnelling through thin features; at 12–26 mm the field is much closer to a
 * true distance field and a longer step is safe.
 */
export const MARCH_STEPS = { 0: 0, 1: 44, 2: 64, 3: 88 } as const;

/**
 * Tier 0 keeps the beads and never pays for the march.
 *
 * This is the most expensive shader in the scene by a wide margin — a march, a
 * gradient, five occlusion taps and a shadow ray, each evaluating a field of
 * thirty primitives. A machine that was already struggling with the beads
 * cannot afford it, and the beads are a perfectly good figure.
 */
export function surfaceEnabled(tier: number): boolean {
  return (MARCH_STEPS[tier as 0 | 1 | 2 | 3] ?? 64) > 0;
}
