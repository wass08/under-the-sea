import { MathUtils } from 'three/webgpu';
import type { createTank } from './scene/tank';
import type { createWater } from './scene/water';
import type { createSpill } from './scene/spill';
import { simTime, state } from './state';

type Tank = Awaited<ReturnType<typeof createTank>>;
/** A 30 Hz, 20-second circular history, with one pristine keyframe for the landing. */
export function createRewind(tank: Tank, water: ReturnType<typeof createWater>, spill: ReturnType<typeof createSpill>, finish: () => void) {
  const capture = () => ({ time: state.elapsed, visualTime: simTime.value, tank: tank.capture(), water: water.capture(), spill: spill.capture() });
  type Snapshot = ReturnType<typeof capture>;
  const capacity = 601, ring: (Snapshot | undefined)[] = Array(capacity);
  let cursor = 0, count = 0, nextRecord = -Infinity, pristine: Snapshot | undefined, playback: Snapshot[] = [], progress = 0;
  // Slot poses are captured at release; they also provide a landing if a long idle
  // period has pushed the break out of the circular history.
  const homes: number[] = [];
  function record(force = false) {
    if (!pristine || state.rewinding || (!force && state.elapsed < nextRecord - 1e-6)) return;
    const snapshot = capture();
    for (let i = homes.length; i < snapshot.tank.poses.length; i++) homes.push(snapshot.tank.poses[i]);
    ring[cursor] = snapshot; cursor = (cursor + 1) % capacity; count = Math.min(capacity, count + 1); if (!Number.isFinite(nextRecord)) nextRecord = state.elapsed;
    if (state.elapsed >= nextRecord - 1e-6) nextRecord += (Math.max(0, Math.floor((state.elapsed - nextRecord + 1e-6) * 30)) + 1) / 30;
  }
  return {
    beforeBreak() { pristine ??= capture(); }, record,
    get count() { return count; }, get progress() { return progress; },
    start() {
      if (state.rewinding) { finish(); return false; }
      if (!pristine || !count) { finish(); return false; }
      record(true); playback = Array.from({ length: count }, (_, i) => ring[(cursor - count + i + capacity) % capacity]!);
      // Retain the return-to-slot pose independently of the ring's moving time window.
      const first = playback[0];
      playback.unshift({ ...pristine, time: first.time - 0.3, tank: { ...pristine.tank, poses: Float32Array.from(homes) } });
      progress = 0; state.rewinding = true; tank.beginRewind(); spill.clearParticles(); return true;
    },
    update(realDt: number) {
      progress = Math.min(1, progress + realDt * state.timeScale / 1.6);
      const ease = MathUtils.smootherstep(progress, 0, 1), first = playback[0], latest = playback[playback.length - 1];
      const time = latest.time + (first.time - latest.time) * ease;
      let lo = 0, hi = playback.length - 1;
      while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (playback[mid].time <= time) lo = mid; else hi = mid; }
      const a = playback[lo], b = playback[hi], t = MathUtils.clamp((time - a.time) / Math.max(1e-6, b.time - a.time), 0, 1);
      tank.restore(a.tank, b.tank, t); water.restore(a.water, b.water, t); spill.restore(a.spill, b.spill, t); simTime.value = a.visualTime * (1 - t) + b.visualTime * t;
      if (progress === 1) finish();
    },
    clear() { ring.fill(undefined); playback = []; cursor = count = 0; nextRecord = -Infinity; pristine = undefined; homes.length = 0; state.rewinding = false; progress = 0; },
  };
}
