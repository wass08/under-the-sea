// Reproducible art-review shots. Usage: node tools/review-shots.mjs <prefix> [url=http://localhost:5391] [--close-only]
// Writes intro and two underwater overview shots, plus 7 u close-a / close-b (0.5 s apart)
// and close-side (broadside to the measured school heading). Each close shot has matching frozen-frame metrics.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const args = process.argv.slice(2), closeOnly = args.includes('--close-only');
const [prefix = 'shots/night/review', base = 'http://localhost:5391'] = args.filter(a => a !== '--close-only');
const browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`${base}/?debug&clean`);
  await page.waitForFunction(() => document.documentElement.dataset.status === 'ready', null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  if (!closeOnly) await page.screenshot({ path: `${prefix}-1-intro-end.png` });
  /** Orbit the main camera around its target: distance, polar angle from straight up (deg), keeping the azimuth. */
  const orbit = (dist, polarDeg) => page.evaluate(([d, p]) => {
    const { camera, controls } = window.sceneDebug, t = controls.target;
    const off = camera.position.clone().sub(t), az = Math.atan2(off.x, off.z), ph = p * Math.PI / 180;
    controls.maxPolarAngle = Math.max(controls.maxPolarAngle, ph); controls.minDistance = Math.min(controls.minDistance, d);
    camera.position.set(t.x + d * Math.sin(ph) * Math.sin(az), t.y + d * Math.cos(ph), t.z + d * Math.sin(ph) * Math.cos(az));
    camera.lookAt(t); controls.update();
  }, [dist, polarDeg]);
  // Wait for actual unfrozen simulation time: wall time can undercount on slow WebGPU frames.
  const settle = async seconds => {
    const start = await page.evaluate(() => {
      window.sceneDebug.frozen = false;
      return window.fishDebug.env.clock.value;
    });
    await page.waitForFunction(({ start, seconds }) => !window.sceneDebug.frozen && window.fishDebug.env.clock.value - start >= seconds,
      { start, seconds }, { timeout: 90000 });
  };
  const aimBroadside = () => page.evaluate(async () => {
    const { camera, controls } = window.sceneDebug;
    const pos = await window.fishDebug.readPos(), vel = await window.fishDebug.readVel();
    const center = camera.position.clone().set(0, 0, 0), heading = center.clone();
    for (let i = 0; i < pos.length; i += 4) {
      center.x += pos[i]; center.y += pos[i + 1]; center.z += pos[i + 2];
      heading.x += vel[i]; heading.y += vel[i + 1]; heading.z += vel[i + 2];
    }
    center.divideScalar(pos.length / 4);
    if (heading.lengthSq() < 1e-8) heading.copy(window.fishDebug.env.attractDirs[0].value);
    heading.normalize();
    const up = center.clone().set(0, 1, 0);
    const side = heading.clone().cross(up);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    const below = heading.clone().cross(side).normalize(), tilt = 10 * Math.PI / 180;
    const offset = side.multiplyScalar(Math.cos(tilt)).addScaledVector(below, Math.sin(tilt)).multiplyScalar(7);
    controls.target.copy(center);
    controls.minDistance = Math.min(controls.minDistance, 7);
    controls.maxPolarAngle = Math.max(controls.maxPolarAngle, Math.acos(offset.y / 7));
    camera.position.copy(center).add(offset);
    camera.lookAt(center); controls.update(); camera.updateMatrixWorld();
  });
  // Read the same GPU fish used by the render; keep the scene frozen until its screenshot is saved.
  const closeShot = async name => {
    const frozen = await page.evaluate(() => {
      const previous = window.sceneDebug.frozen;
      window.sceneDebug.frozen = true;
      return previous;
    });
    try {
      const metrics = await page.evaluate(async () => {
        const { camera, controls } = window.sceneDebug;
        const pos = await window.fishDebug.readPos(), vel = await window.fishDebug.readVel();
        const center = camera.position.clone().set(0, 0, 0), heading = center.clone();
        for (let i = 0; i < pos.length; i += 4) {
          center.x += pos[i]; center.y += pos[i + 1]; center.z += pos[i + 2];
          heading.x += vel[i]; heading.y += vel[i + 1]; heading.z += vel[i + 2];
        }
        center.divideScalar(pos.length / 4);
        if (heading.lengthSq() < 1e-8) heading.copy(window.fishDebug.env.attractDirs[0].value);
        heading.normalize();
        const p = center.clone(), v = p.clone(), visible = [];
        let within2u = 0;
        for (let i = 0; i < pos.length; i += 4) {
          p.set(pos[i], pos[i + 1], pos[i + 2]);
          const d = p.distanceTo(camera.position), ndc = p.clone().project(camera);
          if (d < 2) within2u++;
          if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || ndc.z < 0 || ndc.z > 1) continue;
          v.set(vel[i], vel[i + 1], vel[i + 2]).normalize();
          visible.push({ p: p.clone(), v: v.clone(), d });
        }
        let aligned = 0;
        for (const a of visible) aligned = Math.max(aligned, visible.filter(b => a.v.dot(b.v) >= Math.cos(Math.PI / 6)).length);
        const gaps = visible.map(a => {
          let nearest = Infinity;
          for (let j = 0; j < pos.length; j += 4) {
            const d = Math.hypot(a.p.x - pos[j], a.p.y - pos[j+1], a.p.z - pos[j+2]);
            if (d > 0.0001) nearest = Math.min(nearest, d);
          }
          return nearest;
        }).sort((a,b) => a-b);
        return {
          camera: camera.position.toArray(), cameraTarget: controls.target.toArray(), cameraDistance: camera.position.distanceTo(controls.target),
          attractors: window.fishDebug.env.attractors.slice(0,3).map(a=>a.value.toArray()),
          headings: window.fishDebug.env.attractDirs.slice(0,3).map(a=>a.value.toArray()),
          center: center.toArray(), travelHeading: heading.toArray(), visible: visible.length,
          within2u, headingWithin30: aligned / Math.max(1, visible.length), nearestVisible: Math.min(...visible.map(v => v.d)),
          medianNeighbourDistance: gaps[Math.floor(gaps.length / 2)], school: window.school,
          separation: { weight: window.fishDebug.env.sepW.value, radius: window.fishDebug.env.sepR.value },
        };
      });
      // Let the frozen school render at the selected camera before capturing it.
      await page.evaluate(async () => { for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame); });
      const screenshot = `${prefix}-${name}.png`;
      await page.screenshot({ path: screenshot });
      return { screenshot, ...metrics };
    } finally {
      await page.evaluate(previous => { window.sceneDebug.frozen = previous; }, frozen);
    }
  };
  await orbit(30, 98); await page.waitForTimeout(2500);
  if (!closeOnly) await page.screenshot({ path: `${prefix}-2-under-far.png` });
  await orbit(18, 96); await page.waitForTimeout(2000);
  if (!closeOnly) await page.screenshot({ path: `${prefix}-2b-under-far.png` });
  await orbit(7, 100); await settle(2.5);
  const closeShots = {};
  closeShots['3-close-a'] = await closeShot('3-close-a');
  await settle(0.5);
  closeShots['3-close-b'] = await closeShot('3-close-b');
  await aimBroadside(); await settle(2.5);
  closeShots['3-close-side'] = await closeShot('3-close-side');
  const metrics = { closeShots };
  await writeFile(`${prefix}-metrics.json`, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics));
  console.log(errors.length ? 'errors:\n' + errors.join('\n') : 'no console errors');
} finally { await browser.close(); }
