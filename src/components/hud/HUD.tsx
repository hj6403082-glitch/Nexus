'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSystemStore } from '@/stores/useSystemStore';
import { useGestureStore } from '@/stores/useGestureStore';
import { useAIStore } from '@/stores/useAIStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { WORLDS } from '@/core/constants/worlds';
import { BEAT } from '@/core/constants/motion';

/**
 * The HUD is deliberately sparse. Four corners, nothing in the middle, nothing
 * that moves unless the thing it reports moved. It is instrumentation, not
 * decoration: every glyph answers a question the user would otherwise have to
 * guess at.
 */
export function HUD() {
  const visible = useSystemStore((s) => s.hudVisible);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-20 select-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: BEAT * 2, ease: [0.22, 1, 0.36, 1] }}
        >
          <TopLeft />
          <TopRight />
          <BottomLeft />
          <BottomRight />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TopLeft() {
  const { fps, tier, gpu, webgl } = useSystemStore();
  const tracking = useGestureStore((s) => s.tracking);
  const world = useSystemStore((s) => s.world);

  return (
    <div className="absolute left-6 top-6 space-y-1.5 font-mono text-[11px] tracking-wide">
      <div className="text-[13px] font-medium tracking-[0.35em] text-nexus-ink">NEXUS</div>
      <Row label="fps" value={String(fps)} tone={fps < 45 ? 'warn' : 'ok'} />
      <Row label="tier" value={`${tier} / 3`} />
      <Row label="gpu" value={webgl ? gpu : 'software'} tone={webgl ? 'dim' : 'warn'} />
      <Row
        label="track"
        value={tracking}
        tone={tracking === 'live' ? 'ok' : tracking === 'off' ? 'dim' : 'warn'}
      />
      <Row label="world" value={WORLDS[world].label.toLowerCase()} tone="dim" />
    </div>
  );
}

function TopRight() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Rendered null on the server: a clock is the one thing guaranteed to
  // hydrate-mismatch otherwise.
  if (!now) return null;

  return (
    <div className="absolute right-6 top-6 text-right font-mono">
      <div className="text-[26px] font-light leading-none tabular-nums text-nexus-ink">
        {now.toTimeString().slice(0, 5)}
        <span className="text-[14px] text-nexus-dim">:{now.toTimeString().slice(6, 8)}</span>
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-nexus-dim">
        {now.toDateString()}
      </div>
    </div>
  );
}

function BottomLeft() {
  const log = useSystemStore((s) => s.log);
  const recent = log.slice(-6);

  return (
    <div className="absolute bottom-6 left-6 w-[340px] space-y-1 font-mono text-[10.5px]">
      <AnimatePresence initial={false}>
        {recent.map((entry) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: BEAT, ease: [0.22, 1, 0.36, 1] }}
            className="flex gap-2"
          >
            <span className="text-nexus-dim/60 tabular-nums">
              {new Date(entry.at).toTimeString().slice(0, 8)}
            </span>
            <span
              className={
                entry.level === 'warn'
                  ? 'text-nexus-warn'
                  : entry.level === 'ok'
                    ? 'text-nexus-accent'
                    : 'text-nexus-dim'
              }
            >
              {entry.text}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function BottomRight() {
  const { gesture, confidence, gestureAt } = useGestureStore();
  const status = useAIStore((s) => s.status);
  const phase = useTransformStore((s) => s.phase);
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    setFresh(true);
    const id = setTimeout(() => setFresh(false), 1400);
    return () => clearTimeout(id);
  }, [gestureAt]);

  return (
    <div className="absolute bottom-6 right-6 space-y-1.5 text-right font-mono text-[11px]">
      <Row
        label="gesture"
        value={gesture}
        tone={fresh && gesture !== 'none' ? 'ok' : 'dim'}
        align="right"
      />
      <Row
        label="conf"
        value={gesture === 'none' ? '—' : confidence.toFixed(2)}
        tone="dim"
        align="right"
      />
      <Row label="ai" value={status} tone={status === 'offline' ? 'warn' : 'ok'} align="right" />
      {phase !== 'NORMAL' && (
        <Row label="form" value={phase.toLowerCase().replace(/_/g, ' ')} tone="ok" align="right" />
      )}
    </div>
  );
}

function Row({
  label,
  value,
  tone = 'dim',
  align = 'left',
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'dim';
  align?: 'left' | 'right';
}) {
  const colour =
    tone === 'warn' ? 'text-nexus-warn' : tone === 'ok' ? 'text-nexus-accent' : 'text-nexus-ink/70';
  return (
    <div className={`flex gap-2 ${align === 'right' ? 'justify-end' : ''}`}>
      <span className="text-nexus-dim/60 uppercase tracking-[0.18em]">{label}</span>
      <span className={`${colour} tabular-nums`}>{value}</span>
    </div>
  );
}
