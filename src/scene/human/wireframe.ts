/**
 * THE MESH BETWEEN THE POINTS.
 *
 * The figure has been through a solid metal version and a translucent
 * holographic one, and neither was what was wanted. What was wanted is a
 * NETWORK: bright nodes scattered over the surface, joined by fine lines, with
 * the silhouette and the feature edges burning brightest. No shaded surface at
 * all — you see straight through the head to the mesh on its far side.
 *
 * The input for that already existed and was being thrown away. The bake
 * produces a Poisson-disc point set on the surface — uniformly spaced, no
 * clumps, no gaps — which is exactly the distribution a good triangulation
 * wants, and exactly what the beads fly to. So the network is built from the
 * same points the particles land on, and the figure that assembles IS the
 * figure that stays.
 *
 * WHY k-NEAREST-NEIGHBOUR AND NOT DELAUNAY
 *
 * A proper surface triangulation of a point cloud means estimating a tangent
 * plane per point, projecting its neighbourhood, triangulating in 2D and
 * stitching the patches — a few hundred lines, and it can fail on a surface
 * that folds back on itself, which this one does at the jaw and the nose.
 *
 * Connecting each point to its k nearest neighbours produces a network that is
 * visually indistinguishable at this density and cannot fail. It is not a
 * manifold, and nothing here needs one: no normals are interpolated across it,
 * no area is integrated over it, nothing is filled. It is drawn as lines. The
 * only property that matters is that the lines look like they belong to a
 * surface, and joining near neighbours on a uniformly spaced set gives that.
 *
 * Edges are deduplicated and length-capped. The cap is what stops a point near
 * a fold — the underside of the jaw, say — reaching across the gap and lashing
 * the neck to the chin with a line that passes through empty space.
 */

/** How many neighbours each point reaches for. */
const NEIGHBOURS = 6;

/**
 * Longest edge kept, as a multiple of the point set's mean spacing.
 *
 * A Poisson-disc set guarantees a minimum separation, not a maximum, so the
 * genuine local spacing varies; 2.2 keeps the honest neighbours and drops the
 * ones that would have to cross a hole or a fold to get there.
 */
const MAX_EDGE = 2.2;

export interface Wireframe {
  /** Index pairs into the point array, two entries per edge. */
  edges: Uint32Array;
  edgeCount: number;
}

/**
 * Chunked, like everything else in the bake, so it can be spent a slice per
 * frame rather than stalling the transformation it is part of.
 */
export function* buildWireframe(
  positions: Float32Array,
  count: number,
  meanSpacing: number,
): Generator<number, Wireframe, void> {
  const cell = Math.max(meanSpacing * MAX_EDGE, 1e-4);
  const maxEdgeSq = (meanSpacing * MAX_EDGE) ** 2;

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

  // Counting sort into flat buckets: no per-cell arrays, no rehashing.
  const cells = nx * ny * nz;
  const starts = new Int32Array(cells + 1);
  for (let i = 0; i < count; i++) starts[cellOf(i) + 1]++;
  for (let c = 0; c < cells; c++) starts[c + 1] += starts[c];
  const order = new Int32Array(count);
  const cursor = Int32Array.from(starts.subarray(0, cells));
  for (let i = 0; i < count; i++) order[cursor[cellOf(i)]++] = i;

  // Worst case is every point keeping every neighbour; dedup shrinks it.
  const edges = new Uint32Array(count * NEIGHBOURS * 2);
  let edgeCount = 0;

  const bestIdx = new Int32Array(NEIGHBOURS);
  const bestD2 = new Float64Array(NEIGHBOURS);
  const CHUNK = 3072;

  for (let start = 0; start < count; start += CHUNK) {
    const end = Math.min(start + CHUNK, count);
    for (let i = start; i < end; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      const cx = Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / cell)));
      const cy = Math.min(ny - 1, Math.max(0, Math.floor((y - minY) / cell)));
      const cz = Math.min(nz - 1, Math.max(0, Math.floor((z - minZ) / cell)));

      bestD2.fill(Infinity);
      bestIdx.fill(-1);

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
              if (d2 > maxEdgeSq || d2 >= bestD2[NEIGHBOURS - 1]) continue;
              let k = NEIGHBOURS - 1;
              while (k > 0 && bestD2[k - 1] > d2) {
                bestD2[k] = bestD2[k - 1];
                bestIdx[k] = bestIdx[k - 1];
                k--;
              }
              bestD2[k] = d2;
              bestIdx[k] = j;
            }
          }
        }
      }

      for (let k = 0; k < NEIGHBOURS; k++) {
        const j = bestIdx[k];
        // i < j keeps exactly one of each pair without a hash set: the same
        // edge found from the other end is simply not written.
        if (j < 0 || j < i) continue;
        edges[edgeCount * 2] = i;
        edges[edgeCount * 2 + 1] = j;
        edgeCount++;
      }
    }
    yield end / count;
  }

  return { edges: edges.subarray(0, edgeCount * 2), edgeCount };
}

/**
 * MAKE THE POINT SET SYMMETRIC.
 *
 * The selection is a random elimination, so the left and right halves of the
 * face get different points, and at network density that difference is the
 * most legible thing on it: one eye ends up with five nodes in its socket and
 * the other with three, one cheek carries a bright edge the other does not.
 * The face reads as damaged rather than as sparse — which is exactly the
 * complaint the network was built to answer.
 *
 * So one half is chosen and the other is its reflection. The mesh is then
 * symmetric by construction and the eye stops reading asymmetry as injury.
 * Points sitting on the midline are kept once and pinned to x = 0, or they
 * would be duplicated on top of themselves and the seam would be twice as
 * bright as the rest.
 */
export function mirrorAcrossMidline(
  positions: Float32Array,
  normals: Float32Array,
  count: number,
): { positions: Float32Array; normals: Float32Array; count: number } {
  // Half the mean spacing: wide enough to catch the points the elimination put
  // on the midline, narrow enough not to flatten the ones beside it onto it.
  const SEAM = 0.0018;

  const outP: number[] = [];
  const outN: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];

    if (Math.abs(x) <= SEAM) {
      outP.push(0, y, z);
      outN.push(0, ny, nz);
      continue;
    }
    if (x < 0) continue;
    outP.push(x, y, z, -x, y, z);
    outN.push(nx, ny, nz, -nx, ny, nz);
  }

  return {
    positions: new Float32Array(outP),
    normals: new Float32Array(outN),
    count: outP.length / 3,
  };
}
