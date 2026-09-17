import { makeRandom } from '@/core/math/util';

export interface SelectionResult {
  positions: Float32Array;
  normals: Float32Array;
  count: number;
  /** The spacing the selection actually achieved. Drives the bead radius. */
  spacing: number;
}

/**
 * POISSON-DISK SELECTION TO AN EXACT COUNT.
 *
 * The bake produces a cloud of converged points whose density follows the
 * seeding, not the surface: seeds are uniform in the bounding VOLUME, so the
 * points pile up wherever the surface is folded toward the box and thin out
 * where it is not. Drawing that directly gives clumps and holes, which is
 * instantly legible as "particles on a shape" rather than as a surface.
 *
 * So the candidates are thinned by dart-throwing with a rejection radius:
 * accept a candidate only if no already-accepted point lies within `r`. That
 * yields blue noise — uniform density, no clumps, no holes, and no lattice
 * artefacts either (a grid would read as a mesh).
 *
 * The radius is derived from the surface area the candidates imply, then
 * relaxed until the exact requested count is reached. Exactness matters
 * because the particle buffer is allocated once for the whole transformation
 * and must not be rebuilt.
 *
 * Chunked as a generator: a 40k-point selection is tens of milliseconds and
 * would otherwise be a visible hitch at the worst possible moment.
 */
export function* selectPoisson(
  positions: Float32Array,
  normals: Float32Array,
  candidateCount: number,
  want: number,
  candidatesPerChunk = 4000,
): Generator<number, SelectionResult, void> {
  const outPos = new Float32Array(want * 3);
  const outNrm = new Float32Array(want * 3);

  // Bounding box → an area estimate → a starting radius.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < candidateCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const ex = maxX - minX || 1;
  const ey = maxY - minY || 1;
  const ez = maxZ - minZ || 1;
  const areaEstimate = 2 * (ex * ey + ey * ez + ez * ex) * 0.55;
  let radius = Math.sqrt(areaEstimate / Math.max(want, 1)) * 0.82;

  // Shuffled visit order — dart throwing in bake order would bias toward
  // whichever corner the seeding happened to favour.
  const order = new Int32Array(candidateCount);
  for (let i = 0; i < candidateCount; i++) order[i] = i;
  const rand = makeRandom(9001);
  for (let i = candidateCount - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }

  let accepted = 0;
  let pass = 0;

  while (accepted < want && pass < 12) {
    const cell = radius;
    const grid = new Map<number, number[]>();
    const gx = (v: number) => Math.floor((v - minX) / cell);
    const gy = (v: number) => Math.floor((v - minY) / cell);
    const gz = (v: number) => Math.floor((v - minZ) / cell);
    const key = (a: number, b: number, c: number) => (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);

    // Re-seed the grid with everything already accepted, so relaxing the
    // radius never undoes the spacing of an earlier pass.
    for (let i = 0; i < accepted; i++) {
      const k = key(gx(outPos[i * 3]), gy(outPos[i * 3 + 1]), gz(outPos[i * 3 + 2]));
      const bucket = grid.get(k);
      if (bucket) bucket.push(i);
      else grid.set(k, [i]);
    }

    const r2 = radius * radius;
    let processed = 0;

    for (let o = 0; o < candidateCount && accepted < want; o++) {
      const i = order[o];
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const cx = gx(x);
      const cy = gy(y);
      const cz = gz(z);

      let blocked = false;
      for (let a = -1; a <= 1 && !blocked; a++) {
        for (let b = -1; b <= 1 && !blocked; b++) {
          for (let c = -1; c <= 1 && !blocked; c++) {
            const bucket = grid.get(key(cx + a, cy + b, cz + c));
            if (!bucket) continue;
            for (const j of bucket) {
              const dx = outPos[j * 3] - x;
              const dy = outPos[j * 3 + 1] - y;
              const dz = outPos[j * 3 + 2] - z;
              if (dx * dx + dy * dy + dz * dz < r2) {
                blocked = true;
                break;
              }
            }
          }
        }
      }

      if (!blocked) {
        outPos[accepted * 3] = x;
        outPos[accepted * 3 + 1] = y;
        outPos[accepted * 3 + 2] = z;
        outNrm[accepted * 3] = normals[i * 3];
        outNrm[accepted * 3 + 1] = normals[i * 3 + 1];
        outNrm[accepted * 3 + 2] = normals[i * 3 + 2];
        const k = key(cx, cy, cz);
        const bucket = grid.get(k);
        if (bucket) bucket.push(accepted);
        else grid.set(k, [accepted]);
        accepted++;
      }

      if (++processed >= candidatesPerChunk) {
        processed = 0;
        yield accepted / want;
      }
    }

    // Short of the target: relax and go round again. Shrinking by 12% per pass
    // converges in a handful of passes without collapsing the spacing.
    radius *= 0.88;
    pass++;
  }

  // If the surface genuinely cannot hold `want` points, duplicate the last
  // accepted point rather than leaving zeros: a zeroed position is a particle
  // stuck at the world origin, which is extremely visible.
  for (let i = accepted; i < want; i++) {
    const src = accepted > 0 ? (i % accepted) : 0;
    outPos.copyWithin(i * 3, src * 3, src * 3 + 3);
    outNrm.copyWithin(i * 3, src * 3, src * 3 + 3);
  }

  return { positions: outPos, normals: outNrm, count: want, spacing: radius / 0.88 };
}
