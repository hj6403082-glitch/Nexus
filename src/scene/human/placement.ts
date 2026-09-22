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
  // The eye plane (bust-local y 1.6045, z 0.0855) lands at world (0, 0.16, 0.28).
  //
  // Close, and level with the camera rather than above it. Further out the head
  // was a sixth of the frame and the chest was most of the rest — a whole
  // figure seen from across a room, not something addressing you. Moving it in
  // does not change the head-to-shoulder ratio, but it does put the eyes on the
  // camera's own axis and run the chest off the bottom edge, which is the
  // difference between a portrait and an inventory photograph.
  m.premultiply(new THREE.Matrix4().makeTranslation(0, 0.16 - 1.6045, 0.28 + 0.0855));
  return m;
})();

export const FIGURE_NORMAL_MATRIX = new THREE.Matrix3().setFromMatrix4(FIGURE_PLACEMENT);

/** The gathering point, in world space — in front of the camera, not on it. */
export const CORE = new THREE.Vector3(0, 0.18, 0.40);

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
