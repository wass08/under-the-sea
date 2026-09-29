import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5});
page.on('pageerror',e=>console.log(e.message));page.on('console',m=>{if(m.type()==='error')console.log(m.text())});
await page.goto('http://localhost:4174/?camera=default');await page.waitForFunction(()=>window.aquarium?.elapsed>2,null,{timeout:90000});await page.screenshot({path:'verify/run-n/look.png'});console.log(JSON.stringify(await page.evaluate(()=>({fps:aquarium.fps,light:aquarium.lightDirection}))));await browser.close();
