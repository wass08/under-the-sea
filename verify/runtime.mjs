import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { contrastPair } from './image-metrics.mjs';
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
  await page.waitForFunction(() => window.aquarium.fps >= 45 && window.aquarium.elapsed > 2 && window.aquarium.lampSequenceDone && window.aquarium.lampOn === 1, null, { timeout: 90000 }); await capture('idle');
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
    await page.goto(`${base}?camera=${preset}`); await page.waitForFunction(() => window.aquarium?.elapsed > 2 && window.aquarium.lampSequenceDone && window.aquarium.lampOn === 1);
    const shot = await capture(`pass-${preset}`);
    if(preset==='floor') {const s=await state();report('Unified floor light direction',{sunAzimuth:s.sunAzimuth,causticAzimuth:s.causticAzimuth,axisDifference:Math.abs(Math.abs(s.sunAzimuth-s.causticAzimuth)-180)});assert.ok(Math.abs(Math.abs(s.sunAzimuth-s.causticAzimuth)-180)<.001);}
    if (preset === 'front') {
      // Derive adjacent submerged rock faces from the current terrain, camera and lamp diagnostics.
      const pair = contrastPair(await state());
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
        // Projected tank crop, normalized for each image; excludes UI and the outside floor.
        const saturation=()=>{const d=ctx.getImageData(Math.round(pair.crop[0]*canvas.width),Math.round(pair.crop[1]*canvas.height),Math.round((pair.crop[2]-pair.crop[0])*canvas.width),Math.round((pair.crop[3]-pair.crop[1])*canvas.height)).data;let sum=0,n=0;for(let i=0;i<d.length;i+=4){const max=Math.max(d[i],d[i+1],d[i+2]),min=Math.min(d[i],d[i+1],d[i+2]);sum+=max?(max-min)/max:0;n++;}return sum/n;};
        const afterSaturation=saturation();
        const old=new Image();old.src='data:image/png;base64,'+before;await old.decode();ctx.drawImage(old,0,0);const beforeSaturation=saturation();
        return {lit,dark,ratio:lit/dark,pair,beforeSaturation,afterSaturation};
      }, {png:shot.toString('base64'),pair,before:(await readFile('verify/run-j/before-pass-front.png')).toString('base64')});
      report('Underwater contrast and saturation', contrast); assert.ok(contrast.ratio >= 1.8, 'Adjacent underwater rock contrast'); assert.ok(contrast.dark/contrast.lit >= .35, 'Shadow-side facets retain at least 35% luminance'); assert.ok(contrast.afterSaturation > contrast.beforeSaturation * 1.08, 'Tank saturation rises clearly');
    }
    report(`Camera ${preset} performance`, await performanceSample());
  }
  // A pristine release includes the dense core; a shatter after drainage has already lost it.
  await page.goto(`${base}?camera=default`); await page.waitForFunction(() => window.aquarium?.elapsed > 2 && window.aquarium.lampSequenceDone && window.aquarium.lampOn === 1);
  await page.keyboard.press('Space'); const pristineLaunch = await state();
  report('Run O pristine launch', pristineLaunch.physics.launch);
  assert.equal(pristineLaunch.shardBodies,220,'Single-wall Space remains full-density');
  assert.ok(pristineLaunch.physics.launch.radialFraction > .75);
  assert.ok(pristineLaunch.physics.launch.max > 8.4 && pristineLaunch.physics.launch.max < 9.6);
  await until(pristineLaunch.elapsed + .25); await capture('shatter-airborne');
  // Pin the default camera for repeatable pixel-to-wall impacts: auto-orbit plus
  // integer MouseEvent coordinates otherwise changes the crack origin between runs.
  await page.goto(`${base}?camera=default`); await page.waitForFunction(() => window.aquarium?.elapsed > 2 && window.aquarium.lampSequenceDone && window.aquarium.lampOn === 1);
  const target = (await state()).crackTarget;
  await page.mouse.click(target.x, target.y);
  const impact = await state(), start = impact.elapsed;
  assert.equal(impact.audio.lastPlay.kind, 'crack'); assert.equal(impact.audio.lastPlay.frame, impact.impactFrame, 'First crack sound is scheduled in the impact frame'); assert.equal(impact.audio.lastPlay.gain, 0.9);
  assert.equal(impact.cracks, 1); assert.equal(impact.wall, 0); assert.ok(impact.holeBottom < idle.height);
  await until(start + 0.6); await capture('crack');
  const cracked = await state(); assert.ok(cracked.brokenCount > 0); assert.equal(cracked.mode, 'cracked');
  await until(start + 3); await capture('spill');
  const spill = await state(); report('Spill', spill);
  assert.ok(spill.spillFlow[0].measuredLandings > 20); assert.ok(spill.spillFlow[0].meanRelativeError < .15);
  assert.deepEqual(spill.lightDirection, idle.lightDirection); assert.deepEqual(spill.lampPosition, idle.lampPosition);
  assert.ok(spill.water.agitation > .3, 'Flow agitates the Gerstner spectrum');
  assert.equal(spill.spilling, true); assert.ok(spill.height < idle.height - 0.2);
  await page.waitForFunction(() => !window.aquarium.spilling && Math.abs(window.aquarium.height - window.aquarium.holeBottom) < 0.05, null, { timeout: 90000 });
  const settled = await state(); report('Hole settled', settled); assert.ok(Math.abs(settled.height - settled.holeBottom) < 0.05);
  await page.keyboard.press('Space'); const fullImpact = await state(), fullStart = fullImpact.elapsed;
  report('Run O crack-then-shatter launch velocities at creation', fullImpact.physics.launch); assert.ok(fullImpact.physics.launch.max > 3.5); assert.ok(fullImpact.physics.launch.maxAngular <= 14.001);
  assert.equal(fullImpact.audio.lastPlay.kind, 'shatter'); assert.equal(fullImpact.audio.lastPlay.frame, fullImpact.impactFrame); assert.equal(fullImpact.audio.lastPlay.gain, 1);
  await until(fullStart + 0.25); await capture('shatter-after-crack-airborne');
  await until(fullStart + 1.5); await capture('shatter');
  const shattered = await state(); assert.equal(shattered.mode, 'shattered'); assert.ok(shattered.brokenCount > cracked.brokenCount); assert.equal(shattered.brokenCount,220,'First-wall budget stays at 100%, one body per cell'); assert.deepEqual(shattered.physics.wallBudgets.map(b=>[b.cells,b.fraction]),[[220,1]]);
  report('Shatter', shattered);
  const earlyRest = await page.evaluate(async start => {
    const read = () => window.aquarium; let reference, samples = 0, maxDisplacement = 0, maxRotation = 0;
    while (read().elapsed < start + 4) {
      await new Promise(requestAnimationFrame); const s = read(); if (s.elapsed < start + 3) continue;
      reference ??= s.shardTransforms; samples++;
      for (let i = 0; i < reference.length; i += 7) {
        const p = s.shardTransforms;
        maxDisplacement = Math.max(maxDisplacement, Math.hypot(...[0,1,2].map(k => p[i+k] - reference[i+k])));
        const a = reference.slice(i+3,i+7), b = p.slice(i+3,i+7), dot = a.reduce((n,v,k)=>n+v*b[k],0) / Math.hypot(...a) / Math.hypot(...b);
        maxRotation = Math.max(maxRotation, 2*Math.acos(Math.min(1,Math.abs(dot))));
      }
    }
    return { samples, maxDisplacement, maxRotation };
  }, fullStart);
  report('Settling 3–4 seconds (all rendered poses)', earlyRest);
  assert.ok(earlyRest.samples >= 30); assert.ok(earlyRest.maxDisplacement < 0.002); assert.ok(earlyRest.maxRotation < 0.01);
  await until(fullStart + 5); const sleep5 = await state(); report('Native sleep at five seconds', { awake: sleep5.awakeShards, fixedFallbacks: sleep5.physics.fixedFallbacks }); assert.equal(sleep5.awakeShards, 0, 'Native sleepers by five seconds');
  assert.equal((await state()).physics.fixedFallbacks, 0, 'No deadline used to pass early settling');
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
  const puddles=(await state()).puddles;assert.ok(puddles.length>0);
  assert.ok(puddles.every(p=>p.depthWrite===false));assert.equal(new Set(puddles.map(p=>p.position[1])).size,puddles.length,'Distinct puddle depths');
  const stability=await page.evaluate(async puddle=>{
    const source=document.querySelector('#app canvas'), canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const x=Math.round(puddle.sample.x*1.5)-32,y=Math.round(puddle.sample.y*1.5)-32,frames=[];
    const strip=document.createElement('canvas');strip.width=640;strip.height=64;const stripContext=strip.getContext('2d');
    for(let i=0;i<10;i++){await new Promise(requestAnimationFrame);ctx.drawImage(source,0,0);const data=ctx.getImageData(x,y,64,64);frames.push(data.data);stripContext.putImageData(data,i*64,0);}
    let max=0,sum=0,n=0,nonzero=0;
    for(let i=1;i<frames.length;i++)for(let j=0;j<frames[i].length;j++)if(j%4!==3){const d=Math.abs(frames[i][j]-frames[i-1][j]);max=Math.max(max,d);sum+=d;n++;if(frames[i][j]>0)nonzero++;}
    return {frames:10,x,y,width:64,height:64,maxChannelDifference:max,meanChannelDifference:sum/n,nonzero,strip:strip.toDataURL()};
  },puddles[0]);
  await writeFile('verify/run-j/puddle-10-frames.png',Buffer.from(stability.strip.split(',')[1],'base64'));delete stability.strip;
  report('Puddle consecutive-frame stability',stability);assert.ok(stability.nonzero>1000,'Read actual rendered pixels');assert.ok(stability.maxChannelDifference<=12,'No puddle brightness jump');
  await writeFile('verify/run-j/puddle-stability.json',JSON.stringify(stability,null,2));
  await capture('shatter-settled'); report('Shatter settled', await state()); report('Shattered performance', await performanceSample());
  await page.keyboard.press('t'); assert.equal((await state()).timeScale, 0.15);
  const t0 = await state(), realStart = Date.now(); await page.waitForTimeout(2000); const t1 = await state(), real = (Date.now() - realStart) / 1000;
  const rate = (t1.elapsed - t0.elapsed) / real; report('Slow motion rate', rate); assert.ok(Math.abs(rate - 0.15) < 0.025);
  await page.locator('#slow').click(); assert.equal((await state()).timeScale, 1);
  await page.keyboard.press('r'); const rewindAt = Date.now(), reverseStages = [];
  for (const [name, progress] of [['early', 0.20], ['mid', 0.50], ['late', 0.85]]) {
    await page.waitForFunction(p => window.aquarium.rewindProgress >= p, progress);
    const stage = await state(); reverseStages.push(stage); await capture(`rewind-${name}`);
    assert.equal(stage.rewinding, true); assert.ok(stage.rewindProgress < progress + 0.1);
    report(`Rewind ${name}`, { progress: stage.rewindProgress, height: stage.height, bodies: stage.shardBodies });
  }
  const mid = reverseStages[1]; assert.ok(mid.historyFrames <= 601);
  for (let i = 1; i < reverseStages.length; i++) {
    assert.ok(reverseStages[i].height > reverseStages[i - 1].height + 0.04, 'Water rises through distinct rewind stages');
    assert.ok(reverseStages[i].shardTransforms.some((v,j) => j % 7 < 3 && Math.abs(v - reverseStages[i-1].shardTransforms[j]) > 0.05), 'Distinct shard poses through rewind');
  }
  assert.ok(mid.shardTransforms.some((v, i) => i % 7 < 3 && Math.abs(v - pose10[i]) > 0.01), 'Rewind visibly moves shards back through their recorded poses');
  await page.waitForFunction(() => !window.aquarium.rewinding); const rewindDuration = (Date.now() - rewindAt) / 1000; report('Rewind duration', rewindDuration); assert.ok(rewindDuration > 3.0 && rewindDuration < 3.6); await page.waitForTimeout(4100); await capture('reset');
  const reset = await state(); assert.equal(reset.shardBodies, 0); assert.equal(reset.height, reset.tank.base); assert.equal(reset.mode, 'idle'); assert.equal(reset.cracks, 0); assert.equal(reset.brokenCount, 0); assert.equal(reset.spilling, false); assert.ok(Math.abs(reset.height - reset.tank.base) < 0.02); assert.ok(reset.bubbles > 0); assert.ok(reset.bubblePops > 0); assert.ok(reset.floorCausticIntensity > 0); report('Reset', reset);
  await page.mouse.move(1000, 470); await page.mouse.down(); await page.mouse.move(1100, 470, { steps: 12 }); await page.mouse.up(); assert.equal((await state()).hasImpact, false);
  await page.keyboard.press('t'); await page.locator('#shatter').click(); assert.equal((await state()).mode, 'shattered');
  const slowFrames = await page.evaluate(async () => { let last = window.aquarium.shardTransforms, moving = 0;
    for (let i=0;i<60;i++) { await new Promise(requestAnimationFrame); const poses=window.aquarium.shardTransforms;
      if (poses.some((v,j)=>j%7<3 && Math.abs(v-last[j])>1e-6)) moving++; last=poses;
    } return moving;
  });
  report('Slow-motion frames with shard movement', slowFrames); assert.ok(slowFrames > 45, 'Interpolated glass keeps moving smoothly between fixed physics steps');
  await page.keyboard.press('t'); await page.locator('#reset').click(); assert.equal((await state()).rewinding, true); await page.locator('#reset').click(); assert.equal((await state()).cracks, 0); assert.equal((await state()).shardBodies, 0);
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
  report('PASS', 'eight camera presets, Run L Gerstner waves/planar reflection/shore foam and depth-aware pour, stable puddle frames, unified floor light, saturation gain, underwater contrast >=1.8, bubbles/pop/reset, submerged motes, draining floor caustics, logo breakpoints, accessible hover/focus/touch spoiler, trimmed same-frame audio, crack/spill/sill, physics cap, 3–4s/8–10s rest and native sleep by 5s, 0.15× clock, 3.2s rewind with three distinct stages and skip, drag, branding, responsive layout, WebGPU guard');
} catch (error) { failed = error; console.error(error); report('Failure state', await state().catch(() => null)); await capture('failure').catch(() => {}); }
finally { await writeFile('verify/console.txt', logs.join('\n') + '\n'); await writeFile('verify/summary.txt', summary.join('\n') + '\n'); await writeFile('verify/runtime.txt', summary.join('\n') + '\n'); await browser.close(); }
if (failed) process.exitCode = 1;
