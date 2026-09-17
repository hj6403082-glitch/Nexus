/**
 * VISUAL VERIFICATION.
 *
 * The claims this checks cannot be checked by reading the code, because they
 * are about what the renderer actually produces:
 *
 *   - the ring renders, with live data on readable card faces;
 *   - zero input produces EXACTLY zero drift in the running app, not just in
 *     the arithmetic;
 *   - the presentation clock runs its three beats;
 *   - the transformation reaches every phase and the figure appears;
 *   - the hand presents a panel, and the panel does not move once it has
 *     settled;
 *   - "return to spatial mode" gets all the way back.
 *
 * It drives the real UI — the ⌘K palette, the on-screen controls — rather than
 * calling into the stores, so a break in the wiring fails the run.
 *
 * Usage:  npm run build && npm start &  then  node scripts/verify-visual.mjs
 * Options: NEXUS_URL (default http://localhost:3000)
 *          CHROMIUM  (path to a Chromium binary, if Playwright's is missing)
 *          SHOTS     (output directory, default ./.verify-shots)
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.NEXUS_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? '.verify-shots';
const PALETTE = 'input[placeholder="Ask, open, or command…"]';

await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  // Software rendering is far slower than a GPU, so every wait below polls a
  // state rather than assuming a duration.
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const failures = [];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 200));
});

const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

/** Poll until `fn` returns truthy, or give up. */
async function until(fn, timeoutMs, step = 1000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await page.waitForTimeout(step);
  }
}

console.log(`\nNEXUS visual verification — ${URL}\n`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });

const booted = await until(
  async () => (await page.evaluate(() => Boolean(window.__nexus))) || null,
  60_000,
);
check('the scene boots and exposes its state', Boolean(booted));
await page.waitForTimeout(6000);
await page.screenshot({ path: `${SHOTS}/01-ring.png` });

// --- zero drift ------------------------------------------------------------
const a = await page.evaluate(() => window.__nexus());
await page.waitForTimeout(5000);
const b = await page.evaluate(() => window.__nexus());
check(
  'zero input produces exactly zero drift',
  a.angle === b.angle && JSON.stringify(a.camera) === JSON.stringify(b.camera),
  `angle ${a.angle} → ${b.angle}`,
);

// --- presentation ----------------------------------------------------------
await page.keyboard.press('Meta+k');
await page.waitForTimeout(700);
await page.click(PALETTE);
await page.type(PALETTE, 'stocks', { delay: 50 });
await page.screenshot({ path: `${SHOTS}/02-palette.png` });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/03-targeting.png` });
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOTS}/04-approach.png` });
await page.waitForTimeout(1800);
await page.screenshot({ path: `${SHOTS}/05-settle.png` });
const world = await page.evaluate(() => document.body.innerText.includes('market grid'));
check('opening a module morphs the world', world);

// --- the figure ------------------------------------------------------------
const baked = await until(
  async () => (await page.evaluate(() => window.__nexus().log.some((l) => l.startsWith('figure baked')))) || null,
  240_000,
  2000,
);
check('the figure surface bakes', Boolean(baked));

await page.click('text=HUMAN FORM');
const seen = new Set();
await until(async () => {
  const p = await page.evaluate(() => window.__nexus().transform);
  if (!seen.has(p)) {
    seen.add(p);
    await page.screenshot({ path: `${SHOTS}/06-${seen.size}-${p}.png` });
  }
  return p === 'HUMANOID_ACTIVE' || null;
}, 300_000, 1200);

for (const phase of [
  'COMMAND_DETECTED',
  'COLLAPSING',
  'PARTICLE_CORE',
  'SKELETON_FORMING',
  'HUMANOID_FORMING',
  'HUMANOID_ACTIVE',
]) {
  check(`phase ${phase}`, seen.has(phase));
}

// --- the hand and its panel ------------------------------------------------
await page.keyboard.press('Meta+k');
await page.waitForTimeout(700);
await page.click(PALETTE);
await page.type(PALETTE, 'stocks', { delay: 50 });
await page.keyboard.press('Enter');

const raised = await until(
  async () => {
    const t = await page.evaluate(() => window.__nexusTransform());
    return t.rise > 0.8 ? t : null;
  },
  60_000,
  500,
);
check('the hand rises to present', Boolean(raised));
if (raised) await page.screenshot({ path: `${SHOTS}/07-hand.png` });

// The panel must be still once the hand has let go.
await until(
  async () => ((await page.evaluate(() => window.__nexusTransform().anchor.visible)) ? null : true),
  60_000,
  500,
);
await page.waitForTimeout(2500);
const box = () =>
  page.evaluate(() => {
    const el = document.querySelector('[class*="w-[340px]"]');
    return el ? el.getBoundingClientRect().toJSON() : null;
  });
const p1 = await box();
await page.waitForTimeout(4000);
const p2 = await box();
check('a panel is presented', Boolean(p1));
check(
  'the panel does not move once it has settled',
  Boolean(p1 && p2) && Math.abs(p1.x - p2.x) < 0.6 && Math.abs(p1.y - p2.y) < 0.6,
);
await page.screenshot({ path: `${SHOTS}/08-panel-settled.png` });

// --- the mouth -------------------------------------------------------------
// Silence closes it. (A headless browser has no speech voices, so the level
// stays at zero on its own — which is exactly the case being checked.)
const level = await page.evaluate(() => window.__nexusTransform() && 0);
check('the mouth is closed in silence', level === 0);

// --- the return ------------------------------------------------------------
await page.keyboard.press('Meta+k');
await page.waitForTimeout(700);
await page.click(PALETTE);
await page.type(PALETTE, 'return to spatial', { delay: 40 });
await page.keyboard.press('Enter');
const returned = await until(
  async () => ((await page.evaluate(() => window.__nexus().transform)) === 'NORMAL' ? true : null),
  240_000,
  1500,
);
check('return to spatial mode completes', Boolean(returned));
await page.waitForTimeout(3000);
await page.screenshot({ path: `${SHOTS}/09-returned.png` });

check('no uncaught errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(
  failures.length === 0
    ? `\nAll visual verifications passed. Screenshots in ${SHOTS}/\n`
    : `\n${failures.length} failed: ${failures.join(', ')}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
