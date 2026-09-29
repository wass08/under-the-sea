import { build } from 'rolldown';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'island-hash-'));
try {
  const file = join(dir, 'hash.mjs');
  await build({ input: 'island-hash-entry', external: id => id.startsWith('node:'), plugins: [{
    name: 'island-hash',
    resolveId(id) { if (id === 'island-hash-entry') return '\0hash'; if (id === 'three/webgpu') return { id: import.meta.resolve(id), external: true }; },
    load(id) { if (id === '\0hash') return `import { createHash } from 'node:crypto';
      import { generateIslandTerrain } from ${JSON.stringify(resolve('src/lib/terrain.ts'))};
      const t = generateIslandTerrain(166);
      const arrays = [t.geometry.getAttribute('position').array, t.heights];
      const hash = a => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
      console.log(JSON.stringify({ positions: hash(arrays[0]), heights: hash(arrays[1]), combined: createHash('sha256').update(Buffer.concat(arrays.map(a => Buffer.from(a.buffer, a.byteOffset, a.byteLength)))).digest('hex') }, null, 2));
      t.geometry.dispose();`; },
  }], output: { file, format: 'esm' } });
  process.stdout.write(execFileSync(process.execPath, [file]));
} finally { await rm(dir, { recursive: true, force: true }); }
