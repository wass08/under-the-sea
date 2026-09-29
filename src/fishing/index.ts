import type { Ctx, Fishing, School, World } from '../contracts';

/** STUB — replaced by the boat / fisherman / game implementation. */
export async function createFishing(_ctx: Ctx, _world: World, _school: School): Promise<Fishing> {
  return { update() {}, click: () => false, addControls() {} };
}
