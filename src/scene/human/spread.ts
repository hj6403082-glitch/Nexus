/**
 * PER-BEAD SPACING.
 *
 * A bead's only job is to meet its neighbours. Sizing every bead from one
 * global number assumes the point set is uniform, and this one is not: the
 * bake seeds candidates uniformly through a BOX, so the density that reaches
 * the surface falls off wherever the surface is large. Measured on the figure,
 * the head came out solid and the chest — several times the area — was 3%
 * void. One radius cannot serve both. Raise it until the chest closes and the
 * face turns to plastic; lower it until the face reads and the chest is
 * perforated.
 *
 * So each bead measures its own neighbourhood and is sized from that. Sparse
 * regions grow beads until they touch; dense regions keep small ones and stay
 * legible as dots. The global spacing survives only as the unit the result is
 * clamped against, so one bad outlier cannot produce a dinner plate.
 */

/**
 * Which neighbour to measure.
 *
 * The 3rd, not the 5th. The 5th nearest neighbour of a Poisson-disc set sits
 * at roughly 1.6x the typical nearest-neighbour distance, so sizing beads from
 * it made every bead about three times as wide as the gap it had to close —
 * the surface stopped reading as beads and turned into gravel. The 3rd sits at
 * about 1.25x, which is a stable statistic without being a wildly inflated
 * one.
 */
const NEIGHBOUR = 3;

/** Clamped to this range, in multiples of the mean spacing. */
const MIN_SCALE = 0.65;
const MAX_SCALE = 2.4;

/**
 * Distance from each point to its Nth nearest neighbour, via a uniform grid
 * sized so that a cell holds a handful of points. Chunked, like everything
 * else in the bake, so it can be spent a slice per frame.
 */
export function* measureSpread(
  positions: Float32Array,
  count: number,
  meanSpacing: number,
): Generator<number, Float32Array, void> {
  const spread = new Float32Array(count);

  // One cell per ~2 mean spacings keeps the 27-cell search around a dozen
  // candidates, which is comfortably more than the 5 we need.
  const cell = Math.max(meanSpacing * 2, 1e-4);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const ny = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  const nz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);

  const cellOf = (i: number): number => {
    const cx = Math.min(nx - 1, Math.max(0, Math.floor((positions[i * 3] - minX) / cell)));
    const cy = Math.min(ny - 1, Math.max(0, Math.floor((positions[i * 3 + 1] - minY) / cell)));
    const cz = Math.min(nz - 1, Math.max(0, Math.floor((positions[i * 3 + 2] - minZ) / cell)));
    return (cz * ny + cy) * nx + cx;
  };

  // Counting sort into a flat bucket array: no per-cell arrays, no rehashing.
  const cells = nx * ny * nz;
  const starts = new Int32Array(cells + 1);
  for (let i = 0; i < count; i++) starts[cellOf(i) + 1]++;
  for (let c = 0; c < cells; c++) starts[c + 1] += starts[c];
  const order = new Int32Array(count);
  const cursor = Int32Array.from(starts.subarray(0, cells));
  for (let i = 0; i < count; i++) order[cursor[cellOf(i)]++] = i;

  const best = new Float64Array(NEIGHBOUR);
  const CHUNK = 4096;

  for (let start = 0; start < count; start += CHUNK) {
    const end = Math.min(start + CHUNK, count);
    for (let i = start; i < end; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      const cx = Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / cell)));
      const cy = Math.min(ny - 1, Math.max(0, Math.floor((y - minY) / cell)));
      const cz = Math.min(nz - 1, Math.max(0, Math.floor((z - minZ) / cell)));

      best.fill(Infinity);

      for (let dz = -1; dz <= 1; dz++) {
        const gz = cz + dz;
        if (gz < 0 || gz >= nz) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const gy = cy + dy;
          if (gy < 0 || gy >= ny) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const gx = cx + dx;
            if (gx < 0 || gx >= nx) continue;
            const c = (gz * ny + gy) * nx + gx;
            for (let s = starts[c]; s < starts[c + 1]; s++) {
              const j = order[s];
              if (j === i) continue;
              const ddx = positions[j * 3] - x;
              const ddy = positions[j * 3 + 1] - y;
              const ddz = positions[j * 3 + 2] - z;
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
              // Insertion into a 5-slot sorted list. Cheaper than a heap at
              // this size, and it never allocates.
              if (d2 >= best[NEIGHBOUR - 1]) continue;
              let k = NEIGHBOUR - 1;
              while (k > 0 && best[k - 1] > d2) {
                best[k] = best[k - 1];
                k--;
              }
              best[k] = d2;
            }
          }
        }
      }

      // The furthest of the near neighbours: the gap this bead has to close.
      const furthest = best[NEIGHBOUR - 1];
      const d = Number.isFinite(furthest) ? Math.sqrt(furthest) : meanSpacing * MAX_SCALE;
      spread[i] = Math.min(
        meanSpacing * MAX_SCALE,
        Math.max(meanSpacing * MIN_SCALE, d),
      );
    }
    yield end / count;
  }

  return spread;
}
