/* eslint-disable @typescript-eslint/no-explicit-any */
import { Frustum, IndirectStorageBufferAttribute, Matrix4, Vector3, Vector4 } from 'three/webgpu';
import type { PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { Sim } from './sim';
const { Fn, If, atomicAdd, atomicStore, dot, float, instanceIndex, instancedArray, length, storage, uint, uniform } = TSL as any;

/**
 * GPU culling + LOD bucketing. One compute pass tests every fish against the camera frustum, then appends the survivors to one of two
 * compacted index lists (near = LOD0 full-detail mesh, far = LOD1 simplified mesh). The lists' counters ARE the instanceCount fields of
 * two drawIndexedIndirect argument blocks, so nothing is read back to drive the draws.
 */
export function createLod(renderer: WebGPURenderer, sim: Sim, count: number, indexCounts: [number, number], radius: number) {
  const args = new IndirectStorageBufferAttribute(new Uint32Array(10), 1);
  (args.array as Uint32Array).set([indexCounts[0], 0, 0, 0, 0, indexCounts[1], 0, 0, 0, 0]);
  const argsAtomic = storage(args, 'uint', 10).toAtomic();
  const list0 = instancedArray(count, 'uint'), list1 = instancedArray(count, 'uint');
  const planes = [0, 1, 2, 3, 4, 5].map(() => uniform(new Vector4()));
  const planes2 = [0, 1, 2, 3, 4, 5].map(() => uniform(new Vector4()));
  const camPos = uniform(new Vector3()), camPos2 = uniform(new Vector3()), inset = uniform(0), dist = uniform(2.8), r = float(radius);

  const reset = Fn(() => { atomicStore(argsAtomic.element(1), uint(0)); atomicStore(argsAtomic.element(6), uint(0)); })().compute(1).setName('fishLodReset');
  const cull = Fn(() => {
    const i = instanceIndex, p = sim.pos.element(i).xyz, a = sim.aux.element(i);
    const visible = a.w.lessThan(2.5).toVar();
    const inMain = a.w.lessThan(2.5).toVar(), inInset = a.w.lessThan(2.5).and(inset.greaterThan(0.5)).toVar();
    planes.forEach((pl: any) => { inMain.assign(inMain.and(dot(pl.xyz, p).add(pl.w).greaterThan(r.negate()))); });
    planes2.forEach((pl: any) => { inInset.assign(inInset.and(dot(pl.xyz, p).add(pl.w).greaterThan(r.negate()))); });
    visible.assign(inMain.or(inInset));
    // LOD by the nearest of the two cameras (the inset is where close-ups happen)
    const dMin = float(length(p.sub(camPos))).toVar();
    If(inset.greaterThan(0.5), () => { dMin.assign(dMin.min(length(p.sub(camPos2)))); });
    If(visible, () => {
      If(dMin.lessThan(dist), () => { list0.element(atomicAdd(argsAtomic.element(1), uint(1))).assign(i); })
        .Else(() => { list1.element(atomicAdd(argsAtomic.element(6), uint(1))).assign(i); });
    });
  })().compute(count).setName('fishCull');

  const passes = [reset, cull];
  const frustum = new Frustum(), m = new Matrix4();
  return {
    args, dist,
    read: { list0: storage(list0.value, 'uint', count).toReadOnly(), list1: storage(list1.value, 'uint', count).toReadOnly() },
    /** Encode reset + cull for this frame (after the simulation). */
    update(camera: PerspectiveCamera, insetCamera: PerspectiveCamera | null = null) {
      const set = (cam: PerspectiveCamera, pls: any[], pos: any) => {
        cam.updateMatrixWorld();
        m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        frustum.setFromProjectionMatrix(m, (renderer as any).coordinateSystem);
        frustum.planes.forEach((pl, k) => pls[k].value.set(pl.normal.x, pl.normal.y, pl.normal.z, pl.constant));
        pos.value.setFromMatrixPosition(cam.matrixWorld);
      };
      set(camera, planes, camPos);
      inset.value = insetCamera ? 1 : 0;
      if (insetCamera) set(insetCamera, planes2, camPos2);
      renderer.compute(passes);
    },
    async readCounts(): Promise<[number, number]> {
      const a = new Uint32Array(await renderer.getArrayBufferAsync(args));
      return [a[1], a[6]];
    },
  };
}
export type Lod = ReturnType<typeof createLod>;
