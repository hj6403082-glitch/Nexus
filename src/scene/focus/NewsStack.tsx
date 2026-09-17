'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ACCENTS } from '@/core/constants/palette';
import { MOTION } from '@/core/constants/motion';
import { advanceSpring, makeSpring } from '@/core/math/spring';
import { useModuleData } from '@/stores/useModuleData';
import { useSystemStore } from '@/stores/useSystemStore';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { gestureEngine } from '@/gesture/GestureEngine';
import { audio } from '@/audio/AudioEngine';
import { PANEL_ASPECT, paintPanel } from './panelTexture';

interface Article {
  title: string;
  source?: { name?: string };
  publishedAt?: string;
}

const CARD_W = 1.9;
const CARD_H = CARD_W / PANEL_ASPECT;

/**
 * NEWS CARDS STACK, AND YOU SWIPE THROUGH THEM.
 *
 * A deck rather than a list: the front article is readable, the ones behind it
 * are visibly waiting, and the count is legible without a scrollbar — which
 * there is nowhere to put in a room.
 *
 * Swiping advances the deck, and so do the arrow keys, because the deck has to
 * work on the pointer fallback too.
 */
export function NewsStack() {
  const group = useRef<THREE.Group>(null);
  const index = useRef(0);
  const slide = useMemo(() => makeSpring(0), []);
  const record = useModuleData((s) => s.records.news);

  const articles = useMemo(() => {
    const detail = record?.detail as { articles?: Article[] } | null;
    return (detail?.articles ?? []).slice(0, 8);
  }, [record]);

  const textures = useMemo(() => {
    if (typeof document === 'undefined') return [];
    return articles.map((a, i) =>
      paintPanel({
        title: a.title,
        lines: [a.source?.name ?? 'unattributed'],
        accent: ACCENTS.indigo.css,
        footer: `${i + 1} / ${articles.length}`,
      }),
    );
  }, [articles]);

  useEffect(() => () => textures.forEach((t) => t.dispose()), [textures]);

  const advance = (direction: number) => {
    if (articles.length === 0) return;
    index.current = (index.current + direction + articles.length) % articles.length;
    audio.play('tick', 0.6);
    useSystemStore
      .getState()
      .pushLog(`article ${index.current + 1} / ${articles.length}`);
  };

  useEffect(() => {
    const unsubscribe = gestureEngine.subscribe((e) => {
      if (e.name === 'swipe-left') advance(1);
      if (e.name === 'swipe-right') advance(-1);
    });
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement) return;
      if (ev.key === 'ArrowDown') advance(1);
      if (ev.key === 'ArrowUp') advance(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articles.length]);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const g = group.current;
    if (!g) return;
    advanceSpring(slide, index.current, MOTION.ARRIVING, dt);

    g.children.forEach((child, i) => {
      // Depth in the deck, relative to the (fractional) front card.
      const depth = i - slide.value;
      const behind = Math.max(0, depth);
      child.position.set(behind * 0.055, -behind * 0.045, -behind * 0.14);
      const scale = 1 - behind * 0.045;
      child.scale.setScalar(Math.max(0.2, scale));
      // Cards already read fall away rather than lingering in front.
      const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      const stageFade = useCarouselStore.getState().focusPresence;
      material.opacity = (depth < -0.5 ? 0 : Math.max(0, 1 - behind * 0.22)) * stageFade;
      child.visible = material.opacity > 0.01;
      child.renderOrder = -Math.round(behind * 10);
    });
  });

  if (textures.length === 0) return null;

  return (
    <group ref={group}>
      {textures.map((texture, i) => (
        <mesh key={i}>
          <planeGeometry args={[CARD_W, CARD_H]} />
          <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
