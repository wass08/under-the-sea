// Opt-in CPU timings; no allocations or clock reads in ordinary presentation runs.
export const perf = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fourWallPerf') ? { physics:0, rapier:0, collision:0, solver:0, ccd:0, steps:0, sync:0, batch:0, spill:0, rewind:0, render:0, shadow:0, shadowCalls:0, bodies:0, awake:0, uploads:0 } : null;
export function timed<T extends (...args: any[]) => any>(key: 'physics'|'sync'|'batch'|'spill'|'rewind', fn:T):T {
  if (!perf) return fn;
  return ((...args:Parameters<T>) => { const t=performance.now(); try { return fn(...args); } finally { perf[key]+=performance.now()-t; } }) as T;
}
