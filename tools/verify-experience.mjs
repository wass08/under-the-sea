// Real WebGPU integration check. Usage: node tools/verify-experience.mjs http://127.0.0.1:5188
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:5188';
const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    // Exercise the real mix without playing test sounds through the machine's speakers.
    const connect = AudioNode.prototype.connect, silentOutputs = new WeakMap();
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination === this.context.destination) {
        let silent = silentOutputs.get(this.context);
        if (!silent) {
          silent = this.context.createGain(); silent.gain.value = 0;
          connect.call(silent, destination); silentOutputs.set(this.context, silent);
        }
        return connect.call(this, silent, ...args);
      }
      return connect.call(this, destination, ...args);
    };
    // Observe the real mix, including mute, instead of asserting that a cue function was called.
    const original = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function() {
      const gain = original.call(this);
      if (!window.audioProbe) {
        const analyser = this.createAnalyser(); analyser.fftSize = 512;
        gain.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        window.audioProbe = { peak: 0, rms: 0 };
        setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, v) => sum + v*v, 0) / samples.length);
          window.audioProbe.rms = rms; window.audioProbe.peak = Math.max(window.audioProbe.peak, rms);
        }, 16);
      }
      return gain;
    };
  });
  await page.goto(url + '/?debug');
  await page.waitForFunction(() => document.documentElement.dataset.status === 'ready', null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.school.count), 4096);
  assert.equal(await page.evaluate(() => window.fishing.settings.hookWindow), 3.25);
  assert.equal(await page.evaluate(() => window.fishing.audio.state.context), 'locked');
  await page.getByRole('button', { name: 'Mute sound', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fishing.audio.state.muted), true);
  await page.getByRole('button', { name: 'Enable sound', exact: true }).click();
  await page.getByRole('button', { name: 'Auto-fish A', exact: true }).click();
  await page.evaluate(() => { window.fishing.settings.autoSuccess = 0; });
  const phase = p => page.waitForFunction(p => window.fishing.state.phase === p, p, { timeout: 90000 });
  await phase('bite');
  await page.evaluate(() => window.fishing.auto(false));
  await page.screenshot({ path: '/tmp/aquarium-verified-bite.png' });
  await page.waitForFunction(() => window.fishing.game.t > 2, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.fishing.state.phase), 'bite', 'Bite remains hookable after two seconds');
  const attachment = await page.evaluate(async () => {
    const hook = window.fishing.game.hookPoint, knot = window.fishing.game.lure;
    const aux = await window.fishDebug.readAux();
    return {
      hookToKnot: hook.distanceTo(knot),
      renderAnchorError: hook.distanceTo(window.fishDebug.env.lurePos.value),
      attached: aux.some((value, i) => i % 4 === 3 && value > 1.5 && value < 2.5),
    };
  });
  assert(attachment.attached, 'The real GPU school contains an attached fish');
  assert(attachment.hookToKnot > .15, 'The metal hook tip is distinct from the line knot');
  assert(attachment.renderAnchorError < .001, 'The fish rendering anchor follows the current metal hook tip');
  assert(await page.getByRole('button', { name: 'Hook fish', exact: true }).isVisible());
  await page.screenshot({ path: '/tmp/aquarium-verified-bite-clear.png' });
  await page.keyboard.press('Space');
  await phase('reeling');
  await page.waitForFunction(() => window.fishing.state.caught === 1, null, { timeout: 10000 });
  assert(await page.evaluate(() => window.audioProbe.peak > 0.001), 'Actual audio mix contains sound');
  await page.screenshot({ path: '/tmp/aquarium-verified-catch.png' });
  await page.getByRole('button', { name: 'Mute sound', exact: true }).click();
  await page.waitForTimeout(600);
  assert(await page.evaluate(() => window.audioProbe.rms < 0.0001), 'Mute silences actual output');
  await page.getByRole('button', { name: 'Enable sound', exact: true }).click();
  await page.evaluate(() => window.fishing.auto(true));
  await phase('bite');
  await page.evaluate(() => window.fishing.auto(false));
  const before = await page.evaluate(() => window.school.count);
  await phase('missed');
  assert.equal(await page.evaluate(() => window.fishing.state.caught), 1);
  assert.equal(await page.evaluate(() => window.school.count), before);
  assert.equal(await page.evaluate(() => window.fishing.state.biter), 'none');
  assert(!(await page.getByRole('button', { name: 'Hook fish', exact: true }).isVisible()));
  await page.setViewportSize({ width: 390, height: 844 });
  await phase('bite');
  await page.screenshot({ path: '/tmp/aquarium-verified-mobile-bite.png' });
  const bounds = await page.getByRole('button', { name: 'Hook fish', exact: true }).boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844, 'Touch hook prompt stays on screen');
  await page.getByRole('button', { name: 'Hook fish', exact: true }).click();
  await page.waitForFunction(() => window.fishing.state.caught === 2, null, { timeout: 10000 });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(1000);
  const perf = await page.evaluate(async () => {
    const ms = []; let previous = performance.now();
    for (let i = 0; i < 240; i++) { await new Promise(requestAnimationFrame); const now = performance.now(); ms.push(now-previous); previous = now; }
    ms.sort((a,b) => a-b);
    return { fps: 1000 / (ms.reduce((a,b) => a+b) / ms.length), p95Ms: ms[Math.floor(ms.length * .95)], school: window.school, lod: window.fishDebug.lodStats, tris: window.fishDebug.tris };
  });
  // Exercise all three school controls through their actual UI.
  await page.getByRole('button', { name: 'Milling M', exact: true }).click();
  await page.getByRole('button', { name: 'Fountain F', exact: true }).click();
  await page.getByRole('button', { name: 'Flash X', exact: true }).click();
  await page.waitForTimeout(500);
  assert(await page.evaluate(() => window.fishDebug.school.behaviour.milling));
  assert.notEqual(await page.evaluate(() => window.fishDebug.school.behaviour.predator), 'off');
  // Sustained frame pressure should lower render resolution, without changing school size.
  const originalRatio = await page.evaluate(() => window.school.pixelRatio);
  await page.evaluate(() => {
    window.framePressure = true;
    const load = () => { if (!window.framePressure) return; const start = performance.now(); while (performance.now() - start < 38) {} requestAnimationFrame(load); };
    requestAnimationFrame(load);
  });
  await page.waitForFunction(r => window.school.pixelRatio < r, originalRatio, { timeout: 15000 });
  await page.evaluate(() => { window.framePressure = false; });
  assert.equal(await page.evaluate(() => window.school.count), before);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ passed: ['WebGPU', '3.25s bite', 'late Space hook', 'button hook', 'catch', 'miss and retry', 'audible output', 'mute', 'school behaviours', 'mobile hook layout', 'adaptive resolution', 'no console errors'], perf }, null, 2));
} finally { await browser.close(); }
