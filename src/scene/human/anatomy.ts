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

import { MOUTH } from './faceMarkings';

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
  /**
   * THE HEAD — A MASK, NOT A RECONSTRUCTION.
   *
   * Five passes were spent trying to sculpt a naturalistic face out of blended
   * primitives, and each one traded a deformity for a different deformity: the
   * nasion carve that fixed the profile bored a third eye socket in the
   * forehead; widening it turned that into a visor slot; the lip masses that
   * gave the mouth substance read as a muzzle, and the seam that made the
   * mouth visible read as a letterbox. The version with the most anatomy in it
   * was the one that looked most diseased.
   *
   * That is not bad luck, it is the medium. A viewer's tolerance for error in
   * a human face is about a millimetre, and every smooth-minimum here is a
   * surface that bulges by a fraction of its blend radius in a direction
   * nobody chose. Naturalism is the one target this technique cannot hit, and
   * aiming at it and missing lands squarely in the uncanny valley — which is
   * precisely where "disgusting" comes from.
   *
   * So the target moved. This is a MASK: a classical bust, an Oscar, a helmet.
   * Smooth planes, exact proportions, and deliberately few features — no
   * nostrils, no lip masses, no lids, no ears. What is left is the structure
   * that carries light: a brow, two cheekbones, a nose ridge, a jaw, and two
   * eyes. Nothing in it is trying to pass for a person, so nothing in it can
   * fail to.
   *
   * The proportions are anthropometric even though the surface is not: head
   * 210 mm crown to chin, 155 mm wide, eyes on the vertical midline 63 mm
   * apart, nose base a third of the way from eyes to chin. Those are what make
   * a stylised head read as elegant instead of as approximate.
   */
  {
    // Lower and deeper than a human skull rather than taller. Real skulls are
    // hidden by hair; this one is bare, so its proportions have to work naked.
    name: 'cranium',
    prim: { kind: 'ellipsoid', p: [0, 1.6300, -0.0075], r: [0.0778, 0.0792, 0.0955] },
    blend: 0,
  },
  {
    // The frontal bone. Without it the forehead is just the front of the
    // cranium sphere, 12 mm behind the brow — an ape's profile.
    name: 'forehead',
    prim: { kind: 'ellipsoid', p: [0, 1.6535, 0.0248], r: [0.0655, 0.0455, 0.0638] },
    blend: 0.020,
  },
  {
    // The facial block, set back from the nose so the nose can project past
    // it. When these were at the same depth the whole lower face fused into a
    // single forward mass with two holes in it.
    name: 'faceBlock',
    prim: { kind: 'ellipsoid', p: [0, 1.5905, 0.0155], r: [0.0705, 0.0765, 0.0785] },
    blend: 0.026,
  },
  ...mirrored('brow', {
    /**
     * AN ARCH, and only 3 mm of it.
     *
     * Two things were wrong with the bar this replaces. It was seventeen
     * millimetres inside the face block — measured, not guessed — so every
     * earlier attempt to "make the brow heavier" was adjusting a primitive
     * that was not on the surface at all. And when it was finally brought out,
     * a single capsule at constant height protruded by the same amount along
     * its whole length and read as a Neanderthal ledge across the forehead.
     *
     * A real brow arches: highest and most proud above the pupil, falling away
     * and back toward the temple. Two segments do that, and three millimetres
     * of relief is enough — a heavy brow is the fastest route to a scowl, and
     * a mask that scowls is a gargoyle.
     */
    prim: { kind: 'capsule', a: [0.0055, 1.6272, 0.0808], b: [0.0508, 1.6208, 0.0730], ra: 0.0132, rb: 0.0108 },
    blend: 0.012,
  }),
  ...mirrored('cheek', {
    // High and wide. This is the plane the key rakes across, and in a face
    // with this little detail it does most of the work of reading as a face.
    prim: { kind: 'ellipsoid', p: [0.0512, 1.5915, 0.0372], r: [0.0318, 0.0332, 0.0418] },
    blend: 0.020,
  }),
  {
    name: 'noseBridge',
    // Starts BELOW and BEHIND the brow, so the saddle between them is where
    // the two primitives simply do not reach rather than somewhere a carve had
    // to be dug. Every attempt to dig it — sphere, saddle, slot — read as a
    // hole in the forehead, because a shallow carve on a convex surface has a
    // visible edge and a visible edge on a face is a scar.
    prim: { kind: 'capsule', a: [0, 1.6095, 0.0668], b: [0, 1.5788, 0.0958], ra: 0.0054, rb: 0.0090 },
    blend: 0.009,
  },
  {
    // The tip, and nothing else. No wings, no nostrils — both were carves or
    // near-carves beside a convex form, and both raised rims.
    // NARROWER. As a 23 mm ball on the end of a ridge it read as a bulb stuck
    // on the face; an ellipsoid flattened in X and drawn out in Z is a tip.
    name: 'noseTip',
    prim: { kind: 'ellipsoid', p: [0, 1.5765, 0.0952], r: [0.0092, 0.0105, 0.0128] },
    blend: 0.009,
  },

  // ---- mandible ------------------------------------------------------------
  // Two rami running from the hinge down to the chin, bridged under it. This
  // is the part that swings when it speaks.
  ...mirrored('ramus', {
    prim: { kind: 'capsule', a: [0.0648, 1.5915, -0.0300], b: [0.0206, 1.5372, 0.0520], ra: 0.0252, rb: 0.0202 },
    blend: 0.014,
    jaw: true,
  }),
  {
    name: 'jawBody',
    prim: { kind: 'capsule', a: [-0.0218, 1.5372, 0.0508], b: [0.0218, 1.5372, 0.0508], ra: 0.0214, rb: 0.0214 },
    blend: 0.014,
    jaw: true,
  },
  {
    // Set back from the mouth by about 8 mm, as a real one is. Level with it,
    // the lower face becomes one plane and reads as a jutting jaw.
    name: 'chin',
    prim: { kind: 'ellipsoid', p: [0, 1.5352, 0.0578], r: [0.0242, 0.0225, 0.0252] },
    blend: 0.016,
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
    /**
     * THE ARM RUNS OFF THE BOTTOM OF THE FRAME. IT DOES NOT END.
     *
     * This was a stub: a capsule from the shoulder down to y = 1.245 and then
     * nothing. A capsule that stops is a hemisphere, so each shoulder finished
     * in a ball standing 50 mm proud of a torso that then narrowed below it —
     * two balloons tied to the sides of the chest, and the single worst thing
     * on the figure.
     *
     * The torso already knew this: it runs to y = 0.62 and off the frame,
     * because a chest that ENDS is a bust on a plinth. The same is true of an
     * arm. So the deltoid is now an upper arm, tapering gently the way one
     * does and leaving the picture rather than closing over.
     */
    prim: { kind: 'capsule', a: [0.138, 1.332, 0], b: [0.170, 0.62, 0.004], ra: 0.062, rb: 0.052 },
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
    // Flatter in Z than it was. At 48 mm of forward relief each pec stood off
    // the torso as a dome, and a pair of domes on a chest reads as a breast,
    // not as a muscle. A pectoral is a broad shallow plane; 32 mm gives the
    // plane the key can rake across without giving it a horizon.
    prim: { kind: 'ellipsoid', p: [0.054, 1.245, 0.040], r: [0.078, 0.058, 0.032] },
    blend: 0.040,
  }),

  // ---- carved ---------------------------------------------------------------
  // THREE, and all of them shallow. Every carve beside a convex form raises a
  // rim around itself, so each one here is the smallest that still reads.
  ...mirrored('socket', {
    // 34 x 18 mm and 13 mm deep. A human eye opening is about 30 x 11 mm; the
    // first version of this was 50 x 34 and set 76 mm apart, which is the
    // caricature that reads as "alien grey" and was doing it single-handed.
    prim: { kind: 'ellipsoid', p: [0.0315, 1.6012, 0.0800], r: [0.0170, 0.0092, 0.0132] },
    blend: 0.0060,
    carve: true,
  }),
  // The mouth is not carved. It is DRAWN — see `faceMarkings.ts`. Five
  // geometric versions of this seam each broke differently, because a carve
  // has to reach a surface that five other primitives are jointly deciding.
  /**
   * THE STERNUM IS NOT CARVED EITHER.
   *
   * It was, and it did what the file says every carve beside a convex form
   * does: it raised a rim around itself. Between two pec domes that rim became
   * a ridge running down the middle of the chest — a mound where a valley was
   * meant to be, which is the opposite of the intent.
   *
   * The two torso capsules already meet in a shallow valley at the midline,
   * and the pecs sit either side of it. That valley is the sternum. Nothing
   * needs to be dug for it, and digging for it was making it worse.
   */

  // ---- the eyes themselves --------------------------------------------------
  // Added back AFTER the sockets are carved, so each sits in its own recess.
  // No lids: a lid is two more rims around an eye that already has one, and
  // together they read as goggles.
  ...mirrored('eyeball', {
    prim: { kind: 'sphere', p: [0.0315, 1.6000, 0.0648], r: 0.0105 },
    blend: 0.0045,
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
  /**
   * Where the mouth is, re-exported from `faceMarkings.ts` so there is one
   * statement of it. The mouth is drawn rather than carved — see that file —
   * and the beads' seam glow has to light the same line the surface draws, or
   * the two disagree by a few millimetres during the cross-fade.
   */
  seam: { y: MOUTH.y, z: 0.0800, halfWidth: MOUTH.halfWidth },
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
