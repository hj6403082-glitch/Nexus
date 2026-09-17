/**
 * NEXUS colour system.
 *
 * Dark environment, blue and white holographic light, orange reserved — truly
 * reserved — for warnings. Every hue below is stated in degrees so the two
 * constraints that actually matter can be checked by eye and by test:
 *
 *   1. GOLD (46°) and WARNING ORANGE (28°) sit 18° apart. At the saturation
 *      and bloom radius this scene runs, 18° is not enough separation to tell
 *      apart in peripheral vision. That is why a warned card is never allowed
 *      to go gold at all — see GOLD below. Distance in hue does not solve it;
 *      exclusivity does.
 *
 *   2. The module accents are spread across violet → blue → cyan rather than
 *      clustered on one blue. Mid-rotation, a card is a smear of colour and
 *      nothing else; the accent is the only thing identifying it.
 */

export interface Accent {
  /** Hue in degrees. */
  h: number;
  /** Linear-space RGB triple for shader uniforms. */
  rgb: [number, number, number];
  /** CSS colour for HUD and DOM panels. */
  css: string;
}

const fromHue = (h: number, s: number, l: number): Accent => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const rgb: [number, number, number] = [f(0), f(8), f(4)];
  const css = `rgb(${rgb.map((c) => Math.round(c * 255)).join(' ')})`;
  return { h, rgb, css };
};

/** The accent spectrum. Violet at one end, cyan at the other, blue in between. */
export const ACCENTS = {
  violet: fromHue(268, 0.82, 0.66),
  indigo: fromHue(248, 0.84, 0.66),
  blue: fromHue(222, 0.88, 0.64),
  azure: fromHue(206, 0.9, 0.62),
  cyan: fromHue(188, 0.86, 0.6),
  teal: fromHue(172, 0.74, 0.56),
} as const;

export type AccentName = keyof typeof ACCENTS;

/** Warning. The only warm colour in the system that is allowed to be loud. */
export const WARNING = fromHue(28, 0.94, 0.58);

/**
 * GOLD — the centred-card colour.
 *
 * Three rules, two of them counter-intuitive enough that they were each
 * discovered by getting them wrong first:
 *
 * RULE 1 — Gold must never read as warning orange. Enforced by EXCLUSION, not
 *   by hue distance: `goldTerm` below returns 0 for a warned card, full stop.
 *   A card cannot be both centred-and-gold and warned-and-orange; warning wins
 *   and gold is gated off entirely. A gold glow the user reads as an alert is
 *   worse than no gold at all.
 *
 * RULE 2 — Gold must be drawn DIMMER than the blue it replaces in order to
 *   read as gold. The instinct is to multiply the border brightness above 1.0
 *   to make the centred card prominent. That clips red and green to 1.0 and
 *   the "gold" resolves to white — you lose the hue exactly where you wanted
 *   it most. So: no border multiplier above 1.0, ever. Prominence comes from
 *   the hue shift plus a wider, softer outer bloom, not from more energy.
 *
 * RULE 3 — Gold is EARNED. It fades in continuously on a power curve of how
 *   centred the card is, so there is no threshold at which a card "becomes"
 *   the centre one. The curve is deliberately steep: only the genuinely
 *   centred card gets meaningful gold.
 */
export const GOLD = fromHue(46, 0.72, 0.58);

export const GOLD_RULES = {
  /** Never exceed 1.0. See RULE 2. */
  MAX_BORDER_MULTIPLIER: 1.0,
  /** Gold is drawn at this fraction of blue's intensity. See RULE 2. */
  INTENSITY_RATIO: 0.74,
  /** Outer bloom radius multiplier — where the prominence actually comes from. */
  BLOOM_RADIUS_MULTIPLIER: 1.85,
  /** Steepness of the earned-gold curve. See RULE 3. */
  CENTRE_EXPONENT: 3.5,
} as const;

/**
 * How gold a card is allowed to be.
 *
 * @param centredness 1 when the card is dead centre, 0 at the far side.
 * @param warned      whether the card is currently raising a warning.
 */
export function goldTerm(centredness: number, warned: boolean): number {
  if (warned) return 0; // RULE 1. Not a multiplier. A gate.
  const c = centredness < 0 ? 0 : centredness > 1 ? 1 : centredness;
  return Math.pow(c, GOLD_RULES.CENTRE_EXPONENT);
}

/** Base environment colours. */
export const ENV = {
  void: '#04060b',
  fog: '#0a1018',
  glass: '#0e1622',
  ink: '#e8eef8',
  dim: '#7c8ba3',
} as const;
