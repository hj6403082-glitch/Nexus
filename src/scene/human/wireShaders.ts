/**
 * THE NETWORK'S SHADERS, ON THEIR OWN.
 *
 * Held apart from the component for the same reason `placement.ts` is: so a
 * script can render the real thing without instantiating React, a renderer or
 * a scene graph. `scripts/preview-wire.ts` imports these, which means the
 * preview cannot drift from what the application draws — change a falloff here
 * and the preview shows that falloff.
 *
 * They are strings and nothing else. No imports, so importing them costs
 * nothing and drags nothing in.
 */

/**
 * Shared by both passes: place the point, and work out how much of the
 * silhouette it is on.
 */
export const SHARED_VERTEX = /* glsl */ `
precision highp float;

in vec3 aNormal;
in float aSeed;
in float aEye;

uniform mat4 uPlacement;
uniform mat3 uNormalMatrix;
uniform float uTime;
uniform float uReveal;
uniform float uLevel;

out float vSilhouette;
out float vDepth;
out float vKey;
out float vSeed;
out float vEye;

void main() {
  vec4 world = uPlacement * vec4(position, 1.0);
  vec3 n = normalize(uNormalMatrix * aNormal);

  vec4 mv = modelViewMatrix * world;
  vec3 toEye = normalize(-mv.xyz);
  vec3 nView = normalize(normalMatrix * n);

  /**
   * 1 on the contour, 0 where the surface faces the camera squarely. This is
   * the term that draws the profile, the brow and the jaw — the bright curves
   * that separate a head from a tangle of triangles.
   *
   * The exponent is a WIDTH. At 2.4 only the outer profile survived it and the
   * face inside was flat mesh; the brow, the side of the nose and the line of
   * the cheek all turn away from the camera sharply enough to light up, but
   * not sharply enough to beat that falloff. At 1.9 they do, and the interior
   * gets the feature curves the silhouette was already drawing on the outside.
   */
  vSilhouette = pow(1.0 - abs(dot(nView, toEye)), 1.9);

  // Nearer is brighter. Without this the far side of the skull competes with
  // the face and the whole figure flattens.
  //
  // The range is the figure's ACTUAL extent in front of the camera — the nose
  // lands at 0.56 and the back of the shoulders at 0.92 — not a guess. It was
  // guessed at first (0.18 to 0.80), which put the entire figure in the far
  // third of the ramp: every line came out at a third of its brightness and
  // the network read as a dim smudge with a bright outline.
  vDepth = clamp(1.0 - (-mv.z - 0.36) / 0.30, 0.0, 1.0);

  vKey = max(dot(n, normalize(vec3(-0.82, 0.50, 0.14))), 0.0);
  vSeed = aSeed;
  vEye = aEye;

  gl_Position = projectionMatrix * mv;
}
`;

/**
 * The nodes. Same placement and same silhouette term as the lines, plus a
 * screen-space size that falls off with distance so the far side of the head
 * does not produce dots the same size as the near side.
 */
export const NODE_VERTEX = /* glsl */ `
precision highp float;

in vec3 aNormal;
in float aSeed;
in float aEye;

uniform mat4 uPlacement;
uniform mat3 uNormalMatrix;
uniform float uTime;
uniform float uReveal;
uniform float uLevel;
uniform float uViewportHeight;

out float vSilhouette;
out float vDepth;
out float vKey;
out float vSeed;
out float vEye;

void main() {
  vec4 world = uPlacement * vec4(position, 1.0);
  vec3 n = normalize(uNormalMatrix * aNormal);

  vec4 mv = modelViewMatrix * world;
  vec3 toEye = normalize(-mv.xyz);
  vec3 nView = normalize(normalMatrix * n);

  vSilhouette = pow(1.0 - abs(dot(nView, toEye)), 1.9);
  vDepth = clamp(1.0 - (-mv.z - 0.36) / 0.30, 0.0, 1.0);
  vKey = max(dot(n, normalize(vec3(-0.82, 0.50, 0.14))), 0.0);
  vSeed = aSeed;
  vEye = aEye;

  // A fixed WORLD size, projected — so the dots keep their scale on the head
  // rather than staying a constant number of pixels as the figure moves.
  float radius = 0.0028 + 0.0012 * aEye;
  gl_PointSize = clamp(
    radius * 2.0 * projectionMatrix[1][1] * (uViewportHeight * 0.5) / max(-mv.z, 0.05),
    1.0,
    14.0
  );
  gl_Position = projectionMatrix * mv;
}
`;

export const LINE_FRAGMENT = /* glsl */ `
precision highp float;

in float vSilhouette;
in float vDepth;
in float vKey;
in float vSeed;
in float vEye;

uniform vec3 uLineColour;
uniform vec3 uEdgeColour;
uniform float uReveal;
uniform float uTime;
uniform float uLevel;

out vec4 fragColor;

void main() {
  /**
   * Distance enters as a RANGE, not as a multiplier.
   *
   * Multiplying BOTH the colour and the alpha by it squares the falloff, so a
   * line at the middle of the figure was drawn at a tenth of its brightness
   * and the mesh vanished into the backdrop. The far side has to recede, not
   * disappear — you are meant to see through the head to it.
   */
  float near = mix(0.34, 1.0, vDepth);

  // The body of the mesh, cool and always present.
  vec3 colour = uLineColour * (0.62 + 0.70 * vKey);

  // And the contour, which is where nearly all of the drawing happens.
  colour += uEdgeColour * vSilhouette * 1.85;

  // A slow travelling brightening, so the network reads as powered rather than
  // printed. Irregular rate, so it never settles into a pulse.
  float pulse = 0.5 + 0.5 * sin(vSeed * 23.7 + uTime * 1.35);
  colour *= 0.80 + 0.26 * pulse;

  // It brightens when it speaks.
  colour *= 1.0 + uLevel * 0.55;

  float alpha = (0.42 + vSilhouette * 0.58) * near * uReveal;
  fragColor = vec4(colour * near, clamp(alpha, 0.0, 1.0));
}
`;

export const NODE_FRAGMENT = /* glsl */ `
precision highp float;

in float vSilhouette;
in float vDepth;
in float vKey;
in float vSeed;
in float vEye;

uniform vec3 uNodeColour;
uniform float uReveal;
uniform float uTime;
uniform float uLevel;

out vec4 fragColor;

void main() {
  // Round, and soft at the rim. A square node reads as a rendering artefact.
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float core = 1.0 - smoothstep(0.0, 1.0, r);

  // Nodes twinkle individually. A third of them are noticeably brighter at any
  // moment, which is what gives the network its scattered-starfield quality
  // instead of looking like a regular grid of identical dots.
  float near = mix(0.34, 1.0, vDepth);
  float twinkle = 0.5 + 0.5 * sin(vSeed * 61.3 + uTime * 2.1);
  float bright = 0.62 + 0.46 * twinkle + 0.70 * vSilhouette;

  vec3 colour = uNodeColour * bright * (0.5 + 0.6 * vKey);

  /**
   * The eyes are a CONCENTRATION, not a light.
   *
   * At 2.6 they were four or five individual nodes at several times the
   * brightness of everything else, which on a mesh this sparse does not read
   * as an eye — it reads as damage. The gather radius is wider now and the
   * lift much smaller, so the region is denser and warmer than the face around
   * it and stops there. Nothing in the reference glows; the network is the
   * whole of the drawing.
   */
  colour += uNodeColour * vEye * 0.85;

  colour *= 1.0 + uLevel * 0.7;

  float alpha = core * (0.58 + 0.34 * twinkle + vEye * 0.45) * near * uReveal;
  fragColor = vec4(colour * near, clamp(alpha, 0.0, 1.0));
}
`;
