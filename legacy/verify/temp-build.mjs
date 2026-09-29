import {build} from 'rolldown';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
// Resolve external packages here so temporary modules need no workspace node_modules.
export async function bundle(input,plugins=[]) {
 const dir=await mkdtemp(join(tmpdir(),'aquarium-verify-'));
 try {
  await build({input,external:id=>id.startsWith('node:'),plugins:[...plugins,{name:'external-three',resolveId:id=>id.startsWith('three/')?{id:import.meta.resolve(id),external:true}:null}],output:{file:join(dir,'entry.mjs'),format:'esm'}});
  return await import(pathToFileURL(join(dir,'entry.mjs')).href);
 } finally {await rm(dir,{recursive:true,force:true});}
}
