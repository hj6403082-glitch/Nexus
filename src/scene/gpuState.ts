/**
 * Whether the GPU context has been taken away.
 *
 * Shared between the context listener and the error boundary because they
 * observe the SAME event from two sides and race each other: losing the
 * context makes every WebGL call start returning null, so React's render loop
 * usually throws a null-property error in the same frame the loss handler
 * fires. Whichever arrives first, the user should be told "the GPU context was
 * lost" — not "Cannot read properties of null (reading 'alpha')", which is
 * true, useless, and alarming.
 */
let lost = false;

export function markContextLost(): void {
  lost = true;
}

export function markContextRestored(): void {
  lost = false;
}

export function wasContextLost(): boolean {
  return lost;
}
