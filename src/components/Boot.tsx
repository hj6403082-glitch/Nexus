'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BOOT } from '@/core/constants/motion';
import { useSystemStore } from '@/stores/useSystemStore';

/**
 * BOOT.
 *
 * Opening NEXUS should feel like booting into an operating system rather than
 * loading a page. Every beat below is a multiple of BEAT, composed from the
 * one choreography constant — so the whole opening speeds up or slows down as
 * a single instrument.
 */
export function Boot() {
  const stage = useSystemStore((s) => s.bootStage);

  useEffect(() => {
    const s = useSystemStore.getState();
    const timers: number[] = [];
    const at = (seconds: number, fn: () => void) =>
      timers.push(window.setTimeout(fn, seconds * 1000));

    s.pushLog('cold start', 'ok');
    at(BOOT.BLACK, () => {
      s.setBootStage('lattice');
      s.pushLog('lattice');
    });
    at(BOOT.BLACK + BOOT.LATTICE_IN * 0.4, () => {
      s.setBootStage('atmosphere');
      s.pushLog('atmosphere');
    });
    at(BOOT.BLACK + BOOT.LATTICE_IN * 0.8, () => {
      s.setBootStage('cards');
      s.pushLog('modules mounted');
    });
    at(BOOT.TOTAL * 0.55, () => {
      s.setBootStage('live');
      s.pushLog('nexus online', 'ok');
    });

    let raf = 0;
    const started = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = Math.min(1, (performance.now() - started) / (BOOT.TOTAL * 1000));
      useSystemStore.getState().setBootProgress(p);
      if (p >= 1) cancelAnimationFrame(raf);
    };
    tick();

    return () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <AnimatePresence>
      {stage !== 'live' && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[#04060b]"
          initial={{ opacity: 1 }}
          animate={{ opacity: stage === 'black' ? 1 : 0.0 }}
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
