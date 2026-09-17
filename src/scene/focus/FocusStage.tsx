'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { damp } from '@/core/math/spring';
import { Chart3D } from './Chart3D';

const UP = new THREE.Vector3(0, 1, 0);
import { NewsStack } from './NewsStack';
import { ProjectWorlds } from './ProjectWorlds';

/**
 * WHAT A MODULE BECOMES ONCE IT IS OPEN.
 *
 * A card has to stay legible from across the ring, so its face is a summary.
 * Opening it earns the space for the data to become geometry — a chart that
 * stands up off the floor, a deck of articles you swipe through, a
 * constellation of project worlds.
 *
 * The stage sits between the camera and the centred card, which is exactly
 * where the camera has already pushed to. It is deliberately NOT parented to
 * the carousel: the ring keeps turning underneath it, and a stage that turned
 * with the ring would swing out of frame the moment anything rotated.
 */
export function FocusStage() {
  const group = useRef<THREE.Group>(null);
  const presence = useRef(0);
  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const g = group.current;
    if (!g) return;

    const carousel = useCarouselStore.getState();
    const embodied = useTransformStore.getState().phase !== 'NORMAL';
    /**
     * The stage retracts for the whole of a presentation sequence.
     *
     * `open` only becomes the new module when the sequence SETTLES, so a stage
     * that tracks `open` alone keeps showing the previous module's content
     * while the ring has already turned to the next one — news articles
     * floating in front of the Projects card. Nothing about that is subtle.
     *
     * Retracting is also the right choreography: Phase 6 steps the unrelated
     * cards back during targeting, and the outgoing module's stage is the most
     * unrelated thing in the frame.
     */
    const open = embodied || carousel.presentPhase !== 'none' ? null : carousel.open;

    presence.current = damp(presence.current, open ? 1 : 0, 0.2, dt);
    if (presence.current !== carousel.focusPresence) {
      carousel.setFocusPresence(presence.current);
    }
    if (presence.current < 0.005) {
      g.visible = false;
      return;
    }
    g.visible = true;

    /**
     * PLACED RELATIVE TO THE CAMERA, not to the world.
     *
     * The stage is a presentation surface for whoever is looking, not a thing
     * that lives at a particular spot in the room — and the camera moves while
     * a module opens (it pushes in, it drifts, and Phase 6's approach carries
     * it further still). Pinning the stage to a world position meant its
     * framing depended on where the camera happened to end up, and it slid out
     * of frame or behind the card depending on the beat.
     *
     * Fixed offsets down the view axis are deterministic: it is always this
     * far in front and this far below the eye, so it is always in shot and
     * always nearer than the card it belongs to.
     */
    const camera = state.camera;
    camera.getWorldDirection(forward);
    right.set(forward.z, 0, -forward.x).normalize();

    g.position
      .copy(camera.position)
      .addScaledVector(forward, 2.35)
      .addScaledVector(UP, -0.92 + presence.current * 0.06);

    // Face the camera squarely; a stage seen at an angle is a stage nobody can
    // read the numbers off.
    g.quaternion.copy(camera.quaternion);
    g.scale.setScalar(0.62 + presence.current * 0.1);
  });

  const open = useCarouselStore((s) => s.open);

  return (
    <group ref={group} visible={false}>
      {open === 'news' && (
        <group position={[0, 0.34, 0]}>
          <NewsStack />
        </group>
      )}
      {open === 'projects' && (
        <group position={[0, 0.3, 0]}>
          <ProjectWorlds />
        </group>
      )}
      {open && open !== 'news' && open !== 'projects' && <Chart3D module={open} />}
    </group>
  );
}
