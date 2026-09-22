import { BUST_PARTS, HAND, type Part, type Prim, type V3 } from './anatomy';

/**
 * GLSL emitted FROM the anatomy tables — and, crucially, the CPU evaluator
 * emitted from the same walk of the same array.
 *
 * The previous version hand-maintained a second copy of the bust field in
 * TypeScript "as a CPU mirror". Two hand-written copies of a field is two
 * fields, and the moment one gains a primitive the jaw weights and the eye
 * search are computed against a body that no longer exists. Here `fold()` is
 * the only statement of how parts combine; `fieldGLSL` and `fieldCPU` are two
 * renderings of it, so they cannot disagree.
 */

const f = (n: number): string => n.toFixed(5);
const v3 = (p: V3): string => `vec3(${p.map(f).join(', ')})`;

// --- primitives -------------------------------------------------------------

export const SDF_PRIMITIVES = /* glsl */ `
float sdSphere(vec3 p, vec3 c, float r) { return length(p - c) - r; }

// Approximate but well-behaved: the gradient is smooth everywhere outside the
// centre, which is all Newton needs.
float sdEllipsoid(vec3 p, vec3 c, vec3 r) {
  vec3 q = (p - c) / r;
  float k0 = length(q);
  float k1 = length(q / r);
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}

float sdTaperedCapsule(vec3 p, vec3 a, vec3 b, float ra, float rb) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t)) - mix(ra, rb, t);
}

// Polynomial smooth minimum.
float smin(float a, float b, float k) {
  if (k <= 0.0) return min(a, b);
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Smooth subtraction. max(a, -b) is the hard form; this is the same identity
// written through smin, so a carve and a union share one blend function and
// one set of numerical properties.
float ssub(float a, float b, float k) { return -smin(-a, b, k); }
`;

const primGLSL = (prim: Prim): string => {
  switch (prim.kind) {
    case 'sphere':
      return `sdSphere(p, ${v3(prim.p)}, ${f(prim.r)})`;
    case 'ellipsoid':
      return `sdEllipsoid(p, ${v3(prim.p)}, ${v3(prim.r)})`;
    case 'capsule':
      return `sdTaperedCapsule(p, ${v3(prim.a)}, ${v3(prim.b)}, ${f(prim.ra)}, ${f(prim.rb)})`;
  }
};

const primCPU = (prim: Prim, x: number, y: number, z: number): number => {
  switch (prim.kind) {
    case 'sphere':
      return Math.hypot(x - prim.p[0], y - prim.p[1], z - prim.p[2]) - prim.r;
    case 'ellipsoid': {
      const qx = (x - prim.p[0]) / prim.r[0];
      const qy = (y - prim.p[1]) / prim.r[1];
      const qz = (z - prim.p[2]) / prim.r[2];
      const k0 = Math.hypot(qx, qy, qz);
      const k1 = Math.hypot(qx / prim.r[0], qy / prim.r[1], qz / prim.r[2]);
      return (k0 * (k0 - 1)) / Math.max(k1, 1e-6);
    }
    case 'capsule': {
      const abx = prim.b[0] - prim.a[0];
      const aby = prim.b[1] - prim.a[1];
      const abz = prim.b[2] - prim.a[2];
      const den = abx * abx + aby * aby + abz * abz || 1e-6;
      let t = ((x - prim.a[0]) * abx + (y - prim.a[1]) * aby + (z - prim.a[2]) * abz) / den;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return (
        Math.hypot(
          x - (prim.a[0] + abx * t),
          y - (prim.a[1] + aby * t),
          z - (prim.a[2] + abz * t),
        ) - (prim.ra + (prim.rb - prim.ra) * t)
      );
    }
  }
};

const sminCPU = (a: number, b: number, k: number): number => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
};

// --- the one statement of how parts combine ---------------------------------

/**
 * Fold a part list into an accumulated field, in order. `combine` is applied
 * once per part; everything else about the traversal is shared, which is what
 * makes the GLSL and the CPU evaluator two renderings rather than two fields.
 */
function fold<T>(
  parts: Part[],
  evaluate: (prim: Prim) => T,
  union: (acc: T, next: T, k: number) => T,
  subtract: (acc: T, next: T, k: number) => T,
): T {
  if (parts.length === 0) throw new Error('fold: empty part list');
  let acc = evaluate(parts[0].prim);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.carve && part.jaw) {
      throw new Error(`${part.name}: a carved part cannot be mandible mass`);
    }
    const next = evaluate(part.prim);
    acc = part.carve ? subtract(acc, next, part.blend) : union(acc, next, part.blend);
  }
  return acc;
}

const fieldGLSL = (parts: Part[], name: string): string => `
float ${name}(vec3 p) {
  return ${fold<string>(
    parts,
    primGLSL,
    (a, b, k) => `smin(${a}, ${b}, ${f(k)})`,
    (a, b, k) => `ssub(${a}, ${b}, ${f(k)})`,
  )};
}`;

const fieldCPU = (parts: Part[], x: number, y: number, z: number): number =>
  fold<number>(
    parts,
    (prim) => primCPU(prim, x, y, z),
    (a, b, k) => sminCPU(a, b, k),
    (a, b, k) => -sminCPU(-a, b, k),
  );

// --- the bust ---------------------------------------------------------------

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
${fieldGLSL(BUST_PARTS, 'sdBust')}
`;

/** The full bust field, on the CPU. Used for the eye search and for asserts. */
export const sdBustCPU = (x: number, y: number, z: number): number =>
  fieldCPU(BUST_PARTS, x, y, z);

/**
 * The mandible alone.
 *
 * Jaw membership is distance to THIS, not height below a threshold. The height
 * test the first version used was true of the neck, the shoulders and the
 * whole chest, so opening the mouth swung the entire torso about a line
 * through the ears.
 */
const MANDIBLE = BUST_PARTS.filter((p) => p.jaw);

export const sdMandibleCPU = (x: number, y: number, z: number): number =>
  fieldCPU(MANDIBLE, x, y, z);

/**
 * The sampling box. Its lower edge is deliberately BELOW the chest's own
 * extent: a box that clips the chest leaves a ragged scatter along the cut,
 * and a ragged cut is far more visible than a chest that simply runs out of
 * frame.
 */
export const BUST_BOUNDS = {
  min: [-0.27, 0.60, -0.20] as [number, number, number],
  max: [0.27, 1.77, 0.16] as [number, number, number],
};

// --- the hand ---------------------------------------------------------------

const HAND_PARTS: Part[] = [
  { name: 'palm', prim: { kind: 'capsule', ...HAND.palm }, blend: 0 },
  { name: 'thenar', prim: { kind: 'capsule', ...HAND.thenar }, blend: HAND.blend * 2.0 },
  { name: 'forearm', prim: { kind: 'capsule', ...HAND.forearm }, blend: HAND.blend * 2.4 },
  ...HAND.fingers.flatMap((finger) =>
    finger.joints.slice(0, -1).map((joint, i) => ({
      name: `${finger.name}${i}`,
      prim: {
        kind: 'capsule' as const,
        a: joint,
        b: finger.joints[i + 1],
        ra: finger.radii[i],
        rb: finger.radii[i + 1],
      },
      blend: HAND.blend,
    })),
  ),
];

export const HAND_SDF = /* glsl */ `
${SDF_PRIMITIVES}
${fieldGLSL(HAND_PARTS, 'sdHand')}
`;

export const HAND_BOUNDS = {
  min: [-0.13, -0.34, -0.09] as [number, number, number],
  max: [0.10, 0.23, 0.10] as [number, number, number],
};
