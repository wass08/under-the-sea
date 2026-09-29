import { build } from 'rolldown';
import { execFileSync } from 'node:child_process';
await build({ input: 'verify/library-entry.ts', external: ['node:assert/strict', 'three/webgpu', '@dimforge/rapier3d-compat'], output: { file: 'verify/lab/library.bundle.mjs', format: 'esm' } });
console.log(execFileSync(process.execPath, ['verify/lab/library.bundle.mjs'], { encoding: 'utf8' }));
