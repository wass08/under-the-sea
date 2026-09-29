// Usage: node tools/fishing-drag.mjs "<url>" <outPrefix>  -- cast, then recast elsewhere and capture the underwater drag (retrieving) + lure cam.
import { chromium } from 'playwright';
const [url = 'http://localhost:5190/', prefix = 'shots/fishing-drag'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = []; page.on('console', m => { if (['error'].includes(m.type())) logs.push(m.text().slice(0, 300)); }); page.on('pageerror', e => logs.push(e.message));
await page.goto(url);
await page.waitForFunction(() => document.documentElement.dataset.status === 'ready', null, { timeout: 60000 });
await page.evaluate(() => window.fishing.cast(13, 1));
const phase = () => page.evaluate(() => window.fishing.state.phase);
while ((await phase()) !== 'calm') await page.waitForTimeout(50);
console.log('recast', await page.evaluate(() => window.fishing.cast(4, 16)));
for (const [i, ms] of [[1, 350], [2, 500]]) { await page.waitForTimeout(ms); await page.screenshot({ path: `${prefix}-${i}.png` }); console.log(JSON.stringify(await page.evaluate(() => window.fishing.state))); }
console.log(logs.join('\n') || '(no errors)');
await browser.close();
