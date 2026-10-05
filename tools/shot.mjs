// Usage: node tools/shot.mjs <url> <out.png> [waitMs=4000] [--eval "js expression run after load"] [--w 1600 --h 900]
// Starts nothing: point it at a running dev server (npm run dev -- --port XXXX).
// Prints console errors/warnings and JSON of window.school after the wait.
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const evalJs = flag('--eval', null), width = Number(flag('--w', 1600)), height = Number(flag('--h', 900));
const [url, out = 'shots/shot.png', wait = '4000'] = args;
const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`.slice(0, 600)); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
try { await page.waitForFunction(() => ['ready', 'error', 'unavailable'].includes(document.documentElement.dataset.status), null, { timeout: 60000 }); }
catch { logs.push('[shot] timed out waiting for data-status'); }
if (evalJs) { try { console.log('eval:', JSON.stringify(await page.evaluate(evalJs))); } catch (e) { logs.push('[eval] ' + e.message); } }
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
console.log('status:', await page.evaluate(() => document.documentElement.dataset.status));
console.log('school:', JSON.stringify(await page.evaluate(() => (window).school ?? null)));
console.log(logs.slice(0, 40).join('\n') || '(no console errors)');
await browser.close();
