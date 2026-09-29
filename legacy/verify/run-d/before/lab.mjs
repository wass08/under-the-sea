import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('verify/lab', { recursive: true });
const logs = [], errors = [], summary = [];
const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
page.on('console', msg => { logs.push(`[${msg.type()}] ${msg.text()}`); if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', error => { errors.push(error.message); logs.push(`[uncaught] ${error.stack}`); });
const base = 'http://localhost:4174/';
const capture = async name => { await page.screenshot({ path: `verify/lab/${name}.png` }); };
const ready = async (bench, level) => {
  await page.waitForFunction(({ bench, level }) => window.lab?.ready && window.lab.state.bench === bench && window.lab.state.level === level, { bench, level }, { timeout: 90000 });
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('canvas').count(), 1, 'One live renderer canvas');
};
let failed;
try {
  let first = true, randomSeeds;
  for (const bench of ['terrain', 'caustics', 'shatter']) for (const level of [1, 2, 3]) {
    const hash = `#/lab/${bench}?level=${level}`;
    if (first) { await page.goto(base + hash); first = false; }
    else await page.evaluate(hash => { location.hash = hash; }, hash);
    await ready(bench, level);
    assert.equal(await page.locator('.lab-card .level-number').textContent(), `Level ${level} of 3`);
    await capture(`${bench}-L${level}`);
    const state = await page.evaluate(() => window.lab.state);
    if (bench === 'terrain' && level === 1) randomSeeds = state.seedCoordinates;
    if (bench === 'terrain' && level === 2) assert.deepEqual(state.seedCoordinates, randomSeeds, 'L1/L2 point coordinates match exactly');
    if (bench === 'terrain' && level === 3) {
      await page.evaluate(() => window.lab.setReveal({ wireframe: true, seeds: true })); await page.waitForTimeout(350); await capture('terrain-L3-reveal');
      await page.evaluate(() => window.lab.setReveal({ circumcircles: true })); await page.waitForTimeout(200);
      await page.evaluate(() => window.lab.setReveal({ circumcircles: false }));
    }
    if (bench === 'caustics' && level === 3) {
      await page.evaluate(() => window.lab.setReveal({ rawField: true, freeze: true })); await page.waitForTimeout(350); await capture('caustics-L3-raw');
      const frozen = await page.evaluate(() => window.lab.state.elapsed); await page.waitForTimeout(200); assert.equal(await page.evaluate(() => window.lab.state.elapsed), frozen);
    }
    if (bench === 'shatter') {
      await page.evaluate(() => window.lab.setReveal({ seeds: true, outlines: true })); await page.waitForTimeout(200); await capture(`shatter-L${level}-pattern`);
      await page.evaluate(() => window.lab.setReveal({ seeds: false, outlines: false }));
      const { paneCenter } = await page.evaluate(() => window.lab.state);
      const start = await page.evaluate(() => window.lab.state.elapsed);
      await page.mouse.click(paneCenter.x, paneCenter.y);
      await page.waitForFunction(() => window.lab.state.broken);
      await page.waitForFunction(start => window.lab.state.elapsed >= start + 1.2, start, { timeout: 60000 });
      await page.evaluate(() => window.lab.setReveal({ freeze: true })); await capture(`shatter-L${level}-broken`);
      const frozen = await page.evaluate(() => window.lab.state.elapsed); await page.waitForTimeout(200); assert.equal(await page.evaluate(() => window.lab.state.elapsed), frozen);
      await page.keyboard.press('r'); await page.waitForFunction(() => !window.lab.state.broken);
      await page.evaluate(() => window.lab.setReveal({ freeze: false, slowMotion: true }));
      assert.equal(await page.evaluate(() => window.lab.state.slowMotion), true);
    }
    if (bench === 'shatter') await page.evaluate(() => window.lab.setReveal({ slowMotion: false }));
    summary.push(`PASS ${bench} L${level}: WebGPU ready, screenshot captured${bench === 'shatter' ? ', click / physics / freeze / reset verified' : ''}`);
    console.log(summary.at(-1));
  }
  // Bench routing, keyboard level control, and the two page-boundary links.
  await page.locator('a[data-bench="terrain"]').click(); await ready('terrain', 3);
  await page.keyboard.press('1'); await ready('terrain', 1);
  await page.locator('button', { hasText: 'Regenerate seed' }).click();
  const regenerated = await page.evaluate(() => window.lab.state.seedCoordinates);
  await page.keyboard.press('ArrowRight'); await ready('terrain', 2);
  assert.deepEqual(await page.evaluate(() => window.lab.state.seedCoordinates), regenerated, 'Regenerated seed survives level changes');
  await page.locator('.lab-back').click();
  await page.waitForFunction(() => document.documentElement.dataset.status === 'ready' && window.aquarium, null, { timeout: 90000 });
  await page.waitForTimeout(1800); await capture('main');
  assert.equal(await page.evaluate(() => window.aquarium.renderer), 'WebGPU'); assert.equal(await page.locator('h1').textContent(), 'Aquarium');
  await page.locator('.enter-lab').click(); await ready('terrain', 3);
  assert.deepEqual(errors, [], 'No console errors, uncaught exceptions or shader errors');
  summary.push('PASS aquarium renders unchanged; both page links, Lab navigation and keyboard levels work.');
  summary.push(`Console: ${errors.length} errors; ${logs.filter(x => x.startsWith('[warning]')).length} warnings.`);
  console.log(summary.slice(-2).join('\n'));
} catch (error) { failed = error; console.error(error); await capture('failure').catch(() => {}); }
finally { await writeFile('verify/lab/console.txt', logs.join('\n') + '\n'); await writeFile('verify/lab/summary.txt', summary.join('\n') + '\n'); await browser.close(); }
if (failed) process.exitCode = 1;
