import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { verifyCameraPersistence } from './lab-camera-persist.mjs';
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
  let first = true;
  for (const bench of ['terrain', 'caustics', 'shatter']) for (const level of [1, 2, 3]) {
    const hash = `#/lab/${bench}?level=${level}`;
    if (first) { await page.goto(base + hash); first = false; }
    else await page.evaluate(hash => { location.hash = hash; }, hash);
    await ready(bench, level);
    assert.equal(await page.locator('.lab-card .level-number').textContent(), `Level ${level} of 3`);
    await capture(`${bench}-L${level}`);
    const benchState = await state();
    if (bench === 'terrain') {
      const { seedCoordinates, seedCount, triangleCount, level: terrainLevel } = benchState, tolerance = 1e-6;
      const points = Array.from({ length: seedCount }, (_, i) => seedCoordinates.slice(i * 2, i * 2 + 2));
      const axes = [0, 1].map(axis => [...new Set(points.map(p => p[axis]))].sort((a, b) => a - b));
      const [lo, hi] = [axes[0][0], axes[0].at(-1)], size = hi - lo;
      const boundary = points.filter(p => p.some(v => Math.abs(v - lo) < tolerance || Math.abs(v - hi) < tolerance));
      const interior = points.filter(p => p.every(v => v > lo + tolerance && v < hi - tolerance));
      assert.equal(seedCoordinates.length, seedCount * 2); assert.equal(terrainLevel, level);
      assert.equal(triangleCount, 2 * seedCount - boundary.length - 2, 'Diagnostics describe a triangulated square');
      for (const axis of [0, 1]) for (const edge of [lo, hi]) {
        const side = points.filter(p => Math.abs(p[axis] - edge) < tolerance).map(p => p[1 - axis]).sort((a, b) => a - b);
        assert.ok(side.length > 2 && Math.abs(side[0] - lo) < tolerance && Math.abs(side.at(-1) - hi) < tolerance, 'Boundary ring includes all four sides and corners');
        const step = size / (side.length - 1);
        assert.ok(side.every((v, i) => Math.abs(v - lo - i * step) < tolerance), 'Boundary ring is evenly spaced');
      }
      if (level < 3) {
        assert.equal(benchState.smooth, level === 1, 'Smooth defaults only on the dense grid');
        assert.equal(benchState.sampling, 'grid');
        assert.equal(seedCount, level === 1 ? 29929 : 1521, 'Dense count does not leak into coarse grid');
        assert.equal(axes[0].length * axes[1].length, seedCount, 'Grid fills its lattice');
        assert.equal(new Set(points.map(p => p.join(','))).size, seedCount, 'No duplicate lattice vertices');
        for (const axis of axes) {
          assert.ok(axis.length <= Math.sqrt(seedCount) + 1, 'Grid is a square lattice');
          assert.ok(axis.every((v, i) => Math.abs(v - lo - i * size / (axis.length - 1)) < tolerance), 'Grid lattice is evenly spaced');
        }
        if (level === 1) {
          await page.evaluate(() => { window.terrainHeightAt = window.lab.state.heightAt; });
          const fps = await page.evaluate(async () => {
            const samples = [];
            for (let i = 0; i < 120; i++) { await new Promise(requestAnimationFrame); samples.push(parseInt(document.querySelector('.lab-fps').textContent)); }
            samples.sort((a, b) => a - b); return samples[Math.floor(samples.length / 2)];
          });
          summary.push(`Terrain L1 default: ${seedCount} vertices, ${triangleCount} triangles, median on-screen ${fps} FPS (1600×1000).`);
          await page.evaluate(() => window.lab.setReveal({ wireframe: true })); await page.waitForTimeout(350); await capture('terrain-L1-wireframe');
          await page.evaluate(() => window.lab.setReveal({ wireframe: false }));
        }
      } else {
        // The straight boundary ring is appended after sampling and is not Poisson-excluded.
        let minDistance = Infinity;
        for (let i = 0; i < interior.length; i++) for (let j = 0; j < i; j++) minDistance = Math.min(minDistance, Math.hypot(interior[i][0] - interior[j][0], interior[i][1] - interior[j][1]));
        assert.equal(benchState.sampling, 'poisson'); assert.equal(benchState.smooth, false);
        assert.equal(benchState.count, 1500, 'Dense count does not leak into Poisson');
        const minimumRadius = size / Math.sqrt(benchState.count) * 1.05 / Math.sqrt(4.25);
        assert.ok(minDistance >= minimumRadius - tolerance, 'L3 respects the smallest slope-weighted Poisson radius');
        await page.evaluate(() => window.lab.setReveal({ sampling: 'random' })); await page.waitForTimeout(350);
        const random = await state();
        assert.equal(random.sampling, 'random'); assert.equal(random.seedCount, random.count + 4 * Math.ceil(Math.sqrt(random.count)));
        const randomPoints = Array.from({ length: random.count }, (_, i) => random.seedCoordinates.slice(i * 2, i * 2 + 2));
        assert.ok(new Set(randomPoints.map(p => p[0])).size > random.count * .9, 'Random points are not on a lattice');
        let randomMinDistance = Infinity;
        for (let i = 0; i < randomPoints.length; i++) for (let j = 0; j < i; j++) randomMinDistance = Math.min(randomMinDistance, Math.hypot(randomPoints[i][0] - randomPoints[j][0], randomPoints[i][1] - randomPoints[j][1]));
        assert.ok(randomMinDistance < .5 * minDistance, 'Random clumps are closer than Poisson samples');
        await capture('terrain-L3-random');
        await page.evaluate(() => window.lab.setReveal({ sampling: 'poisson' }));
        assert.deepEqual((await state()).meshPositions, benchState.meshPositions, 'Returning to Poisson restores the exact geometry');
      }
      {
        const heightErrors = await page.evaluate(() => {
          const { heightAt, meshPositions } = window.lab.state, errors = [];
          for (let i = 0; i < 8; i++) {
            const offset = Math.floor((meshPositions.length / 3 - 1) * i / 7) * 3, [x, y, z] = meshPositions.slice(offset, offset + 3);
            errors.push(Math.abs(heightAt(x, z) - y), Math.abs(window.terrainHeightAt(x, z) - y));
          }
          return errors;
        });
        assert.ok(heightErrors.every(error => error < tolerance), 'Every level samples the same analytic field within 1e-6');
      }
    }
    if (bench === 'terrain') {
      await page.evaluate(smooth => window.lab.setReveal({ smooth }), !benchState.smooth);
      assert.equal((await state()).smooth, !benchState.smooth);
      assert.deepEqual((await state()).meshPositions, benchState.meshPositions, 'Smooth reveal preserves geometry');
      await page.evaluate(smooth => window.lab.setReveal({ smooth }), benchState.smooth);
    }
    if (bench === 'terrain' && level === 3) {
      await page.evaluate(() => window.lab.setReveal({ wireframe: true, seeds: true })); await page.waitForTimeout(350); await capture('terrain-L3-reveal');
    }
    if (bench === 'caustics') {
      const parameters = await page.locator('.lab-pane').innerText();
      assert.ok(parameters.includes('scaleA') && parameters.includes('intensity') && parameters.includes('cell seeds'));
      assert.equal(parameters.includes('scaleB'), level === 3);
      assert.equal(parameters.includes('rgb offset'), level === 3);
      assert.equal(parameters.includes('sharpness'), level >= 2);
      assert.ok(!parameters.includes('sine'));
      const moving = benchState.elapsed; await page.waitForTimeout(150);
      assert.ok((await state()).elapsed > moving, 'Animated features share the simulation clock');
      await page.evaluate(() => window.lab.setReveal({ rawField: true, freeze: true })); await page.waitForTimeout(350); await capture(`caustics-L${level}-raw`);
      const frozen = await page.evaluate(() => window.lab.state.elapsed); await page.waitForTimeout(200); assert.equal(await page.evaluate(() => window.lab.state.elapsed), frozen);
      await page.evaluate(() => window.lab.setReveal({ rawField: false, freeze: false }));
    }
    if (bench === 'shatter') {
      await page.evaluate(() => window.lab.setReveal({ seeds: true, outlines: true })); await page.waitForTimeout(200); await capture(`shatter-L${level}-pattern`);
      await page.evaluate(() => window.lab.setReveal({ seeds: false, outlines: false }));
      await page.evaluate(() => window.lab.setReveal({ freeze: true }));
      // Each settling fixture starts with the same fresh, frozen native world.
      // Idle ticks before a release otherwise make this narrow rest-window check vary.
      await page.keyboard.press('r'); await page.waitForFunction(() => window.lab.state.elapsed === 0 && !window.lab.state.broken);
      const { paneCenter } = await state();
      await page.mouse.click(paneCenter.x, paneCenter.y);
      await page.waitForFunction(() => window.lab.state.broken);
      const launched = await state();
      assert.equal(launched.shardTransforms.length, launched.shardCount);
      assert.equal(launched.bodyCount, launched.shardCount + 2);
      assert.equal(launched.colliderCount, launched.cellCount + 2, 'One convex collider per visible cell');
      assert.equal(launched.shardCount, launched.cellCount, 'Every Lab cell is an independent body');
      assert.ok(launched.cellsPerBody.every(n => n === 1));
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
  await verifyCameraPersistence(page, ready, summary);
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
  const regenerated = await page.evaluate(() => ({ seed: window.lab.state.seed, heights: [[0, 0], [1, -2], [-3, 4]].map(([x, z]) => window.lab.state.heightAt(x, z)) }));
  await page.keyboard.press('ArrowRight'); await ready('terrain', 2);
  assert.deepEqual(await page.evaluate(() => ({ seed: window.lab.state.seed, heights: [[0, 0], [1, -2], [-3, 4]].map(([x, z]) => window.lab.state.heightAt(x, z)) })), regenerated, 'Regenerated seed and height field survive level changes');
  await page.locator('.lab-back').click();
  await page.waitForFunction(() => document.documentElement.dataset.status === 'ready' && window.aquarium, null, { timeout: 90000 });
  await page.waitForTimeout(1800); await capture('main');
  assert.equal(await page.evaluate(() => window.aquarium.renderer), 'WebGPU'); assert.equal(await page.locator('h1').textContent(), 'Aquarium');
  await page.locator('.enter-lab').click(); await ready('terrain', 1);
  assert.deepEqual(errors, [], 'No console errors, uncaught exceptions or shader errors');
  summary.push('PASS aquarium renders; both page links, Lab navigation and keyboard levels work.');
  summary.push(`Console: ${errors.length} errors; ${logs.filter(x => x.startsWith('[warning]')).length} warnings.`);
  console.log(summary.slice(-2).join('\n'));
} catch (error) { failed = error; console.error(error); await capture('failure').catch(() => {}); }
finally { await writeFile('verify/run-k/lab-physics.json',JSON.stringify(physicsEvidence,null,2)); await writeFile('verify/lab/console.txt', logs.join('\n') + '\n'); await writeFile('verify/lab/summary.txt', summary.join('\n') + '\n'); await browser.close(); }
if (failed) process.exitCode = 1;
