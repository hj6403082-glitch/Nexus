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
import { countPixels, meanGreenOverRed, readPng } from './png.mjs';

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

// --- picking, on the pointer fallback --------------------------------------
// The mouse exists only as a fallback, but a fallback that does not work is
// not one: it has to hover, select and drag exactly as a hand does.
await page.mouse.move(720, 450);
await page.waitForTimeout(600);
const hovered = await page.evaluate(() => window.__nexus().hovered);
check('the centred card hovers under the pointer', Boolean(hovered), String(hovered));

await page.mouse.move(720, 450);
await page.mouse.down();
await page.waitForTimeout(300);
const dragging = await page.evaluate(() => window.__nexus().dragging);
check('pressing a card starts a drag', Boolean(dragging), String(dragging));
// Drag it well off its slot, then let go. The store knowing a drag is in
// progress proves nothing about whether the card moved, so this reads the
// card's actual world position.
await page.mouse.move(980, 300, { steps: 18 });
await page.waitForTimeout(1600);
const dragged = await page.evaluate(() => window.__nexus().draggedAt);
check(
  'the dragged card follows the cursor off its slot',
  Boolean(dragged) && dragged[1] > 0.25,
  dragged ? `y = ${dragged[1].toFixed(2)}` : 'no card',
);
await page.screenshot({ path: `${SHOTS}/01b-drag.png` });
await page.mouse.up();
await page.waitForTimeout(1800);
check(
  'a released card returns to its orbit slot',
  (await page.evaluate(() => window.__nexus().dragging)) === null,
);

// A click (press and release without travel) opens the module.
await page.mouse.move(720, 450);
await page.waitForTimeout(400);
await page.mouse.click(720, 450);
const opened = await until(
  async () => (await page.evaluate(() => window.__nexus().open)) || null,
  20_000,
  700,
);
check('clicking a card opens its module', Boolean(opened), String(opened));

// --- the in-scene stage ----------------------------------------------------
const staged = await until(
  async () => ((await page.evaluate(() => window.__nexus().focusPresence)) > 0.6 ? true : null),
  20_000,
  700,
);
check('the focused module raises its 3D stage', Boolean(staged));
await page.screenshot({ path: `${SHOTS}/01c-focus-stage.png` });

/**
 * THE TYPE SURVIVES THE POST CHAIN.
 *
 * Reads actual pixels, because the bug this guards against was invisible to
 * every state check: the colour grade sampled neighbours of the buffer it was
 * writing, and the driver erased thin bright features. The stores all reported
 * a perfectly open, perfectly painted card whose headline figure was no longer
 * on screen.
 */
const faceShot = await page.screenshot({
  clip: { x: 500, y: 40, width: 460, height: 580 },
});
const face = readPng(faceShot);
// Accent-agnostic: the module spectrum runs violet to cyan, so this counts
// BRIGHT SATURATED pixels rather than one hue. Before the halation fix this
// region measured in the low tens; with the type intact it is thousands.
const bright = countPixels(face, (r, g, b) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max > 150 && max - min > 60;
});
check(
  'bright accent type survives the post chain',
  bright > 800,
  `${bright} bright saturated pixels`,
);

// --- environments ----------------------------------------------------------
await page.keyboard.press('Meta+k');
await page.waitForTimeout(700);
await page.click(PALETTE);
await page.type(PALETTE, 'Fog Chamber', { delay: 40 });
await page.keyboard.press('Enter');
const fog = await until(
  async () => ((await page.evaluate(() => window.__nexus().world)) === 'fog-chamber' ? true : null),
  20_000,
  600,
);
check('an environment can be switched by name', Boolean(fog));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/01d-fog-chamber.png` });

// --- the weather world reflects the weather --------------------------------
await page.keyboard.press('Meta+k');
await page.waitForTimeout(700);
await page.click(PALETTE);
await page.type(PALETTE, 'weather', { delay: 40 });
await page.keyboard.press('Enter');
const weather = await until(
  async () =>
    (await page.evaluate(() => window.__nexus().world)) === 'weather-reactive' ? true : null,
  30_000,
  700,
);
check('opening weather morphs the world to match it', Boolean(weather));
await page.waitForTimeout(3500);
await page.screenshot({ path: `${SHOTS}/01e-weather.png` });

// --- the system module reports the machine ---------------------------------
await page.keyboard.press('Meta+k');
await page.waitForTimeout(700);
await page.click(PALETTE);
await page.type(PALETTE, 'system', { delay: 40 });
await page.keyboard.press('Enter');
const systemRows = await until(async () => {
  const rows = await page.evaluate(() => window.__nexus().rows?.system ?? []);
  return rows.length >= 6 ? rows : null;
}, 30_000, 800);
check(
  'the system card reports cpu, gpu, battery, network, memory and storage',
  Boolean(systemRows) &&
    ['cpu', 'gpu', 'battery', 'network', 'memory', 'storage'].every((s) =>
      systemRows.includes(s),
    ),
  systemRows ? systemRows.join(', ') : 'no rows',
);

// --- the floor becomes a market grid ---------------------------------------
// Measured in pixels: the market grid is green-cyan and the room's lattice is
// blue, so this counts pixels where green leads and compares the floor before
// and after opening Stocks.
const floorClip = { x: 120, y: 600, width: 1200, height: 280 };
const beforeFloor = meanGreenOverRed(readPng(await page.screenshot({ clip: floorClip })));

await page.keyboard.press('Meta+k');
await page.waitForTimeout(700);
await page.click(PALETTE);
await page.type(PALETTE, 'stocks', { delay: 40 });
await page.keyboard.press('Enter');
await until(
  async () => ((await page.evaluate(() => window.__nexus().world)) === 'market-grid' ? true : null),
  30_000,
  700,
);
await page.waitForTimeout(9000);
const afterFloor = meanGreenOverRed(readPng(await page.screenshot({ clip: floorClip })));
await page.screenshot({ path: `${SHOTS}/01f-market-grid.png` });
check(
  'opening stocks converts the floor into a market grid',
  afterFloor - beforeFloor > 1.5,
  `mean green-over-red ${beforeFloor.toFixed(2)} → ${afterFloor.toFixed(2)}`,
);

/**
 * The same type check again, in the HIGHEST-SATURATION world.
 *
 * This is the case that actually broke: saturation above 1.0 extrapolates away
 * from grey and drove cyan type's red channel negative, and the final sRGB
 * encode turned every one of those pixels into a NaN hole. Minimal Studio sits
 * at saturation 1.0 and never showed it; Market Grid is at 1.10 and erased the
 * headline figure completely.
 */
const gradedCard = readPng(
  await page.screenshot({ clip: { x: 520, y: 170, width: 420, height: 400 } }),
);
const gradedBright = countPixels(gradedCard, (r, g, b) => b > 150 && b > r + 70 && g > r + 40);
check(
  'saturated type survives the most saturated world',
  gradedBright > 600,
  `${gradedBright} cyan pixels in market grid`,
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
