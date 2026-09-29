import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [], results = [];
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const state = () => page.evaluate(() => window.aquarium);
const click = async p => { await page.mouse.click(p.x, p.y); await page.waitForTimeout(200); };
try {
  await page.goto('http://localhost:4174/'); await page.waitForFunction(() => window.aquarium?.elapsed > 2, null, { timeout: 90000 });
  await click((await state()).aboveTarget);
  const above = await state(); assert.equal(above.cracks, 1); assert.ok(above.holeBottom > 2.59); assert.equal(above.spilling, false);
  await page.waitForTimeout(1000); assert.equal((await state()).height, 2.59); results.push('PASS above-water crack: no jet/drips, no drainage');
  await click((await state()).wallTargets[0]); assert.equal((await state()).cracks, 1); results.push('PASS one crack per wall');
  await click((await state()).wallTargets[2]); assert.equal((await state()).cracks, 2); assert.equal((await state()).spilling, true);
  await page.mouse.move(900, 350); await page.mouse.down(); await page.mouse.move(1440, 350, { steps: 30 }); await page.mouse.up(); await page.waitForTimeout(2000);
  await click((await state()).wallTargets[1]); assert.equal((await state()).cracks, 3);
  await click((await state()).wallTargets[3]); assert.equal((await state()).cracks, 4);
  const multi = await state(); assert.equal(multi.holeBottom, Math.min(...multi.holes.map(h => h.bottom))); results.push('PASS four cracks: independent openings and lowest sill target');
  await page.keyboard.press('Space'); await page.waitForTimeout(1800); const full = await state(); assert.equal(full.mode, 'shattered'); assert.ok(full.brokenCount <= 400); results.push(`PASS four-wall full break: ${full.brokenCount} bodies, ${full.drawCalls} draw calls, ${full.fps} FPS`);
  await page.keyboard.press('r'); await page.waitForTimeout(200); const reset = await state(); assert.equal(reset.cracks, 0); assert.equal(reset.brokenCount, 0); assert.equal(reset.height, 2.59); assert.equal(reset.spilling, false);
  assert.deepEqual(errors, []); results.push('PASS reset after four-wall break; zero console errors');
  console.log(results.join('\n')); await writeFile('verify/edges-summary.txt', results.join('\n') + '\n');
} finally { await browser.close(); }
