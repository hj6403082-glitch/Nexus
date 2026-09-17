'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  Bloom,
  DepthOfField,
  EffectComposer,
  Noise,
} from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { blendGrade, WORLDS } from '@/core/constants/worlds';
import { damp } from '@/core/math/spring';
import { clamp01 } from '@/core/math/util';
import { TIER_BUDGET, useSystemStore } from '@/stores/useSystemStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { useCarouselStore } from '@/stores/useCarouselStore';
import { CAROUSEL_RADIUS } from '../Carousel';
import { ColorGradeEffect } from './ColorGradeEffect';
import { HalationEffect } from './HalationEffect';

export function PostChain() {
  const tier = useSystemStore((s) => s.tier);
  const budget = TIER_BUDGET[tier];

  /**
   * Phase 7 protection: the depth of field is RELEASED while embodied.
   * The ring's focus distance is tuned for cards at CAROUSEL_RADIUS; the bust
   * sits nearer than the ring, so that same focus distance smears the face —
   * the one thing in the frame that has to be sharp. Selecting a boolean here
   * means this re-renders once, on the crossing, not every frame.
   */
  const embodied = useTransformStore((s) => s.env.presence > 0.5);

  const grade = useMemo(() => new ColorGradeEffect(WORLDS['minimal-studio']), []);
  const halation = useMemo(() => new HalationEffect(WORLDS['minimal-studio'].halation), []);
  /**
   * The depth-of-field effect, so its focus distance can be written directly.
   * `postprocessing` has renamed this material across versions, so both names
   * are accepted rather than pinning the app to one of them.
   */
  const dofRef = useRef<{
    circleOfConfusionMaterial?: { uniforms: Record<string, { value: number }> };
    cocMaterial?: { uniforms: Record<string, { value: number }> };
  } | null>(null);
  const focus = useRef(CAROUSEL_RADIUS);
  const vignette = useRef(0.55);

  useEffect(
    () => () => {
      grade.dispose();
      halation.dispose();
    },
    [grade, halation],
  );

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const system = useSystemStore.getState();
    const transform = useTransformStore.getState();

    // World crossover. The spike inside blendGrade peaks at t = 0.5, which is
    // what makes a world change read as a cut rather than a dissolve.
    if (system.worldBlend < 1) {
      system.setWorldBlend(clamp01(system.worldBlend + dt / 1.1));
    }
    const blended = blendGrade(
      WORLDS[system.previousWorld],
      WORLDS[system.world],
      system.worldBlend,
    );

    /**
     * Phase 7 protection: release most of the vignette while embodied. At the
     * spatial-mode strength it crops a bust that fills the frame into a black
     * oval — the face literally disappears into the corners' falloff.
     */
    const targetVignette = 0.55 - transform.env.presence * 0.42;
    vignette.current = damp(vignette.current, targetVignette, 0.25, dt);

    grade.apply(blended, vignette.current);
    halation.amount = blended.halation;

    /**
     * THE FOCUS DISTANCE FOLLOWS THE SUBJECT.
     *
     * A fixed focus distance is only correct while nothing moves. The moment a
     * module is opened the card flies toward the camera AND the camera pushes
     * to meet it, so the card ends up well inside the focal plane — in the
     * NEAR field, which is the worst place to be: the near-field pass smears
     * high-contrast pixels outward, and on a dark card face that reads as the
     * bright type being erased rather than blurred. The headline figure and
     * the sparkline simply vanished, while the dimmer body text survived.
     *
     * So the focus distance is recomputed each frame from where the subject
     * actually is, and damped so a rack focus is a rack focus rather than a
     * jump.
     */
    const camera = state.camera;
    const carousel = useCarouselStore.getState();
    const subjectZ = carousel.open
      ? carousel.radius - 0.5 // the focused card's own push toward the camera
      : carousel.radius;
    const subject = Math.abs(subjectZ - camera.position.z);
    focus.current = damp(focus.current, subject, 0.22, dt);

    const coc = dofRef.current?.circleOfConfusionMaterial ?? dofRef.current?.cocMaterial;
    if (coc?.uniforms.focusDistance) {
      // The uniform is normalised against the camera's far plane.
      const far = (camera as THREE.PerspectiveCamera).far || 80;
      coc.uniforms.focusDistance.value = focus.current / far;
    }
  });

  return (
    <EffectComposer enableNormalPass={false} multisampling={tier >= 2 ? 2 : 0}>
      {budget.dof && !embodied ? (
        <DepthOfField
          ref={dofRef as never}
          // Initial value only — the focus distance TRACKS THE SUBJECT every
          // frame. See the frame loop below for why a fixed one is not an
          // option.
          focusDistance={4.4 / 80}
          focalLength={0.14}
          bokehScale={0.8}
        />
      ) : (
        <></>
      )}
      {budget.bloom ? (
        <Bloom
          // The threshold has to sit ABOVE the card's body text, or every
          // glyph blooms and the type stops being readable — which defeats
          // the point of putting live figures on the cards at all.
          intensity={0.85}
          luminanceThreshold={0.52}
          luminanceSmoothing={0.3}
          mipmapBlur
          radius={0.66}
        />
      ) : (
        <></>
      )}
      {/*
        Halation goes FIRST and alone in its own pass: it is a convolution, so
        the buffer it samples must not be the buffer it writes.
      */}
      <primitive object={halation} />
      <primitive object={grade} />
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.055} />
    </EffectComposer>
  );
}
