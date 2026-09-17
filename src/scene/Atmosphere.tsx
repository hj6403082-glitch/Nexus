'use client';

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { TIER_BUDGET, useSystemStore } from '@/stores/useSystemStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { WORLDS } from '@/core/constants/worlds';
import { makeRandom } from '@/core/math/util';

/**
 * The room: volumetric dust, moving light shafts and a floor lattice.
 *
 * No stars, no galaxy, no skybox. The sense of a place comes entirely from
 * suspended particulate catching light — which is what actually makes real
 * rooms legible, and is why a "space" background always reads as a wallpaper.
 */
export function Atmosphere() {
  return (
    <group>
      <Dust />
      <LightShafts />
      <FloorLattice />
    </group>
  );
}

function Dust() {
  const points = useRef<THREE.Points>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const tier = useSystemStore((s) => s.tier);
  const count = TIER_BUDGET[tier].dust;

  const geometry = useMemo(() => {
    const rand = makeRandom(1337);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Distributed in a shell around the user: dense enough near the ring to
      // read, sparse far out so the fog does the work at distance.
      const r = 1.5 + rand() * 9;
      const theta = rand() * Math.PI * 2;
      const y = (rand() - 0.5) * 7;
      pos[i * 3] = Math.cos(theta) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(theta) * r;
      seed[i] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, [count]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMotion: { value: 0 },
      uOpacity: { value: 0 },
      uSize: { value: 0.85 },
      uColor: { value: new THREE.Color('#bcd6ff') },
    }),
    [],
  );

  useFrame((state, dt) => {
    const system = useSystemStore.getState();
    const transform = useTransformStore.getState();
    const m = system.motionMultiplier;
    if (!material.current) return;
    const u = material.current.uniforms;
    // Time only advances for the dust when motion is enabled. With m at 0 the
    // dust is frozen in place — visible, but perfectly still.
    if (m !== 0) u.uTime.value += dt * m;
    u.uMotion.value = m;
    // The dust is drawn in AFTER the cards during the dissolve: the room's own
    // particulate is the last thing to leave.
    u.uOpacity.value = (1 - transform.env.dissolve * 0.85) * (1 - transform.env.dim * 0.4);
    u.uColor.value.set(WORLDS[system.world].keyLight);
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={/* glsl */ `
          attribute float aSeed;
          uniform float uTime;
          uniform float uMotion;
          uniform float uSize;
          varying float vFade;
          void main() {
            vec3 p = position;
            // Convection, not orbit. Dust in a room rises and wanders.
            p.y += sin(uTime * 0.21 + aSeed * 31.4) * 0.35 * uMotion;
            p.x += sin(uTime * 0.13 + aSeed * 17.7) * 0.22 * uMotion;
            p.z += cos(uTime * 0.11 + aSeed * 23.1) * 0.22 * uMotion;

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float dist = -mv.z;
            // Particulate, not stars. The brief rules out a starfield, and a
            // starfield is exactly what large bright points at constant size
            // produce. Dust has to be small, dim, and fade with distance so it
            // reads as something suspended in air between you and the room.
            vFade = smoothstep(16.0, 1.5, dist) * (0.10 + aSeed * 0.30);
            gl_PointSize = clamp(uSize * (0.6 + aSeed * 0.8) * (5.0 / max(dist, 0.6)), 1.0, 3.2);
            gl_Position = projectionMatrix * mv;
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vFade;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = dot(c, c);
            if (d > 0.25) discard;
            float a = smoothstep(0.25, 0.0, d) * vFade * uOpacity;
            gl_FragColor = vec4(uColor * a, a);
          }
        `}
      />
    </points>
  );
}

/** Slow light shafts. Cones of additive haze that sweep the room. */
function LightShafts() {
  const group = useRef<THREE.Group>(null);
  const mats = useRef<THREE.Material[]>([]);

  const shafts = useMemo(() => {
    const rand = makeRandom(88);
    return Array.from({ length: 4 }, (_, i) => ({
      angle: (i / 4) * Math.PI * 2 + rand() * 0.6,
      speed: 0.018 + rand() * 0.02,
      tilt: 0.24 + rand() * 0.3,
    }));
  }, []);

  useFrame((state, dt) => {
    const system = useSystemStore.getState();
    const transform = useTransformStore.getState();
    const m = system.motionMultiplier;
    const g = group.current;
    if (!g) return;

    const opacity = 0.055 * (1 - transform.env.dissolve * 0.9) * (1 - transform.env.dim * 0.5);
    g.children.forEach((child, i) => {
      if (m !== 0) child.rotation.y += shafts[i].speed * dt * m;
      const mesh = child.children[0] as THREE.Mesh | undefined;
      const mat = mesh?.material as THREE.ShaderMaterial | undefined;
      if (mat?.uniforms?.uOpacity) mat.uniforms.uOpacity.value = opacity;
    });
  });

  return (
    <group ref={group}>
      {shafts.map((s, i) => (
        <group key={i} rotation={[0, s.angle, 0]}>
          <mesh position={[0, 3.2, 6]} rotation={[s.tilt, 0, 0]}>
            <coneGeometry args={[2.6, 13, 28, 1, true]} />
            {/*
              A cone drawn with a flat material has a HARD SILHOUETTE, and a
              hard-edged wedge of light across a dark room reads as a polygon,
              not as a beam. The shaft has to fade at its rim and at its far
              end, which needs a shader — there is no flat material that can
              do it.
            */}
            <shaderMaterial
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              side={THREE.BackSide}
              uniforms={{
                uColor: { value: new THREE.Color('#8fb6ff') },
                uOpacity: { value: 0.05 },
              }}
              vertexShader={/* glsl */ `
                varying vec2 vUv;
                varying vec3 vNormalView;
                void main() {
                  vUv = uv;
                  vNormalView = normalize(normalMatrix * normal);
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
              `}
              fragmentShader={/* glsl */ `
                uniform vec3 uColor;
                uniform float uOpacity;
                varying vec2 vUv;
                varying vec3 vNormalView;
                void main() {
                  // Brightest where the cone wall is edge-on to the camera —
                  // that is where the most volume is behind the pixel, which
                  // is what makes it read as a volume rather than a surface.
                  float edgeOn = 1.0 - abs(vNormalView.z);
                  // Fade along the length, and fade toward the open mouth.
                  float along = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
                  float a = uOpacity * edgeOn * along;
                  if (a < 0.0015) discard;
                  gl_FragColor = vec4(uColor * a, a);
                }
              `}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** A faint ground plane so the room has a floor without having a floor. */
function FloorLattice() {
  const material = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uMotion: { value: 0 },
      uColor: { value: new THREE.Color('#5f8fd8') },
    }),
    [],
  );

  useFrame((state, dt) => {
    if (!material.current) return;
    const system = useSystemStore.getState();
    const transform = useTransformStore.getState();
    const m = system.motionMultiplier;
    const u = material.current.uniforms;
    if (m !== 0) u.uTime.value += dt * m;
    u.uMotion.value = m;
    u.uOpacity.value =
      (1 - transform.env.dissolve * 0.9) * (1 - transform.env.dim * 0.55) *
      Math.min(1, system.bootProgress * 1.4);
    u.uColor.value.set(WORLDS[system.world].keyLight);
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.9, 0]}>
      <planeGeometry args={[46, 46]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          varying vec3 vWorld;
          void main() {
            vUv = uv;
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `}
        fragmentShader={/* glsl */ `
          precision highp float;
          uniform float uTime;
          uniform float uOpacity;
          uniform float uMotion;
          uniform vec3 uColor;
          varying vec2 vUv;
          varying vec3 vWorld;

          float grid(vec2 p, float scale, float width) {
            vec2 g = abs(fract(p * scale - 0.5) - 0.5) / fwidth(p * scale);
            float line = min(g.x, g.y);
            return 1.0 - smoothstep(0.0, width, line);
          }

          void main() {
            vec2 p = vWorld.xz;
            float fine = grid(p, 1.0, 1.4) * 0.16;
            float coarse = grid(p, 0.2, 1.1) * 0.34;

            // A slow pulse travelling outward from the centre.
            float r = length(p);
            float ripple = sin(r * 0.55 - uTime * 0.6) * 0.5 + 0.5;
            float pulse = smoothstep(0.75, 1.0, ripple) * 0.25 * uMotion;

            float falloff = smoothstep(22.0, 2.0, r);
            float a = (fine + coarse + pulse) * falloff * uOpacity;
            if (a < 0.002) discard;
            gl_FragColor = vec4(uColor * a, a);
          }
        `}
      />
    </mesh>
  );
}
