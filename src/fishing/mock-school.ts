import { Vector3 } from 'three/webgpu';
import type { FolderApi } from 'tweakpane';
import type { School } from '../contracts';

/**
 * Fake School with plausible timing so the game loop can be developed / recorded without the GPU fish:
 * panic -> fear 1 decaying over ~4.5 s; nearLure ramps up with curiosity once fear is gone;
 * strike() -> 'approaching' then 'hooked' after ~0.6 s; land() -> 'none'.
 */
export function createMockSchool(): School & { mock: true } {
  let fear = 0, curiosity = 0, lure: Vector3 | null = null, approachT = -1, clock = 0, drift = 0;
  const stats = { nearLure: 0, biter: 'none' as 'none' | 'approaching' | 'hooked', centroid: new Vector3(0, 4, 0), meanFear: 0 };
  return {
    mock: true,
    count: 0,
    update(dt: number) {
      clock += dt; fear = Math.max(0, fear - dt / 4.5); stats.meanFear = fear;
      if (!lure) { stats.nearLure = 0; return; }
      const target = curiosity > 0.5 && fear < 0.15 ? Math.round(2 + 6 * curiosity + Math.sin(clock * 0.7) * 2) : 0;
      drift += (target - drift) * Math.min(1, dt * 0.8);
      stats.nearLure = Math.max(0, Math.round(drift));
      if (approachT >= 0) { approachT += dt; if (approachT > 0.6) { stats.biter = 'hooked'; approachT = -1; } }
    },
    panic() { fear = 1; drift = 0; },
    setLure(p) {
      lure = p ? (lure ?? new Vector3()).copy(p) : null;
      if (!p) { drift = 0; if (stats.biter === 'approaching') { stats.biter = 'none'; approachT = -1; } }
    },
    setCuriosity(a) { curiosity = a; },
    strike() { if (stats.nearLure <= 0 || stats.biter !== 'none') return false; stats.biter = 'approaching'; approachT = 0; return true; },
    land() { stats.biter = 'none'; approachT = -1; drift = 0; },
    stats,
    addControls(_folder: FolderApi) {},
  };
}
