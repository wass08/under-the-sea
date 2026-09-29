import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const session = 'aquarium-spill-closeup', base = process.env.VERIFY_URL || 'http://localhost:4175/';
const run = (...args) => execFileSync('agent-browser', ['--session', session, '--json', ...args], { encoding: 'utf8', maxBuffer: 4e6 });
const evaluate = js => JSON.parse(run('eval', js)).data.result;
const until = condition => evaluate(`new Promise(resolve => { const tick = () => ${condition} ? resolve(true) : requestAnimationFrame(tick); tick(); })`);
const reports = [], lines = [];
const log = line => { lines.push(line); console.log(line); };
const report = label => {
  const r = evaluate('({afterCrack:window.aquarium.elapsed-window.spillCloseupStart,height:window.aquarium.height,spilling:window.aquarium.spilling,pixelRatio:window.aquarium.pixelRatio,puddle:window.aquarium.puddles[0]})');
  assert.ok(r.puddle.maxRadius <= 1.6);
  reports.push({label,...r});
  log(`${label}: radius=[${r.puddle.radius.map(v=>v.toFixed(3)).join(', ')}], max=${r.puddle.maxRadius.toFixed(3)} world units, sheetVolume=${r.puddle.sheetVolume.toFixed(5)}, depth=${r.puddle.poolDepth.toFixed(3)}`);
  return r;
};
function crack() {
  const target = evaluate('window.aquarium.crackTarget');
  evaluate(`window.spillCloseupStart=null; window.pondFirstContact=null; window.pourFPS=[];
    document.addEventListener('pointerup',()=>{window.spillCloseupStart=window.aquarium.elapsed;},{once:true});
    const sample=()=>{const s=window.aquarium,age=s.elapsed-window.spillCloseupStart;
      if(window.spillCloseupStart!==null){if(!window.pondFirstContact&&s.puddles.length)window.pondFirstContact=s.puddles[0].maxRadius;if(age>1&&age<3)window.pourFPS.push(s.fps);if(age>3)return;}
      requestAnimationFrame(sample);};requestAnimationFrame(sample);`);
  run('mouse','move',String(Math.round(target.x)),String(Math.round(target.y))); run('mouse','down'); run('mouse','up');
}
try {
  run('--webgpu','open',`${base}?camera=floor`);
  run('set','viewport','1920','1080');
  const browser = await chromium.connectOverCDP(JSON.parse(run('get','cdp-url')).data.cdpUrl);
  const page = browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith(base));
  assert.ok(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1.5,mobile:false});
  evaluate("dispatchEvent(new Event('resize'))");
  until('window.aquarium?.elapsed > 2');
  // Frame the hole and landing with the existing camera and its public dolly control.
  run('mouse','move','960','540'); run('mouse','wheel','-180');
  evaluate('new Promise(resolve=>setTimeout(resolve,600))'); crack();
  for (const seconds of [3,10]) {
    until(`window.aquarium.elapsed >= window.spillCloseupStart + ${seconds}`);
    report(`Pond ${seconds}s`); run('screenshot',`verify/spill-closeup-${seconds}s.png`);
  }
  until('!window.aquarium.spilling');
  const settled = report('Pond after drain');
  const first=evaluate('window.pondFirstContact'); log(`First contact radius: ${first.toFixed(3)} world units`);
  assert.ok(first>=.15&&first<.25);
  const frozen=settled.puddle.radius;
  until(`window.aquarium.elapsed >= ${settled.afterCrack} + window.spillCloseupStart + 1`);
  assert.deepEqual(evaluate('window.aquarium.puddles[0].radius'),frozen);
  run('press','r'); until('!window.aquarium.rewinding');
  assert.equal(evaluate('window.aquarium.puddles.length'),0); log('Stopped growth and rewind/reset: PASS');
  run('open',`${base}?camera=default`);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1.5,mobile:false});
  evaluate("dispatchEvent(new Event('resize'))");
  until('window.aquarium?.elapsed > 2'); crack();
  until('window.aquarium.elapsed >= window.spillCloseupStart + 12');
  report('Pond wide 12s'); run('screenshot','verify/spill-pond-wide.png');
  const performance=evaluate('({medianFPS:window.pourFPS.sort((a,b)=>a-b)[Math.floor(window.pourFPS.length/2)],samples:window.pourFPS.length,pixelRatio:window.aquarium.pixelRatio})');
  log(`Pour performance: ${JSON.stringify(performance)}`);
  await cdp.detach();
  await writeFile('verify/spill-closeup.json',JSON.stringify(reports,null,2));
  await writeFile('verify/spill-pond-evidence.txt',lines.join('\n')+'\n');
} finally { run('close'); }
