import { Vector3 } from 'three/webgpu';
import type { Ctx, School, World } from '../contracts';

/** STUB — replaced by the GPGPU school implementation. */
export async function createSchool(_ctx: Ctx, _world: World): Promise<School> {
  return {
    count: 0, update() {}, panic() {}, setLure() {}, setCuriosity() {}, strike: () => false, land() {}, addControls() {},
    stats: { nearLure: 0, biter: 'none', centroid: new Vector3(), meanFear: 0 },
  };
}
