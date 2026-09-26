import { rmSync } from 'node:fs';
import { importPgnFiles } from '../packages/server/src/importer/import.js';
const file = process.argv[2] ?? 'bench/out/small.pgn';
const db = process.argv[3] ?? 'bench/out/small.sqlite';
for (const ext of ['', '-wal', '-shm']) rmSync(db + ext, { force: true });
const t0 = Date.now();
const p = await importPgnFiles(db, [file], {
  onProgress: (p) => process.stderr.write(`\r${p.phase} ${p.imported} games, ${p.gamesPerSecond}/s, ${(p.bytesRead / 1e6).toFixed(0)}MB  `),
});
console.log('\n', { ...p, errorSamples: p.errorSamples.slice(0, 3) }, `${Date.now() - t0}ms`);
