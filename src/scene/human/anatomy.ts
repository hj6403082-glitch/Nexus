/**
 * THE FIGURE, AUTHORED AS DATA.
 *
 * Both the signed-distance field AND the pose code are emitted from these
 * tables. That is the whole trick: a hand whose knuckles are declared here
 * cannot have a field and a rig that disagree about where a knuckle is,
 * because there is only one statement of where a knuckle is.
 *
 * The brief for the bust is a SYNTHETIC INTELLIGENCE, not a likeness. So:
 * broad, heavily blended primitives and nothing that sticks out. No ears, no
 * carved lip line, no brow primitive. Every crease in an SDF collects surface
 * points during projection — Newton iteration converges into concavities — and
 * a collected crease reads as a bulge or a bright arc, never as a feature.
 * Blend radii are large for the same reason.
 */

export interface Sphere {
  p: [number, number, number];
  r: number;
}

export interface Capsule {
  a: [number, number, number];
  b: [number, number, number];
  ra: number;
  rb: number;
}

/** Units are metres. The bust is authored at human scale. */
export const BUST = {
  /** Smooth-union radius. Large on purpose — see the note above. */
  blend: 0.055,
  cranium: { p: [0, 1.635, 0], r: 0.114 } as Sphere,
  /** Slightly forward and down of the cranium; together they read as a skull. */
  face: { p: [0, 1.583, 0.032], r: 0.101 } as Sphere,
  /** The jaw mass. Rotates as a rigid body — see JAW. */
  jaw: { a: [-0.045, 1.525, 0.012], b: [0.045, 1.525, 0.012], ra: 0.062, rb: 0.062 } as Capsule,
  neck: { a: [0, 1.505, -0.005], b: [0, 1.345, -0.012], ra: 0.054, rb: 0.068 } as Capsule,
  /** Trapezius sweep into the shoulders. One capsule, deliberately broad. */
  shoulders: { a: [-0.150, 1.280, 0], b: [0.150, 1.280, 0], ra: 0.100, rb: 0.100 } as Capsule,
  /**
   * The upper chest. Broad and running off the bottom of the frame — a chest
   * that ENDS is a bust on a plinth, and the taper to a point read as a torso
   * that had been pinched shut.
   */
  chest: { a: [0, 1.255, 0], b: [0, 0.78, 0.02], ra: 0.168, rb: 0.255 } as Capsule,
  /** Deltoid caps, so the shoulders end in mass rather than in a capsule tip. */
  deltoidL: { a: [-0.170, 1.268, 0], b: [-0.204, 1.196, 0], ra: 0.088, rb: 0.076 } as Capsule,
  deltoidR: { a: [0.170, 1.268, 0], b: [0.204, 1.196, 0], ra: 0.088, rb: 0.076 } as Capsule,
} as const;

/**
 * The jaw hinges about a LINE THROUGH THE EARS. Not about the chin, and not by
 * translating the lower face down. A hinge is what makes the chin swing
 * further than the lower lip, which is the entire visual signature of a mouth
 * opening rather than a hole appearing.
 *
 * Rigid rotation cannot open a gap in the surface, which is why the jaw is
 * posed in the vertex shader rather than re-baked.
 */
export const JAW = {
  /** A point on the hinge axis. */
  pivot: [0, 1.556, -0.052] as [number, number, number],
  /** The axis itself: ear to ear, i.e. +X. */
  axis: [1, 0, 0] as [number, number, number],
  /** Radians at full openness. Small — a mechanism, not a membrane. */
  maxAngle: 0.20,
  /** Points below this Y belong to the jaw; weight ramps over `feather`. */
  topY: 1.575,
  feather: 0.055,
  /** The lip seam, in the figure's local frame. The light lives HERE only. */
  seam: { y: 1.5305, z: 0.088, halfWidth: 0.030 },
  /**
   * Openness is held to five discrete steps. A continuous jaw reads as rubber;
   * quantising it reads as a machine deciding how far to open.
   */
  steps: 5,
} as const;

export const EYES = {
  left: [-0.036, 1.588, 0.078] as [number, number, number],
  right: [0.036, 1.588, 0.078] as [number, number, number],
  radius: 0.011,
} as const;

/** A finger: a chain of tapered capsules with a hinge at each joint. */
export interface FingerDef {
  name: string;
  /** Knuckle positions in the hand's local frame, base → tip. */
  joints: [number, number, number][];
  /** Radius at each joint. */
  radii: number[];
  /** Per-joint curl multiplier. The MCP curls least, the DIP most. */
  curlGain: number[];
  /** Hinge axis per joint, in hand-local space. */
  axis: [number, number, number][];
}

/**
 * The hand. Authored the same way as the bust, baked through the same
 * pipeline, drawn with the same beads under the same key.
 *
 * Every knuckle below is a hinge the vertex shader can rotate about, so ONE
 * curl uniform cups the hand and opens it. Like the jaw, rigid rotation about
 * a hinge cannot tear the surface — which is what lets the hand close around
 * a panel without the bead field opening seams.
 */
export const HAND = {
  blend: 0.016,
  /** Palm slab. */
  palm: { a: [0, 0, 0], b: [0, 0.085, 0.004], ra: 0.040, rb: 0.044 } as Capsule,
  /** Thenar eminence — the mass at the base of the thumb. */
  thenar: { a: [-0.026, 0.012, 0.012], b: [-0.030, 0.045, 0.014], ra: 0.024, rb: 0.020 } as Capsule,
  /** Forearm, running off the bottom of the frame. */
  forearm: { a: [0, -0.02, 0], b: [0, -0.30, -0.02], ra: 0.038, rb: 0.050 } as Capsule,
  fingers: [
    {
      name: 'index',
      joints: [
        [-0.026, 0.092, 0.004],
        [-0.028, 0.136, 0.006],
        [-0.029, 0.164, 0.006],
        [-0.030, 0.186, 0.005],
      ],
      radii: [0.016, 0.014, 0.012, 0.010],
      curlGain: [0.75, 1.0, 0.9],
      axis: [
        [1, 0, 0],
        [1, 0, 0],
        [1, 0, 0],
      ],
    },
    {
      name: 'middle',
      joints: [
        [0.000, 0.096, 0.004],
        [0.000, 0.144, 0.006],
        [0.000, 0.176, 0.006],
        [0.000, 0.200, 0.005],
      ],
      radii: [0.017, 0.015, 0.012, 0.010],
      curlGain: [0.75, 1.0, 0.9],
      axis: [
        [1, 0, 0],
        [1, 0, 0],
        [1, 0, 0],
      ],
    },
    {
      name: 'ring',
      joints: [
        [0.026, 0.092, 0.003],
        [0.029, 0.136, 0.005],
        [0.031, 0.165, 0.005],
        [0.032, 0.187, 0.004],
      ],
      radii: [0.016, 0.014, 0.011, 0.009],
      curlGain: [0.8, 1.0, 0.95],
      axis: [
        [1, 0, 0],
        [1, 0, 0],
        [1, 0, 0],
      ],
    },
    {
      name: 'pinky',
      joints: [
        [0.049, 0.084, 0.002],
        [0.054, 0.118, 0.004],
        [0.057, 0.141, 0.004],
        [0.058, 0.159, 0.003],
      ],
      radii: [0.014, 0.012, 0.010, 0.008],
      curlGain: [0.85, 1.05, 1.0],
      axis: [
        [1, 0, 0],
        [1, 0, 0],
        [1, 0, 0],
      ],
    },
    {
      name: 'thumb',
      joints: [
        [-0.034, 0.038, 0.016],
        [-0.058, 0.064, 0.030],
        [-0.072, 0.086, 0.040],
        [-0.080, 0.102, 0.046],
      ],
      radii: [0.019, 0.016, 0.013, 0.011],
      curlGain: [0.6, 0.8, 0.7],
      // The thumb opposes: its hinge is not the ear-to-ear style +X of the
      // fingers, it is tilted out of the palm plane.
      axis: [
        [0.35, 0.25, 0.9],
        [0.35, 0.25, 0.9],
        [0.35, 0.25, 0.9],
      ],
    },
  ] as FingerDef[],
} as const;

/** Total hinge count, for the uniform array sizes the generator emits. */
export const HAND_HINGE_COUNT = HAND.fingers.reduce(
  (n, f) => n + f.joints.length - 1,
  0,
);
