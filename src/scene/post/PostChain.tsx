'use client';

import { useEffect, useMemo, useRef } from 'react';
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
  const dofRef = useRef<{ target?: unknown; circleOfConfusionMaterial?: { uniforms: Record<string, { value: number }> } } | null>(null);
  const focus = useRef(CAROUSEL_RADIUS);
  const vignette = useRef(0.55);

  useEffect(() => () => grade.dispose(), [grade]);

  useFrame((_, rawDelta) => {
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
  });

  return (
    <EffectComposer enableNormalPass={false} multisampling={tier >= 2 ? 2 : 0}>
      {budget.dof && !embodied ? (
        <DepthOfField
          ref={dofRef as never}
          // Normalised against the camera's far plane (80), so this is the
          // ring at ~4.4 units. Focusing anywhere else puts the one card the
          // user is reading behind the blur.
          focusDistance={4.4 / 80}
          focalLength={0.08}
          bokehScale={0.9}
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
      <primitive object={grade} />
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.055} />
    </EffectComposer>
  );
}
