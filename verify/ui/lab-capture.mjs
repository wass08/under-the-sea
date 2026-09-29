import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: chromium.executablePath(), headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const base=process.env.VERIFY_URL||'http://localhost:4174/';
await mkdir('verify/ui',{recursive:true});
const page = await browser.newPage({deviceScaleFactor:1});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.setViewportSize({ width: 1600, height: 1000 });
  for (const [bench, level] of [['terrain', 3], ['caustics', 1], ['shatter', 2]]) {
    await page.goto(`${base}#/lab/${bench}?level=${level}`);
    await page.waitForFunction(() => window.lab?.ready, null, { timeout: 90000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await page.screenshot({ path: `verify/ui/lab-${bench}-L${level}.png` });
    console.log(`CAPTURE ${bench} L${level}: 1600x1000`);
  }
  const styles = await page.evaluate(() => {
    const selectors = ['.lab-sidebar', '.lab-card', '.lab-sidebar nav a.active', '.lab-pane .tp-rotv', '.lab-pane .tp-lblv_l', '.lab-pane .tp-btnv_b'];
    return Object.fromEntries(selectors.map(selector => {
      const node = document.querySelector(selector), style = getComputedStyle(node);
      return [selector, { color: style.color, background: style.backgroundColor, radius: style.borderRadius, border: style.borderColor }];
    }));
  });
  await page.keyboard.press('Tab');
  await page.focus('#lab-level');
  const focus = await page.$eval('#lab-level', node => ({ outline: getComputedStyle(node).outline, offset: getComputedStyle(node).outlineOffset }));
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto(`${base}#/lab/terrain?level=3`);
  await page.waitForFunction(() => window.lab?.ready, null, { timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(resolve => setTimeout(resolve, 1500));
  await page.evaluate(() => document.activeElement?.blur());
  await page.screenshot({ path: 'verify/ui/lab-terrain-L3-mobile.png' });
  console.log('CAPTURE terrain L3: 430x900');
  await writeFile('verify/ui/lab-styles.json', JSON.stringify({ styles, focus, errors }, null, 2));
  console.log(JSON.stringify({ styles, focus, errors }));
} finally { await browser.close(); }
