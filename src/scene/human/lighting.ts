import { sdBustCPU } from './sdf';

/**
 * BAKED LIGHT.
 *
 * A Lambert term alone cannot describe a face. It tells you which way a patch
 * of surface points and nothing about what is in front of it, so a nose and a
 * painted-on nose shade identically — which is precisely why the first figure
 * read as an egg no matter how the key was aimed. What makes a face look like
 * a face is the dark: the well under the brow, the crease beside the nose, the
 * shadow the nose throws across the cheek.
 *
 * Both are cheap to have, ONCE, because the figure does not deform. The field
 * that produced the surface is still here, so each point can ask it two
 * questions at bake time:
 *
 *   occlusion — how much of the sky can this point see?
 *   shadow    — is there anything between this point and the key?
 *
 * The answers are two floats per point held for the lifetime of the figure. Per
 * frame they cost nothing, and they are stable, so nothing shimmers.
 *
 * Both run against `sdBustCPU`, which is generated from the same part table as
 * the GPU field. There is no second description of the body to drift.
 */

export interface BakedLight {
  /** 1 = fully open to the sky, 0 = deep in a crevice. */
  occlusion: Float32Array;
  /** 1 = fully lit by the key, 0 = fully shadowed. Soft at the edges. */
  shadow: Float32Array;
}

/** Points processed per chunk. Tuned to stay under a frame on a weak machine. */
const CHUNK = 2048;

/**
 * Five taps along the normal, each weighted less than the last. Where the
 * surface is open the field grows as fast as the step, so `h - d` is zero and
 * nothing accumulates. Where a wall is nearby the field lags the step and the
 * difference is the occlusion.
 */
function occlusionAt(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  let sum = 0;
  let weight = 1;
  for (let i = 1; i <= 5; i++) {
    const h = i * 0.011;
    const d = sdBustCPU(x + nx * h, y + ny * h, z + nz * h);
    sum += (h - d) * weight;
    weight *= 0.68;
  }
  return Math.max(0, Math.min(1, 1 - 2.6 * sum));
}

/**
 * March toward the key. `d / t` is the angle the nearest blocker subtends from
 * the ray, so tracking its minimum gives a penumbra that widens with distance
 * — a hard edge under the nose and a soft one across the chest, from one loop.
 *
 * The march starts slightly off the surface. Starting ON it means the first
 * sample reads ~0 and every point shadows itself.
 */
function shadowAt(
  x: number, y: number, z: number,
  nx: number, ny: number, nz: number,
  lx: number, ly: number, lz: number,
): number {
  // Facing away from the key is not a shadow test, it is already dark. Skipping
  // it here is most of the saving: roughly half the points never march.
  if (nx * lx + ny * ly + nz * lz <= 0) return 0;

  let t = 0.012;
  let result = 1;
  for (let i = 0; i < 16 && t < 0.34; i++) {
    const d = sdBustCPU(x + lx * t, y + ly * t, z + lz * t);
    if (d < 0.0006) return 0;
    result = Math.min(result, (9 * d) / t);
    t += Math.max(d, 0.006);
  }
  return Math.max(0, Math.min(1, result));
}

/**
 * Chunked so the caller can spend one slice per frame, exactly like the
 * surface bake it follows. Yields the fraction complete.
 */
export function* bakeLighting(
  positions: Float32Array,
  normals: Float32Array,
  count: number,
  key: [number, number, number],
): Generator<number, BakedLight, void> {
  const occlusion = new Float32Array(count);
  const shadow = new Float32Array(count);

  const len = Math.hypot(key[0], key[1], key[2]) || 1;
  const lx = key[0] / len;
  const ly = key[1] / len;
  const lz = key[2] / len;

  for (let start = 0; start < count; start += CHUNK) {
    const end = Math.min(start + CHUNK, count);
    for (let i = start; i < end; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const nx = normals[i * 3];
      const ny = normals[i * 3 + 1];
      const nz = normals[i * 3 + 2];
      occlusion[i] = occlusionAt(x, y, z, nx, ny, nz);
      // Offset along the normal before marching, for the same reason the march
      // does not start at zero.
      shadow[i] = shadowAt(
        x + nx * 0.003, y + ny * 0.003, z + nz * 0.003,
        nx, ny, nz,
        lx, ly, lz,
      );
    }
    yield end / count;
  }

  return { occlusion, shadow };
}
