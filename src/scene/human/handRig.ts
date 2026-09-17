import * as THREE from 'three';
import { HAND, HAND_HINGE_COUNT } from './anatomy';

/**
 * THE HAND RIG.
 *
 * Two things are computed here, both on the CPU, both once per frame.
 *
 * 1. THE HINGE MATRICES. Every knuckle in `anatomy.ts` is a hinge. One `curl`
 *    uniform drives all of them through their per-joint gains, and the
 *    rotations are ACCUMULATED DOWN EACH CHAIN so a distal joint inherits its
 *    parents — which is what a finger is. Because each bead is rotated
 *    rigidly by its own bone's matrix, curling the hand cannot tear the
 *    surface, exactly as with the jaw.
 *
 * 2. THE WRIST POSE, FROM SCREEN-SPACE TARGETS. The hand is placed by
 *    unprojecting a target in NDC, not by a world-space position. The gesture
 *    has to land in the same place on screen whatever the camera is doing —
 *    and the camera is doing something, because the rig drifts and pushes.
 *    Authoring it in world space means the hand wanders out of frame the
 *    moment the camera moves.
 */

export interface HandPose {
  /** One matrix per hinge, in the order the fingers are declared. */
  hinges: THREE.Matrix4[];
  /** Hand-local → world. */
  world: THREE.Matrix4;
  /** Where the held panel's centre sits, in screen space (0..1). */
  anchor: { x: number; y: number };
}

/**
 * Screen-space keyframes. NDC, y up — and the z matters more than it looks.
 *
 * NDC z is not linear in distance. With this camera (near 0.05, far 80), z =
 * 0.58 unprojects to about 24 CENTIMETRES from the lens, which put a hand the
 * size of the room in front of the figure. z ≈ 0.91 is a little over a metre
 * out, which is where a hand held up to present something actually is.
 */
const RETRACTED = { x: -0.40, y: -1.65, z: 0.914 };
const PRESENTING = { x: -0.46, y: -0.40, z: 0.908 };
/**
 * Where the panel's BOTTOM EDGE sits, in the hand's local frame.
 *
 * Just clear of the fingertips (which reach y ≈ 0.20). Anchoring the panel's
 * centre on the palm instead put a 340-pixel opaque DOM panel directly over
 * the hand — and the panel always wins, because it is DOM and the hand is
 * canvas. The gesture was happening, perfectly, underneath it.
 */
const PALM_OFFSET = new THREE.Vector3(0.0, 0.235, 0.02);

export class HandRig {
  readonly hinges: THREE.Matrix4[] = Array.from(
    { length: HAND_HINGE_COUNT },
    () => new THREE.Matrix4(),
  );
  readonly world = new THREE.Matrix4();

  private position = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private scale = new THREE.Vector3(1, 1, 1);
  private scratch = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private pivot = new THREE.Vector3();
  private local = new THREE.Matrix4();

  /**
   * @param rise 0 = retracted below the frame, 1 = presenting.
   * @param curl 0 = fingers open (released), 1 = cupped around the panel.
   */
  update(camera: THREE.Camera, rise: number, curl: number): { x: number; y: number } {
    // --- wrist, from screen space -----------------------------------------
    const t = rise;
    this.scratch.set(
      RETRACTED.x + (PRESENTING.x - RETRACTED.x) * t,
      RETRACTED.y + (PRESENTING.y - RETRACTED.y) * t,
      RETRACTED.z + (PRESENTING.z - RETRACTED.z) * t,
    );
    this.scratch.unproject(camera);
    this.position.copy(this.scratch);

    // The palm basis is interpolated between the two poses as well: the hand
    // rolls open as it rises, rather than arriving flat and then rotating.
    const tilt = THREE.MathUtils.lerp(-1.15, -0.28, t);
    const yaw = THREE.MathUtils.lerp(0.55, 0.18, t);
    const euler = new THREE.Euler(tilt, yaw, THREE.MathUtils.lerp(0.4, 0.12, t));
    this.quaternion.setFromEuler(euler);

    const s = THREE.MathUtils.lerp(0.9, 1.0, t);
    this.scale.set(s, s, s);
    this.world.compose(this.position, this.quaternion, this.scale);

    // --- hinges -------------------------------------------------------------
    let h = 0;
    for (const finger of HAND.fingers) {
      // Accumulated parent transform for this chain.
      const chain = new THREE.Matrix4();
      for (let j = 0; j < finger.joints.length - 1; j++) {
        this.pivot.set(...finger.joints[j]).applyMatrix4(chain);
        this.axis.set(...finger.axis[j]).normalize();

        const angle = curl * finger.curlGain[j] * 1.15;
        this.local
          .makeTranslation(this.pivot.x, this.pivot.y, this.pivot.z)
          .multiply(new THREE.Matrix4().makeRotationAxis(this.axis, angle))
          .multiply(
            new THREE.Matrix4().makeTranslation(-this.pivot.x, -this.pivot.y, -this.pivot.z),
          );

        chain.premultiply(this.local);
        this.hinges[h++].copy(chain);
      }
    }
    for (; h < this.hinges.length; h++) this.hinges[h].identity();

    // --- publish the panel anchor, in screen space -------------------------
    this.scratch.copy(PALM_OFFSET).applyMatrix4(this.world).project(camera);
    return { x: (this.scratch.x + 1) * 0.5, y: (1 - this.scratch.y) * 0.5 };
  }
}

/**
 * Which hinge each baked hand point belongs to, and how strongly. Computed
 * once after the bake from the same joint table the field was emitted from.
 */
export function assignHandBones(positions: Float32Array, count: number): Float32Array {
  const bone = new Float32Array(count);
  const joints: { p: THREE.Vector3; index: number; radius: number }[] = [];

  let h = 0;
  for (const finger of HAND.fingers) {
    for (let j = 0; j < finger.joints.length - 1; j++) {
      joints.push({
        p: new THREE.Vector3(...finger.joints[j + 1]),
        index: h,
        radius: finger.radii[j + 1] * 3.2,
      });
      h++;
    }
  }

  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    p.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    let best = -1;
    let bestD = Infinity;
    for (const j of joints) {
      const d = p.distanceTo(j.p);
      // Only claim a point that is plausibly ON this segment; the palm and the
      // forearm must stay on the root transform or the whole hand curls.
      if (d < j.radius && d < bestD) {
        bestD = d;
        best = j.index;
      }
    }
    // -1 → the root. The shader treats a negative index as identity.
    bone[i] = best;
  }
  return bone;
}
