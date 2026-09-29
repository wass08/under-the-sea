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
await page.addInitScript(() => { window.maxMotesAbove = 0; const check = () => { if (window.aquarium) window.maxMotesAbove = Math.max(window.maxMotesAbove, window.aquarium.motesAboveSurface); requestAnimationFrame(check); }; requestAnimationFrame(check); });
const state = () => page.evaluate(() => window.aquarium);
const capture = name => page.screenshot({ path: `verify/${name}.png` });
const until = elapsed => page.waitForFunction(t => window.aquarium.elapsed >= t, elapsed, { timeout: 90000 });
const report = (label, value) => { if (value && typeof value === 'object' && 'shardTransforms' in value) { const { shardTransforms, ...rest } = value; value = rest; } const line = `${label}: ${JSON.stringify(value)}`; summary.push(line); console.log(line); };
// Sample without CDP screenshot readback stalls contaminating the FPS window.
const performanceSample = async () => { const result = await page.evaluate(async () => {
  const samples = [];
  for (let i = 0; i < 90; i++) { await new Promise(requestAnimationFrame); samples.push(window.aquarium.fps); }
  samples.sort((a, b) => a - b);
  return { medianFPS: samples[45], drawCalls: window.aquarium.drawCalls, pixelRatio: window.aquarium.pixelRatio };
}); assert.ok(result.medianFPS >= 55, `60 FPS target (55 FPS scheduling tolerance): ${result.medianFPS}`); return result; };
let failed;
try {
  await page.goto(base);
  await page.waitForFunction(() => ['ready', 'unavailable', 'error'].includes(document.documentElement.dataset.status), null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.status), 'ready', 'WebGPU must actually render');
  await page.waitForFunction(() => window.aquarium.fps >= 45 && window.aquarium.elapsed > 2, null, { timeout: 90000 }); await capture('idle');
  const idle = await state(); report('Idle', idle);
  assert.ok(idle.bubbles > 0); assert.ok(idle.motes > 0); assert.equal(idle.motesAboveSurface, 0); assert.ok(idle.floorCausticIntensity > 0);
  report('Run H idle draw calls (Run G baseline 48)', { before: 48, after: idle.drawCalls });
  assert.equal(idle.renderer, 'WebGPU'); assert.equal(idle.pixelRatio, 1.5);
  report('Idle performance', await performanceSample());
  assert.equal(await page.title(), 'Aquarium · Wawa Sensei');
  assert.equal(await page.locator('.masthead img').evaluate(e => e.getBoundingClientRect().width), 96);
  const spoiler = page.locator('.topic-spoiler');
  assert.equal(await spoiler.getAttribute('aria-label'), 'Reveal the topic');
  await spoiler.focus(); assert.equal(await spoiler.getAttribute('aria-expanded'), 'true');
  await spoiler.evaluate(e => e.blur()); assert.equal(await spoiler.getAttribute('aria-expanded'), 'false');
  await spoiler.click(); await page.mouse.move(800, 100); assert.equal(await spoiler.getAttribute('aria-expanded'), 'true');
  await spoiler.click(); await page.mouse.move(800, 100); assert.equal(await spoiler.getAttribute('aria-expanded'), 'false');
  assert.equal(idle.audio.muted, false); assert.equal(idle.audio.ready, true);
  assert.ok(Math.abs(idle.audio.offsets.glass - 0.414) < 0.025); assert.ok(Math.abs(idle.audio.offsets.bubbles - 0.39) < 0.025);
  await capture('pass-default');
  for (const preset of ['34', 'front', 'low', 'plaque', 'floor']) {
    await page.goto(`${base}?camera=${preset}`); await page.waitForFunction(() => window.aquarium?.elapsed > 2);
    const shot = await capture(`pass-${preset}`);
    if (preset === 'front') {
      // Same adjacent rock facets as Run G (1916/2096), reprojected for the new camera target.
      const contrast = await page.evaluate(async png => {
        const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        const sample = (x, y) => { const data = ctx.getImageData(x - 2, y - 2, 5, 5).data; let sum = 0;
          for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) {
            const v = data[i + c] / 255, linear = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            sum += linear * [0.2126, 0.7152, 0.0722][c];
          } return sum / 25;
        };
        const lit = sample(1924, 943), dark = sample(1936, 955); return { lit, dark, ratio: lit / dark };
      }, shot.toString('base64'));
      report('Run H underwater facet contrast', contrast); assert.ok(contrast.ratio >= 1.8);
    }
    report(`Camera ${preset} performance`, await performanceSample());
  }
  await page.goto(base); await page.waitForFunction(() => window.aquarium?.elapsed > 2);
  const target = (await state()).crackTarget;
  await page.mouse.click(target.x, target.y);
  const impact = await state(), start = impact.elapsed;
  assert.equal(impact.audio.lastPlay.kind, 'crack'); assert.equal(impact.audio.lastPlay.frame, impact.impactFrame, 'First crack sound is scheduled in the impact frame'); assert.equal(impact.audio.lastPlay.gain, 0.9);
  assert.equal(impact.cracks, 1); assert.equal(impact.wall, 0); assert.ok(impact.holeBottom < idle.height);
  await until(start + 0.6); await capture('crack');
  const cracked = await state(); assert.ok(cracked.brokenCount > 0); assert.equal(cracked.mode, 'cracked');
  await until(start + 3); await capture('spill');
  const spill = await state(); report('Spill', spill);
  assert.equal(spill.spilling, true); assert.ok(spill.height < idle.height - 0.2);
  await page.waitForFunction(() => !window.aquarium.spilling && Math.abs(window.aquarium.height - window.aquarium.holeBottom) < 0.05, null, { timeout: 90000 });
  const settled = await state(); report('Hole settled', settled); assert.ok(Math.abs(settled.height - settled.holeBottom) < 0.05);
  await page.keyboard.press('Space'); const fullImpact = await state(), fullStart = fullImpact.elapsed;
  assert.equal(fullImpact.audio.lastPlay.kind, 'shatter'); assert.equal(fullImpact.audio.lastPlay.frame, fullImpact.impactFrame); assert.equal(fullImpact.audio.lastPlay.gain, 1);
  await until(fullStart + 0.3); await capture('shatter-airborne');
  await until(fullStart + 1.5); await capture('shatter');
  const shattered = await state(); assert.equal(shattered.mode, 'shattered'); assert.ok(shattered.brokenCount > cracked.brokenCount); assert.ok(shattered.brokenCount <= 400);
  report('Shatter', shattered);
  await until(fullStart + 8); const pose8 = (await state()).shardTransforms;
  await until(fullStart + 10); const pose10 = (await state()).shardTransforms;
  assert.equal(pose8.length, pose10.length); assert.ok(pose8.length > 0);
  let maxDisplacement = 0, maxRotation = 0;
  for (let i = 0; i < pose8.length; i += 7) {
    maxDisplacement = Math.max(maxDisplacement, Math.hypot(...pose8.slice(i, i + 3).map((v, j) => v - pose10[i + j])));
    const a = pose8.slice(i + 3, i + 7), b = pose10.slice(i + 3, i + 7);
    const dot = a.reduce((s, v, j) => s + v * b[j], 0) / (Math.hypot(...a) * Math.hypot(...b));
    maxRotation = Math.max(maxRotation, 2 * Math.acos(Math.min(1, Math.abs(dot))));
  }
  assert.ok(maxDisplacement < 1e-4); assert.ok(maxRotation < 1e-3); assert.equal((await state()).awakeShards, 0);
  report('Settling 8–10 seconds', { maxDisplacement, maxRotation, shards: pose8.length / 7 });
  assert.equal((await state()).bubbles, 0); assert.equal((await state()).motes, 0); assert.ok((await state()).floorCausticIntensity < 1e-6);
  assert.equal(await page.evaluate(() => window.maxMotesAbove), 0, 'No live mote above the tilted water surface during idle, crack, slosh or drain');
  await capture('shatter-settled'); report('Shatter settled', await state()); report('Shattered performance', await performanceSample());
  await page.keyboard.press('t'); assert.equal((await state()).timeScale, 0.15);
  const t0 = await state(), realStart = Date.now(); await page.waitForTimeout(2000); const t1 = await state(), real = (Date.now() - realStart) / 1000;
  const rate = (t1.elapsed - t0.elapsed) / real; report('Slow motion rate', rate); assert.ok(Math.abs(rate - 0.15) < 0.025);
  await page.locator('#slow').click(); assert.equal((await state()).timeScale, 1);
  await page.keyboard.press('r'); await page.waitForFunction(() => window.aquarium.rewindProgress > 0.45); await capture('rewind-mid'); const mid = await state(); assert.equal(mid.rewinding, true); assert.ok(mid.historyFrames <= 601);
  assert.ok(mid.shardTransforms.some((v, i) => i % 7 < 3 && Math.abs(v - pose10[i]) > 0.01), 'Rewind visibly moves shards back through their recorded poses');
  await page.waitForFunction(() => !window.aquarium.rewinding); await page.waitForTimeout(4100); await capture('reset');
  const reset = await state(); assert.equal(reset.shardBodies, 0); assert.equal(reset.height, 2.59); assert.equal(reset.mode, 'idle'); assert.equal(reset.cracks, 0); assert.equal(reset.brokenCount, 0); assert.equal(reset.spilling, false); assert.ok(Math.abs(reset.height - 2.59) < 0.02); assert.ok(reset.bubbles > 0); assert.ok(reset.bubblePops > 0); assert.ok(reset.floorCausticIntensity > 0); report('Reset', reset);
  await page.mouse.move(1000, 470); await page.mouse.down(); await page.mouse.move(1100, 470, { steps: 12 }); await page.mouse.up(); assert.equal((await state()).hasImpact, false);
  await page.locator('#shatter').click(); assert.equal((await state()).mode, 'shattered'); await page.locator('#reset').click(); assert.equal((await state()).rewinding, true); await page.locator('#reset').click(); assert.equal((await state()).cracks, 0); assert.equal((await state()).shardBodies, 0);
  await page.keyboard.press('m'); await page.waitForFunction(() => document.querySelector('#sound').getAttribute('aria-pressed') === 'false'); await page.keyboard.press('m');
  await page.setViewportSize({ width: 900, height: 760 }); await page.waitForTimeout(300); await capture('responsive');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
  assert.equal(await page.locator('.masthead img').evaluate(e => e.getBoundingClientRect().width), 80);
  await page.setViewportSize({ width: 640, height: 760 }); assert.equal(await page.locator('.masthead img').evaluate(e => e.getBoundingClientRect().width), 72);
  assert.equal(await page.locator('.socials a').count(), 4); assert.equal(await page.locator('.masthead img').getAttribute('alt'), 'Wawa Sensei');
  const touch = await browser.newPage({ viewport: { width: 640, height: 760 }, hasTouch: true });
  await touch.goto(base); await touch.waitForFunction(() => window.aquarium?.elapsed > 1);
  const touchSpoiler = touch.locator('.topic-spoiler');
  await touchSpoiler.tap(); assert.equal(await touchSpoiler.getAttribute('aria-expanded'), 'true');
  await touchSpoiler.tap(); await touch.waitForFunction(() => getComputedStyle(document.querySelector('.topic-spoiler')).filter === 'blur(5px)');
  assert.equal(await touchSpoiler.getAttribute('aria-expanded'), 'false');
  assert.equal(await touchSpoiler.evaluate(e => getComputedStyle(e).filter), 'blur(5px)'); await touch.close();
  const fallback = await browser.newPage(); await fallback.addInitScript(() => { delete navigator.gpu; delete Navigator.prototype.gpu; }); await fallback.goto(base);
  await fallback.waitForFunction(() => document.documentElement.dataset.status === 'unavailable'); assert.match(await fallback.locator('#loading').textContent(), /WebGPU is unavailable/);
  assert.deepEqual(errors, [], 'No console, shader or uncaught errors');
  report('PASS', 'six camera presets, underwater contrast >=1.8, bubbles/pop/reset, submerged motes, draining floor caustics, logo breakpoints, accessible hover/focus/touch spoiler, trimmed same-frame audio, crack/spill/sill, physics cap and 8–10s rest, 0.15× clock, rewind and skip, drag, branding, responsive layout, WebGPU guard');
} catch (error) { failed = error; console.error(error); await capture('failure').catch(() => {}); }
finally { await writeFile('verify/console.txt', logs.join('\n') + '\n'); await writeFile('verify/summary.txt', summary.join('\n') + '\n'); await browser.close(); }
if (failed) process.exitCode = 1;
