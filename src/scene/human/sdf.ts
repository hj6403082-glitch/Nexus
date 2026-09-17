import { BUST, HAND, type Capsule } from './anatomy';

/**
 * GLSL emitted FROM the anatomy tables. Nothing here is hand-written geometry;
 * change a knuckle in `anatomy.ts` and the field, the rig and the bake all move
 * together, because there is only one statement of where the knuckle is.
 */

const v3 = (p: readonly number[]): string =>
  `vec3(${p.map((n) => n.toFixed(5)).join(', ')})`;

const capsule = (c: Capsule, name: string): string =>
  `float ${name}(vec3 p) { return sdTaperedCapsule(p, ${v3(c.a)}, ${v3(c.b)}, ${c.ra.toFixed(5)}, ${c.rb.toFixed(5)}); }`;

export const SDF_PRIMITIVES = /* glsl */ `
float sdSphere(vec3 p, vec3 c, float r) { return length(p - c) - r; }

float sdTaperedCapsule(vec3 p, vec3 a, vec3 b, float ra, float rb) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t)) - mix(ra, rb, t);
}

// Polynomial smooth minimum. Large k values are what keep the bust free of
// creases: every join is a blend, never an intersection.
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
`;

export const BUST_SDF = /* glsl */ `
${SDF_PRIMITIVES}

uniform float uJawAngle;

// Rotate a point about an arbitrary axis through a pivot.
vec3 rotateAbout(vec3 p, vec3 pivot, vec3 axis, float angle) {
  vec3 v = p - pivot;
  float c = cos(angle);
  float s = sin(angle);
  return pivot + v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

float sdBust(vec3 p) {
  float d = sdSphere(p, ${v3(BUST.cranium.p)}, ${BUST.cranium.r.toFixed(5)});
  d = smin(d, sdSphere(p, ${v3(BUST.face.p)}, ${BUST.face.r.toFixed(5)}), ${BUST.blend.toFixed(4)});
  d = smin(d, sdTaperedCapsule(p, ${v3(BUST.jaw.a)}, ${v3(BUST.jaw.b)}, ${BUST.jaw.ra.toFixed(5)}, ${BUST.jaw.rb.toFixed(5)}), ${BUST.blend.toFixed(4)});
  d = smin(d, sdTaperedCapsule(p, ${v3(BUST.neck.a)}, ${v3(BUST.neck.b)}, ${BUST.neck.ra.toFixed(5)}, ${BUST.neck.rb.toFixed(5)}), ${BUST.blend.toFixed(4)});
  d = smin(d, sdTaperedCapsule(p, ${v3(BUST.shoulders.a)}, ${v3(BUST.shoulders.b)}, ${BUST.shoulders.ra.toFixed(5)}, ${BUST.shoulders.rb.toFixed(5)}), ${(BUST.blend * 0.85).toFixed(4)});
  d = smin(d, sdTaperedCapsule(p, ${v3(BUST.chest.a)}, ${v3(BUST.chest.b)}, ${BUST.chest.ra.toFixed(5)}, ${BUST.chest.rb.toFixed(5)}), ${(BUST.blend * 1.6).toFixed(4)});
  d = smin(d, sdTaperedCapsule(p, ${v3(BUST.deltoidL.a)}, ${v3(BUST.deltoidL.b)}, ${BUST.deltoidL.ra.toFixed(5)}, ${BUST.deltoidL.rb.toFixed(5)}), ${(BUST.blend * 1.5).toFixed(4)});
  d = smin(d, sdTaperedCapsule(p, ${v3(BUST.deltoidR.a)}, ${v3(BUST.deltoidR.b)}, ${BUST.deltoidR.ra.toFixed(5)}, ${BUST.deltoidR.rb.toFixed(5)}), ${(BUST.blend * 1.5).toFixed(4)});
  return d;
}
`;

/** Finger capsules, emitted chain by chain from the table. */
const fingerChains = HAND.fingers
  .map((f) =>
    f.joints
      .slice(0, -1)
      .map(
        (j, i) =>
          `  d = smin(d, sdTaperedCapsule(p, ${v3(j)}, ${v3(f.joints[i + 1])}, ${f.radii[i].toFixed(5)}, ${f.radii[i + 1].toFixed(5)}), ${HAND.blend.toFixed(4)});`,
      )
      .join('\n'),
  )
  .join('\n');

export const HAND_SDF = /* glsl */ `
${SDF_PRIMITIVES}

float sdHand(vec3 p) {
  float d = sdTaperedCapsule(p, ${v3(HAND.palm.a)}, ${v3(HAND.palm.b)}, ${HAND.palm.ra.toFixed(5)}, ${HAND.palm.rb.toFixed(5)});
  d = smin(d, sdTaperedCapsule(p, ${v3(HAND.thenar.a)}, ${v3(HAND.thenar.b)}, ${HAND.thenar.ra.toFixed(5)}, ${HAND.thenar.rb.toFixed(5)}), ${(HAND.blend * 2.0).toFixed(4)});
  d = smin(d, sdTaperedCapsule(p, ${v3(HAND.forearm.a)}, ${v3(HAND.forearm.b)}, ${HAND.forearm.ra.toFixed(5)}, ${HAND.forearm.rb.toFixed(5)}), ${(HAND.blend * 2.4).toFixed(4)});
${fingerChains}
  return d;
}
`;

/** Bounding boxes for seeding the bake. Generous — a clipped seed is a hole. */
/**
 * The sampling box. Its lower edge is deliberately BELOW the chest's own
 * extent: a box that clips the chest leaves a ragged scatter along the cut,
 * and a ragged cut is far more visible than a chest that simply runs out of
 * frame.
 */
export const BUST_BOUNDS = {
  min: [-0.40, 0.48, -0.32] as [number, number, number],
  max: [0.40, 1.79, 0.34] as [number, number, number],
};

export const HAND_BOUNDS = {
  min: [-0.13, -0.34, -0.09] as [number, number, number],
  max: [0.10, 0.23, 0.10] as [number, number, number],
};

/** CPU mirror of the bust field. Used for the jaw weight and the eye search. */
export function sdBustCPU(x: number, y: number, z: number): number {
  const sphere = (cx: number, cy: number, cz: number, r: number) =>
    Math.hypot(x - cx, y - cy, z - cz) - r;
  const cap = (c: Capsule) => {
    const abx = c.b[0] - c.a[0];
    const aby = c.b[1] - c.a[1];
    const abz = c.b[2] - c.a[2];
    const den = abx * abx + aby * aby + abz * abz || 1e-6;
    let t = ((x - c.a[0]) * abx + (y - c.a[1]) * aby + (z - c.a[2]) * abz) / den;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return (
      Math.hypot(x - (c.a[0] + abx * t), y - (c.a[1] + aby * t), z - (c.a[2] + abz * t)) -
      (c.ra + (c.rb - c.ra) * t)
    );
  };
  const smin = (a: number, b: number, k: number) => {
    const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
    return b + (a - b) * h - k * h * (1 - h);
  };

  let d = sphere(...BUST.cranium.p, BUST.cranium.r);
  d = smin(d, sphere(...BUST.face.p, BUST.face.r), BUST.blend);
  d = smin(d, cap(BUST.jaw), BUST.blend);
  d = smin(d, cap(BUST.neck), BUST.blend);
  d = smin(d, cap(BUST.shoulders), BUST.blend * 0.85);
  d = smin(d, cap(BUST.chest), BUST.blend * 1.6);
  d = smin(d, cap(BUST.deltoidL), BUST.blend * 1.5);
  d = smin(d, cap(BUST.deltoidR), BUST.blend * 1.5);
  return d;
}
