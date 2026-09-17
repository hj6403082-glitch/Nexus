'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { MOTION, PRESENT } from '@/core/constants/motion';
import { advanceSpring, makeSpring } from '@/core/math/spring';
import { smootherstep } from '@/core/math/util';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { useSystemStore } from '@/stores/useSystemStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { CAROUSEL_RADIUS } from './Carousel';

const BASE = new THREE.Vector3(0, 0.12, 0);
const LOOK = new THREE.Vector3(0, 0, CAROUSEL_RADIUS);

/**
 * Camera rig.
 *
 * Owns the camera completely: nothing else in the scene is permitted to touch
 * `camera.position` or `camera.quaternion`. One writer means the "zero drift
 * with zero input" guarantee is checkable by reading one function.
 */
export function Rig() {
  const { camera } = useThree();
  const push = useMemo(() => makeSpring(0), []);
  const embodiedPull = useMemo(() => makeSpring(0), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);
  const baseline = useRef(new THREE.Vector3(0, 0.1, -0.2));

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const carousel = useCarouselStore.getState();
    const system = useSystemStore.getState();
    const transform = useTransformStore.getState();
    const m = system.motionMultiplier;
    const time = state.clock.elapsedTime;

    /**
     * APPROACH pushes the camera along the VIEW AXIS to meet the card.
     * Not "toward the card's position" — along the axis the camera is already
     * looking down. Moving toward the card's world position introduces a
     * lateral component, and any lateral camera move during an approach reads
     * as a dolly, which fights the card's own travel instead of meeting it.
     */
    let pushTarget = 0;
    if (carousel.presentPhase === 'approach') {
      pushTarget = smootherstep(0, 1, carousel.presentT) * 1.05;
    } else if (carousel.presentPhase === 'settle') {
      // The push RELAXES during settle rather than snapping back.
      pushTarget = 1.05 * (1 - smootherstep(0, 1, carousel.presentT) * 0.35);
    } else if (carousel.open) {
      // Enough to commit to the module, not so much that its stage is cropped.
      pushTarget = 0.42;
    }
    advanceSpring(push, pushTarget, carousel.presentPhase === 'approach' ? MOTION.ARRIVING : MOTION.LEAVING, dt);

    // Phase 7: the camera pulls back to frame the bust.
    advanceSpring(embodiedPull, transform.env.presence, MOTION.REPORTING, dt);

    /**
     * Ambient camera drift. Skipped entirely — not scaled — when m is 0, so
     * the camera transform is bit-identical frame over frame while LOCKED.
     */
    let driftX = 0;
    let driftY = 0;
    let driftZ = 0;
    let lookDriftX = 0;
    let lookDriftY = 0;
    if (m !== 0) {
      driftX = Math.sin(time * 0.17) * 0.16 * m;
      driftY = Math.sin(time * 0.13 + 1.7) * 0.09 * m;
      driftZ = Math.sin(time * 0.09 + 0.4) * 0.11 * m;
      lookDriftX = Math.sin(time * 0.11 + 2.2) * 0.10 * m;
      lookDriftY = Math.sin(time * 0.15 + 0.9) * 0.06 * m;
    }

    const pull = embodiedPull.value;

    target.set(
      baseline.current.x + driftX,
      baseline.current.y + driftY + pull * 0.22,
      baseline.current.z + driftZ + push.value - pull * 0.55,
    );

    camera.position.copy(target);

    lookTarget.set(
      LOOK.x + lookDriftX,
      LOOK.y + lookDriftY + pull * 0.35,
      LOOK.z * (1 - pull) + pull * 1.1,
    );
    camera.lookAt(lookTarget);
  });

  return null;
}

export const RIG_BASE = BASE;
