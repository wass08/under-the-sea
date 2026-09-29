import assert from 'node:assert/strict';

export async function verifyCameraPersistence(page, ready, summary) {
  // Keep dense mesh serialization out of timing-sensitive camera observations.
  const state = () => page.evaluate(() => {
    const { seedCoordinates, meshPositions, heightAt, ...settingsAndCamera } = window.lab.state;
    return settingsAndCamera;
  });
  const pass = message => { summary.push(`PASS ${message}`); console.log(summary.at(-1)); };
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  const sameView = (a, b) => {
    assert.ok(distance(a.position, b.position) < 1e-6, 'Camera position survives level change');
    assert.ok(distance(a.target, b.target) < 1e-6, 'Controls target survives level change');
    assert.ok(Math.abs(a.distance - b.distance) < 1e-6, 'Orbit distance survives level change');
    assert.equal(a.zoom, b.zoom); assert.equal(a.autoRotate, b.autoRotate);
  };
  const pose = view => JSON.stringify({ position: view.position, target: view.target, zoom: view.zoom, distance: view.distance, autoRotate: view.autoRotate });
  const checkSettings = async values => {
    const actual = await state();
    for (const [key, value] of Object.entries(values)) {
      const message = `${actual.bench} preserves ${key}`;
      if (typeof value === 'number') assert.ok(Math.abs(actual[key] - value) < 1e-9, message);
      else assert.equal(actual[key], value, message);
    }
  };
  await page.evaluate(() => { location.hash = '#/lab/terrain?level=1'; }); await ready('terrain', 1);
  const rotatingStart = (await state()).camera;
  await page.waitForTimeout(3000);
  const rotatingBefore = (await state()).camera;
  assert.equal(rotatingBefore.autoRotate, true);
  assert.ok(distance(rotatingStart.position, rotatingBefore.position) > 1, 'Auto-rotation advances away from entry angle');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.lab.ready && window.lab.state.level === 2);
  const rotatingAfter = (await state()).camera;
  assert.equal(rotatingAfter.autoRotate, true);
  assert.ok(distance(rotatingBefore.position, rotatingAfter.position) < 0.8, 'Auto-rotation continues from current angle');
  assert.deepEqual(rotatingAfter.target, rotatingBefore.target);
  await page.waitForTimeout(500);
  assert.ok(distance(rotatingAfter.position, (await state()).camera.position) > 0.05, 'Auto-rotation keeps running');
  pass(`camera auto-rotate L1→L2: before=${pose(rotatingBefore)} after=${pose(rotatingAfter)}`);

  const defaults = { position: [12, 13, 16], target: [0, 0.4, 0], zoom: 1, distance: Math.hypot(12, 12.6, 16), autoRotate: false };
  await page.locator('a[data-bench="caustics"]').click(); await ready('caustics', 3);
  sameView(defaults, (await state()).camera);
  pass('camera rotating terrain→caustics: default pose applied with no residual orbit momentum');
  await page.evaluate(() => { location.hash = '#/lab/terrain?level=1'; }); await ready('terrain', 1);
  const initial = await state(), canvas = await page.locator('canvas').boundingBox();
  const x = canvas.x + canvas.width * 0.5, y = canvas.y + canvas.height * 0.5;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 180, y + 60, { steps: 12 }); await page.mouse.up();
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 230, y + 90, { steps: 8 }); await page.mouse.up({ button: 'right' });
  await page.mouse.wheel(0, -240);
  // Wait for real OrbitControls damping to settle before comparing stationary poses.
  await page.evaluate(async () => {
    let previous = window.lab.state.camera, stable = 0;
    for (let frame = 0; frame < 600; frame++) {
      await new Promise(requestAnimationFrame);
      const current = window.lab.state.camera;
      const delta = Math.max(...['position', 'target'].flatMap(key => current[key].map((v, i) => Math.abs(v - previous[key][i]))));
      stable = delta < 1e-9 ? stable + 1 : 0;
      if (stable >= 8) return;
      previous = current;
    }
    throw new Error('Camera damping did not settle');
  });
  const before = (await state()).camera;
  assert.equal(before.autoRotate, false, 'Interaction stops terrain auto-rotation');
  assert.ok(distance(before.position, initial.camera.position) > 2, 'Drag produces a non-default camera');
  assert.ok(distance(before.target, initial.camera.target) > 0.1, 'Pan produces a non-default target');
  assert.ok(Math.abs(before.distance - initial.camera.distance) > 1, 'Wheel changes orbit distance');
  const terrainSettings = { wireframe: true, seeds: true, biomes: false, sea: false, amplitude: 3.4, seed: 57 };
  await page.evaluate(values => window.lab.setReveal({ ...values, count: 28000, smooth: false }), terrainSettings);
  for (const level of [2, 3]) {
    await page.keyboard.press('ArrowRight'); await ready('terrain', level);
    const after = (await state()).camera; sameView(before, after); await checkSettings(terrainSettings);
    assert.equal((await state()).count, level === 2 ? 1500 : 900, 'L2/L3 share a count independent of L1');
    assert.equal((await state()).smooth, false, 'L1 smooth setting does not leak');
    if (level === 2) await page.evaluate(() => window.lab.setReveal({ count: 900, smooth: true }));
    pass(`camera terrain L1→L${level}: before=${pose(before)} after=${pose(after)}; settings preserved`);
  }
  await page.locator('#lab-level').fill('2'); await ready('terrain', 2);
  sameView(before, (await state()).camera); await checkSettings(terrainSettings);
  assert.equal((await state()).count, 900); assert.equal((await state()).smooth, true);
  await page.keyboard.press('1'); await ready('terrain', 1);
  assert.equal((await state()).count, 28000); assert.equal((await state()).smooth, false);
  sameView(before, (await state()).camera);
  await page.evaluate(() => window.lab.setReveal({ count: 30000, smooth: true }));
  await page.keyboard.press('2'); await ready('terrain', 2);
  await page.evaluate(() => window.lab.setReveal({ count: 1500, smooth: false }));
  pass('camera terrain slider L3→L2 and L1 return: pose, separate dense count, shared coarse count and per-level smooth preserved');
  await page.evaluate(values => window.lab.setReveal(values), Object.fromEntries(Object.keys(terrainSettings).map(key => [key, initial[key]])));

  await page.locator('a[data-bench="caustics"]').click(); await ready('caustics', 3);
  const caustics = await state(); sameView(defaults, caustics.camera);
  pass(`camera bench switch terrain→caustics: before=${pose(before)} after=${pose(caustics.camera)}; defaults applied`);
  const causticsSettings = { rawField: true, showSeeds: true, layer: 1, freeze: true, scaleA: 3.1, waterLevel: 1.2 };
  await page.evaluate(values => window.lab.setReveal(values), causticsSettings);
  for (const level of [1, 2]) {
    await page.keyboard.press(String(level)); await ready('caustics', level);
    await checkSettings(causticsSettings); sameView(caustics.camera, (await state()).camera);
  }
  await page.evaluate(values => window.lab.setReveal(values), Object.fromEntries(Object.keys(causticsSettings).map(key => [key, caustics[key]])));
  pass('caustics L3→L1→L2: camera, reveal toggles and parameters preserved');

  await page.locator('a[data-bench="shatter"]').click(); await ready('shatter', 3);
  const shatter = await state(), shatterSettings = { seeds: true, outlines: true, freeze: true, slowMotion: true, count: 180 };
  await page.evaluate(values => window.lab.setReveal(values), shatterSettings);
  for (const level of [1, 2]) {
    await page.keyboard.press(String(level)); await ready('shatter', level);
    await checkSettings(shatterSettings); sameView(shatter.camera, (await state()).camera);
    assert.equal((await state()).elapsed, 0, 'Rebuilt shatter world remains frozen');
  }
  await page.evaluate(() => window.lab.setReveal({ freeze: false }));
  const rate = await page.evaluate(async () => {
    const start = performance.now(), elapsed = window.lab.state.elapsed;
    await new Promise(resolve => setTimeout(resolve, 1500));
    return (window.lab.state.elapsed - elapsed) / ((performance.now() - start) / 1000);
  });
  assert.ok(Math.abs(rate - 0.15) < 0.025, `Preserved slow-motion rate ${rate}`);
  await page.evaluate(values => window.lab.setReveal(values), Object.fromEntries(Object.keys(shatterSettings).map(key => [key, shatter[key]])));
  pass(`shatter L3→L1→L2: camera, reveal toggles, count, freeze and slowMotion preserved; measured rate=${rate}`);
}
