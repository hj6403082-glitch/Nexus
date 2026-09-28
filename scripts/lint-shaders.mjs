import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A backtick inside a shader template literal silently ends the literal, and
 * the rest of the GLSL is then parsed as TypeScript. The error it produces
 * ("Expected '</', got 'step'") points at a line of shader code and says
 * nothing about quoting, so it costs a build every time.
 *
 * It has happened three times in this codebase, always in a comment where
 * backticks are the natural way to quote an identifier. So it is a lint now.
 */
const SHADER_MARKERS = [
  'void main',
  'gl_FragColor',
  'gl_Position',
  'mainImage',
  'fragColor',
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(path)) yield path;
  }
}

const offences = [];

/**
 * `scripts/` as well as `src/`.
 *
 * The face preview emits a shader too, and it went down to exactly the bug
 * this file exists to catch — a backtick inside a GLSL comment, which ends the
 * template literal and turns the rest of the program into syntax errors. It
 * was outside the scan because the scan only looked at `src`, which is a
 * statement about where the code happened to live rather than about where
 * shaders are written.
 */
for (const file of [...walk('src'), ...walk('scripts')]) {
  const text = readFileSync(file, 'utf8');
  // Walk template literals, tracking `${}` nesting well enough for our shaders
  // (which never nest a template inside an interpolation).
  const parts = text.split('`');
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i];
    if (!SHADER_MARKERS.some((m) => body.includes(m))) continue;
    // A shader literal that ends mid-GLSL means the NEXT segment starts with
    // shader text rather than with TypeScript.
    const after = parts[i + 1] ?? '';
    const trimmed = after.trimStart();
    if (trimmed && !/^[;,)\]}.a-zA-Z_$\s]/.test(trimmed[0])) continue;
    if (/^[a-z]+\(|^\s*(float|vec[234]|void|uniform|varying|in |out )/.test(trimmed)) {
      offences.push(`${file}: shader literal ends inside GLSL — a stray backtick in a comment?`);
    }
  }

  // Direct scan: a backtick on a line that is clearly a GLSL comment.
  const lines = text.split('\n');
  let inShader = false;
  lines.forEach((line, n) => {
    if (SHADER_MARKERS.some((m) => line.includes(m))) inShader = true;
    if (inShader && /^\s*(\/\/|\*)/.test(line) && line.includes('`')) {
      offences.push(`${file}:${n + 1}: backtick inside a shader comment`);
    }
    if (line.includes('`;') || line.includes('`,')) inShader = false;
  });
}

if (offences.length > 0) {
  console.error('\nShader lint failed:\n' + offences.map((o) => `  ${o}`).join('\n') + '\n');
  process.exit(1);
}
console.log('  ok   no backticks inside shader literals');
