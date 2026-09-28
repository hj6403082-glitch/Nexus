/**
 * A STANDALONE PREVIEW OF THE NETWORK.
 *
 * The same argument as `preview-face.ts`, one layer up. Judging the wireframe
 * through the application costs a Next build, a page load, a GPU bake and a
 * fourteen-second choreography — minutes per look on a software renderer, and
 * every one of those stages is a place the figure can fail to appear for
 * reasons that have nothing to do with the mesh. The first capture of the
 * network came back as a field of blobs and it was not possible to tell from
 * it whether the edges were wrong, the shader was wrong, or the thing on
 * screen was the beads.
 *
 * So this bakes the surface on the CPU with the SAME field, selects with the
 * SAME Poisson pass, wires it with the SAME `buildWireframe`, and draws it
 * with the SAME shaders `WireFigure` uses — imported, not restated. What it
 * shows is what the application draws, minus everything that is not the mesh.
 *
 * Run with: npm run wire
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { sdBustCPU, BUST_BOUNDS } from '../src/scene/human/sdf.ts';
import { selectPoisson } from '../src/scene/human/poisson.ts';
import { buildWireframe, mirrorAcrossMidline } from '../src/scene/human/wireframe.ts';
import { EYES } from '../src/scene/human/anatomy.ts';
import {
  FIGURE_EYES,
  FIGURE_PLACEMENT,
  PORTRAIT_DISTANCE,
} from '../src/scene/human/placement.ts';
import {
  SHARED_VERTEX,
  NODE_VERTEX,
  LINE_FRAGMENT,
  NODE_FRAGMENT,
} from '../src/scene/human/wireShaders.ts';

const CANDIDATES = 96000;
const WANT = 24000;
/** How many of those points the NETWORK is built on — see preview note below. */
const WANT_WIRE = Number(process.env.WIRE_NODES ?? 9000);

/** The same seeded stream the GPU baker uses, so runs are comparable. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gradient(x: number, y: number, z: number): [number, number, number] {
  const e = 0.0008;
  return [
    (sdBustCPU(x + e, y, z) - sdBustCPU(x - e, y, z)) / (2 * e),
    (sdBustCPU(x, y + e, z) - sdBustCPU(x, y - e, z)) / (2 * e),
    (sdBustCPU(x, y, z + e) - sdBustCPU(x, y, z - e)) / (2 * e),
  ];
}

/**
 * Seed in the box, then Newton onto the isosurface.
 *
 * The step is gradient-NORMALISED — `p -= g * d / dot(g,g)` — not `p -= n * d`.
 * A smooth-minimum field is not a true distance field; near a blend its
 * gradient is well under one, so a step of `d` along the unit normal
 * undershoots and the point never reaches the tolerance. That undershoot is
 * what used to punch holes in the chest.
 */
function bakeCPU(): { positions: Float32Array; normals: Float32Array; count: number } {
  const rnd = makeRandom(7);
  const positions = new Float32Array(CANDIDATES * 3);
  const normals = new Float32Array(CANDIDATES * 3);
  const { min, max } = BUST_BOUNDS;
  let count = 0;

  for (let i = 0; i < CANDIDATES; i++) {
    let x = min[0] + rnd() * (max[0] - min[0]);
    let y = min[1] + rnd() * (max[1] - min[1]);
    let z = min[2] + rnd() * (max[2] - min[2]);

    for (let step = 0; step < 24; step++) {
      const d = sdBustCPU(x, y, z);
      if (Math.abs(d) < 0.0004) break;
      const g = gradient(x, y, z);
      const gg = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (gg < 1e-9) break;
      const k = (d / gg) * 0.9;
      x -= g[0] * k;
      y -= g[1] * k;
      z -= g[2] * k;
    }

    // Accept on TRUE distance, not on the step having been taken.
    if (Math.abs(sdBustCPU(x, y, z)) > 0.0009) continue;

    const g = gradient(x, y, z);
    const len = Math.hypot(g[0], g[1], g[2]) || 1;
    positions[count * 3] = x;
    positions[count * 3 + 1] = y;
    positions[count * 3 + 2] = z;
    normals[count * 3] = g[0] / len;
    normals[count * 3 + 1] = g[1] / len;
    normals[count * 3 + 2] = g[2] / len;
    count++;
  }
  return { positions, normals, count };
}

function drain<T>(gen: Generator<number, T, void>): T {
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

console.log('baking on the CPU…');
const baked = bakeCPU();
console.log(`  ${baked.count} candidates on the surface`);

const selection = drain(selectPoisson(baked.positions, baked.normals, baked.count, WANT, 16000));
const count = selection.positions.length / 3;
console.log(`  ${count} points selected · spacing ${(selection.spacing * 1000).toFixed(2)}mm`);

/**
 * The network is built on a COARSER subset of the same points.
 *
 * The bead set is sized so thirty thousand spheres can close into a solid
 * figure, which puts them four millimetres apart. A mesh at four millimetres
 * seen from sixty centimetres is finer than the pixel grid: the lines merge
 * into a wash and the thing reads as a dim solid, not as a network. Running
 * the same elimination again with a smaller target keeps the Poisson property
 * — uniform, no clumps — at a spacing where the individual triangles are
 * actually visible.
 */
const net = drain(
  selectPoisson(selection.positions, selection.normals, count, WANT_WIRE, 16000),
);
const mirrored = mirrorAcrossMidline(net.positions, net.normals, net.positions.length / 3);
const nodes = mirrored.count;
console.log(`  ${nodes} network nodes · spacing ${(net.spacing * 1000).toFixed(2)}mm`);
const wire = drain(buildWireframe(mirrored.positions, nodes, net.spacing));
console.log(`  ${wire.edgeCount} edges (${(wire.edgeCount / nodes).toFixed(2)} per node)`);
if (wire.edgeCount === 0) throw new Error('the wireframe has no edges');

const seed = new Float32Array(nodes);
const eye = new Float32Array(nodes);
const rnd = makeRandom(19);
for (let i = 0; i < nodes; i++) {
  seed[i] = rnd();
  const x = mirrored.positions[i * 3];
  const y = mirrored.positions[i * 3 + 1];
  const z = mirrored.positions[i * 3 + 2];
  const dl = Math.hypot(x - EYES.left[0], y - EYES.left[1], z - EYES.left[2]);
  const dr = Math.hypot(x - EYES.right[0], y - EYES.right[1], z - EYES.right[2]);
  eye[i] = Math.max(0, 1 - Math.min(dl, dr) / 0.030);
}

const b64 = (a: Float32Array | Uint32Array) =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');

/**
 * Three declares these for a ShaderMaterial. A raw context does not, so the
 * preview declares exactly the same names and fills them from JS — which is
 * what keeps the imported shader source compiling unchanged.
 */
const PRELUDE = `#version 300 es
in vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
`;
const FRAG_PRELUDE = '#version 300 es\n';

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>wire</title>
<style>html,body{margin:0;height:100%;background:#050b16;overflow:hidden}canvas{display:block}</style>
</head><body><canvas id="c"></canvas>
<script>
const DATA = {
  positions: "${b64(mirrored.positions)}",
  normals: "${b64(mirrored.normals)}",
  edges: "${b64(wire.edges)}",
  seed: "${b64(seed)}",
  eye: "${b64(eye)}",
  count: ${nodes},
  edgeCount: ${wire.edgeCount}
};
const SRC = {
  lineVert: ${JSON.stringify(PRELUDE + SHARED_VERTEX)},
  nodeVert: ${JSON.stringify(PRELUDE + NODE_VERTEX)},
  lineFrag: ${JSON.stringify(FRAG_PRELUDE + LINE_FRAGMENT)},
  nodeFrag: ${JSON.stringify(FRAG_PRELUDE + NODE_FRAGMENT)}
};
<\/script>
<script>
// A handful of matrix operations, written out rather than pulled from a CDN:
// the preview has to render in an offline headless browser.
const M = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
  },
  lookAt(eye, at, up) {
    const z = M.norm([eye[0]-at[0], eye[1]-at[1], eye[2]-at[2]]);
    const x = M.norm(M.cross(up, z));
    const y = M.cross(z, x);
    return new Float32Array([
      x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
      -M.dot(x,eye), -M.dot(y,eye), -M.dot(z,eye), 1]);
  },
  // Turn about Y by PI, then translate. Column-major, as WebGL wants.
  placement(tx, ty, tz) {
    const c = Math.cos(Math.PI), s = Math.sin(Math.PI);
    return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, tx,ty,tz,1]);
  },
  // The upper-left 3x3 inverse-transpose. Every matrix here is a rotation and
  // a translation, so that is just the rotation part unchanged.
  normal(m) { return new Float32Array([m[0],m[1],m[2], m[4],m[5],m[6], m[8],m[9],m[10]]); },
  cross(a,b){return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];},
  dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];},
  norm(v){const l=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/l,v[1]/l,v[2]/l];}
};
const PLACEMENT = ${JSON.stringify(Array.from(FIGURE_PLACEMENT.elements))};
// The rig's portrait station, not the Canvas camera prop — the rig overrides
// that prop on its first frame, so a preview built from it looks from
// somewhere the application never looks from.
const EYES = ${JSON.stringify(FIGURE_EYES.toArray())};
const PORTRAIT = ${PORTRAIT_DISTANCE};
const params = new URLSearchParams(location.search);
const W = +(params.get('w') || 900), H = +(params.get('h') || 900);
const canvas = document.getElementById('c');
canvas.width = W; canvas.height = H;
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });

function bytes(s) { const b = atob(s); const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; }
const positions = new Float32Array(bytes(DATA.positions));
const normals = new Float32Array(bytes(DATA.normals));
const edges = new Uint32Array(bytes(DATA.edges));
const seeds = new Float32Array(bytes(DATA.seed));
const eyes = new Float32Array(bytes(DATA.eye));

function compile(type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    window.__error = label + ': ' + gl.getShaderInfoLog(s);
    document.title = 'SHADER ERROR';
  }
  return s;
}
function program(vs, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs, label + ' vs'));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs, label + ' fs'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    window.__error = label + ' link: ' + gl.getProgramInfoLog(p);
    document.title = 'LINK ERROR';
  }
  return p;
}
const lineProg = program(SRC.lineVert, SRC.lineFrag, 'line');
const nodeProg = program(SRC.nodeVert, SRC.nodeFrag, 'node');

function buffer(data, target) {
  const b = gl.createBuffer();
  gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b;
}
const posBuf = buffer(positions, gl.ARRAY_BUFFER);
const nrmBuf = buffer(normals, gl.ARRAY_BUFFER);
const seedBuf = buffer(seeds, gl.ARRAY_BUFFER);
const eyeBuf = buffer(eyes, gl.ARRAY_BUFFER);
const idxBuf = buffer(edges, gl.ELEMENT_ARRAY_BUFFER);

function bindAttribs(prog) {
  const bind = (name, buf, size) => {
    const loc = gl.getAttribLocation(prog, name);
    if (loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  bind('position', posBuf, 3);
  bind('aNormal', nrmBuf, 3);
  bind('aSeed', seedBuf, 1);
  bind('aEye', eyeBuf, 1);
}

// The application's placement, restated as a matrix product: turn the bust to
// face the camera, then put its eye plane at world (0, 0.15, 0.245).
// Taken from the application, not restated: a preview that places the figure
// its own way is a preview of a different figure.
const placement = new Float32Array(PLACEMENT);
const placeNormal = M.normal(placement);

// The application's camera: fov 54 at (0, 0.12, -0.35), looking at the face.
const yaw = +(params.get('yaw') || 0);
const dist = +(params.get('dist') || PORTRAIT);
const target = EYES.slice();
const camera = [target[0] - Math.sin(yaw) * dist, target[1], target[2] - Math.cos(yaw) * dist];
const view = M.lookAt(camera, target, [0, 1, 0]);
const proj = M.perspective(54 * Math.PI / 180, W / H, 0.05, 80);
const normalMatrix = M.normal(view);

function setCommon(prog) {
  const u = (n) => gl.getUniformLocation(prog, n);
  gl.uniformMatrix4fv(u('modelViewMatrix'), false, view);
  gl.uniformMatrix4fv(u('projectionMatrix'), false, proj);
  gl.uniformMatrix3fv(u('normalMatrix'), false, normalMatrix);
  gl.uniformMatrix4fv(u('uPlacement'), false, placement);
  gl.uniformMatrix3fv(u('uNormalMatrix'), false, placeNormal);
  gl.uniform1f(u('uTime'), +(params.get('t') || 0));
  gl.uniform1f(u('uReveal'), +(params.get('reveal') || 1));
  gl.uniform1f(u('uLevel'), +(params.get('level') || 0));
  gl.uniform1f(u('uViewportHeight'), H);
  gl.uniform3f(u('uLineColour'), 0.169, 0.624, 0.878);
  gl.uniform3f(u('uEdgeColour'), 0.749, 0.937, 1.0);
  gl.uniform3f(u('uNodeColour'), 0.624, 0.894, 1.0);
}

gl.viewport(0, 0, W, H);
gl.clearColor(0.020, 0.043, 0.086, 1);
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
gl.disable(gl.DEPTH_TEST);

gl.useProgram(lineProg); bindAttribs(lineProg); setCommon(lineProg);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
gl.drawElements(gl.LINES, DATA.edgeCount * 2, gl.UNSIGNED_INT, 0);

gl.useProgram(nodeProg); bindAttribs(nodeProg); setCommon(nodeProg);
gl.drawArrays(gl.POINTS, 0, DATA.count);

gl.finish();
window.__stats = { count: DATA.count, edges: DATA.edgeCount };
window.__drawn = true;
<\/script></body></html>`;

mkdirSync('.wire-preview', { recursive: true });
writeFileSync('.wire-preview/index.html', HTML);
console.log('Wrote .wire-preview/index.html');
