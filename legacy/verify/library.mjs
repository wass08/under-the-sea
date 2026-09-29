import { build } from 'rolldown';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'aquarium-library-')),file=join(dir,'library.bundle.mjs');
try {
 await build({ input: 'verify/library-entry.ts', transform: { define: { 'import.meta.env.BASE_URL': '\"/\"' } }, external: id=>id.startsWith('node:'), plugins:[{name:'external-packages',resolveId:id=>['three/webgpu','@dimforge/rapier3d-compat'].includes(id)?{id:import.meta.resolve(id),external:true}:null}], output: { file, format: 'esm' } });
 console.log(execFileSync(process.execPath, [file], { encoding: 'utf8' }));
} finally {await rm(dir,{recursive:true,force:true});}
