'use client';

import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { useTransformStore } from '@/stores/useTransformStore';
import { useAIStore } from '@/stores/useAIStore';
import { useModuleData } from '@/stores/useModuleData';
import { MODULE_BY_ID } from '@/core/constants/modules';
import { ACCENTS } from '@/core/constants/palette';

/**
 * THE PRESENTED PANEL.
 *
 * While embodied there is no ring, so modules are PRESENTED rather than opened:
 * one glass panel beside the figure, at most two at a time, with a 24px title
 * and tabular figures a person across the room could quote.
 *
 * THE PANEL IS NEVER IN THE HAND. It stays DOM — readability is the entire
 * point of presenting it, and DOM text is the only text here that is real text
 * — and is carried as a HOLOGRAM: the rig publishes where the held panel's
 * centre should sit in screen space every frame, and this follows that anchor
 * through MOTION VALUES. No React render per frame; the position is written
 * straight to the compositor.
 *
 * The moment the hand opens its fingers, the panel springs to its slot and
 * STAYS — sharp, still and readable. A panel that keeps drifting is a panel
 * nobody finishes reading.
 */
export function PresentedPanel() {
  const focus = useAIStore((s) => s.focusModule);
  const presence = useTransformStore((s) => s.env.presence);
  const record = useModuleData((s) => (focus ? s.records[focus] : undefined));

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  // Springs, so the hand-off from "held" to "settled" is a physical settle
  // rather than a cut.
  const sx = useSpring(x, { stiffness: 180, damping: 26, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 180, damping: 26, mass: 0.6 });
  const settled = useRef(false);
  const node = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const follow = () => {
      raf = requestAnimationFrame(follow);
      const { handAnchor } = useTransformStore.getState();

      if (handAnchor.visible) {
        settled.current = false;
        // The anchor is the panel's BOTTOM edge, centred horizontally — so the
        // panel floats above the open palm rather than on top of the hand.
        const height = node.current?.offsetHeight ?? 470;
        x.set(handAnchor.x * window.innerWidth - 170);
        y.set(handAnchor.y * window.innerHeight - height);
        return;
      }
      // The hand let go, or was never ready: the panel's slot beside the
      // figure. If the hand is not available at all, this is simply where the
      // panel slides in from the edge to, exactly as it always did.
      if (!settled.current) {
        settled.current = true;
        x.set(window.innerWidth * 0.64);
        y.set(window.innerHeight * 0.26);
      }
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, [x, y]);

  if (presence < 0.35 || !focus || !record) return null;

  const def = MODULE_BY_ID[focus];
  const accent = ACCENTS[def.accent];
  const face = record.face;

  return (
    <motion.div
      ref={node}
      style={{ x: sx, y: sy }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: Math.min(1, presence * 1.4), scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 28 }}
      className="pointer-events-none fixed left-0 top-0 z-30 w-[340px] rounded-2xl border border-white/10 bg-[#0a1018]/85 p-5 backdrop-blur-xl"
    >
      <div className="mb-1 h-[2px] w-12 rounded" style={{ background: accent.css }} />
      <div className="text-[24px] font-medium leading-tight text-nexus-ink">{face.title}</div>
      <div className="mt-0.5 text-[12px] text-nexus-dim">{face.caption}</div>

      {face.metric && (
        <div className="mt-4">
          <div
            className="font-mono text-[42px] font-light leading-none tabular-nums"
            style={{ color: accent.css }}
          >
            {face.metric}
          </div>
          {face.metricLabel && (
            <div className="mt-1 text-[10.5px] uppercase tracking-[0.18em] text-nexus-dim">
              {face.metricLabel}
            </div>
          )}
        </div>
      )}

      {face.series && face.series.length > 1 && (
        <Sparkline values={face.series} colour={accent.css} />
      )}

      {face.rows && (
        <div className="mt-4 space-y-1.5 font-mono text-[12px]">
          {face.rows.slice(0, 5).map(([label, value]) => (
            <div key={label} className="flex justify-between border-b border-white/[0.06] pb-1">
              <span className="text-nexus-dim">{label}</span>
              <span className="tabular-nums text-nexus-ink">{value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-between font-mono text-[10px] text-nexus-dim/70">
        <span>{face.status}</span>
        <span>
          {record.provenance} · {face.age}
        </span>
      </div>
    </motion.div>
  );
}

/** Draws itself once, then stops. */
function Sparkline({ values, colour }: { values: number[]; colour: string }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 300},${60 - ((v - min) / span) * 56}`)
    .join(' ');

  return (
    <svg viewBox="0 0 300 64" className="mt-4 w-full" aria-hidden>
      <motion.polyline
        points={points}
        fill="none"
        stroke={colour}
        strokeWidth={2}
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}
