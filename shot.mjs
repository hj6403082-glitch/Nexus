import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = process.env.OUT, URL = process.env.URL;
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message.slice(0,220)));
await p.goto(URL, { waitUntil: 'load' });
const until = async (fn, ms = 500000, every = 1500) => { const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await p.waitForTimeout(every); } return null; };
await until(async () => await p.evaluate(() => (window.__nexus ? window.__nexus().rows.stocks.length > 0 : false)));
await p.waitForTimeout(5000);
await p.screenshot({ path: `${OUT}/1-ring.png` });
console.log(await until(async () => await p.evaluate(() => {
  const l = window.__nexus ? window.__nexus().log : [];
  return l.find(function (x) { return x.indexOf('figure baked') === 0; }) || null; })));
await p.click('button:has-text("human form")');
console.log('active:', await until(async () => (await p.evaluate(() => window.__nexus().transform)) === 'HUMANOID_ACTIVE' || null));
await p.waitForTimeout(9000);
await p.screenshot({ path: `${OUT}/2-figure.png` });
await p.screenshot({ path: `${OUT}/3-face.png`, clip: { x: 570, y: 380, width: 320, height: 350 } });
await b.close();
