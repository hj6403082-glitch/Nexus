'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ACCENTS, goldTerm } from '@/core/constants/palette';
import { MOTION } from '@/core/constants/motion';
import type { ModuleDef } from '@/core/constants/modules';
import { advanceSpring, damp, makeSpring } from '@/core/math/spring';
import { clamp01, hash11, smoothstep } from '@/core/math/util';
import { useCarouselStore, type CardState } from '@/stores/useCarouselStore';
import { useSystemStore } from '@/stores/useSystemStore';
import { useModuleData } from '@/stores/useModuleData';
import { useTransformStore } from '@/stores/useTransformStore';
import { CardFacePainter, FACE_H, FACE_W } from './CardFacePainter';
import { cardFrameShader } from './materials/cardFrame';
import { cardRegistry } from './cardRegistry';

const CARD_W = 1.06;
const CARD_H = CARD_W / (FACE_W / FACE_H);

/**
 * Per-state targets. Each of the six card states has its own pose, not just a
 * different opacity — "hovered" that only brightens is a website, not a room.
 */
const STATE_POSE: Record<
  CardState,
  { scale: number; push: number; tilt: number; glow: number }
> = {
  idle: { scale: 1.0, push: 0, tilt: 0, glow: 0.0 },
  hovered: { scale: 1.045, push: 0.10, tilt: 0.06, glow: 0.35 },
  selected: { scale: 1.09, push: 0.22, tilt: 0.0, glow: 0.8 },
  expanded: { scale: 1.32, push: 0.55, tilt: 0.0, glow: 0.6 },
  focused: { scale: 1.5, push: 0.95, tilt: 0.0, glow: 1.0 },
  dragging: { scale: 1.12, push: 0.34, tilt: 0.14, glow: 0.7 },
};

interface CardProps {
  module: ModuleDef;
  index: number;
  count: number;
  radius: number;
}

export function Card({ module, index, count, radius }: CardProps) {
  const group = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const frameMat = useRef<THREE.ShaderMaterial>(null);
  const faceMat = useRef<THREE.MeshBasicMaterial>(null);

  const seed = useMemo(() => hash11(index * 17.3 + 4.1), [index]);
  const slotAngle = (index / count) * Math.PI * 2;

  // Springs. One per animated channel; every one of them is a named intent.
  const springs = useMemo(
    () => ({
      scale: makeSpring(0.001),
      push: makeSpring(0),
      tilt: makeSpring(0),
      glow: makeSpring(0),
      opacity: makeSpring(0),
      pulse: makeSpring(1),
    }),
    [],
  );

  // --- face texture --------------------------------------------------------
  const painter = useMemo(() => {
    if (typeof document === 'undefined') return null;
    return new CardFacePainter(module);
  }, [module]);

  const texture = useMemo(() => {
    if (!painter) return null;
    const t = new THREE.CanvasTexture(painter.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [painter]);

  const record = useModuleData((s) => s.records[module.id]);

  useEffect(() => {
    if (!painter || !texture) return;
    const face =
      record?.face ?? { title: module.label, caption: module.caption, status: 'loading…' };
    if (painter.paint(face)) texture.needsUpdate = true;
  }, [painter, texture, record, module]);

  // Publish this card to the registry so the Phase 7 dissolve can find its
  // pixels and its world matrix. The registry is READ-ONLY to the scene: cards
  // write, the particle system reads, nothing flows back.
  useEffect(() => {
    if (!painter) return;
    cardRegistry.register(module.id, { painter, index });
    return () => cardRegistry.unregister(module.id);
  }, [painter, module.id, index]);

  const accent = ACCENTS[module.accent];

  const frameUniforms = useMemo(() => {
    const u = THREE.UniformsUtils.clone(cardFrameShader.uniforms);
    u.uAccent.value = new THREE.Color(accent.rgb[0], accent.rgb[1], accent.rgb[2]);
    u.uAspect.value = CARD_W / CARD_H;
    return u;
  }, [accent]);

  const lastState = useRef<CardState>('idle');

  useFrame((state, rawDelta) => {
    const g = group.current;
    const innerGroup = inner.current;
    if (!g || !innerGroup) return;

    const dt = Math.min(rawDelta, 1 / 20);
    const time = state.clock.elapsedTime;

    const carousel = useCarouselStore.getState();
    const system = useSystemStore.getState();
    const transform = useTransformStore.getState();
    const m = system.motionMultiplier;

    const cardState = carousel.stateOf(module.id);
    if (cardState !== lastState.current) {
      if (cardState === 'selected' || cardState === 'focused') {
        springs.pulse.value = 0;
        springs.pulse.velocity = 0;
      }
      lastState.current = cardState;
    }

    const pose = STATE_POSE[cardState];

    // --- slot on the ring --------------------------------------------------
    const worldAngle = slotAngle + carousel.angle;

    /**
     * Centredness: 1 when this card faces the user, 0 for everything else.
     *
     * The obvious measure — `(cos + 1) / 2` — is wrong for this, and wrong in
     * a way that only shows once gold is wired up: it returns 0.5 for a card
     * at ninety degrees and over 0.9 for a card two slots away, so even a
     * steep power curve leaves half the ring glowing gold. Centredness has to
     * be measured over the last few degrees, not over the whole half-turn.
     */
    const facing = Math.cos(worldAngle);
    const centred = smoothstep(0.93, 1.0, facing);

    // --- ambient idle float ------------------------------------------------
    // Every term is multiplied by `m`. When drift is off, m is exactly 0 and
    // these contribute exactly 0 — not 1e-9. The card's transform is then
    // bit-identical frame over frame, which is what "LOCKED" has to mean.
    const bob = m === 0 ? 0 : Math.sin(time * 0.42 + seed * 9.1) * 0.035 * m;
    const swayX = m === 0 ? 0 : Math.sin(time * 0.31 + seed * 4.7) * 0.02 * m;
    const rollZ = m === 0 ? 0 : Math.sin(time * 0.27 + seed * 2.3) * 0.022 * m;

    // --- presentation: unrelated cards step back (Phase 6) -----------------
    let stepBack = 0;
    if (carousel.presentPhase !== 'none' && carousel.pending !== module.id) {
      const k = carousel.presentPhase === 'targeting' ? carousel.presentT : 1;
      stepBack = k * 0.55;
    }

    advanceSpring(springs.scale, pose.scale, MOTION.ARRIVING, dt);
    advanceSpring(springs.push, pose.push, MOTION.ARRIVING, dt);
    advanceSpring(springs.tilt, pose.tilt, MOTION.ACKNOWLEDGING, dt);
    advanceSpring(springs.glow, pose.glow, MOTION.ACKNOWLEDGING, dt);
    advanceSpring(springs.pulse, 1, MOTION.LEAVING, dt);

    // Cards fade out behind the dissolve envelope during the transformation.
    // Cards BEHIND the user go first — they have the furthest to travel and
    // leaving early is how they arrive with everyone else.
    const behindness = clamp01((1 - facing) * 0.5);
    const stagger = behindness * 0.35;
    const dissolve = clamp01((transform.env.dissolve - stagger * 0.5) / (1 - stagger * 0.5));
    const targetOpacity = transform.phase === 'NORMAL' ? 1 : 1 - clamp01(transform.env.dissolve * 1.2);
    springs.opacity.value = damp(springs.opacity.value, targetOpacity, 0.12, dt);

    // --- place -------------------------------------------------------------
    const effectiveRadius = radius + stepBack - springs.push.value + (m === 0 ? 0 : swayX);
    g.position.set(
      Math.sin(worldAngle) * effectiveRadius,
      bob,
      Math.cos(worldAngle) * effectiveRadius,
    );
    // + PI so the face turns INWARD, toward the user at the centre of the ring.
    // Without it the planes face outward and, being double-sided, render their
    // own backs — every glyph mirrored, which is subtle enough at a glance and
    // unmissable once read.
    g.rotation.set(0, worldAngle + Math.PI, 0);

    innerGroup.rotation.set(springs.tilt.value, 0, rollZ + springs.tilt.value * 0.4);
    const s = springs.scale.value;
    innerGroup.scale.set(s, s, s);

    // During the transformation the card turns to face the core at the centre.
    if (transform.phase !== 'NORMAL') {
      const turn = clamp01(transform.env.collapse) * Math.PI * 0.45;
      innerGroup.rotation.y = turn * Math.sign(Math.sin(worldAngle) || 1);
    }

    // --- uniforms ----------------------------------------------------------
    const fm = frameMat.current;
    if (fm) {
      const u = fm.uniforms;
      u.uTime.value = time;
      // RULE 1 lives here: the warning flag gates gold off entirely.
      u.uGold.value = goldTerm(centred, record?.face.warned ?? false);
      u.uPulse.value = springs.pulse.value;
      u.uSelected.value = cardState === 'selected' || cardState === 'focused' ? 1 : 0;
      u.uOpacity.value = springs.opacity.value * (0.55 + springs.glow.value * 0.45);
      u.uDissolve.value = dissolve;

      // Approach scan line: sweeps the face top to bottom during APPROACH only.
      u.uScan.value =
        carousel.pending === module.id && carousel.presentPhase === 'approach'
          ? 1 - carousel.presentT
          : -1;
    }

    // Publish the world matrix of the group the face actually lives in, every
    // frame, so the Phase 7 particles sit on the face pixel-for-pixel while
    // the card is still turning toward the core.
    if (transform.phase !== 'NORMAL') {
      innerGroup.updateWorldMatrix(true, false);
      cardRegistry.publishMatrix(module.id, innerGroup.matrixWorld);
    }

    if (faceMat.current) {
      faceMat.current.opacity = springs.opacity.value * (0.82 + centred * 0.18);
    }
  });

  if (!texture) return null;

  return (
    <group ref={group}>
      <group ref={inner}>
        {/* Glass pane — the body of the card. */}
        <mesh>
          <planeGeometry args={[CARD_W, CARD_H]} />
          <meshBasicMaterial
            ref={faceMat}
            map={texture}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>

        {/* Frame, glow, pulse, scan line. Additive so it reads as emitted light. */}
        <mesh position={[0, 0, 0.002]}>
          <planeGeometry args={[CARD_W * 1.06, CARD_H * 1.045]} />
          <shaderMaterial
            ref={frameMat}
            args={[
              {
                uniforms: frameUniforms,
                vertexShader: cardFrameShader.vertexShader,
                fragmentShader: cardFrameShader.fragmentShader,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
              },
            ]}
          />
        </mesh>
      </group>
    </group>
  );
}

export const CARD_SIZE = { w: CARD_W, h: CARD_H };
