'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAIStore } from '@/stores/useAIStore';
import { useTransformStore } from '@/stores/useTransformStore';

/**
 * AI responses appear IN SPACE, not in chat bubbles.
 *
 * Sentences assemble from particles: each word arrives from a scattered
 * position with its own blur and settles into the line. A chat log would put
 * the model in a window; this puts it in the room, which is the whole premise.
 *
 * Only the latest model turn is shown, and only while it is live. History is
 * the model's business, not the user's — a transcript on screen is a thing to
 * scroll, and there is nothing to scroll with.
 */
export function HolographicText() {
  const history = useAIStore((s) => s.history);
  const status = useAIStore((s) => s.status);
  const interim = useAIStore((s) => s.interim);
  const presence = useTransformStore((s) => s.env.presence);

  const latest = [...history].reverse().find((t) => t.role === 'model');
  const show =
    latest && (latest.streaming || status === 'speaking' || Date.now() - latest.at < 14_000);

  const words = latest?.text.split(/\s+/).filter(Boolean) ?? [];

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex flex-col items-center px-8"
      style={{ bottom: presence > 0.4 ? '12%' : '18%' }}
    >
      <AnimatePresence>
        {interim && (
          <motion.div
            key="interim"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 0.55, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-3 font-mono text-[12px] uppercase tracking-[0.2em] text-nexus-dim"
          >
            {interim}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {show && (
          <motion.p
            key={latest!.id}
            className="max-w-[46ch] text-center text-[19px] font-light leading-relaxed text-nexus-ink"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, filter: 'blur(6px)' }}
            transition={{ duration: 0.5 }}
          >
            {words.map((word, i) => (
              <Word key={`${latest!.id}-${i}`} word={word} index={i} />
            ))}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function Word({ word, index }: { word: string; index: number }) {
  // The scatter is seeded from the index so a word does not jump when the
  // component re-renders on the next token.
  const seed = useRef((Math.sin(index * 91.7) * 43758.5453) % 1);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setSettled(true), 30);
    return () => clearTimeout(id);
  }, []);

  const s = seed.current;
  return (
    <motion.span
      className="inline-block"
      initial={{
        opacity: 0,
        x: s * 60,
        y: -s * 34,
        filter: 'blur(8px)',
        scale: 0.94,
      }}
      animate={
        settled
          ? { opacity: 1, x: 0, y: 0, filter: 'blur(0px)', scale: 1 }
          : undefined
      }
      transition={{ type: 'spring', stiffness: 190, damping: 24, mass: 0.5 }}
    >
      {word}
      {' '}
    </motion.span>
  );
}
