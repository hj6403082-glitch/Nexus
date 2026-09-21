/**
 * Build the hosted preview.
 *
 * A static export cannot contain API routes, and NEXUS has eleven of them. The
 * App Router ignores folders whose name starts with an underscore ("private
 * folders"), so the route tree is renamed out of the way for the duration of
 * the build and put back afterwards.
 *
 * The rename is wrapped in try/finally and also hooked to the signals that a
 * cancelled build actually sends — leaving a developer's `src/app/api` renamed
 * because a build was interrupted would be a genuinely nasty thing to do to
 * someone's checkout.
 */
import { spawnSync } from 'node:child_process';
import { renameSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LIVE = 'src/app/api';
const PARKED = 'src/app/_api';

function park() {
  if (existsSync(LIVE)) renameSync(LIVE, PARKED);
}

function restore() {
  if (existsSync(PARKED)) renameSync(PARKED, LIVE);
}

// Restore on every abnormal exit path, not just the happy one.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restore();
    process.exit(1);
  });
}
process.on('uncaughtException', (err) => {
  restore();
  throw err;
});


const OUT = '.next-static';

// Text formats that can carry an asset path. Next embeds "./_next/" in the HTML,
// in the flight payload inlined in it, and in the webpack runtime's public path.
const REWRITABLE = new Set(['.html', '.js', '.css', '.json', '.txt', '.map']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Hosts that reserve leading underscores for their own names reject a tree
 * containing `_next/`. Rename the directory and rewrite every reference to it.
 *
 * `_next/` with the trailing slash is the only form that appears as a path;
 * Next's other underscore tokens (`self.__next_f`, `__next_s`) have no slash,
 * so this cannot touch them.
 */
/**
 * core-js's URL/encoding polyfill carries three literal U+FFFD characters
 * inside string literals. Hosts that treat U+FFFD as a decoding failure reject
 * the file. `\uFFFD` is the same character to a JS parser and plain ASCII on
 * the wire, so escaping it changes nothing about how the bundle behaves.
 */
function escapeReplacementChars(root) {
  let touched = 0;
  for (const file of walk(root)) {
    if (!file.endsWith('.js')) continue;
    const before = readFileSync(file, 'utf8');
    if (!before.includes('\uFFFD')) continue;
    writeFileSync(file, before.split('\uFFFD').join('\\uFFFD'));
    touched += 1;
  }
  if (touched) console.log(`Escaped U+FFFD in ${touched} file(s).`);
}

function deUnderscore(root) {
  const from = join(root, '_next');
  const to = join(root, 'assets');
  if (!existsSync(from)) return;
  renameSync(from, to);

  let touched = 0;
  for (const file of walk(root)) {
    const dot = file.lastIndexOf('.');
    if (dot < 0 || !REWRITABLE.has(file.slice(dot))) continue;
    const before = readFileSync(file, 'utf8');
    const after = before.split('_next/').join('assets/');
    if (after !== before) {
      writeFileSync(file, after);
      touched += 1;
    }
  }
  console.log(`Renamed _next/ to assets/ across ${touched} file(s).`);
}

const run = (cmd, args, env = {}) => {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
};

try {
  // Freeze the sample payloads first: the export has no server to produce them.
  run('node', [
    '--experimental-strip-types',
    '--import',
    './scripts/register.mjs',
    'scripts/generate-samples.ts',
  ]);

  park();
  run('npx', ['next', 'build'], { NEXUS_STATIC: '1' });
  deUnderscore(OUT);
  escapeReplacementChars(OUT);
  console.log(`\nStatic preview built into ./${OUT}`);
} finally {
  restore();
}
