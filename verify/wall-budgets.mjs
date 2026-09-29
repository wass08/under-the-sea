import {chromium} from 'playwright';import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']}),page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=process.env.VERIFY_URL||'http://localhost:4175/',open=async query=>{await page.goto(`${base}?camera=default&${query}`);await page.waitForFunction(()=>window.aquarium?.elapsed>2&&window.aquarium.lampSequenceDone&&window.aquarium.lampOn===1,null,{timeout:90000});};
try{
 // Compare actual main-page releases at solver boundaries, independent of rendered frame timing.
 const trajectories=[];for(const budget of ['full','adaptive']){await open(`wallBudget=${budget}&burstProbe&burstUntil=5`);await page.keyboard.press('Space');await page.waitForFunction(()=>window.burstProbe.steps.length>=300,null,{timeout:90000});trajectories.push(await page.evaluate(()=>window.burstProbe.steps.slice(0,300).map(s=>s.bodies.map(b=>[...Object.values(b.p),...Object.values(b.q),...Object.values(b.v),...Object.values(b.w),b.sleep]))));}
 assert.deepEqual(trajectories[1],trajectories[0]);console.log('PASS main-page single-wall trajectories: all 300 physics steps bit-identical with full and adaptive budgets.');
 await open('wallBudgetProbe&pondProbe');const rows=[];let earlier=[];
 for(const wall of [0,2,1,3]){const records=await page.evaluate(w=>window.wallBudgetProbe.prime([w]),wall),bodies=await page.evaluate(()=>window.wallBudgetProbe.bodies());assert.deepEqual(bodies.slice(0,earlier.length),earlier,'Earlier flying bodies keep their handles, geometry and masses');earlier=bodies;
  const r=records.at(-1);rows.push({walls:records.length,wall,cells:r.cells,fraction:r.fraction,core:r.coreCells,crackBodies:bodies.length,spaceBodies:records.reduce((n,r)=>n+r.cells,0)});
 }
 assert.deepEqual(rows.map(r=>r.cells),[220,176,143,110]);await page.evaluate(()=>window.pondProbe.arm(.3));await page.keyboard.press('Space');await page.waitForFunction(()=>window.pondProbe.frozen);
 const state=await page.evaluate(()=>window.aquarium);assert.equal(state.shardBodies,649);assert.deepEqual(state.physics.wallBudgets.map(b=>b.cells),rows.map(r=>r.cells),'Space reuses sequentially assigned per-wall patterns without reducing existing fragments');
 await page.evaluate(()=>window.pondProbe.view([-10,13,13],[0,.5,0]));await page.waitForTimeout(150);
 await mkdir('verify/perf-after',{recursive:true});await page.screenshot({path:'verify/perf-after/four-wall-budget.png'});const age=await page.evaluate(()=>window.pondProbe.age);
 // Measure each Space prefix in a fresh real main-page world, not just its planned sum.
 for(const count of [1,2,3]){await open('wallBudgetProbe');await page.evaluate(walls=>window.wallBudgetProbe.prime(walls),[0,2,1,3].slice(0,count));await page.keyboard.press('Space');const s=await page.evaluate(()=>window.aquarium);assert.equal(s.shardBodies,rows[count-1].spaceBodies);rows[count-1].spaceBodies=s.shardBodies;}
 await writeFile('verify/perf-after/wall-budgets.json',JSON.stringify({rows,age,physics:state.physics},null,2));
 console.log('walls wall cells fraction core live-after-crack total-after-Space');for(const r of rows)console.log(`${r.walls} ${r.wall} ${r.cells} ${r.fraction.toFixed(4)} ${r.core} ${r.crackBodies} ${r.spaceBodies}`);
 console.log('PASS four-wall budgets: 649 bodies after Space; existing flying fragments untouched; all four core bursts captured at 0.3 s.');assert.deepEqual(errors,[]);
}finally{await browser.close();}
