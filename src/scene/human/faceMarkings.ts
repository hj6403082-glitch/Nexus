/**
 * FINE FACE DETAIL, IN SHADING RATHER THAN IN GEOMETRY.
 *
 * The mouth line went through five geometric versions and broke in a different
 * way each time. A carve has to reach the surface to cut it and must not reach
 * far past it, and the face is a curve — so a seam placed to nick the midline
 * missed the corners, one placed to reach the corners gouged a slot through
 * the middle, and one raked to follow the curve fell apart the moment anything
 * behind it moved by two millimetres. Every attempt was a carve whose
 * correctness depended on the exact position of a surface that five other
 * primitives were jointly deciding.
 *
 * So the division of labour moved. GEOMETRY carries form — the things that
 * have to occlude, catch light and cast shadow, like the brow, the nose and
 * the cheekbones. SHADING carries line work — the mouth, the nostrils, the
 * brow line. A drawn line cannot fragment, cannot gouge, costs nothing, and
 * does not care what the surface under it is doing.
 *
 * It is also what a mask actually is. The features here are painted on because
 * this is a made object, not a scanned person.
 *
 * Emitted as one GLSL function so the app's raymarcher and the standalone face
 * preview share it and cannot drift apart.
 */

/** Where the mouth line sits, in the figure's own frame. Metres. */
export const MOUTH = {
  y: 1.5545,
  halfWidth: 0.0246,
  /** How far the corners rise relative to the centre. */
  arc: 0.0016,
} as const;

/**
 * `faceMarkings(p, n, colour)` darkens `colour` where the line work falls.
 *
 * Every mark is gated on facing forward AND on being in front of the ear line,
 * because the same (x, y) occurs again on the back of the skull and an
 * ungated mark draws a second mouth across the occiput.
 */
export const FACE_MARKINGS_GLSL = /* glsl */ `
vec3 faceMarkings(vec3 p, vec3 n, vec3 colour) {
  float front = step(0.030, p.z) * smoothstep(0.0, 0.35, n.z);
  if (front <= 0.0) return colour;

  // ---- the mouth -----------------------------------------------------------
  float mx = clamp(p.x / ${MOUTH.halfWidth.toFixed(4)}, -1.0, 1.0);
  // A slight upward curve at the corners. Dead straight reads as a slot cut
  // with a saw; this is the difference between a mouth and a mail slot.
  float lineY = ${MOUTH.y.toFixed(4)} + ${MOUTH.arc.toFixed(4)} * mx * mx;
  float across = 1.0 - smoothstep(0.80, 1.0, abs(mx));
  float mouth = (1.0 - smoothstep(0.0007, 0.0024, abs(p.y - lineY))) * across * front;

  // ---- the nostrils --------------------------------------------------------
  vec2 nostril = vec2(abs(p.x) - 0.0082, p.y - 1.5712);
  float nose = (1.0 - smoothstep(0.0022, 0.0052, length(nostril * vec2(1.0, 1.45)))) * front;

  // ---- the orbital crease --------------------------------------------------
  // NOT an eyebrow. It is the shadow where the orbital rim turns under, and it
  // has to hug the top of the socket — held 7 mm clear of it, as it first was,
  // two straight dashes float above the eyes and read as pencilled-on brows.
  // Tapered at both ends, because a crease that stops abruptly is a mark.
  float bx = clamp(abs(p.x) / 0.0465, 0.0, 1.0);
  float browY = 1.6112 - 0.0038 * bx * bx;
  float browTaper = smoothstep(0.10, 0.34, bx) * (1.0 - smoothstep(0.66, 1.0, bx));
  float brow = (1.0 - smoothstep(0.0010, 0.0038, abs(p.y - browY))) * browTaper * front;

  colour *= mix(1.0, 0.16, mouth);
  colour *= mix(1.0, 0.22, nose);
  colour *= mix(1.0, 0.52, brow);
  return colour;
}
`;
