// Usage: node tools/fishing-seq.mjs "<url>" <outPrefix> [--w 1600 --h 900] [--miss]
// Drives window.fishing headlessly through cast -> bite -> hook -> catch and screenshots key moments.
// Point it at a running dev server. Example: node tools/fishing-seq.mjs "http://localhost:5193/?fishingCam=cast" shots/fishing-seq
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const width = Number(flag('--w', 1600)), height = Number(flag('--h', 900)), miss = bool('--miss');
const [url, prefix = 'shots/fishing-seq'] = args;
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`.slice(0, 500)); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => document.documentElement.dataset.status === 'ready', null, { timeout: 60000 });
await page.waitForTimeout(800);
const state = () => page.evaluate(() => window.fishing.state);
const shot = async name => { await page.screenshot({ path: `${prefix}-${name}.png` }); };
const waitPhase = async (phase, timeout = 40000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if ((await state()).phase === phase) return true; await page.waitForTimeout(40); }
  return false;
};
console.log('cast accepted:', await page.evaluate(() => window.fishing.cast(-0.5, -0.4)));
await page.waitForTimeout(250); await shot('1-windup'); console.log(JSON.stringify(await state()));
await page.waitForTimeout(450); await shot('2-flight'); console.log(JSON.stringify(await state()));
await page.waitForTimeout(500); await shot('3-splash'); console.log(JSON.stringify(await state()));
await page.waitForTimeout(700); await shot('4-splash2');
await waitPhase('scared'); await waitPhase('calm'); await shot('5-calm');
await waitPhase('curious'); await shot('6-curious'); console.log(JSON.stringify(await state()));
const gotBite = await waitPhase('bite'); console.log('bite:', gotBite);
await page.waitForTimeout(150); await shot('7-bite'); console.log(JSON.stringify(await state()));
if (miss) {
  await waitPhase('missed'); await page.waitForTimeout(300); await shot('8-missed'); console.log(JSON.stringify(await state()));
} else {
  console.log('hook:', await page.evaluate(() => window.fishing.hook()));
  await page.waitForTimeout(250); await shot('8-jerk');
  await page.waitForTimeout(600); await shot('9-pull');
  await page.waitForTimeout(650); await shot('10-surface');
  await page.waitForTimeout(500); await shot('11-air');
  await waitPhase('celebrate'); await page.waitForTimeout(350); await shot('12-celebrate'); console.log(JSON.stringify(await state()));
  await waitPhase('idle'); await page.waitForTimeout(500); await shot('13-caught'); console.log(JSON.stringify(await state()));
}
console.log(logs.slice(0, 30).join('\n') || '(no console errors)');
await browser.close();
