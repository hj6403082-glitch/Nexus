'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { TIER_BUDGET, useSystemStore } from '@/stores/useSystemStore';
import { useTransformStore } from '@/stores/useTransformStore';
import { WORLDS } from '@/core/constants/worlds';
import { makeRandom } from '@/core/math/util';
import { damp } from '@/core/math/spring';
import { useModuleData } from '@/stores/useModuleData';

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

  /**
   * The adaptive quality monitor changes the tier during normal use, and each
   * change rebuilds this geometry. Without disposing the previous one, a
   * session that shifts tiers a few times leaks a buffer every time — the one
   * leak here that actually fires in ordinary use rather than only on reload.
   */
  useEffect(() => () => geometry.dispose(), [geometry]);

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
      // 0 = the room's lattice, 1 = a live market grid. Blended rather than
      // switched, so opening Stocks converts the floor instead of replacing it.
      uMarket: { value: 0 },
      // Eight normalised series values — the same holdings the card shows.
      uSeries: { value: new Float32Array(8) },
    }),
    [],
  );

  useFrame((state, dt) => {
    if (!material.current) return;
    const system = useSystemStore.getState();
    const transform = useTransformStore.getState();
    const m = system.motionMultiplier;
    const u = material.current.uniforms;
    // The grid's own animation is gated, but its SHAPE is not: a locked scene
    // still shows the market grid, it just is not scrolling.
    if (m !== 0) u.uTime.value += dt * m;
    u.uMotion.value = m;
    u.uOpacity.value =
      (1 - transform.env.dissolve * 0.9) * (1 - transform.env.dim * 0.55) *
      Math.min(1, system.bootProgress * 1.4);
    u.uColor.value.set(WORLDS[system.world].keyLight);

    /**
     * THE FLOOR BECOMES AN ANIMATED MARKET GRID.
     *
     * Not a different floor — the same one, converted. The lattice fades down
     * as the market grid fades up over the same square metres, so opening
     * Stocks reads as the room being repurposed rather than as one object
     * being swapped for another.
     */
    const wantMarket = system.world === 'market-grid' ? 1 : 0;
    u.uMarket.value = damp(u.uMarket.value as number, wantMarket, 0.35, dt);

    if (u.uMarket.value > 0.001) {
      const holdings =
        (useModuleData.getState().records.stocks?.detail as
          | { holdings?: { value: number }[] }
          | undefined)?.holdings ?? [];
      const series = u.uSeries.value as Float32Array;
      if (holdings.length > 0) {
        let max = 0;
        for (const h of holdings) max = Math.max(max, h.value);
        for (let i = 0; i < series.length; i++) {
          series[i] = max > 0 ? (holdings[i % holdings.length].value / max) : 0.5;
        }
      }
    }
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
          uniform float uMarket;
          uniform float uSeries[8];
          uniform vec3 uColor;
          varying vec2 vUv;
          varying vec3 vWorld;

          float grid(vec2 p, float scale, float width) {
            vec2 g = abs(fract(p * scale - 0.5) - 0.5) / fwidth(p * scale);
            float line = min(g.x, g.y);
            return 1.0 - smoothstep(0.0, width, line);
          }

          /**
           * Lines along ONE axis.
           *
           * Not the 2D grid function with the other axis pinned to a constant:
           * fwidth of a constant is zero, the division blows up, min() picks the
           * zero, and it returns 1.0 for every pixel on the plane. That is how
           * a market GRID became a solid teal slab across the whole floor.
           */
          float lines1d(float v, float scale, float width) {
            float d = abs(fract(v * scale - 0.5) - 0.5) / max(fwidth(v * scale), 1e-5);
            return 1.0 - smoothstep(0.0, width, d);
          }

          // Reads the series as a stepped bar height across x, so the grid
          // carries the portfolio's actual shape rather than decorative noise.
          float seriesAt(float x) {
            float t = clamp((x + 12.0) / 24.0, 0.0, 0.999) * 8.0;
            int i = int(t);
            float v = 0.5;
            for (int k = 0; k < 8; k++) { if (k == i) v = uSeries[k]; }
            return v;
          }

          void main() {
            vec2 p = vWorld.xz;
            float r = length(p);
            float falloff = smoothstep(22.0, 2.0, r);

            // ---- the room's lattice --------------------------------------
            float fine = grid(p, 1.0, 1.4) * 0.16;
            float coarse = grid(p, 0.2, 1.1) * 0.34;
            float ripple = sin(r * 0.55 - uTime * 0.6) * 0.5 + 0.5;
            float pulse = smoothstep(0.75, 1.0, ripple) * 0.25 * uMotion;
            float lattice = fine + coarse + pulse;

            // ---- the market grid -----------------------------------------
            // Columns across x, each lit to its holding's value, with lanes
            // scrolling toward the viewer and a tick sweeping along the front.
            //
            // Every term here is a LINE, not a fill. The first version used a
            // step on the distance from the centre for the bars, which is true
            // across almost the whole plane — so the grid was a solid teal slab
            // that flooded the lower half of the frame and blew out everything
            // standing on it.
            float columns = lines1d(p.x, 0.5, 2.2);
            float height = seriesAt(p.x);
            float lane = fract(p.y * 0.25 + uTime * 0.25);
            float lanes = smoothstep(0.93, 1.0, lane) * 0.45;
            float tick = smoothstep(0.994, 1.0, fract(p.x * 0.35 - uTime * 0.3)) * 0.7;
            // Each column is lit to its holding's value, so the floor carries
            // the portfolio's actual shape rather than a decorative pattern.
            float market = clamp(
              columns * (0.42 + height * 0.85) + lanes + tick,
              0.0,
              0.85
            );

            float a = mix(lattice, market, uMarket) * falloff * uOpacity;
            if (a < 0.002) discard;

            // The market grid leans green-cyan; the lattice keeps the world's
            // own key colour.
            vec3 tint = mix(uColor, vec3(0.42, 0.95, 0.82), uMarket * 0.7);
            gl_FragColor = vec4(tint * a, a);
          }
        `}
      />
    </mesh>
  );
}
