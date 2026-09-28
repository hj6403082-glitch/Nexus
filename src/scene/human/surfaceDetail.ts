/**
 * PLATING, SEAMS AND MACHINING MARKS.
 *
 * The figure went from a pale matte mass to a dark polished metal and still
 * got called a ghost. That is not the lighting failing — it is the fact that
 * "pale blue, glowing, perfectly smooth, floating in black" is the visual
 * vocabulary of an apparition, and every one of those four words was still
 * true. Making a ghost out of metal produces a metal ghost.
 *
 * Three things here, and between them they say MANUFACTURED:
 *
 *   SEAMS       A skull is one continuous surface. A helmet is panels, and
 *               panels have edges. A seam is the single most legible signal
 *               that a thing was made rather than apparated, because nothing
 *               organic and nothing spectral has one.
 *   MACHINING   A fine anisotropic perturbation of the normal. A perfect
 *               mirror is the least physical surface there is; every real
 *               metal has direction in its finish, and breaking the specular
 *               along one axis is what reads as brushed rather than as glass.
 *   WEAR        Slightly duller in the recesses, brighter on the edges the
 *               plating presents to the light — the way an object that exists
 *               in a world gets handled.
 *
 * All of it is drawn, not modelled, for the reason `faceMarkings.ts` gives at
 * length: a carve whose correctness depends on the exact position of a surface
 * six other primitives are jointly deciding will fragment the moment any of
 * them moves. A seam drawn from the hit position cannot.
 */

/** Emitted as GLSL so the app's raymarcher and the face preview share it. */
export const SURFACE_DETAIL_GLSL = /* glsl */ `
// Cheap 3D value noise, for the machining. Deliberately not the same hash the
// room uses — two surfaces sharing a noise basis end up sharing its artefacts.
float sdHash(vec3 p) {
  p = fract(p * 0.1031 + vec3(0.11, 0.37, 0.71));
  p += dot(p, p.yzx + 27.19);
  return fract((p.x + p.y) * p.z);
}

float sdNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(sdHash(i + vec3(0,0,0)), sdHash(i + vec3(1,0,0)), f.x),
        mix(sdHash(i + vec3(0,1,0)), sdHash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(sdHash(i + vec3(0,0,1)), sdHash(i + vec3(1,0,1)), f.x),
        mix(sdHash(i + vec3(0,1,1)), sdHash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}

/**
 * How near this point is to a panel edge. 1 on the seam, 0 away from it.
 *
 * The seams are placed where a helmet's would be, not where a skull's sutures
 * are: a crown plate, a band above the ear line, a collar, and a shoulder
 * break. Each is a distance to a simple surface, so none of them can fragment.
 */
float panelSeams(vec3 p) {
  float seam = 0.0;

  // Crown plate: a band around the skull, above the brow and behind the face.
  float crown = abs(length((p - vec3(0.0, 1.6300, -0.0075)) / vec3(0.0800, 0.0830, 0.1000)) - 0.965);
  seam = max(seam, (1.0 - smoothstep(0.004, 0.020, crown)) * smoothstep(1.638, 1.660, p.y));

  // Sagittal line over the top, front to back. Stops before the forehead.
  float sagittal = abs(p.x);
  seam = max(seam, (1.0 - smoothstep(0.0012, 0.0042, sagittal))
                 * smoothstep(1.655, 1.678, p.y));

  // Temporal band, running above where an ear would be.
  float temporal = abs(p.y - (1.6180 - 0.055 * abs(p.x)));
  seam = max(seam, (1.0 - smoothstep(0.0014, 0.0046, temporal))
                 * smoothstep(0.052, 0.070, abs(p.x)));

  // Collar, where the neck meets the chest.
  float collar = abs(length(vec2(p.x, p.z + 0.010) / vec2(0.062, 0.070)) - 1.0);
  seam = max(seam, (1.0 - smoothstep(0.02, 0.09, collar))
                 * (1.0 - smoothstep(0.004, 0.016, abs(p.y - 1.4180))));

  // Shoulder break, where the deltoid plate meets the chest plate.
  float shoulder = abs(length(vec2(abs(p.x) - 0.145, p.y - 1.3050) / vec2(0.075, 0.062)) - 1.0);
  seam = max(seam, (1.0 - smoothstep(0.02, 0.10, shoulder)) * step(0.060, abs(p.x)));

  return clamp(seam, 0.0, 1.0);
}

/**
 * Machining. Perturbs the normal along one axis so the specular streaks.
 *
 * Applied at two scales: a fine brushed grain, and a much broader undulation
 * that keeps large flat areas like the forehead and the chest from behaving
 * like a mirror.
 */
vec3 machined(vec3 p, vec3 n) {
  float grain = sdNoise(vec3(p.x * 420.0, p.y * 46.0, p.z * 420.0)) - 0.5;
  float broad = sdNoise(p * 58.0) - 0.5;

  // Perturb across the grain direction, which is what gives the streak a
  // direction instead of a sparkle.
  vec3 across = normalize(cross(n, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
  return normalize(n + across * grain * 0.055 + vec3(broad) * 0.020);
}
`;
