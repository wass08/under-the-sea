import { timed } from '../verify/four-wall-metrics';
import { MathUtils } from 'three/webgpu';
import type { createTank } from './scene/tank';
import type { createWater } from './scene/water';
import type { createSpill } from './scene/spill';
import { rewindProgress, simTime, state } from './state';

type Tank = Awaited<ReturnType<typeof createTank>>;
/** Adaptive 30 Hz history: compact old samples, never discard the original break. */
export function createRewind(tank: Tank, water: ReturnType<typeof createWater>, spill: ReturnType<typeof createSpill>, finish: () => void) {
  const capture = () => ({ time: state.elapsed, visualTime: simTime.value, tank: tank.capture(), water: water.capture(), spill: spill.capture() });
  type Snapshot = ReturnType<typeof capture>;
  const history: Snapshot[] = []; let nextRecord = -Infinity, interval = 1 / 30, pristine: Snapshot | undefined, playback: Snapshot[] = [], progress = 0;
  const homes: number[] = [], weights: number[] = [];
  function record(force = false) {
    if (!pristine || state.rewinding || (!force && state.elapsed < nextRecord - 1e-6)) return;
    const snapshot = capture();
    for (let i = homes.length; i < snapshot.tank.poses.length; i++) homes.push(snapshot.tank.poses[i]);
    history.push(snapshot); nextRecord = state.elapsed + interval;
    if (history.length > 600) {
      // Keep endpoints and every release event; decimate only redundant time samples.
      for (let i = history.length - 2; i > 0; i -= 2) if (history[i - 1].tank.poses.length === history[i].tank.poses.length && history[i].tank.poses.length === history[i + 1].tank.poses.length) history.splice(i, 1);
      interval *= 2;
    }
  }
  return {
    beforeBreak() { pristine ??= capture(); }, record: timed('rewind', record),
    get count() { return history.length; }, get progress() { return progress; },
    start() {
      if (state.rewinding) { finish(); return false; }
      if (!pristine || !history.length) { finish(); return false; }
      record(true); playback = [...history];
      playback.unshift({ ...pristine, time: playback[0].time - 0.1, tank: { ...pristine.tank, poses: Float32Array.from(homes.slice(0, playback[0].tank.poses.length)) } });
      weights.length = 0; weights.push(0);
      for (let i = 1; i < playback.length; i++) {
        const a = playback[i - 1], b = playback[i]; let movement = 0;
        for (let j = 0; j < Math.min(a.tank.poses.length, b.tank.poses.length); j += 7) {
          movement += Math.hypot(...[0,1,2].map(k => a.tank.poses[j+k] - b.tank.poses[j+k])); const dot = [3,4,5,6].reduce((s, k) => s + a.tank.poses[j+k] * b.tank.poses[j+k], 0);
          movement += 0.04 * 2 * Math.acos(Math.min(1, Math.abs(dot))); 
        }
        // Compress stationary holds, while traversing every snapshot in order.
        const weight = 0.001 * Math.max(0, b.time - a.time) + movement / Math.max(1, homes.length / 7) + Math.abs(a.water.height - b.water.height) * 0.12;
        weights.push(weights[i - 1] + Math.max(0.00001, weight));
      }
      progress = 0; rewindProgress.value = 0; state.rewinding = true; tank.beginRewind(); spill.clearParticles(); return true;
    },
    update(realDt: number) {
      progress = Math.min(1, progress + realDt * state.timeScale / 3.2); rewindProgress.value = progress;
      const ease = MathUtils.smootherstep(progress, 0, 1), target = weights[weights.length - 1] * (1 - ease);
      let lo = 0, hi = playback.length - 1;
      while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (weights[mid] <= target) lo = mid; else hi = mid; }
      const a = playback[lo], b = playback[hi], t = MathUtils.clamp((target - weights[lo]) / Math.max(1e-9, weights[hi] - weights[lo]), 0, 1);
      tank.restore(a.tank, b.tank, t); water.restore(a.water, b.water, t); spill.restore(a.spill, b.spill, t); simTime.value = a.visualTime * (1 - t) + b.visualTime * t;
      if (progress === 1) finish();
    },
    clear() { history.length = 0; playback = []; nextRecord = -Infinity; interval = 1 / 30; pristine = undefined; homes.length = 0; state.rewinding = false; progress = 0; rewindProgress.value = 0; },
  };
}
