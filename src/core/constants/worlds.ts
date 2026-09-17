import type { WorldId } from './modules';

/**
 * WORLD GRADES (Phase 6)
 *
 * A full-screen colour grade per world, applied after bloom and before the
 * vignette. The grade is the thing that makes a world change read as a
 * CINEMATIC CUT rather than a lighting tweak: at the crossover point between
 * two worlds the split and halation are deliberately spiked past both
 * endpoints, so the transition has a visible peak instead of a linear ramp.
 *
 * The scene is lit almost entirely in blue. A blue luminance ramp is the most
 * boring thing a renderer can produce, because every pixel on it has the same
 * hue and only differs in brightness. The fix is to SPLIT THE ENDS of that
 * ramp: violet pushed into the shadows, warm white pulled into the highlights,
 * mid-tones left completely alone. Grading the mid-tones is what makes graded
 * footage look graded; leaving them is what makes it look shot.
 */
export interface WorldGrade {
  /** Violet pushed into shadow. RGB lift, linear space. */
  shadowTint: [number, number, number];
  /** Warm white pulled into highlight. RGB gain, linear space. */
  highlightTint: [number, number, number];
  /** Strength of the split. 0 = untouched blue ramp. */
  split: number;
  /** Filmic S-curve contrast. Pivots at 18% grey — see the shader. */
  contrast: number;
  /** Overall warmth. Negative cools; Open Water uses that for blue hour. */
  warmth: number;
  /** Bloom bleed into neighbouring pixels — the halation term. */
  halation: number;
  /** Saturation applied after the split. */
  saturation: number;
  /** Fog density multiplier for the atmosphere layer. */
  fogDensity: number;
  /** Key light colour for the scene. */
  keyLight: string;
  label: string;
}

/**
 * 18% grey. The filmic contrast curve pivots here rather than at 0.5 so
 * increasing contrast darkens the shadows without also crushing the mid-tones
 * that were deliberately left alone by the split.
 */
export const GREY_PIVOT = 0.18;

export const WORLDS: Record<WorldId, WorldGrade> = {
  'minimal-studio': {
    label: 'Minimal Studio',
    shadowTint: [0.10, 0.06, 0.22],
    highlightTint: [1.0, 0.98, 0.94],
    split: 0.42,
    contrast: 1.06,
    warmth: 0.02,
    halation: 0.18,
    saturation: 1.0,
    fogDensity: 0.7,
    keyLight: '#bcd4ff',
  },
  'dark-lab': {
    label: 'Dark Lab',
    shadowTint: [0.13, 0.05, 0.28],
    highlightTint: [0.94, 0.97, 1.0],
    split: 0.62,
    contrast: 1.16,
    warmth: -0.04,
    halation: 0.26,
    saturation: 0.96,
    fogDensity: 1.1,
    keyLight: '#8fb4ff',
  },
  'glass-observatory': {
    label: 'Glass Observatory',
    shadowTint: [0.14, 0.09, 0.30],
    highlightTint: [1.0, 0.99, 0.97],
    split: 0.54,
    contrast: 1.02,
    warmth: 0.06,
    halation: 0.42,
    saturation: 1.06,
    fogDensity: 0.85,
    keyLight: '#d7e6ff',
  },
  // Sodium-warm and hard. The only world where the highlight tint goes properly
  // orange-white, and the contrast is the highest in the set.
  'industrial-deck': {
    label: 'Industrial Deck',
    shadowTint: [0.16, 0.07, 0.20],
    highlightTint: [1.0, 0.88, 0.70],
    split: 0.70,
    contrast: 1.28,
    warmth: 0.20,
    halation: 0.22,
    saturation: 0.92,
    fogDensity: 1.35,
    keyLight: '#ffc98a',
  },
  // Negative warmth: blue hour. Cooling the highlights is what stops this
  // reading as "underwater" and starts it reading as "dusk, outdoors".
  'open-water': {
    label: 'Open Water',
    shadowTint: [0.06, 0.09, 0.28],
    highlightTint: [0.82, 0.92, 1.0],
    split: 0.58,
    contrast: 1.10,
    warmth: -0.18,
    halation: 0.34,
    saturation: 1.02,
    fogDensity: 1.15,
    keyLight: '#9ec6ff',
  },
  // Maximum bleed, sub-1.0 contrast. Contrast BELOW one is the whole point:
  // fog is a low-contrast medium, and faking it with density alone while
  // holding contrast at 1.0 reads as a dirty lens, not as air.
  'fog-chamber': {
    label: 'Fog Chamber',
    shadowTint: [0.12, 0.10, 0.24],
    highlightTint: [0.96, 0.97, 1.0],
    split: 0.36,
    contrast: 0.88,
    warmth: -0.02,
    halation: 0.62,
    saturation: 0.88,
    fogDensity: 2.1,
    keyLight: '#b6c8e8',
  },
  'market-grid': {
    label: 'Market Grid',
    shadowTint: [0.08, 0.05, 0.26],
    highlightTint: [0.90, 1.0, 0.99],
    split: 0.66,
    contrast: 1.20,
    warmth: -0.08,
    halation: 0.24,
    saturation: 1.10,
    fogDensity: 0.95,
    keyLight: '#7fe6e0',
  },
  'weather-reactive': {
    label: 'Weather',
    shadowTint: [0.10, 0.08, 0.26],
    highlightTint: [0.95, 0.97, 1.0],
    split: 0.48,
    contrast: 1.04,
    warmth: 0.0,
    halation: 0.30,
    saturation: 1.0,
    fogDensity: 1.0,
    keyLight: '#a8c4ff',
  },
};

export const DEFAULT_WORLD: WorldId = 'minimal-studio';

/**
 * Spike the split and halation at the crossover so the world change reads as a
 * cut. `t` is 0 at the outgoing world, 1 at the incoming one; the spike peaks
 * at t = 0.5 and is gone at both ends.
 */
export function crossoverSpike(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.sin(Math.PI * x) ** 2;
}

export function blendGrade(a: WorldGrade, b: WorldGrade, t: number): WorldGrade {
  const m = (x: number, y: number) => x + (y - x) * t;
  const m3 = (
    x: [number, number, number],
    y: [number, number, number],
  ): [number, number, number] => [m(x[0], y[0]), m(x[1], y[1]), m(x[2], y[2])];
  const spike = crossoverSpike(t);
  return {
    label: t < 0.5 ? a.label : b.label,
    shadowTint: m3(a.shadowTint, b.shadowTint),
    highlightTint: m3(a.highlightTint, b.highlightTint),
    split: m(a.split, b.split) + spike * 0.55,
    contrast: m(a.contrast, b.contrast),
    warmth: m(a.warmth, b.warmth),
    halation: m(a.halation, b.halation) + spike * 0.5,
    saturation: m(a.saturation, b.saturation),
    fogDensity: m(a.fogDensity, b.fogDensity),
    keyLight: t < 0.5 ? a.keyLight : b.keyLight,
  };
}
