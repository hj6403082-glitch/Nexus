'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ACCENTS } from '@/core/constants/palette';
import { useModuleData } from '@/stores/useModuleData';
import { useSystemStore } from '@/stores/useSystemStore';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { clamp01, smoothstep } from '@/core/math/util';
import { damp } from '@/core/math/spring';
import { PANEL_ASPECT, paintPanel } from './panelTexture';

interface Project {
  name: string;
  status?: string;
  repo?: string;
  description?: string;
  media?: string[];
  prompts?: string[];
}

const W = 1.35;
const H = W / PANEL_ASPECT;

/**
 * EVERY PROJECT BECOMES A FLOATING WORLD.
 *
 * Not a list of projects — a small constellation of them, arranged in an arc
 * in front of the focused card, each carrying its own description, links and
 * prompt history. They arrive staggered from the centre outward so the arc
 * assembles rather than appearing.
 */
export function ProjectWorlds() {
  const group = useRef<THREE.Group>(null);
  const reveal = useRef(0);
  const record = useModuleData((s) => s.records.projects);

  const projects = useMemo(() => {
    const detail = record?.detail as { items?: Project[] } | null;
    return (detail?.items ?? []).slice(0, 5);
  }, [record]);

  const textures = useMemo(() => {
    if (typeof document === 'undefined') return [];
    return projects.map((p) =>
      paintPanel({
        title: p.name,
        lines: [
          p.description ?? `${p.status ?? 'unknown'} · ${p.media?.length ?? 0} media`,
          p.prompts?.[0] ? `“${p.prompts[0]}”` : 'no prompt history recorded',
        ],
        accent: ACCENTS.indigo.css,
        footer: p.repo && p.repo !== '—' ? p.repo : 'no repository linked',
      }),
    );
  }, [projects]);

  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);

  useEffect(() => {
    if (projects.length > 0) {
      useSystemStore.getState().pushLog(`${projects.length} project worlds`, 'ok');
    }
  }, [projects.length]);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const g = group.current;
    if (!g || textures.length === 0) return;

    reveal.current = damp(reveal.current, 1, 0.3, dt);
    const m = useSystemStore.getState().motionMultiplier;
    const time = state.clock.elapsedTime;

    const count = g.children.length;
    const arc = Math.min(1.1, 0.34 * count);

    g.children.forEach((child, i) => {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const angle = (t - 0.5) * arc;
      // Staggered from the centre outward.
      const order = Math.abs(t - 0.5) * 2;
      const local = smoothstep(0, 1, clamp01((reveal.current - order * 0.3) / 0.7));

      const radius = 1.5;
      child.position.set(
        Math.sin(angle) * radius,
        // Only the ambient bob is gated; the arc itself is not motion, it is
        // where the thing is.
        (m === 0 ? 0 : Math.sin(time * 0.5 + i * 2.1) * 0.02 * m) + (1 - local) * -0.4,
        // The arc curves TOWARD the viewer, so the centre world is the nearest
        // one. Curving away put the middle panel behind its own neighbours,
        // which is the one panel you are most likely to be reading.
        Math.cos(angle) * radius * 0.35,
      );
      child.rotation.set(0, angle * 0.8, 0);
      child.scale.setScalar(0.6 + local * 0.4);
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      material.opacity = local * useCarouselStore.getState().focusPresence;
      child.visible = local > 0.01;
    });
  });

  if (textures.length === 0) return null;

  return (
    <group ref={group}>
      {textures.map((texture, i) => (
        <mesh key={i}>
          <planeGeometry args={[W, H]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
