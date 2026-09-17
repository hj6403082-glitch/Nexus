'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { MODULES } from '@/core/constants/modules';
import { MOTION } from '@/core/constants/motion';
import { advanceSpring, shortestAngle } from '@/core/math/spring';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { useSystemStore } from '@/stores/useSystemStore';
import { Card } from './Card';

const RADIUS = 4.2;

export function Carousel() {
  const root = useRef<THREE.Group>(null);
  const angleSpring = useMemo(() => ({ value: 0, velocity: 0 }), []);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const carousel = useCarouselStore.getState();
    const m = useSystemStore.getState().motionMultiplier;

    if (!carousel.frozen) {
      /**
       * Rotate through the SHORTEST path to the target. The target itself is
       * unbounded (it accumulates), so we spring the current angle toward
       * `angle + shortestAngle(...)` rather than toward the raw target: that
       * keeps the spring's stored velocity meaningful across a wrap.
       */
      const goal = angleSpring.value + shortestAngle(angleSpring.value, carousel.targetAngle);
      advanceSpring(angleSpring, goal, MOTION.ARRIVING, dt);
    }

    /**
     * Ambient carousel drift. `m` is exactly 0 when the scene is LOCKED, and
     * this whole term is skipped rather than multiplied — so `angle` receives
     * no write at all and the drift over any number of seconds of zero input
     * is exactly, verifiably zero.
     */
    const drift = m === 0 ? 0 : Math.sin(performance.now() * 0.00007) * 0.00022 * m;

    const angle = angleSpring.value + drift;
    if (angle !== carousel.angle) {
      carousel.setAngle(angle, angleSpring.velocity);
    }
  });

  return (
    <group ref={root}>
      {MODULES.map((module, i) => (
        <Card
          key={module.id}
          module={module}
          index={i}
          count={MODULES.length}
          radius={RADIUS}
        />
      ))}
    </group>
  );
}

export const CAROUSEL_RADIUS = RADIUS;
