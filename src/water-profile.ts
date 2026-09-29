import type { WebGPURenderer } from 'three/webgpu';
/** Opt-in WebGPU timestamp queries. Split only the water draws into timed render
 * passes, preserving attachments with loadOp=load. This includes tile load/store
 * overhead and is a conservative water cost; normal playback never splits passes.
 * Three's aggregate timers reuse queries across framebuffer-copy pass splits and
 * cannot isolate the water. This adapter is deliberately pinned to Three 0.186. */
export function createWaterProfile(renderer: WebGPURenderer, enabled: boolean) {
  const samples: { water: number; reflection: number }[] = [];
  // Backend render-pass state is not exposed by the public Three types.
  const backend = renderer.backend as any;
  let pending = false, cursor = 0, queries: any, resolve: any, result: any;
  const reflectionStack: boolean[] = [], kinds: boolean[] = [];
  if (enabled) {
    renderer.inspector.beginRender = (_uid, scene) => { reflectionStack.push(scene.name.includes('[ Reflector ]')); };
    renderer.inspector.finishRender = () => { reflectionStack.pop(); };
    const draw = backend.draw.bind(backend);
    backend.draw = (object: any, info: any) => {
      if (!queries || pending || object.object.name !== 'Gerstner water surface' || cursor >= 252) return draw(object, info);
      const context = object.context, data = backend.get(context);
      const descriptor = { ...data.descriptor, colorAttachments: data.descriptor.colorAttachments.map((a: any) => ({ ...a, loadOp: 'load' })),
        depthStencilAttachment: data.descriptor.depthStencilAttachment ? { ...data.descriptor.depthStencilAttachment, depthLoadOp: 'load' } : undefined, timestampWrites: undefined };
      const begin = (timed: boolean) => {
        data.currentPass = data.encoder.beginRenderPass({ ...descriptor, timestampWrites: timed ? { querySet: queries, beginningOfPassWriteIndex: cursor, endOfPassWriteIndex: cursor+1 } : undefined });
        backend._resetRenderContextData(data);
        if(context.viewport) backend.updateViewport(context);
        if(context.scissor) backend.updateScissor(context);
      };
      data.currentPass.end(); kinds[cursor/2] = false; begin(true); draw(object, info); data.currentPass.end(); cursor += 2; begin(false);
    };
  }
  return {
    get diagnostics() { return { supported: Boolean(backend.hasTimestamp), samples: samples.slice(-180) }; },
    update() {
      if (!enabled || pending || !backend.hasTimestamp) return;
      const device = backend.device;
      if (!queries) {
        queries = device.createQuerySet({type:'timestamp',count:256});
        resolve = device.createBuffer({size:2048,usage:512|4}); // QUERY_RESOLVE | COPY_SRC
        result = device.createBuffer({size:2048,usage:8|1}); // COPY_DST | MAP_READ
        // Timestamp every actual reflection render pass (including copy-induced
        // splits/mipmap passes), rather than Three's overwritten aggregate pair.
        const createEncoder = device.createCommandEncoder.bind(device);
        device.createCommandEncoder = (...args: any[]) => {
          const encoder = createEncoder(...args), beginPass = encoder.beginRenderPass.bind(encoder);
          encoder.beginRenderPass = (descriptor: any) => {
            if (!pending && reflectionStack.at(-1) && cursor < 252) {
              kinds[cursor/2] = true;
              descriptor = {...descriptor,timestampWrites:{querySet:queries,beginningOfPassWriteIndex:cursor,endOfPassWriteIndex:cursor+1}};
              cursor += 2;
            }
            return beginPass(descriptor);
          };
          return encoder;
        };
        return;
      }
      if (!cursor) { samples.push({water:0,reflection:0}); if(samples.length>180)samples.shift(); return; }
      pending = true;
      const count = cursor;
      const encoder = device.createCommandEncoder(); encoder.resolveQuerySet(queries,0,count,resolve,0); encoder.copyBufferToBuffer(resolve,0,result,0,count*8); device.queue.submit([encoder.finish()]);
      void result.mapAsync(1,0,count*8).then(() => {
        const t = new BigUint64Array(result.getMappedRange(0,count*8)); let water = 0, reflection = 0;
        for(let i=0;i<count;i+=2) { const ms = Number(t[i+1]-t[i])/1e6; if(kinds[i/2]) reflection += ms; else water += ms; }
        result.unmap(); samples.push({water,reflection}); if(samples.length>180)samples.shift();
      }).finally(() => {cursor=0;pending=false;});
    },
  };
}
