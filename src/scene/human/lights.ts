/**
 * THE LIGHT RIG, as data.
 *
 * Three directions in the figure's own frame, in one place because three
 * different things need them and they must agree: the bead material bakes cast
 * shadows against the key, the raymarched surface lights against all three,
 * and the standalone face preview has to reproduce the app's lighting exactly
 * or it is previewing something else.
 */

/**
 * The key: mostly from the SIDE, not from the front.
 *
 * The original vector had +0.42 of Z in it, and in the figure's own frame +Z
 * is the direction its face points — which is also where the camera is. A
 * light arriving from behind the viewer is the flattest light there is: it
 * fills every hollow it could have carved and leaves a uniformly lit mass with
 * no form on it. That is the technical description of the thing everyone kept
 * calling a ghost.
 *
 * Swung round to rake across the face instead. The lit planes and the shadow
 * now meet along a terminator running down the brow, the cheekbone and the
 * jaw, which is the line that tells a viewer the shape of a head.
 */
export const KEY_DIR: [number, number, number] = [-0.82, 0.50, 0.14];

/** Cool fill, opposite and low, so the shadow side is modelled not crushed. */
export const FILL_DIR: [number, number, number] = [0.70, -0.20, 0.35];

/** Tight rim from behind, to lift the silhouette off the background. */
export const RIM_DIR: [number, number, number] = [0.55, 0.28, -0.78];
