import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5 });
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
  const multi = await state(), lowestSill = Math.min(...multi.holes.map(h => h.bottom));
  assert.ok(multi.height > lowestSill + 0.05, 'Drainage must still be in progress before measuring settlement');
  await page.waitForFunction(sill => !window.aquarium.spilling && Math.abs(window.aquarium.height - sill) < 0.001, lowestSill, { timeout: 90000 });
  const settled = await state(); assert.ok(settled.height < multi.height); assert.ok(Math.abs(settled.height - lowestSill) < 0.001); assert.equal(settled.spilling, false);
  results.push(`PASS four cracks: water drained from ${multi.height} to lowest sill ${settled.height}; spilling stopped`);
  await page.keyboard.press('Space'); const start = (await state()).elapsed;
  const motion = await page.evaluate(async start => {
    let poses, samples = 0, displacement = 0, rotation = 0; const fps = [];
    while (window.aquarium.elapsed < start + 5.1) {
      await new Promise(requestAnimationFrame); const s = window.aquarium;
      fps.push({t:s.elapsed-start,fps:s.fps});
      if (s.elapsed < start+3 || s.elapsed > start+4) continue;
      poses ??= s.shardTransforms; samples++;
      for (let i=0;i<poses.length;i+=7) { const p=s.shardTransforms;
        displacement=Math.max(displacement, Math.hypot(...[0,1,2].map(k=>p[i+k]-poses[i+k])));
        const a=poses.slice(i+3,i+7),b=p.slice(i+3,i+7),dot=a.reduce((n,v,k)=>n+v*b[k],0)/Math.hypot(...a)/Math.hypot(...b);
        rotation=Math.max(rotation,2*Math.acos(Math.min(1,Math.abs(dot))));
      }
    }
    return {samples,displacement,rotation,awake:window.aquarium.awakeShards,drawCalls:window.aquarium.drawCalls,fps};
  },start);
  console.log(JSON.stringify(motion)); await writeFile('verify/run-i/four-wall.json',JSON.stringify(motion,null,2));
  assert.ok(motion.samples >= 30); assert.ok(motion.displacement < 0.002); assert.ok(motion.rotation < 0.01); assert.equal(motion.awake, 0);
  for (let second=0;second<5;second++) { const samples=motion.fps.filter(s=>s.t>=second&&s.t<second+1).map(s=>s.fps).sort((a,b)=>a-b); assert.ok(samples[Math.floor(samples.length/2)] >=55); }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
