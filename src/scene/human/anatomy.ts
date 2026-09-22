/**
 * THE FIGURE, AUTHORED AS DATA.
 *
 * Both the signed-distance field AND the pose code are emitted from the tables
 * below. That is the whole trick: a hand whose knuckles are declared here
 * cannot have a field and a rig that disagree about where a knuckle is,
 * because there is only one statement of where a knuckle is.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS WAS REWRITTEN
 *
 * The first bust was eight primitives smooth-unioned with a 55 mm blend. The
 * reasoning was that creases collect points during Newton projection, so blend
 * everything away. The reasoning was sound and the cure killed the patient: a
 * 55 mm blend on a 90 mm skull dissolves every feature it touches. The result
 * was a faceless egg on a bowling pin — no brow, no nose, no sockets, no neck,
 * and a chest that flared outward like a plinth.
 *
 * The fear was also overstated. Newton runs forty damped steps and rejects
 * anything that fails to converge, and the Poisson pass that follows it
 * re-spaces the survivors uniformly — so a concavity that collects points has
 * its surplus thinned right back out again. Creases are affordable. What is
 * not affordable is having nothing to look at.
 *
 * So the blends here are 10–40 mm, chosen per join, and the face is built the
 * way a face is built: a cranium, a facial block, a brow, cheekbones, a nose,
 * a chin, two hinged rami, and — the single most important part — two eye
 * sockets CARVED OUT rather than added on. A recess is what makes an eye read.
 * Every previous version put the eye lights five centimetres inside the skull,
 * where no baked point could ever reach them, which is why the figure had no
 * eyes at all rather than dim ones.
 *
 * It is still a SYNTHETIC INTELLIGENCE and not a likeness: no ears, no hair,
 * no lips, no nostrils. Broad planes and hard structure.
 */

export type V3 = readonly [number, number, number];

export type Prim =
  | { kind: 'sphere'; p: V3; r: number }
  | { kind: 'ellipsoid'; p: V3; r: V3 }
  | { kind: 'capsule'; a: V3; b: V3; ra: number; rb: number };

export interface Part {
  name: string;
  prim: Prim;
  /** Smooth-union (or smooth-subtract) radius against everything before it. */
  blend: number;
  /** Carve this primitive OUT of the accumulated field instead of adding it. */
  carve?: boolean;
  /**
   * This part is MANDIBLE MASS, so it swings on the jaw hinge. Only additive
   * parts may carry it; a carved part removes mass and cannot define where
   * mass is.
   *
   * Membership is resolved by distance to the union of the parts flagged here
   * — NOT by a height threshold. A height threshold is what the first version
   * used, and because "below the chin" is also true of the neck, the shoulders
   * and the entire chest, opening the mouth rotated the whole torso eleven
   * centimetres about a line through the ears. Nothing caught it because a
   * headless browser has no speech voices, so the mouth never opened in any
   * test that took a screenshot.
   */
  jaw?: boolean;
}

/** Emit a part and its mirror image across the YZ plane. */
function mirrored(name: string, part: Omit<Part, 'name'>): Part[] {
  const flipV = (v: V3): V3 => [-v[0], v[1], v[2]];
  const flip = (p: Prim): Prim => {
    switch (p.kind) {
      case 'sphere':
        return { ...p, p: flipV(p.p) };
      case 'ellipsoid':
        return { ...p, p: flipV(p.p) };
      case 'capsule':
        return { ...p, a: flipV(p.a), b: flipV(p.b) };
    }
  };
  return [
    { ...part, name: `${name}L` },
    { ...part, name: `${name}R`, prim: flip(part.prim) },
  ];
}

/**
 * THE BUST. Units are metres; the figure is authored at human scale about its
 * own origin, standing on y = 0, facing +Z.
 *
 * ORDER MATTERS. Each part is blended against the accumulation of everything
 * before it, so the cranium must exist before the brow can sit on it and the
 * sockets must be carved after the mass they are carved from.
 */
export const BUST_PARTS: Part[] = [
  // ---- skull ---------------------------------------------------------------
  {
    name: 'cranium',
    prim: { kind: 'ellipsoid', p: [0, 1.652, -0.012], r: [0.077, 0.092, 0.094] },
    blend: 0,
  },
  {
    // The facial block: narrower and shallower than the cranium, set forward.
    // The step between the two is the temple.
    name: 'faceBlock',
    prim: { kind: 'ellipsoid', p: [0, 1.594, 0.024], r: [0.0735, 0.076, 0.081] },
    blend: 0.040,
  },
  {
    // Superciliary arches. Buried at the midline and proud at the sides, which
    // is both what a brow actually does and what casts the shadow that tells
    // you where the eyes are before you can see them.
    name: 'brow',
    prim: { kind: 'capsule', a: [-0.058, 1.6355, 0.070], b: [0.058, 1.6355, 0.070], ra: 0.0155, rb: 0.0155 },
    blend: 0.020,
  },
  ...mirrored('cheek', {
    prim: { kind: 'ellipsoid', p: [0.0505, 1.5835, 0.049], r: [0.034, 0.038, 0.044] },
    blend: 0.028,
  }),
  {
    name: 'noseBridge',
    prim: { kind: 'capsule', a: [0, 1.628, 0.074], b: [0, 1.5885, 0.0995], ra: 0.0105, rb: 0.016 },
    blend: 0.013,
  },
  {
    name: 'noseTip',
    prim: { kind: 'sphere', p: [0, 1.5805, 0.1055], r: 0.0180 },
    blend: 0.011,
  },
  ...mirrored('ala', {
    prim: { kind: 'sphere', p: [0.0145, 1.5775, 0.0925], r: 0.0120 },
    blend: 0.010,
  }),

  // ---- mandible ------------------------------------------------------------
  // Two rami running from the hinge down to the chin, bridged under it. This
  // is the part that swings.
  ...mirrored('ramus', {
    prim: { kind: 'capsule', a: [0.0665, 1.5955, -0.030], b: [0.0225, 1.5245, 0.061], ra: 0.0265, rb: 0.0225 },
    blend: 0.020,
    jaw: true,
  }),
  {
    name: 'jawBody',
    prim: { kind: 'capsule', a: [-0.0235, 1.5245, 0.060], b: [0.0235, 1.5245, 0.060], ra: 0.0235, rb: 0.0235 },
    blend: 0.018,
    jaw: true,
  },
  {
    name: 'chin',
    prim: { kind: 'sphere', p: [0, 1.5215, 0.070], r: 0.0275 },
    blend: 0.022,
    jaw: true,
  },

  // ---- neck and shoulders --------------------------------------------------
  {
    name: 'neck',
    prim: { kind: 'capsule', a: [0, 1.560, -0.026], b: [0, 1.402, -0.020], ra: 0.044, rb: 0.056 },
    blend: 0.022,
  },
  ...mirrored('sterno', {
    // Sternocleidomastoid. Two cords running from behind the ear to the notch;
    // without them a neck is a pipe.
    prim: { kind: 'capsule', a: [0.036, 1.566, -0.012], b: [0.014, 1.398, 0.034], ra: 0.011, rb: 0.014 },
    blend: 0.018,
  }),
  ...mirrored('trap', {
    prim: { kind: 'capsule', a: [0, 1.470, -0.030], b: [0.120, 1.352, -0.020], ra: 0.030, rb: 0.052 },
    blend: 0.030,
  }),
  {
    name: 'shoulders',
    prim: { kind: 'capsule', a: [-0.132, 1.338, -0.006], b: [0.132, 1.338, -0.006], ra: 0.064, rb: 0.064 },
    blend: 0.030,
  },
  ...mirrored('deltoid', {
    // 480 mm across the shoulders, not 546. The old pair stood 90 mm proud of
    // a 272 mm chest, which reads as shoulder pads rather than as deltoids.
    prim: { kind: 'capsule', a: [0.140, 1.330, 0], b: [0.172, 1.245, 0], ra: 0.068, rb: 0.060 },
    blend: 0.034,
  }),
  ...mirrored('clavicle', {
    prim: { kind: 'capsule', a: [0.012, 1.356, 0.042], b: [0.112, 1.342, 0.014], ra: 0.012, rb: 0.015 },
    blend: 0.014,
  }),

  // ---- chest ---------------------------------------------------------------
  // THE TORSO IS TWO CAPSULES, NOT ONE.
  //
  // A capsule has a circular cross-section, so one wide enough to read as a
  // chest (±180 mm) is also 360 mm deep — and its front face then sits further
  // forward than the nose, which looks exactly as wrong as it sounds. A pair
  // set either side of the midline gives the width without the depth, and the
  // shallow valley where they meet is the sternum.
  //
  // They run off the bottom of the frame instead of ending, because a chest
  // that ENDS is a bust on a plinth.
  ...mirrored('torso', {
    prim: { kind: 'capsule', a: [0.070, 1.320, -0.012], b: [0.076, 0.62, -0.008], ra: 0.098, rb: 0.106 },
    blend: 0.075,
  }),
  ...mirrored('pec', {
    prim: { kind: 'ellipsoid', p: [0.054, 1.245, 0.046], r: [0.076, 0.056, 0.048] },
    blend: 0.036,
  }),

  // ---- carved ---------------------------------------------------------------
  // Everything below is SUBTRACTED, and everything below is why the figure has
  // a face at all.
  ...mirrored('socket', {
    // SMALLER AND SHALLOWER than they were. At 30x21x28 mm, carved 18 mm deep
    // and only 12 mm apart at their inner edges, the two recesses merged
    // across the bridge of the nose into a single dark band — the figure
    // appeared to be wearing sunglasses, and the nose disappeared into the
    // middle of them. Pulled apart, shrunk, and made shallower so each is its
    // own socket with lit bone between them.
    prim: { kind: 'ellipsoid', p: [0.0395, 1.6065, 0.084], r: [0.0255, 0.0175, 0.023] },
    blend: 0.014,
    carve: true,
  }),
  {
    // The lip groove. Shallow — it is a seam for the mouth light to live in,
    // not an opening. The mouth OPENS by hinging the mandible.
    name: 'lipSeam',
    prim: { kind: 'capsule', a: [-0.024, 1.5545, 0.092], b: [0.024, 1.5545, 0.092], ra: 0.0075, rb: 0.0075 },
    blend: 0.010,
    carve: true,
  },
  {
    name: 'sternumGroove',
    prim: { kind: 'capsule', a: [0, 1.300, 0.082], b: [0, 1.170, 0.086], ra: 0.016, rb: 0.022 },
    blend: 0.030,
    carve: true,
  },

  // ---- the eyes themselves --------------------------------------------------
  // Added back AFTER the sockets are carved, so each sits in its own recess
  // with a rim of brow and cheek around it. Their front pole is the only place
  // on this figure where a light is allowed to live.
  ...mirrored('eyeball', {
    prim: { kind: 'sphere', p: [0.0395, 1.6048, 0.0685], r: 0.0155 },
    blend: 0.008,
  }),
];

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
  /** A point on the hinge axis — level with the top of the ramus. */
  pivot: [0, 1.5955, -0.030] as V3,
  /** The axis itself: ear to ear, i.e. +X. */
  axis: [1, 0, 0] as V3,
  /** Radians at full openness. Small — a mechanism, not a membrane. */
  maxAngle: 0.20,
  /**
   * Jaw membership falls off over this distance from the mandible's own field.
   * See `Part.jaw` for why membership is a distance and not a height.
   */
  feather: 0.030,
  /** The lip seam, in the figure's local frame. The light lives HERE only. */
  seam: { y: 1.5545, z: 0.092, halfWidth: 0.024 },
  /**
   * Openness is held to five discrete steps. A continuous jaw reads as rubber;
   * quantising it reads as a machine deciding how far to open.
   */
  steps: 5,
} as const;

/**
 * Where the eye lights sit: the FRONT POLE of each eyeball, which is a point
 * the bake can actually put beads on. Derived from the eyeball part rather
 * than restated, so moving the eye moves its light.
 */
const EYEBALL = BUST_PARTS.find((p) => p.name === 'eyeballR')!.prim as {
  kind: 'sphere';
  p: V3;
  r: number;
};

export const EYES = {
  left: [-EYEBALL.p[0], EYEBALL.p[1], EYEBALL.p[2] + EYEBALL.r] as V3,
  right: [EYEBALL.p[0], EYEBALL.p[1], EYEBALL.p[2] + EYEBALL.r] as V3,
  /** Cluster radius. One bead in thirty thousand is not a visible eye. */
  gather: 0.0085,
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
  palm: { a: [0, 0, 0], b: [0, 0.085, 0.004], ra: 0.040, rb: 0.044 },
  /** Thenar eminence — the mass at the base of the thumb. */
  thenar: { a: [-0.026, 0.012, 0.012], b: [-0.030, 0.045, 0.014], ra: 0.024, rb: 0.020 },
  /** Forearm, running off the bottom of the frame. */
  forearm: { a: [0, -0.02, 0], b: [0, -0.30, -0.02], ra: 0.038, rb: 0.050 },
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
