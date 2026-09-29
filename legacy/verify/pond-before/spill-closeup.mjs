import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const session = 'aquarium-spill-closeup';
const run = (...args) => execFileSync('agent-browser', ['--session', session, '--json', ...args], { encoding: 'utf8', maxBuffer: 4e6 });
const evaluate = js => JSON.parse(run('eval', js)).data.result;
const until = condition => evaluate(`new Promise(resolve => { const tick = () => ${condition} ? resolve(true) : requestAnimationFrame(tick); tick(); })`);
const reports = [];
try {
  run('--webgpu', 'open', `${process.env.VERIFY_URL || 'http://localhost:4174/'}?camera=floor`);
  run('set', 'viewport', '1920', '1080');
  until('window.aquarium?.elapsed > 2');
  // Use the existing floor camera and its public dolly control; no scene overrides.
  run('mouse', 'move', '960', '540'); run('mouse', 'wheel', '-180');
  evaluate('new Promise(resolve => setTimeout(resolve, 600))');
  const target = evaluate('window.aquarium.crackTarget');
  evaluate("document.addEventListener('pointerup', () => { window.spillCloseupStart = window.aquarium.elapsed; }, { once: true })");
  run('mouse', 'move', String(Math.round(target.x)), String(Math.round(target.y))); run('mouse', 'down'); run('mouse', 'up');
  for (const seconds of [3, 10]) {
    until(`window.aquarium.elapsed >= window.spillCloseupStart + ${seconds}`);
    const report = evaluate('({afterCrack: window.aquarium.elapsed-window.spillCloseupStart, height: window.aquarium.height, spilling: window.aquarium.spilling, fps: window.aquarium.fps, impact: window.aquarium.impact, puddles: window.aquarium.puddles, flow: window.aquarium.spillFlow})');
    run('screenshot', `verify/spill-closeup-${seconds}s.png`);
    reports.push(report); console.log(JSON.stringify(report));
  }
  await writeFile('verify/spill-closeup.json', JSON.stringify(reports, null, 2));
} finally { run('close'); }
