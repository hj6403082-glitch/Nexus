'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { TIER_BUDGET, useSystemStore } from '@/stores/useSystemStore';
import { useModuleData } from '@/stores/useModuleData';
import { makeRandom } from '@/core/math/util';
import { damp } from '@/core/math/spring';
import { PROFILE, readCondition } from './condition';

/**
 * THE WORLD REFLECTS THE WEATHER.
 *
 * Only alive in the weather world, and only as strongly as the live reading
 * says. A grade alone cannot do this: "rain" is a MOTION, not a colour, and a
 * blue-shifted room with nothing falling in it reads as evening, not weather.
 *
 * Every particle is recycled in the shader by wrapping its height, so the
 * count is fixed and the CPU writes four uniforms a frame.
 */
export function Precipitation() {
  const points = useRef<THREE.Points>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const strength = useRef(0);
  const tier = useSystemStore((s) => s.tier);
  const count = Math.round(TIER_BUDGET[tier].dust * 1.1);

  const geometry = useMemo(() => {
    const rand = makeRandom(20260917);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 1.2 + rand() * 11;
      const theta = rand() * Math.PI * 2;
      pos[i * 3] = Math.cos(theta) * r;
      pos[i * 3 + 1] = rand() * 9 - 2.5;
      pos[i * 3 + 2] = Math.sin(theta) * r;
      seed[i] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);
    return g;
  }, [count]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uFall: { value: 0 },
      uDrift: { value: 0 },
      uStreak: { value: 0 },
      uSize: { value: 1 },
      uOpacity: { value: 0 },
      uColour: { value: new THREE.Color('#a8c8ff') },
    }),
    [],
  );

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20);
    const system = useSystemStore.getState();
    const p = points.current;
    const mat = material.current;
    if (!p || !mat) return;

    const active = system.world === 'weather-reactive';
    const record = useModuleData.getState().records.weather;
    const condition = readCondition(
      (record?.detail as { condition?: string } | null)?.condition ?? record?.face.status,
    );
    const profile = PROFILE[condition];

    /**
     * PRESENCE IS NOT MOTION.
     *
     * The motion gate must not decide whether the weather EXISTS — only
     * whether it moves. Multiplying the density by the gate meant that with
     * ambient drift off (which is the default) the weather world reported
     * "fog, settling" on the card and showed a completely empty room.
     *
     * So the particles are always there, and the gate governs `uTime` instead:
     * locked, the precipitation hangs motionless in the air.
     */
    const target = active ? profile.density : 0;
    strength.current = damp(strength.current, target, 0.4, dt);

    if (strength.current < 0.004) {
      p.visible = false;
      return;
    }
    p.visible = true;

    const u = mat.uniforms;
    u.uTime.value += dt * system.motionMultiplier;
    u.uFall.value = profile.fall;
    u.uDrift.value = profile.drift;
    u.uStreak.value = profile.streak;
    u.uSize.value = profile.size;
    u.uOpacity.value = strength.current * 0.5;
    u.uColour.value.set(profile.colour);
  });

  return (
    <points ref={points} geometry={geometry} visible={false} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={/* glsl */ `
          attribute float aSeed;
          uniform float uTime;
          uniform float uFall;
          uniform float uDrift;
          uniform float uSize;
          varying float vFade;
          varying float vSeed;
          void main() {
            vec3 p = position;
            // Wrap the fall height instead of respawning on the CPU: the
            // buffer is written once and never touched again.
            float span = 11.0;
            p.y = mod(p.y - uTime * uFall * (0.7 + aSeed * 0.6) + 2.5, span) - 2.5;
            p.x += sin(uTime * 0.5 + aSeed * 40.0) * uDrift;
            p.z += cos(uTime * 0.42 + aSeed * 27.0) * uDrift;

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float dist = -mv.z;
            vFade = smoothstep(18.0, 1.2, dist) * (0.35 + aSeed * 0.65);
            vSeed = aSeed;
            gl_PointSize = clamp(uSize * (0.6 + aSeed) * (7.0 / max(dist, 0.6)), 1.0, 9.0);
            gl_Position = projectionMatrix * mv;
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 uColour;
          uniform float uOpacity;
          uniform float uStreak;
          varying float vFade;
          varying float vSeed;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            // Streaking squashes the sprite horizontally, so a fast drop is a
            // short line rather than a round dot travelling fast.
            c.x /= max(1.0 - uStreak * 2.4, 0.08);
            float d = dot(c, c);
            if (d > 0.25) discard;
            float a = smoothstep(0.25, 0.0, d) * vFade * uOpacity;
            gl_FragColor = vec4(uColour * a, a);
          }
        `}
      />
    </points>
  );
}
