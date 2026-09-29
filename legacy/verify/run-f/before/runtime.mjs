import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('verify', { recursive: true });
const base = process.env.VERIFY_URL || 'http://localhost:4174/';
const logs = [], errors = [], summary = [];
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5 });
page.on('console', msg => { logs.push(`[${msg.type()}] ${msg.text()}`); if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', error => { errors.push(error.message); logs.push(`[uncaught] ${error.stack}`); });
const state = () => page.evaluate(() => window.aquarium);
const capture = name => page.screenshot({ path: `verify/${name}.png` });
const until = elapsed => page.waitForFunction(t => window.aquarium.elapsed >= t, elapsed, { timeout: 90000 });
const report = (label, value) => { const line = `${label}: ${JSON.stringify(value)}`; summary.push(line); console.log(line); };
// Sample without CDP screenshot readback stalls contaminating the FPS window.
const performanceSample = () => page.evaluate(async () => {
  const samples = [];
  for (let i = 0; i < 90; i++) { await new Promise(requestAnimationFrame); samples.push(window.aquarium.fps); }
  samples.sort((a, b) => a - b);
  return { medianFPS: samples[45], drawCalls: window.aquarium.drawCalls, pixelRatio: window.aquarium.pixelRatio };
});
let failed;
try {
  await page.goto(base);
  await page.waitForFunction(() => ['ready', 'unavailable', 'error'].includes(document.documentElement.dataset.status), null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.status), 'ready', 'WebGPU must actually render');
  await page.waitForFunction(() => window.aquarium.fps >= 45 && window.aquarium.elapsed > 2, null, { timeout: 90000 }); await capture('idle');
  const idle = await state(); report('Idle', idle);
  assert.equal(idle.renderer, 'WebGPU'); assert.equal(idle.pixelRatio, 1.5);
  report('Idle performance', await performanceSample());
  const target = (await state()).crackTarget;
  await page.mouse.click(target.x, target.y);
  const impact = await state(), start = impact.elapsed;
  assert.equal(impact.cracks, 1); assert.equal(impact.wall, 0); assert.ok(impact.holeBottom < idle.height);
  await until(start + 0.6); await capture('crack');
  const cracked = await state(); assert.ok(cracked.brokenCount > 0); assert.equal(cracked.mode, 'cracked');
  await until(start + 3); await capture('spill');
  const spill = await state(); report('Spill', spill);
  assert.equal(spill.spilling, true); assert.ok(spill.height < idle.height - 0.2);
  await page.waitForFunction(() => !window.aquarium.spilling && Math.abs(window.aquarium.height - window.aquarium.holeBottom) < 0.05, null, { timeout: 90000 });
  const settled = await state(); report('Hole settled', settled); assert.ok(Math.abs(settled.height - settled.holeBottom) < 0.05);
  await page.keyboard.press('Space'); const fullStart = (await state()).elapsed;
  await until(fullStart + 0.3); await capture('shatter-airborne');
  await until(fullStart + 1.5); await capture('shatter');
  const shattered = await state(); assert.equal(shattered.mode, 'shattered'); assert.ok(shattered.brokenCount > cracked.brokenCount); assert.ok(shattered.brokenCount <= 400);
  report('Shatter', shattered);
  await until(fullStart + 5); await capture('shatter-settled'); report('Shatter settled', await state()); report('Shattered performance', await performanceSample());
  await page.keyboard.press('t'); assert.equal((await state()).timeScale, 0.15);
  const t0 = await state(), realStart = Date.now(); await page.waitForTimeout(2000); const t1 = await state(), real = (Date.now() - realStart) / 1000;
  const rate = (t1.elapsed - t0.elapsed) / real; report('Slow motion rate', rate); assert.ok(Math.abs(rate - 0.15) < 0.025);
  await page.locator('#slow').click(); assert.equal((await state()).timeScale, 1);
  await page.keyboard.press('r'); await page.waitForTimeout(4100); await capture('reset');
  const reset = await state(); assert.equal(reset.mode, 'idle'); assert.equal(reset.cracks, 0); assert.equal(reset.brokenCount, 0); assert.equal(reset.spilling, false); assert.ok(Math.abs(reset.height - 2.59) < 0.02); report('Reset', reset);
  await page.mouse.move(1000, 470); await page.mouse.down(); await page.mouse.move(1100, 470, { steps: 12 }); await page.mouse.up(); assert.equal((await state()).hasImpact, false);
  await page.locator('#shatter').click(); assert.equal((await state()).mode, 'shattered'); await page.locator('#reset').click(); assert.equal((await state()).cracks, 0);
  await page.keyboard.press('m'); await page.waitForFunction(() => document.querySelector('#sound').getAttribute('aria-pressed') === 'true'); await page.keyboard.press('m');
  await page.setViewportSize({ width: 900, height: 760 }); await page.waitForTimeout(300); await capture('responsive');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
  assert.equal(await page.locator('.socials a').count(), 4); assert.equal(await page.locator('.masthead img').getAttribute('alt'), 'Wawa Sensei');
  const fallback = await browser.newPage(); await fallback.addInitScript(() => { delete navigator.gpu; delete Navigator.prototype.gpu; }); await fallback.goto(base);
  await fallback.waitForFunction(() => document.documentElement.dataset.status === 'unavailable'); assert.match(await fallback.locator('#loading').textContent(), /WebGPU is unavailable/);
  assert.deepEqual(errors, [], 'No console, shader or uncaught errors');
  report('PASS', 'crack, spill, exact sill level, full shatter, physics cap, 0.15× clock, reset, drag, sound, branding, 900px layout, WebGPU guard');
} catch (error) { failed = error; console.error(error); await capture('failure').catch(() => {}); }
finally { await writeFile('verify/console.txt', logs.join('\n') + '\n'); await writeFile('verify/summary.txt', summary.join('\n') + '\n'); await browser.close(); }
if (failed) process.exitCode = 1;
