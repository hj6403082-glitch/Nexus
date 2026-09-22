import * as THREE from "three";

export interface BakeResult {
  positions: Float32Array; // xyz per point
  normals: Float32Array; // xyz per point
  count: number;
}

export interface BakeOptions {
  renderer: THREE.WebGLRenderer;
  /** GLSL declaring the field function. */
  glsl: string;
  /** The field function's name, e.g. `sdBust`. */
  fn: string;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Candidate count. Must exceed the final point count; ~4x is comfortable. */
  candidates: number;
  /** Rows of the bake texture to process per call. Keeps the frame under budget. */
  rowsPerChunk?: number;
  seed?: number;
}

/**
 * BAKE THE SURFACE ONCE.
 *
 * The naive approach is to evaluate the field per particle per frame and let
 * each particle walk toward the surface. That costs a full projection every
 * frame forever, it never quite settles (so the figure shimmers), and it is
 * completely wasted work because the figure does not deform — it is posed by
 * rigid hinges, which move points without moving the SURFACE they sit on.
 *
 * So: seed points in the bounding box, project them onto the isosurface with
 * Newton steps in a fragment shader, read the result back packed at 16 bits,
 * and from then on hold a static set of positions and normals. Per frame this
 * costs nothing and is perfectly still — which is exactly what "alive, not
 * animated" requires.
 *
 * The bake is a generator so the caller can spend one chunk per frame. A bake
 * that stalls the main thread for 400 ms is a bake the user watches happen.
 */
export function* bakeSurface(
  options: BakeOptions,
): Generator<number, BakeResult, void> {
  const { renderer, glsl, fn, bounds, candidates } = options;
  const rowsPerChunk = options.rowsPerChunk ?? 16;
  const seed = options.seed ?? 7;

  const size = Math.ceil(Math.sqrt(candidates));
  const target = makeTarget(renderer, size);
  const normalTarget = makeTarget(renderer, size);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  scene.add(quad);

  const common = /* glsl */ `
    precision highp float;
    ${glsl}
    uniform vec3 uMin;
    uniform vec3 uMax;
    uniform float uSize;
    uniform float uSeed;

    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec3 seedPoint(vec2 frag) {
      float a = hash(frag + uSeed);
      float b = hash(frag.yx * 1.7 + uSeed * 3.1);
      float c = hash(frag * 2.3 + uSeed * 7.7);
      return mix(uMin, uMax, vec3(a, b, c));
    }

    /**
     * The UNNORMALISED gradient, by central differences.
     *
     * The magnitude is the whole point. A field built from smooth minima is
     * not a true distance field: inside a blend, |grad| falls well below 1 and
     * the field UNDERSTATES how far away the surface is. A Newton step that
     * assumes |grad| = 1 therefore under-steps exactly where the blends are
     * widest — and the widest blend here is the 75 mm seam down the middle of
     * the chest, which is precisely where the figure had a vertical streak of
     * holes punched through it. The points were not missing because the
     * selection dropped them; they were missing because forty under-steps
     * never reached the tolerance and the projection marked them invalid.
     */
    vec3 fieldGradient(vec3 p) {
      const float e = 0.0008;
      return vec3(
        ${fn}(p + vec3(e, 0.0, 0.0)) - ${fn}(p - vec3(e, 0.0, 0.0)),
        ${fn}(p + vec3(0.0, e, 0.0)) - ${fn}(p - vec3(0.0, e, 0.0)),
        ${fn}(p + vec3(0.0, 0.0, e)) - ${fn}(p - vec3(0.0, 0.0, e))
      ) / (2.0 * e);
    }

    vec3 fieldNormal(vec3 p) { return normalize(fieldGradient(p)); }
  `;

  const projectMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uMin: { value: new THREE.Vector3(...bounds.min) },
      uMax: { value: new THREE.Vector3(...bounds.max) },
      uSize: { value: size },
      uSeed: { value: seed },
      uJawAngle: { value: 0 },
    },
    vertexShader: /* glsl */ `
      in vec3 position;
      void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      out vec4 fragColor;
      void main() {
        vec3 p = seedPoint(gl_FragCoord.xy);

        // The true Newton step for a scalar field: g * d / |g|^2. Dividing by
        // the gradient's own magnitude is what makes this converge inside a
        // blend as fast as it does on a bare sphere. Still damped slightly, to
        // stop it crossing into a neighbouring lobe and settling on the wrong
        // side of a seam.
        for (int i = 0; i < 48; i++) {
          float d = ${fn}(p);
          vec3 g = fieldGradient(p);
          float g2 = max(dot(g, g), 1e-4);
          if (abs(d) / max(sqrt(g2), 1e-3) < 0.00015) break;
          p -= g * (d / g2) * 0.9;
        }

        // Acceptance is measured in TRUE distance — the field value divided by
        // its own gradient — not in raw field units. Judging a blend region by
        // its raw value rejects points that are in fact on the surface.
        float d = ${fn}(p);
        vec3 g = fieldGradient(p);
        float trueDistance = abs(d) / max(length(g), 1e-3);
        // A point that failed to converge is marked invalid rather than kept:
        // a stray point inside the head is far more visible than a missing one.
        float ok = step(trueDistance, 0.0012);
        fragColor = vec4(p, ok);
      }
    `,
  });

  const normalMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uPositions: { value: target.texture },
      uMin: { value: new THREE.Vector3(...bounds.min) },
      uMax: { value: new THREE.Vector3(...bounds.max) },
      uSize: { value: size },
      uSeed: { value: seed },
      uJawAngle: { value: 0 },
    },
    vertexShader: /* glsl */ `
      in vec3 position;
      void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      uniform sampler2D uPositions;
      out vec4 fragColor;
      void main() {
        vec4 s = texelFetch(uPositions, ivec2(gl_FragCoord.xy), 0);
        fragColor = vec4(fieldNormal(s.xyz), s.w);
      }
    `,
  });

  /**
   * RENDERER STATE IS BORROWED, AND IT IS GIVEN BACK AT EVERY YIELD.
   *
   * This bake is chunked across frames, which means the main render loop runs
   * BETWEEN chunks on the same renderer. Restoring the render target, the
   * scissor rectangle and the viewport only at the end of the whole bake left
   * the scene being drawn into a 213x213 corner of the framebuffer with the
   * scissor test on, for as long as the bake lasted — and permanently if it
   * threw. The symptom was not an error: the room simply rendered into a small
   * square and everything else was black.
   *
   * So every chunk saves the state, does its work, and puts the state back
   * before yielding. The only invariant that matters is that the renderer is
   * always clean when this generator is not executing.
   */
  const withRendererState = (fn: () => void): void => {
    const target = renderer.getRenderTarget();
    const scissorTest = renderer.getScissorTest();
    const scissor = new THREE.Vector4();
    const viewport = new THREE.Vector4();
    renderer.getScissor(scissor);
    renderer.getViewport(viewport);
    try {
      fn();
    } finally {
      renderer.setRenderTarget(target);
      renderer.setScissorTest(scissorTest);
      renderer.setScissor(scissor);
      renderer.setViewport(viewport);
    }
  };

  /**
   * Everything below runs inside a try/finally.
   *
   * This generator is driven a chunk at a time and can be abandoned between
   * chunks — the caller stops calling `next()` when the component unmounts or
   * the bake is cancelled — and it can throw part way through. Either path
   * used to skip the disposal at the bottom, stranding two float render
   * targets on the GPU per abandoned bake. A generator's `finally` runs on
   * `return()` as well as on completion, so this covers both.
   */
  try {
    // --- projection pass, chunked by rows ------------------------------------
    quad.material = projectMaterial;
    for (let row = 0; row < size; row += rowsPerChunk) {
      const h = Math.min(rowsPerChunk, size - row);
      withRendererState(() => {
        renderer.setRenderTarget(target);
        renderer.setScissorTest(true);
        renderer.setScissor(0, row, size, h);
        renderer.setViewport(0, 0, size, size);
        renderer.render(scene, camera);
      });
      yield (row / size) * 0.5;
    }

    // --- normal pass ----------------------------------------------------------
    quad.material = normalMaterial;
    for (let row = 0; row < size; row += rowsPerChunk) {
      const h = Math.min(rowsPerChunk, size - row);
      withRendererState(() => {
        renderer.setRenderTarget(normalTarget);
        renderer.setScissorTest(true);
        renderer.setScissor(0, row, size, h);
        renderer.setViewport(0, 0, size, size);
        renderer.render(scene, camera);
      });
      yield 0.5 + (row / size) * 0.4;
    }

    // --- readback -------------------------------------------------------------
    let posRaw!: Float32Array;
    let nrmRaw!: Float32Array;
    withRendererState(() => {
      posRaw = readTarget(renderer, target, size);
      nrmRaw = readTarget(renderer, normalTarget, size);
    });
    yield 0.95;

    const total = size * size;
    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    let count = 0;
    for (let i = 0; i < total; i++) {
      if (posRaw[i * 4 + 3] < 0.5) continue; // failed to converge
      positions[count * 3] = posRaw[i * 4];
      positions[count * 3 + 1] = posRaw[i * 4 + 1];
      positions[count * 3 + 2] = posRaw[i * 4 + 2];
      normals[count * 3] = nrmRaw[i * 4];
      normals[count * 3 + 1] = nrmRaw[i * 4 + 1];
      normals[count * 3 + 2] = nrmRaw[i * 4 + 2];
      count++;
    }

    return {
      positions: positions.subarray(0, count * 3),
      normals: normals.subarray(0, count * 3),
      count,
    };
  } finally {
    target.dispose();
    normalTarget.dispose();
    projectMaterial.dispose();
    normalMaterial.dispose();
    quad.geometry.dispose();
    scene.clear();
  }
}

function makeTarget(
  renderer: THREE.WebGLRenderer,
  size: number,
): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    type: supportsHalfFloatRead(renderer)
      ? THREE.HalfFloatType
      : THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function supportsHalfFloatRead(renderer: THREE.WebGLRenderer): boolean {
  // WebGL2 guarantees RGBA16F is colour-renderable; readback of RGBA16F is the
  // widely-supported path and halves the bytes crossing the bus.
  return renderer.capabilities.isWebGL2;
}

/** Reads a target and decodes 16-bit half floats if that is what it holds. */
function readTarget(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  size: number,
): Float32Array {
  const texels = size * size * 4;
  if (target.texture.type === THREE.FloatType) {
    const buf = new Float32Array(texels);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, buf);
    return buf;
  }
  const packed = new Uint16Array(texels);
  renderer.readRenderTargetPixels(target, 0, 0, size, size, packed);
  const out = new Float32Array(texels);
  for (let i = 0; i < texels; i++) out[i] = halfToFloat(packed[i]);
  return out;
}

/** IEEE 754 binary16 → binary32. */
export function halfToFloat(h: number): number {
  const sign = (h & 0x8000) >> 15;
  const exponent = (h & 0x7c00) >> 10;
  const fraction = h & 0x03ff;
  if (exponent === 0)
    return (sign ? -1 : 1) * Math.pow(2, -14) * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? NaN : (sign ? -1 : 1) * Infinity;
  return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}
