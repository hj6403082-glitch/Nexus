/**
 * HOW HARD THE SURFACE MARCHES. NOT WHETHER IT MARCHES.
 *
 * This used to return zero steps at tier 0, so a weak machine kept the beads
 * and never paid for the raymarch. That was a feedback loop, and a nasty one:
 * the march is the most expensive thing in the scene, so running it pushes the
 * frame rate down, which drops the tier, which switches the march off, which
 * brings the frame rate back up, which raises the tier, which switches the
 * march back on. The figure flips between a smooth surface and a cloud of
 * disconnected dots every few seconds, and the dots are what gets seen —
 * thirty-two thousand beads at 4 mm spacing over a face whose features are
 * 2–8 mm across read as a disfigurement, not as a person.
 *
 * Any quality dial that changes WHAT is drawn rather than HOW WELL can do this.
 * The fix is not better hysteresis, it is to stop switching representations:
 * every tier marches, and the tier only decides how finely. A coarse march is
 * a slightly softer surface. A dropped march is a different object.
 *
 * The floor is set where the silhouette still closes. Below about 24 steps the
 * ray starts terminating early on grazing hits and the outline frays, which is
 * its own kind of wrong — so tier 0 pays for 26 and saves everywhere else
 * instead (fewer beads, no bloom, no depth of field, lower resolution).
 */
export const MARCH_STEPS = { 0: 26, 1: 40, 2: 60, 3: 84 } as const;

/**
 * Always. Kept as a function because two components have to agree about it —
 * `SurfaceFigure` decides whether to draw the surface and `HumanForm` decides
 * whether to retire the beads, and when those were two separate expressions of
 * the same intent they disagreed at tier 0 and the figure vanished entirely.
 * One statement, one answer, and now the answer never changes.
 */
export function surfaceEnabled(): boolean {
  return true;
}

export function marchSteps(tier: number): number {
  return MARCH_STEPS[tier as 0 | 1 | 2 | 3] ?? 60;
}
