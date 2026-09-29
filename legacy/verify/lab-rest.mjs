import {build} from 'rolldown';import {execFileSync} from 'node:child_process';
await build({input:'verify/lab-rest-entry.ts',external:['three/webgpu','@dimforge/rapier3d-compat'],output:{file:'verify/lab-rest.bundle.mjs',format:'esm'}});
console.log(execFileSync(process.execPath,['verify/lab-rest.bundle.mjs'],{encoding:'utf8'}));
