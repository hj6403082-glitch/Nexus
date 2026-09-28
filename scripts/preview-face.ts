/**
 * A STANDALONE FACE PREVIEW.
 *
 * Judging the figure through the app costs a Next build, a page load, a GPU
 * bake and a transformation sequence — minutes per look, on a software
 * renderer. Almost all of that is irrelevant to the question actually being
 * asked, which is "does the head look right yet".
 *
 * So this emits a single self-contained HTML file that raymarches the SAME
 * generated field with the SAME lighting as `SurfaceFigure`, and nothing else.
 * It imports `BUST_SDF` rather than restating it, so the preview cannot drift
 * from the thing it is previewing: change a cheekbone in `anatomy.ts` and this
 * shows that cheekbone.
 *
 * Run with: npm run face
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { BUST_SDF } from '../src/scene/human/sdf.ts';
import { EYES } from '../src/scene/human/anatomy.ts';
import { FACE_MARKINGS_GLSL } from '../src/scene/human/faceMarkings.ts';
import { KEY_DIR, FILL_DIR, RIM_DIR } from '../src/scene/human/lights.ts';

const v3 = (v: readonly number[]) => `vec3(${v.map((n) => n.toFixed(5)).join(', ')})`;

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>face</title>
<style>html,body{margin:0;height:100%;background:#04060b;overflow:hidden}canvas{display:block}</style>
</head><body><canvas id="c"></canvas><script type="x-shader/x-fragment" id="fs">
precision highp float;
${BUST_SDF}
${FACE_MARKINGS_GLSL}

uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uCamera;
uniform float uYaw;

const vec3 KEY = ${v3(KEY_DIR)};
const vec3 FILL = ${v3(FILL_DIR)};
const vec3 RIM = ${v3(RIM_DIR)};
const vec3 EYE_L = ${v3(EYES.left)};
const vec3 EYE_R = ${v3(EYES.right)};

float sdPosed(vec3 p) { return sdBust(p); }

vec3 fieldNormal(vec3 p) {
  const float e = 0.0005;
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * sdPosed(p + k.xyy * e) + k.yyx * sdPosed(p + k.yyx * e) +
    k.yxy * sdPosed(p + k.yxy * e) + k.xxx * sdPosed(p + k.xxx * e));
}

float occlusion(vec3 p, vec3 n) {
  float sum = 0.0; float w = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = float(i) * 0.010;
    sum += (h - sdPosed(p + n * h)) * w;
    w *= 0.7;
  }
  return clamp(1.0 - 2.4 * sum, 0.0, 1.0);
}

float shadow(vec3 p, vec3 l) {
  float t = 0.012; float res = 1.0;
  for (int i = 0; i < 22; i++) {
    float d = sdPosed(p + l * t);
    if (d < 0.0004) return 0.0;
    res = min(res, 9.0 * d / t);
    t += clamp(d, 0.005, 0.05);
    if (t > 0.35) break;
  }
  return clamp(res, 0.0, 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  // Orbit the head so a still can be taken from any angle.
  float ca = cos(uYaw), sa = sin(uYaw);
  vec3 target = vec3(0.0, 1.585, 0.02);
  vec3 offset = vec3(sa, 0.0, ca) * length(uCamera.xz) + vec3(0.0, uCamera.y, 0.0);
  vec3 ro = target + offset;
  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  vec3 rd = normalize(fwd * 1.9 + right * uv.x + up * uv.y);

  float t = 0.02; bool hit = false;
  for (int i = 0; i < 160; i++) {
    float d = sdPosed(ro + rd * t);
    if (d < 0.00025) { hit = true; break; }
    t += d * 0.85;
    if (t > 3.0) break;
  }
  if (!hit) { gl_FragColor = vec4(0.012, 0.018, 0.035, 1.0); return; }

  vec3 p = ro + rd * t;
  vec3 n = fieldNormal(p);
  vec3 viewDir = -rd;
  vec3 keyDir = normalize(KEY);
  float occ = occlusion(p, n);
  float shade = shadow(p, keyDir);
  float key = max(dot(n, keyDir), 0.0);

  // Metal, not skin — see SurfaceFigure.tsx for why. Kept character for
  // character with the app's shader so this previews the real thing.
  vec3 refl = reflect(rd, n);
  vec3 fillDir = normalize(FILL);
  vec3 rimDir = normalize(RIM);

  vec3 env = mix(vec3(0.008, 0.013, 0.026), vec3(0.070, 0.105, 0.190),
                 smoothstep(-0.55, 0.85, refl.y));
  env += vec3(0.62, 0.78, 1.05) * pow(max(dot(refl, keyDir), 0.0), 52.0) * 2.6;
  env += vec3(0.10, 0.20, 0.44) * pow(max(dot(refl, rimDir), 0.0), 7.0) * 0.55;
  env += vec3(0.05, 0.07, 0.12) * pow(max(dot(refl, fillDir), 0.0), 4.0) * 0.35;

  vec3 albedo = vec3(0.17, 0.22, 0.31);
  float fres = pow(clamp(1.0 - max(dot(n, viewDir), 0.0), 0.0, 1.0), 5.0);
  vec3 colour = mix(albedo, vec3(1.0), fres) * env * mix(0.35, 1.0, occ);

  float wrapped = pow(clamp(key * 0.90 + 0.10, 0.0, 1.0), 1.7);
  colour += albedo * wrapped * mix(0.05, 1.0, shade) * 0.30 * occ;
  colour += albedo * max(dot(n, fillDir), 0.0) * 0.10 * occ;

  vec3 halfVec = normalize(keyDir + viewDir);
  colour += vec3(0.85, 0.95, 1.15) * pow(clamp(dot(n, halfVec), 0.0, 1.0), 120.0) * shade * occ * 1.1;

  colour = faceMarkings(p, n, colour);

  float eye = min(length(p - EYE_L), length(p - EYE_R));
  colour *= mix(1.0, 0.10, 1.0 - smoothstep(0.0020, 0.0088, eye));
  colour += vec3(0.55, 0.78, 1.15) * (1.0 - smoothstep(0.0, 0.0021, eye)) * 1.35;
  colour += vec3(0.08, 0.20, 0.48) * (1.0 - smoothstep(0.002, 0.0075, eye)) * 0.34;

  colour = pow(max(colour, vec3(0.0)), vec3(1.0 / 2.2));
  gl_FragColor = vec4(colour, 1.0);
}
</script>
<script>
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl');
const params = new URLSearchParams(location.search);
const size = +(params.get('size') || 700);
canvas.width = size; canvas.height = size;
const vs = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(vs, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }');
gl.compileShader(vs);
const fs = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(fs, document.getElementById('fs').textContent);
gl.compileShader(fs);
if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
  document.title = 'SHADER ERROR';
  window.__shaderError = gl.getShaderInfoLog(fs);
}
const prog = gl.createProgram();
gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.useProgram(prog);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'a');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
gl.uniform2f(gl.getUniformLocation(prog, 'uResolution'), canvas.width, canvas.height);
gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), 0);
gl.uniform3f(gl.getUniformLocation(prog, 'uCamera'), 0, 0.02, 0.62);
gl.uniform1f(gl.getUniformLocation(prog, 'uYaw'), +(params.get('yaw') || 0));
gl.viewport(0, 0, canvas.width, canvas.height);
gl.drawArrays(gl.TRIANGLES, 0, 3);
gl.finish();
window.__drawn = true;
</script></body></html>`;

mkdirSync('.face-preview', { recursive: true });
writeFileSync('.face-preview/index.html', HTML);
console.log('Wrote .face-preview/index.html');
