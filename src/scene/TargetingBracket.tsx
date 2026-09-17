'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ACCENTS } from '@/core/constants/palette';
import { MODULE_BY_ID } from '@/core/constants/modules';
import { smootherstep } from '@/core/math/util';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { CARD_SIZE } from './Card';
import { CAROUSEL_RADIUS } from './Carousel';

/**
 * The FUI targeting bracket (Phase 6).
 *
 * Four QUADS, not lines. A line rendered with `LineBasicMaterial` is one pixel
 * wide at every distance and on every GPU, which makes the bracket thinner as
 * the camera pushes in — exactly backwards. Quads scale with the scene and can
 * carry a gradient along their length, so the corners read as machined.
 *
 * The brackets converge from OUTSIDE the frame during TARGETING, lock during
 * APPROACH, and dissolve during SETTLE. They never animate on their own clock;
 * every value here is a pure function of `presentPhase` / `presentT`.
 */
export function TargetingBracket() {
  const group = useRef<THREE.Group>(null);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );

  const geometry = useMemo(() => {
    // One corner bracket: two thin quads meeting at a right angle.
    const arm = 0.26;
    const thickness = 0.016;
    const shapes: number[] = [];
    // Horizontal arm.
    pushQuad(shapes, 0, 0, arm, thickness);
    // Vertical arm.
    pushQuad(shapes, 0, 0, thickness, arm);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(shapes, 3));
    return g;
  }, []);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const s = useCarouselStore.getState();

    if (s.presentPhase === 'none' || !s.pending) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const accent = ACCENTS[MODULE_BY_ID[s.pending].accent];
    material.color.setRGB(accent.rgb[0], accent.rgb[1], accent.rgb[2]);

    // Convergence: 0 = far outside the frame, 1 = locked on the card.
    let converge: number;
    let opacity: number;
    if (s.presentPhase === 'targeting') {
      converge = smootherstep(0, 1, s.presentT);
      opacity = Math.min(1, s.presentT * 3);
    } else if (s.presentPhase === 'approach') {
      converge = 1;
      opacity = 1;
    } else {
      converge = 1;
      // Dissolve over the first third of SETTLE — the bracket's job is done the
      // moment the card stops, and leaving it up makes the frame feel busy
      // exactly when the user is trying to read.
      opacity = 1 - smootherstep(0, 0.34, s.presentT);
    }

    const spread = 2.6 - converge * 2.6;
    const halfW = CARD_SIZE.w * 0.62 + spread;
    const halfH = CARD_SIZE.h * 0.58 + spread;

    const corners = g.children as THREE.Mesh[];
    const signs = [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ];
    corners.forEach((mesh, i) => {
      const [sx, sy] = signs[i];
      mesh.position.set(sx * halfW, sy * halfH, 0);
      mesh.scale.set(sx, sy, 1);
    });

    material.opacity = opacity;

    // The bracket sits just in front of the card, at the ring radius.
    g.position.set(0, 0, CAROUSEL_RADIUS - 0.14);
  });

  return (
    <group ref={group} visible={false}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} geometry={geometry} material={material} />
      ))}
    </group>
  );
}

function pushQuad(out: number[], x: number, y: number, w: number, h: number): void {
  const x0 = x;
  const y0 = y;
  const x1 = x + w;
  const y1 = y + h;
  out.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
}
