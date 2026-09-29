import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5});
for(const preset of ['front','default','34']){
 await page.goto(`http://localhost:4174/?camera=${preset}`);await page.waitForFunction(()=>window.aquarium?.elapsed>2);
 await page.screenshot({path:`verify/run-g/current-${preset}.png`});
}
await browser.close();
