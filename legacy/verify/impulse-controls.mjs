import {chromium} from 'playwright';import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']}),page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const state=()=>page.evaluate(()=>window.lab.state),ready=async level=>page.waitForFunction(level=>window.lab?.ready&&window.lab.state.level===level,level,{timeout:90000});
const reset=async()=>{await page.keyboard.press('r');await page.waitForFunction(()=>window.lab.state.elapsed===0&&!window.lab.state.broken);};
const hit=async()=>{const p=(await state()).paneCenter;await page.mouse.click(p.x,p.y);await page.waitForFunction(()=>window.lab.state.broken);};
const input=name=>page.locator('.tp-lblv').filter({has:page.locator('.tp-lblv_l',{hasText:new RegExp(`^${name}$`)})}).locator('input');
try{await page.goto(`${process.env.VERIFY_URL||'http://localhost:4175/'}#/lab/shatter?level=3`);await ready(3);await page.evaluate(()=>window.lab.setReveal({freeze:true}));await reset();
 await page.evaluate(()=>window.lab.setReveal({impulse:1.6,falloff:3.8,forward:.6,spin:1,burstVersion:0}));await page.evaluate(()=>location.hash='/lab/shatter?level=2');await ready(2);await page.evaluate(()=>location.hash='/lab/shatter?level=3');await ready(3);
 const defaults=await state();assert.deepEqual(Object.fromEntries(['impulse','falloff','forward','spin'].map(k=>[k,defaults[k]])),{impulse:1.35,falloff:4.8,forward:.9,spin:1.35});await hit();const initial=await state();
 const values={impulse:2.2,falloff:2.5,forward:.75,spin:1.4};for(const [key,value]of Object.entries(values)){await input(key).fill(String(value));await input(key).press('Enter');}
 const edited=await state();for(const[k,v]of Object.entries(values))assert.ok(Math.abs(edited[k]-v)<1e-9);assert.deepEqual(edited.launch,initial.launch);assert.deepEqual(edited.shardTransforms,initial.shardTransforms,'Editing burst controls leaves the frozen current release alone');
 await page.evaluate(()=>location.hash='/lab/shatter?level=2');await ready(2);let s=await state();for(const[k,v]of Object.entries(values))assert.ok(Math.abs(s[k]-v)<1e-9);assert.equal(s.freeze,true);
 await page.evaluate(()=>location.hash='/lab/shatter?level=3');await ready(3);await hit();s=await state();assert.notDeepEqual(s.launch,initial.launch,'New controls are applied on the next break');
 await page.evaluate(()=>location.hash='/lab/shatter?level=1');await ready(1);for(const k of Object.keys(values))assert.equal(await input(k).isDisabled(),true,'Naive L1 leaves burst controls disabled');
 assert.deepEqual(errors,[]);console.log('PASS Lab controls: one-time old-settings migration, new defaults, real Tweakpane edits, next-break application, settings persistence, frozen poses and unchanged L1.');
}finally{await browser.close();}
