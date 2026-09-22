'use client';

import { useEffect, useState } from 'react';
import { MODULES } from '@/core/constants/modules';
import { useCarouselStore, CAROUSEL_STEP } from '@/stores/useCarouselStore';
import { useSystemStore } from '@/stores/useSystemStore';
import { useTransformStore } from '@/stores/useTransformStore';

/**
 * THE RAIL.
 *
 * Ten modules sit on a circle and the frustum holds three of them. That is a
 * reasonable thing for a spatial interface to do — you are standing inside the
 * ring, and you cannot see behind your own head — but it left the interface
 * unable to answer two questions a first-time user asks immediately: how many
 * of these are there, and where am I in them?
 *
 * So the ring gets a map. Ten marks, the centred one named and lit, the rest
 * dimming with their angular distance from centre — the same falloff the cards
 * themselves use, so the rail and the ring agree about what "near the front"
 * means. Clicking a mark rotates to it by the SHORT way round.
 *
 * It is a readout that happens to be clickable, not a navigation bar: the ring
 * remains the way you move. This only makes the ring legible.
 */
export function RingRail() {
  const angle = useCarouselStore((s) => s.angle);
  const open = useCarouselStore((s) => s.open);
  const visible = useSystemStore((s) => s.hudVisible);
  const phase = useTransformStore((s) => s.phase);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 760);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // A map of the ring is meaningless once the ring has become a person, and
  // it was being drawn straight across the figure's face.
  if (!visible || phase !== 'NORMAL') return null;

  /**
   * Facing, per module, exactly as `centredModule()` computes it: cos of the
   * angle between the card and the camera. 1 is dead centre.
   */
  const facings = MODULES.map((_, i) =>
    Math.cos((i / MODULES.length) * Math.PI * 2 + angle),
  );
  const centre = facings.indexOf(Math.max(...facings));

  const goTo = (index: number) => {
    // The short way round. Stepping |index - centre| forward would take the
    // long way home more than half the time.
    let steps = index - centre;
    const half = MODULES.length / 2;
    if (steps > half) steps -= MODULES.length;
    if (steps < -half) steps += MODULES.length;
    useCarouselStore.setState((s) => ({ targetAngle: s.targetAngle - CAROUSEL_STEP * steps }));
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(50%+11rem)] z-20 flex flex-col items-center gap-2 select-none">
      <div
        className="font-mono text-[11px] uppercase tracking-[0.3em] text-nexus-ink/90 transition-opacity duration-[var(--duration-beat)]"
        style={{ opacity: open ? 0 : 1 }}
      >
        {MODULES[centre].label}
      </div>

      <div
        role="group"
        aria-label="Ring position"
        className="pointer-events-auto flex items-center gap-1.5"
        style={{ opacity: open ? 0.25 : 1, transition: 'opacity var(--duration-beat) var(--ease-nexus)' }}
      >
        {MODULES.map((m, i) => {
          const facing = facings[i];
          // Same curve the ring uses to decide what is "at the front", so a
          // mark brightens in step with its card rather than on its own clock.
          const near = Math.max(0, (facing + 1) / 2) ** 3;
          const isCentre = i === centre;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => goTo(i)}
              title={m.label}
              aria-label={`Rotate to ${m.label}`}
              aria-current={isCentre ? 'true' : undefined}
              className="group relative grid h-6 place-items-center px-1"
            >
              <span
                className={`block rounded-full transition-[width,height,background-color] duration-[var(--duration-half-beat)] ease-[var(--ease-nexus)] ${
                  isCentre ? 'h-1.5 w-6 bg-nexus-accent' : 'h-1.5 w-1.5 bg-nexus-ink'
                } group-hover:bg-nexus-accent`}
                style={{ opacity: isCentre ? 1 : 0.2 + near * 0.55 }}
              />
            </button>
          );
        })}
      </div>

      {!narrow && (
        <div className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-nexus-dim/50">
          {centre + 1} / {MODULES.length}
        </div>
      )}
    </div>
  );
}
