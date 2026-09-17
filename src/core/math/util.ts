export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const clamp01 = (v: number): number => clamp(v, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const inverseLerp = (a: number, b: number, v: number): number =>
  a === b ? 0 : clamp01((v - a) / (b - a));

/** Remap with clamping at both ends. */
export const remap = (v: number, a: number, b: number, c: number, d: number): number =>
  lerp(c, d, inverseLerp(a, b, v));

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = inverseLerp(edge0, edge1, x);
  return t * t * (3 - 2 * t);
};

/** C2-continuous. Used where a smoothstep's acceleration discontinuity shows. */
export const smootherstep = (edge0: number, edge1: number, x: number): number => {
  const t = inverseLerp(edge0, edge1, x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * A window that rises over [a,b] and falls over [c,d]. Envelopes in the master
 * clocks are built almost entirely out of this.
 */
export const window4 = (t: number, a: number, b: number, c: number, d: number): number =>
  smoothstep(a, b, t) * (1 - smoothstep(c, d, t));

/**
 * `Math.pow` on a "one minus facing" term, guarded.
 *
 * Two normalised vectors can dot to 1.0000001 in float32. `pow(negative, 2.5)`
 * is NaN, one NaN pixel propagates through every level of the bloom pyramid on
 * downsample, and the entire frame goes black. This is not hypothetical — it
 * took out the wake wave every time a question arrived in human form. Every
 * facing-based falloff in the shaders and on the CPU goes through here.
 */
export const safePow = (base: number, exponent: number): number =>
  Math.pow(clamp01(base), exponent);

/** Deterministic hash → [0,1). Used for per-particle and per-card stagger. */
export function hash11(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}

export function hash21(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Mulberry32 — small, fast, seedable. Bakes must be reproducible. */
export function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
