'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ACCENTS } from '@/core/constants/palette';
import { MODULE_BY_ID, type ModuleId } from '@/core/constants/modules';
import { clamp01, smoothstep } from '@/core/math/util';
import { damp } from '@/core/math/spring';
import { useModuleData } from '@/stores/useModuleData';
import { useCarouselStore } from '@/stores/useCarouselStore';

const MAX_BARS = 32;

/**
 * THE CHART ANIMATES IN 3D.
 *
 * The card face carries a 2D sparkline because a card has to stay readable
 * from across the ring. Once a module is FOCUSED there is room for the series
 * to become geometry: instanced bars that rise from zero, staggered left to
 * right, standing in front of the card at its own scale.
 *
 * One InstancedMesh and one matrix write per bar per frame — the alternative,
 * a mesh per bar, is thirty-two draw calls for a chart.
 */
export function Chart3D({ module }: { module: ModuleId }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const growth = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const record = useModuleData((s) => s.records[module]);
  const accent = ACCENTS[MODULE_BY_ID[module].accent];

  const series = useMemo(() => {
    const raw = record?.face.series ?? [];
    if (raw.length < 2) return [] as number[];
    // Downsample to the bar budget, then normalise. A chart with ninety bars
    // at this size is a texture, not a chart.
    const step = Math.max(1, Math.floor(raw.length / MAX_BARS));
    const taken: number[] = [];
    for (let i = 0; i < raw.length; i += step) taken.push(raw[i]);
    const min = Math.min(...taken);
    const max = Math.max(...taken);
    const span = max - min || 1;
    return taken.slice(0, MAX_BARS).map((v) => (v - min) / span);
  }, [record]);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const m = mesh.current;
    if (!m || series.length === 0) return;

    growth.current = damp(growth.current, 1, 0.28, dt);

    const width = 1.9;
    const gap = width / series.length;
    for (let i = 0; i < series.length; i++) {
      // Staggered left to right, so the chart draws itself rather than
      // inflating all at once.
      const local = clamp01((growth.current - (i / series.length) * 0.35) / 0.65);
      const eased = smoothstep(0, 1, local);
      const height = Math.max(0.004, series[i] * 0.5 * eased);
      dummy.position.set(-width / 2 + gap * (i + 0.5), height / 2, 0);
      dummy.scale.set(gap * 0.55, height, gap * 0.55);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.count = series.length;
    m.instanceMatrix.needsUpdate = true;
    if (material.current) {
      material.current.opacity = 0.55 * useCarouselStore.getState().focusPresence;
    }
  });

  if (series.length === 0) return null;

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, MAX_BARS]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        ref={material}
        color={new THREE.Color(accent.rgb[0], accent.rgb[1], accent.rgb[2])}
        transparent
        opacity={0.55}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </instancedMesh>
  );
}
