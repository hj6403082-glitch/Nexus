'use client';

import { motion } from 'framer-motion';
import { useSystemStore } from '@/stores/useSystemStore';

/**
 * THE LOCKED / DRIFT INDICATOR.
 *
 * It shows its own CONSEQUENCE, not its own name. A switch labelled "ambient
 * motion" tells you what it is called; this one tells you what the room will
 * do — the dot travels while drifting and sits perfectly still while locked,
 * so the control is a live sample of the setting it controls.
 *
 * The bar underneath is the motion MULTIPLIER, not the boolean: you can watch
 * the room settle over its second rather than stopping dead.
 */
export function MotionControl() {
  const driftEnabled = useSystemStore((s) => s.driftEnabled);
  const multiplier = useSystemStore((s) => s.motionMultiplier);
  const toggle = useSystemStore((s) => s.toggleDrift);

  return (
    <button
      onClick={toggle}
      className="pointer-events-auto group absolute left-1/2 top-6 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-nexus-ink/80 backdrop-blur-md transition-colors hover:border-white/20 hover:text-nexus-ink"
      aria-pressed={driftEnabled}
    >
      <span className="flex items-center gap-3">
        <span className="relative h-[3px] w-14 overflow-hidden rounded-full bg-white/10">
          <motion.span
            className="absolute inset-y-0 w-3 rounded-full bg-nexus-accent"
            animate={
              driftEnabled
                ? { x: [0, 44, 0] }
                : { x: 0 }
            }
            transition={
              driftEnabled
                ? { duration: 4.2, repeat: Infinity, ease: 'easeInOut' }
                : { duration: 0.9, ease: [0.22, 1, 0.36, 1] }
            }
          />
        </span>
        <span>{driftEnabled ? 'drift' : 'locked'}</span>
        <span className="tabular-nums text-nexus-dim/70">{multiplier.toFixed(2)}</span>
      </span>
    </button>
  );
}
