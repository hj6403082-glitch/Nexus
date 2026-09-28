'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MAX_TIMELINE_STEP, PRESENT } from '@/core/constants/motion';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { audio } from '@/audio/AudioEngine';

/**
 * THE MASTER CLOCK for module presentation (Phase 6).
 *
 * One clock. The ring, the bracket, the camera push, the scan line and the
 * stepped-back cards all read `presentPhase` and `presentT` from the store and
 * write nothing back. There is exactly one place time advances, so there is no
 * way for two layers of the sequence to disagree about where they are — which
 * is the failure mode every independently-animated sequence eventually hits.
 *
 * The three beats are deliberately asymmetric; see PRESENT in motion.ts.
 */
export function PresentationClock() {
  const elapsed = useRef(0);

  useFrame((_, rawDelta) => {
    // A TIMELINE, not a spring — see MAX_TIMELINE_STEP. Clamping this to a
    // twentieth of a second made a 6.7 s presentation take over half a minute
    // on a slow renderer, which reads as a click that did nothing.
    const dt = Math.min(rawDelta, MAX_TIMELINE_STEP);
    const s = useCarouselStore.getState();
    if (s.presentPhase === 'none') {
      elapsed.current = 0;
      return;
    }

    elapsed.current += dt;
    const duration = PRESENT[s.presentPhase.toUpperCase() as keyof typeof PRESENT];
    const t = Math.min(1, elapsed.current / duration);

    if (t < 1) {
      s.setPresent(s.presentPhase, t);
      return;
    }

    elapsed.current = 0;
    if (s.presentPhase === 'targeting') {
      audio.play('open', 0.7);
      s.setPresent('approach', 0);
    } else if (s.presentPhase === 'approach') {
      s.setPresent('settle', 0);
    } else {
      // Settle complete: the bracket dissolves, the push relaxes, and control
      // returns to the user.
      useCarouselStore.setState({
        presentPhase: 'none',
        presentT: 0,
        open: s.pending ?? s.open,
        pending: null,
      });
      audio.play('confirm', 0.5);
    }
  });

  return null;
}
