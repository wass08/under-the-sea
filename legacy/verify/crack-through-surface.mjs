import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan,UseSkiaRenderer','--use-angle=metal','--ignore-gpu-blocklist']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1.5});
  if(process.env.CRACK_ORDER==='0'||process.env.CRACK_DEPTH_TEST==='off') await page.route('**/assets/aquarium-*.js',async route=>{
    const response=await route.fetch(),source=await response.text();
    const changed=process.env.CRACK_ORDER==='0'?source.replace(/(\w+)\.renderOrder=4,(\w+)\.position\.copy/g,'$1.renderOrder=0,$2.position.copy'):source.replace('opacity:.72,depthWrite:!1','opacity:.72,depthWrite:!1,depthTest:!1');
    assert.notEqual(changed,source,'Find the crack-line counterfactual in the built bundle');
    await route.fulfill({response,body:changed});
  });
  await page.goto((process.env.VERIFY_URL||'http://localhost:4174/')+'?camera=front');
  await page.waitForFunction(()=>window.aquarium?.elapsed>2);
  // Move close to the pane with the normal OrbitControls dolly, then lower the eye.
  await page.mouse.move(640,450);
  for(let i=0;i<2;i++){await page.mouse.wheel(0,-700);await page.waitForTimeout(200);}
  await page.mouse.down();await page.mouse.move(640,444,{steps:3});await page.mouse.up();await page.waitForTimeout(800);
  const target=await page.evaluate(()=>{const a=window.aquarium.crackTarget,b=window.aquarium.aboveTarget;return {x:a.x,y:(a.y+b.y)/2};});
  await page.mouse.click(target.x,target.y);
  await page.waitForTimeout(80);
  await page.keyboard.press('t');
  assert.equal(await page.evaluate(()=>window.aquarium.cracks),1);
  await page.screenshot({path:`verify/crack-through-surface${process.env.CRACK_SUFFIX||''}.png`,clip:{x:330,y:200,width:660,height:460}});
  console.log(JSON.stringify(await page.evaluate(()=>({camera:window.aquarium.camera.position,water:window.aquarium.height,cracks:window.aquarium.cracks}))));
  if(process.env.CRACK_OCCLUSION) {
    // Walk around to the opposite side: the island is now in front of the cracked pane.
    await page.mouse.move(400,450);await page.mouse.down();await page.mouse.move(850,450,{steps:12});await page.mouse.up();await page.waitForTimeout(1800);
    await page.screenshot({path:`verify/crack-rock-occlusion${process.env.CRACK_SUFFIX||''}.png`,clip:{x:200,y:200,width:850,height:480}});
  }
} finally {await browser.close();}
