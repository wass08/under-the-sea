import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contrastPair } from '../image-metrics.mjs';
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
  assert.equal(idle.water.waves,6); assert.deepEqual(idle.water.resolution,[128,80]); assert.equal(idle.water.reflection,'planar-quarter');
  assert.ok(idle.bubbles > 0); assert.ok(idle.motes > 0); assert.equal(idle.motesAboveSurface, 0); assert.ok(idle.floorCausticIntensity > 0);
  report('Run J idle draw calls (Run I baseline 56)', { before: 56, after: idle.drawCalls });
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
  for (const preset of ['34', 'front', 'low', 'surface', 'shore', 'plaque', 'floor']) {
    await page.goto(`${base}?camera=${preset}`); await page.waitForFunction(() => window.aquarium?.elapsed > 2);
    const shot = await capture(`pass-${preset}`);
    if(preset==='floor') {const s=await state();report('Unified floor light direction',{sunAzimuth:s.sunAzimuth,causticAzimuth:s.causticAzimuth,axisDifference:Math.abs(Math.abs(s.sunAzimuth-s.causticAzimuth)-180)});assert.ok(Math.abs(Math.abs(s.sunAzimuth-s.causticAzimuth)-180)<.001);}
    if (preset === 'front') {
      // Run J changes the topology: select adjacent visible rock faces by normal/light orientation.
      const pair = contrastPair();
      const contrast = await page.evaluate(async ({png,pair,before}) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        const sample = (x, y) => { const data = ctx.getImageData(x - 2, y - 2, 5, 5).data; let sum = 0;
          for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) {
            const v = data[i + c] / 255, linear = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            sum += linear * [0.2126, 0.7152, 0.0722][c];
          } return sum / 25;
        };
        const lit = sample(...pair.litPixel), dark = sample(...pair.darkPixel);
        // Fixed tank-interior crop shared by Run I and Run J; excludes UI and floor.
        const saturation=()=>{const d=ctx.getImageData(650,350,1570,900).data;let sum=0,n=0;for(let i=0;i<d.length;i+=4){const max=Math.max(d[i],d[i+1],d[i+2]),min=Math.min(d[i],d[i+1],d[i+2]);sum+=max?(max-min)/max:0;n++;}return sum/n;};
        const afterSaturation=saturation();
        const old=new Image();old.src='data:image/png;base64,'+before;await old.decode();ctx.drawImage(old,0,0);const beforeSaturation=saturation();
        return {lit,dark,ratio:lit/dark,pair,beforeSaturation,afterSaturation};
      }, {png:shot.toString('base64'),pair,before:(await readFile('verify/run-j/before-pass-front.png')).toString('base64')});
      report('Underwater contrast and saturation', contrast); assert.ok(contrast.ratio >= 1.8, 'Adjacent underwater rock contrast'); assert.ok(contrast.afterSaturation > contrast.beforeSaturation * 1.08, 'Tank saturation rises clearly');
    }
    report(`Camera ${preset} performance`, await performanceSample());
  }
} finally { await browser.close(); }
