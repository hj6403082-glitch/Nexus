'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { Line2 } from 'three-stdlib';
import { useGestureStore } from '@/stores/useGestureStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { ACCENTS } from '@/core/constants/palette';
import { clamp01 } from '@/core/math/util';
import { damp } from '@/core/math/spring';

const SAMPLES = 48;

/**
 * EVERY GESTURE LEAVES A LIGHT TRAIL.
 *
 * Drawn with drei's `<Line>` rather than `THREE.Line`, because a raw WebGL
 * line is ONE PIXEL WIDE on every GPU at every distance. A one-pixel trail
 * reads as a rendering artefact; this one is a screen-space-thick ribbon that
 * can taper, which is the entire difference between "a stray line" and "light
 * following your hand".
 *
 * The geometry is written imperatively every frame. Passing a new `points`
 * array as a prop would re-render this component sixty times a second and
 * rebuild the buffer each time, for a trail that is forty-eight points long.
 */
export function GestureTrail() {
  const line = useRef<Line2>(null);
  const brightness = useRef(0);
  const lastGesture = useRef(0);

  // A ring buffer of world-space cursor samples, oldest first.
  const buffer = useMemo(() => new Float32Array(SAMPLES * 3), []);
  const colours = useMemo(() => new Float32Array(SAMPLES * 3), []);
  const filled = useRef(0);
  const initial = useMemo(
    () => Array.from({ length: SAMPLES }, () => new THREE.Vector3()),
    [],
  );
  // drei types `vertexColors` as the colour array itself, so the per-vertex
  // colours are supplied up front and then rewritten imperatively each frame.
  const initialColours = useMemo(
    () => Array.from({ length: SAMPLES }, () => [0, 0, 0] as [number, number, number]),
    [],
  );

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const l = line.current;
    if (!l) return;

    const gesture = useGestureStore.getState();
    const embodied = useTransformStore.getState().phase !== 'NORMAL';
    const cursor = gesture.cursor;

    if (!cursor.live || embodied) {
      // Let the trail die back rather than vanish — a trail that disappears
      // the instant the hand leaves reads as a bug.
      filled.current = Math.max(0, filled.current - 2);
      brightness.current = damp(brightness.current, 0, 0.12, dt);
      if (filled.current < 2) {
        l.visible = false;
        return;
      }
    } else {
      // Shift the buffer back one sample and append the new head.
      buffer.copyWithin(0, 3);
      buffer[(SAMPLES - 1) * 3] = cursor.x;
      buffer[(SAMPLES - 1) * 3 + 1] = cursor.y;
      buffer[(SAMPLES - 1) * 3 + 2] = cursor.z;
      filled.current = Math.min(SAMPLES, filled.current + 1);

      // A recognised gesture flares the trail; otherwise it rests dim, so the
      // trail reports intent rather than just position.
      if (gesture.gestureAt !== lastGesture.current) {
        lastGesture.current = gesture.gestureAt;
        brightness.current = 1;
      }
      const moving = clamp01(
        Math.hypot(
          buffer[(SAMPLES - 1) * 3] - buffer[(SAMPLES - 4) * 3],
          buffer[(SAMPLES - 1) * 3 + 1] - buffer[(SAMPLES - 4) * 3 + 1],
        ) * 3,
      );
      brightness.current = damp(brightness.current, moving * 0.55, 0.16, dt);
    }

    l.visible = true;

    // Taper: the head is bright, the tail fades to nothing. Vertex colours do
    // the fade because a line material has one opacity for the whole line.
    const head = ACCENTS.azure.rgb;
    const start = SAMPLES - filled.current;
    for (let i = 0; i < SAMPLES; i++) {
      const age = i < start ? 0 : (i - start) / Math.max(1, filled.current - 1);
      const k = age * age * (0.25 + brightness.current * 0.95);
      colours[i * 3] = head[0] * k;
      colours[i * 3 + 1] = head[1] * k;
      colours[i * 3 + 2] = head[2] * k;
      // Points before the filled window collapse onto the first real sample,
      // so the unused tail has zero length instead of sitting at the origin.
      if (i < start) {
        buffer[i * 3] = buffer[start * 3];
        buffer[i * 3 + 1] = buffer[start * 3 + 1];
        buffer[i * 3 + 2] = buffer[start * 3 + 2];
      }
    }

    l.geometry.setPositions(buffer as unknown as number[]);
    l.geometry.setColors(colours as unknown as number[]);
  });

  return (
    <Line
      ref={line}
      points={initial}
      vertexColors={initialColours}
      lineWidth={2.4}
      transparent
      depthWrite={false}
      blending={THREE.AdditiveBlending}
      toneMapped={false}
      visible={false}
    />
  );
}
