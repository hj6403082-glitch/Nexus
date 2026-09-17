'use client';

import { useEffect } from 'react';
import gsap from 'gsap';
import { AnimatePresence, motion } from 'framer-motion';
import { BOOT } from '@/core/constants/motion';
import { useSystemStore } from '@/stores/useSystemStore';

/**
 * BOOT.
 *
 * Opening NEXUS should feel like booting into an operating system rather than
 * loading a page. Every beat is a multiple of the one BEAT constant, so the
 * whole opening speeds up or slows down as a single instrument.
 *
 * Driven by a GSAP timeline rather than a chain of `setTimeout` calls. A
 * timeline is one object that can be inspected, seeked and killed: the
 * setTimeout version could not be interrupted cleanly on unmount, its
 * progress bar was a second clock that could disagree with the stages it was
 * supposed to be reporting, and adding a beat in the middle meant
 * recalculating every offset after it by hand.
 */
export function Boot() {
  const stage = useSystemStore((s) => s.bootStage);

  useEffect(() => {
    const s = useSystemStore.getState();
    s.pushLog('cold start', 'ok');

    const progress = { value: 0 };

    const timeline = gsap.timeline({ defaults: { ease: 'none' } });

    // One tween carries the progress value for the whole boot; the stage
    // callbacks hang off the same timeline, so they cannot drift from it.
    timeline.to(progress, {
      value: 1,
      duration: BOOT.TOTAL,
      onUpdate: () => useSystemStore.getState().setBootProgress(progress.value),
    });

    timeline
      .call(
        () => {
          useSystemStore.getState().setBootStage('lattice');
          useSystemStore.getState().pushLog('lattice');
        },
        undefined,
        BOOT.BLACK,
      )
      .call(
        () => {
          useSystemStore.getState().setBootStage('atmosphere');
          useSystemStore.getState().pushLog('atmosphere');
        },
        undefined,
        BOOT.BLACK + BOOT.LATTICE_IN * 0.4,
      )
      .call(
        () => {
          useSystemStore.getState().setBootStage('cards');
          useSystemStore.getState().pushLog('modules mounted');
        },
        undefined,
        BOOT.BLACK + BOOT.LATTICE_IN * 0.8,
      )
      .call(
        () => {
          useSystemStore.getState().setBootStage('live');
          useSystemStore.getState().pushLog('nexus online', 'ok');
        },
        undefined,
        BOOT.TOTAL * 0.55,
      );

    return () => {
      timeline.kill();
    };
  }, []);

  return (
    <AnimatePresence>
      {stage !== 'live' && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[#04060b]"
          initial={{ opacity: 1 }}
          animate={{ opacity: stage === 'black' ? 1 : 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: BOOT.ATMOSPHERE_IN, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.div
            className="font-mono text-[11px] uppercase tracking-[0.5em] text-nexus-dim"
            initial={{ opacity: 0, letterSpacing: '1.2em' }}
            animate={{ opacity: 1, letterSpacing: '0.5em' }}
            transition={{ duration: BOOT.LATTICE_IN, ease: [0.22, 1, 0.36, 1] }}
          >
            NEXUS
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
