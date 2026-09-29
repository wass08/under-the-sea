import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('verify/lab', { recursive: true });
const logs = [], errors = [], summary = [], physicsEvidence = [];
const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
// Track listeners on long-lived targets; a detached canvas count cannot reveal these leaks.
await page.addInitScript(() => {
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  const listeners = new WeakMap();
  EventTarget.prototype.addEventListener = function(type, callback, options) {
    if (callback && !(typeof options === 'object' && options?.once)) {
      const entries = listeners.get(this) ?? []; listeners.set(this, entries);
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      if (!entries.some(e => e.type === type && e.callback === callback && e.capture === capture)) entries.push({ type, callback, capture });
    }
    return add.call(this, type, callback, options);
  };
  EventTarget.prototype.removeEventListener = function(type, callback, options) {
    const entries = listeners.get(this) ?? [], capture = typeof options === 'boolean' ? options : !!options?.capture;
    const i = entries.findIndex(e => e.type === type && e.callback === callback && e.capture === capture);
    if (i >= 0) entries.splice(i, 1);
    return remove.call(this, type, callback, options);
  };
  window.labListenerCounts = () => [window, document, document.querySelector('canvas')].map(target => (listeners.get(target) ?? []).length);
});
page.on('console', msg => { logs.push(`[${msg.type()}] ${msg.text()}`); if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', error => { errors.push(error.message); logs.push(`[uncaught] ${error.stack}`); });
const base = (process.env.VERIFY_URL || 'http://localhost:4174/');
const capture = async name => { await page.screenshot({ path: `verify/lab/${name}.png` }); };
const state = () => page.evaluate(() => window.lab.state);
const resources = async () => {
  const s = await state();
  return { physics: s.physics, gpu: Object.fromEntries(['geometries', 'attributes', 'indexAttributes', 'textures', 'renderTargets', 'programs', 'uniformBuffers'].map(key => [key, s.resources[key]])), listeners: await page.evaluate(() => window.labListenerCounts()) };
};
const ready = async (bench, level) => {
  await page.waitForFunction(({ bench, level }) => window.lab?.ready && window.lab.state.bench === bench && window.lab.state.level === level, { bench, level }, { timeout: 90000 });
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('canvas').count(), 1, 'One live renderer canvas');
  assert.equal(await page.locator('.lab-pane > .tp-rotv').count(), 1, 'One live Tweakpane');
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
    const benchState = await state();
    if (bench === 'terrain' && level === 1) randomSeeds = benchState.seedCoordinates;
    if (bench === 'terrain' && level === 2) assert.deepEqual(benchState.seedCoordinates, randomSeeds, 'L1/L2 point coordinates match exactly');
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
      await page.evaluate(() => window.lab.setReveal({ freeze: true }));
      const { paneCenter } = await state();
      await page.mouse.click(paneCenter.x, paneCenter.y);
      await page.waitForFunction(() => window.lab.state.broken);
      const launched = await state();
      assert.equal(launched.shardTransforms.length, launched.shardCount);
      assert.equal(launched.bodyCount, launched.shardCount + 2);
      assert.equal(launched.colliderCount, launched.cellCount + 2, 'One convex collider per visible cell, including compound plates');
      assert.ok(launched.launch.maxAngular <= 14.001);
      console.log(`L${level} launch: ${JSON.stringify(launched.launch)}; impact: ${JSON.stringify(launched.impact)}`);
      await page.evaluate(() => window.lab.setReveal({ freeze: false }));
      await page.waitForFunction(start => window.lab.state.elapsed >= start + 0.3, launched.elapsed, { timeout: 60000 });
      await page.evaluate(() => window.lab.setReveal({ freeze: true })); await capture(`shatter-L${level}-broken`);
      const frozen = await state();
      const moved = frozen.shardTransforms.filter((pose, i) => Math.hypot(...pose.slice(0, 3).map((v, j) => v - launched.shardTransforms[i][j])) > 0.1).length;
      assert.ok(moved > launched.shardCount / 2, 'Most shards must physically move, not just advance a clock');
      await page.waitForTimeout(200); const still = await state();
      assert.equal(still.elapsed, frozen.elapsed); assert.deepEqual(still.shardTransforms, frozen.shardTransforms, 'Freeze holds mesh transforms');
      await page.evaluate(() => window.lab.setReveal({ freeze: false }));
      const rest = await page.evaluate(async start => {
        let reference, samples=0,maxDisplacement=0,maxRotation=0;
        while(window.lab.state.elapsed<start+4) {
          await new Promise(requestAnimationFrame);const s=window.lab.state;if(s.elapsed<start+3)continue;
          reference ??= s.shardTransforms;samples++;
          for(let i=0;i<reference.length;i++) {
            const a=reference[i],b=s.shardTransforms[i];maxDisplacement=Math.max(maxDisplacement,Math.hypot(...b.slice(0,3).map((v,k)=>v-a[k])));
            const q=a.slice(3),r=b.slice(3),dot=q.reduce((n,v,k)=>n+v*r[k],0)/Math.hypot(...q)/Math.hypot(...r);maxRotation=Math.max(maxRotation,2*Math.acos(Math.min(1,Math.abs(dot))));
          }
        }
        return {samples,maxDisplacement,maxRotation};
      },launched.elapsed);
      assert.ok(rest.samples>=30,'Sample the full rendered 3–4 second window');
      assert.ok(rest.maxDisplacement<.002,`L${level} displacement ${rest.maxDisplacement}`);assert.ok(rest.maxRotation<.01,`L${level} rotation ${rest.maxRotation}`);
      await page.waitForFunction(start=>window.lab.state.elapsed>=start+5,launched.elapsed);
      const asleep=await state();assert.equal(asleep.awakeCount,0);assert.equal(asleep.fixedFallbacks,0);
      physicsEvidence.push({level,launch:launched.launch,rest,awake5:asleep.awakeCount});console.log(`L${level} settling: ${JSON.stringify(rest)}; awake at 5 s: ${asleep.awakeCount}`);
      await page.keyboard.press('r'); await page.waitForFunction(() => !window.lab.state.broken);
      const reset = await state(); assert.equal(reset.bodyCount, 2); assert.equal(reset.colliderCount, 2); assert.deepEqual(reset.shardTransforms, []);
      await page.evaluate(() => window.lab.setReveal({ freeze: false, slowMotion: true }));
      const rate = await page.evaluate(async () => {
        const start = performance.now(), elapsed = window.lab.state.elapsed;
        await new Promise(resolve => setTimeout(resolve, 1500));
        return (window.lab.state.elapsed - elapsed) / ((performance.now() - start) / 1000);
      });
      assert.ok(Math.abs(rate - 0.15) < 0.025, `Measured slow-motion rate ${rate}`);
    }
    if (bench === 'shatter') await page.evaluate(() => window.lab.setReveal({ slowMotion: false }));
    summary.push(`PASS ${bench} L${level}: WebGPU ready, screenshot captured${bench === 'shatter' ? ', click / physics / freeze / reset verified' : ''}`);
    console.log(summary.at(-1));
  }
  // Warm the same shader variants used by the cycles before comparing allocations.
  await page.evaluate(() => { location.hash = '#/lab/caustics?level=2'; }); await ready('caustics', 2);
  await page.evaluate(() => { location.hash = '#/lab/terrain?level=1'; }); await ready('terrain', 1);
  await page.evaluate(() => { location.hash = '#/lab/shatter?level=3'; }); await ready('shatter', 3);
  // Repeat identical cycles; actual GPU allocations and WASM worlds must return to baseline.
  const baseline = await resources();
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let reset = 0; reset < 2; reset++) {
      const { paneCenter } = await state(); await page.mouse.click(paneCenter.x, paneCenter.y);
      await page.waitForFunction(() => window.lab.state.broken && window.lab.state.bodyCount > 2);
      await page.keyboard.press('r'); await page.waitForFunction(() => !window.lab.state.broken && window.lab.state.bodyCount === 2);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(await resources(), baseline, `Reset ${reset + 1} in cycle ${cycle + 1} releases shard allocations`);
    }
    await page.evaluate(() => { location.hash = '#/lab/caustics?level=2'; }); await ready('caustics', 2);
    assert.deepEqual((await state()).physics, { worlds: 0, bodies: 0, colliders: 0 }, 'Leaving shatter frees its world');
    await page.evaluate(() => { location.hash = '#/lab/terrain?level=1'; }); await ready('terrain', 1);
    assert.deepEqual((await state()).physics, { worlds: 0, bodies: 0, colliders: 0 });
    await page.evaluate(() => { location.hash = '#/lab/shatter?level=3'; }); await ready('shatter', 3);
    assert.deepEqual(await resources(), baseline, `No resource/listener growth after reset and route cycle ${cycle + 1}`);
  }
  summary.push(`PASS repeated reset/bench cycles: stable allocations and listeners ${JSON.stringify(baseline)}`);
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
  summary.push('PASS aquarium renders; both page links, Lab navigation and keyboard levels work.');
  summary.push(`Console: ${errors.length} errors; ${logs.filter(x => x.startsWith('[warning]')).length} warnings.`);
  console.log(summary.slice(-2).join('\n'));
} catch (error) { failed = error; console.error(error); await capture('failure').catch(() => {}); }
finally { await writeFile('verify/run-k/lab-physics.json',JSON.stringify(physicsEvidence,null,2)); await writeFile('verify/lab/console.txt', logs.join('\n') + '\n'); await writeFile('verify/lab/summary.txt', summary.join('\n') + '\n'); await browser.close(); }
if (failed) process.exitCode = 1;
