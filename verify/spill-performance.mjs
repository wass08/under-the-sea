import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true,args:['--enable-unsafe-webgpu','--enable-features=Vulkan,UseSkiaRenderer','--use-angle=metal','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1.5});
try {
  for (const port of process.argv.slice(2).map(Number)) {
    await page.goto(`http://localhost:${port}/?camera=shore`);
    await page.waitForFunction(() => window.aquarium?.elapsed > 2);
    const samples = await page.evaluate(async () => {const result=[];for(let i=0;i<180;i++){await new Promise(requestAnimationFrame);result.push(window.aquarium.fps);}return result;});
    samples.sort((a,b)=>a-b); console.log(JSON.stringify({port,medianFPS:samples[90],minFPS:samples[0],maxFPS:samples.at(-1)}));
  }
} finally { await browser.close(); }
