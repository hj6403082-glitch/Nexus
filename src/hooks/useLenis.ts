'use client';

import { useEffect, type RefObject } from 'react';
import Lenis from 'lenis';

/**
 * Smooth scrolling for the two surfaces in NEXUS that actually scroll: the ⌘K
 * results and the flat fallback page.
 *
 * Native scrolling is stepped — a wheel notch jumps a fixed distance and stops
 * dead — and next to a room where everything else settles on a spring, that
 * step is the most jarring motion in the app. Lenis interpolates it, so the
 * list obeys the same physics as the scene.
 *
 * Disabled entirely under `prefers-reduced-motion`: smoothing scroll is
 * precisely the kind of motion that setting exists to refuse, and the native
 * scroller still works underneath.
 */
export function useLenis(
  target: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const element = target.current;
    if (!element) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lenis = new Lenis({
      wrapper: element,
      content: element,
      duration: 0.85,
      // Matches the settle of the springs in core/math/spring.ts closely enough
      // that a scroll and a card arriving feel like the same machine.
      easing: (t) => 1 - Math.pow(1 - t, 3),
      smoothWheel: true,
    });

    let raf = 0;
    const tick = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, [target, enabled]);
}
