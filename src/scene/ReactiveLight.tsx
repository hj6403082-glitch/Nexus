'use client';

import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useAIStore } from '@/stores/useAIStore';
import { useGestureStore } from '@/stores/useGestureStore';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { useSystemStore } from '@/stores/useSystemStore';
import { WORLDS } from '@/core/constants/worlds';
import { MODULE_BY_ID } from '@/core/constants/modules';
import { ACCENTS } from '@/core/constants/palette';
import { damp } from '@/core/math/spring';
import { clamp01 } from '@/core/math/util';

/**
 * THE AMBIENT LIGHT RESPONDS.
 *
 * The room's fill light is not a constant. It brightens when NEXUS speaks, it
 * flares on a recognised gesture, and it takes the accent colour of whatever
 * module is in focus — so the light in the room tells you what the room is
 * doing even when you are not looking at the HUD.
 *
 * Deliberately a POINT LIGHT near the user rather than a change to the key:
 * moving the key would re-light the whole scene and undo the world's grade.
 * This is fill, and fill is what a room's mood is made of.
 */
export function ReactiveLight() {
  const light = useRef<THREE.PointLight>(null);
  const level = useRef(0);
  const flare = useRef(0);
  const lastGesture = useRef(0);
  const colour = useRef(new THREE.Color('#6ea8ff'));

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const l = light.current;
    if (!l) return;

    const ai = useAIStore.getState();
    const gesture = useGestureStore.getState();
    const carousel = useCarouselStore.getState();
    const system = useSystemStore.getState();

    // Speech drives it continuously; a gesture strikes it once.
    if (gesture.gestureAt !== lastGesture.current) {
      lastGesture.current = gesture.gestureAt;
      flare.current = 1;
    }
    flare.current = damp(flare.current, 0, 0.14, dt);
    level.current = damp(level.current, ai.speechLevel, 0.09, dt);

    const focus = carousel.open ?? carousel.pending ?? carousel.hovered;
    const target = focus
      ? ACCENTS[MODULE_BY_ID[focus].accent]
      : null;

    // The world's key colour is the resting state; a focused module tints the
    // fill toward its own accent.
    const restRgb = new THREE.Color(WORLDS[system.world].keyLight);
    const wantRgb = target
      ? new THREE.Color(target.rgb[0], target.rgb[1], target.rgb[2])
      : restRgb;
    colour.current.lerp(wantRgb, 1 - Math.pow(0.5, dt / 0.35));
    l.color.copy(colour.current);

    l.intensity = clamp01(0.32 + level.current * 0.9 + flare.current * 0.5) * 1.4;
    l.distance = 9 + flare.current * 3;
  });

  return <pointLight ref={light} position={[0, 1.4, 0.5]} intensity={0.5} distance={9} />;
}
