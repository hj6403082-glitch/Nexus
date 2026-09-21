'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { useGestureStore } from '@/stores/useGestureStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { cardRegistry } from './cardRegistry';
import { audio } from '@/audio/AudioEngine';
import type { ModuleId } from '@/core/constants/modules';

/**
 * ONE PICKER FOR BOTH INPUTS.
 *
 * Hand tracking and the pointer resolve to the same thing — a direction from
 * the eye — so they go down ONE code path that raycasts the ring and publishes
 * a single world-space cursor. Using React Three Fiber's pointer events for the
 * mouse and a manual raycast for the hand would have meant two pickers with
 * two notions of what is hovered, and they would disagree the first time a
 * hand appeared while the mouse was still over a card.
 *
 * The hand wins whenever one is being tracked. The mouse exists only as a
 * fallback, exactly as the brief requires, but a fallback that does not work is
 * not one — so it hovers, selects and drags identically.
 */
/** How far the cursor may travel during a press and still count as a click. */
const CLICK_SLOP = 0.28;

export function Picker() {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);

  /**
   * A press on the canvas picks up whatever is hovered; the release either
   * opens it (a click) or lets it spring home (a drag).
   *
   * The press position is captured HERE, in the same handler that starts the
   * drag, rather than by a separate listener. It used to be tracked by a
   * module-scope listener registered at import time — which was never removed,
   * and which fired on every pointerdown anywhere on the page, so clicking the
   * HUD or the palette silently overwrote the reference point that decides
   * whether the next release counts as a click or a drag.
   */
  const pressCursor = useRef<{ x: number; y: number; z: number } | null>(null);

  useEffect(() => {
    const canvas = gl.domElement;

    const onDown = (e: PointerEvent) => {
      if (e.target !== canvas) return;
      if (useTransformStore.getState().phase !== 'NORMAL') return;
      const { hovered } = useCarouselStore.getState();
      if (!hovered) return;
      const c = useGestureStore.getState().cursor;
      pressCursor.current = { x: c.x, y: c.y, z: c.z };
      useCarouselStore.getState().setDragging(hovered);
    };

    const onUp = () => {
      const carousel = useCarouselStore.getState();
      const dragged = carousel.dragging;
      if (!dragged) return;
      carousel.setDragging(null);

      // A press that barely travelled is a click, and a click opens the module.
      const start = pressCursor.current;
      const c = useGestureStore.getState().cursor;
      const travelled = start
        ? Math.hypot(c.x - start.x, c.y - start.y, c.z - start.z)
        : 0;
      pressCursor.current = null;

      if (travelled <= CLICK_SLOP) {
        carousel.present(dragged);
        audio.play('open', 0.6);
      } else {
        audio.play('confirm', 0.4);
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    // A pointer that leaves the window never fires pointerup, and a card left
    // in the dragging state would follow the cursor forever.
    window.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [gl]);

  useFrame(() => {
    const carousel = useCarouselStore.getState();
    const gesture = useGestureStore.getState();

    // While embodied there is no ring, so there is nothing to pick.
    if (useTransformStore.getState().phase !== 'NORMAL') {
      if (carousel.hovered) carousel.setHovered(null);
      if (gesture.cursor.live) gesture.setCursor(0, 0, 0, false);
      return;
    }

    const hand = gesture.hands[0];
    const source = hand.present
      ? { x: hand.x, y: hand.y }
      : gesture.pointer.active
        ? gesture.pointer
        : null;

    if (!source) {
      if (carousel.hovered) carousel.setHovered(null);
      if (gesture.cursor.live) gesture.setCursor(0, 0, 0, false);
      return;
    }

    ndc.set(source.x, source.y);
    raycaster.setFromCamera(ndc, camera);

    // A world point on the ray at ring distance. This is what a dragged card
    // chases, so it has to be in the plane the ring lives in — otherwise the
    // card dives toward the camera as you move sideways.
    const along = raycaster.ray.origin
      .clone()
      .addScaledVector(raycaster.ray.direction, carousel.radius);
    gesture.setCursor(along.x, along.y, along.z, true);

    const meshes = cardRegistry.pickTargets();
    if (meshes.length === 0) return;

    const hits = raycaster.intersectObjects(meshes, false);
    const id = (hits[0]?.object.userData.moduleId as ModuleId | undefined) ?? null;

    if (id !== carousel.hovered) {
      carousel.setHovered(id);
      if (id) audio.play('tick', 0.35);
    }
  });

  return null;
}
