'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAIStore } from '@/stores/useAIStore';

/**
 * THE WAKE WAVE.
 *
 * When NEXUS wakes, the whole interface glows and a wave spreads across the
 * scene. This is the DOM half of it — a full-bleed radial expansion and the
 * microphone appearing. The scene half rides the same `wakeWave` value.
 */
export function WakeOverlay() {
  const awake = useAIStore((s) => s.awake);
  const status = useAIStore((s) => s.status);
  const level = useAIStore((s) => s.speechLevel);

  // The wave itself is a one-shot; the glow that follows is held by `awake`.
  useEffect(() => {
    if (!awake) return;
    const id = setTimeout(() => useAIStore.getState().setWakeWave(0), 1600);
    return () => clearTimeout(id);
  }, [awake]);

  return (
    <>
      <AnimatePresence>
        {awake && (
          <motion.div
            key="wave"
            className="pointer-events-none fixed inset-0 z-10"
            initial={{ opacity: 0.85, scale: 0.2 }}
            animate={{ opacity: 0, scale: 2.4 }}
            transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
            style={{
              background:
                'radial-gradient(circle at 50% 55%, rgba(120,180,255,0.30) 0%, rgba(120,180,255,0.06) 42%, transparent 68%)',
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {awake && (
          <motion.div
            key="mic"
            className="pointer-events-none fixed bottom-[9%] left-1/2 z-30 -translate-x-1/2"
            initial={{ opacity: 0, y: 14, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          >
            <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] backdrop-blur-md">
              <motion.div
                className="absolute inset-0 rounded-full border border-nexus-accent/50"
                animate={{
                  scale: 1 + level * 0.55,
                  opacity: 0.25 + level * 0.6,
                }}
                transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              />
              <svg width="18" height="26" viewBox="0 0 18 26" fill="none" aria-hidden>
                <rect x="5" y="1" width="8" height="14" rx="4" fill="#cfe2ff" />
                <path
                  d="M1 12a8 8 0 0 0 16 0M9 20v5"
                  stroke="#cfe2ff"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="mt-2 text-center font-mono text-[9.5px] uppercase tracking-[0.25em] text-nexus-dim">
              {status}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
