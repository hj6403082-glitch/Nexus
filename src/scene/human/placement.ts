import * as THREE from 'three';

/**
 * WHERE THE FIGURE STANDS.
 *
 * Separated from the component so the invariant below can be asserted without
 * instantiating a renderer. It is a matrix and a question about that matrix;
 * neither needs React.
 *
 * The bust is authored at human scale about its own origin, standing on y = 0.
 * The ring's camera sits at roughly y = 0.12 INSIDE the ring, so a figure left
 * at its authored origin is standing on top of the camera. It has to be moved
 * out in front and dropped to eye level.
 */

export const FIGURE_PLACEMENT = (() => {
  /**
   * IT HAS TO BE TURNED AROUND.
   *
   * The bust is authored facing +Z, and the ring's camera looks along +Z from
   * behind it — so a placement that only translates presents the BACK OF ITS
   * HEAD to the viewer. That is what shipped: the face was there the whole
   * time, pointing away.
   *
   * Nothing caught it because the first bust was eight spheres and capsules
   * with no front-back asymmetry to speak of, so its back and its face
   * rendered identically. The moment the face gained a nose, a brow and two
   * sockets, the bug became the only thing you could see — the figure had
   * structure and none of it was facing the room.
   *
   * `figureFacesCamera()` below is the assertion that keeps it turned around.
   */
  const m = new THREE.Matrix4().makeRotationY(Math.PI);
  /**
   * The eye plane (bust-local y 1.6045, z 0.0855) lands at world (0, 0.15, 0.07).
   *
   * Close, and level with the camera rather than above it. Further out the head
   * was a sixth of the frame and the chest was most of the rest — a whole
   * figure seen from across a room, not something addressing you. Moving it in
   * does not change the head-to-shoulder ratio, but it does put the eyes on the
   * camera's own axis and run the chest off the bottom edge, which is the
   * difference between a portrait and an inventory photograph.
   *
   * At 0.42 m from the camera at a 54 degree field of view, the frame is
   * 0.43 m tall and the head is 0.21 m of it — very nearly half. That is the
   * framing of the thing this is meant to look like. The previous 0.60 m put
   * the head at under a third and gave the remaining two thirds to a chest
   * that carries no information.
   */
  m.premultiply(new THREE.Matrix4().makeTranslation(0, 0.15 - 1.6045, 0.07 + 0.0855));
  return m;
})();

/**
 * WHERE THE EYES ARE, IN THE ROOM.
 *
 * Derived from the placement rather than written down beside it, because two
 * places that both claim to know where the figure is will disagree the first
 * time one of them moves. The rig frames the portrait from this, so moving the
 * figure moves the shot with it.
 */
export const FIGURE_EYES = new THREE.Vector3(0, 1.6045, 0.0855).applyMatrix4(
  (() => FIGURE_PLACEMENT)(),
);

/**
 * How far in front of the eyes the camera stands once the figure is present.
 *
 * At a 54 degree field of view this makes the frame 0.43 m tall and the head
 * 0.21 m of it — very nearly half. Closer and the crown leaves the top of the
 * frame; further and it becomes a figure seen across a room.
 */
export const PORTRAIT_DISTANCE = 0.42;

export const FIGURE_NORMAL_MATRIX = new THREE.Matrix3().setFromMatrix4(FIGURE_PLACEMENT);

/**
 * The gathering point, in world space — in front of the camera, not on it.
 *
 * It sits where the HEAD will be. The beads collapse here and then open out
 * into the figure, so a core behind the figure's own face means the cloud
 * gathers behind the thing it is about to become and every particle has to
 * come forward past it. When the figure moved in to portrait framing this was
 * left at 0.24 and ended up a hand's breadth behind the back of the skull.
 */
export const CORE = new THREE.Vector3(0, 0.15, 0.09);

/**
 * The figure's nose must end up NEARER the camera than the back of its skull.
 *
 * Exported so the verification suite can state the invariant rather than
 * hoping a screenshot catches it. The camera sits behind the origin looking
 * toward +Z, so "nearer" means a smaller world z.
 */
export function figureFacesCamera(): boolean {
  const nose = new THREE.Vector3(0, 1.5805, 0.1235).applyMatrix4(FIGURE_PLACEMENT);
  const occiput = new THREE.Vector3(0, 1.652, -0.106).applyMatrix4(FIGURE_PLACEMENT);
  return nose.z < occiput.z;
}
