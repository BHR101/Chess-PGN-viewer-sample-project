/**
 * Import benchmark: imports a PGN file into a fresh database and reports throughput.
 *   node --conditions=development --import tsx bench/import.ts <file.pgn> <out.sqlite>
 */
import { rmSync, statSync } from 'node:fs';
import { importPgnFiles, dbStats, openDatabase } from '../packages/server/src/index.js';

const file = process.argv[2] ?? 'bench/out/small.pgn';
const dbPath = process.argv[3] ?? 'bench/out/bench.sqlite';
for (const ext of ['', '-wal', '-shm']) rmSync(dbPath + ext, { force: true });
const t0 = Date.now();
let importDone = 0;
const p = await importPgnFiles(dbPath, [file], {
  onProgress: (p) => {
    if (p.phase === 'indexing' && !importDone) importDone = Date.now();
    process.stderr.write(`\r${p.phase} ${p.imported.toLocaleString()} games, ${p.gamesPerSecond.toLocaleString()}/s   `);
  },
});
const total = (Date.now() - t0) / 1000;
const db = openDatabase(dbPath, { readonly: true });
const s = dbStats(db);
console.log(`
file            ${(statSync(file).size / 1e6).toFixed(0)} MB
games           ${p.imported.toLocaleString()}
parse + write   ${((importDone - t0) / 1000).toFixed(1)} s (${Math.round(p.imported / ((importDone - t0) / 1000)).toLocaleString()} games/s)
index + finish  ${((Date.now() - importDone) / 1000).toFixed(1)} s
total           ${total.toFixed(1)} s (${Math.round(p.imported / total).toLocaleString()} games/s)
positions       ${s.positions.toLocaleString()}
database size   ${(s.fileBytes / 1e6).toFixed(0)} MB (${Math.round(s.fileBytes / Math.max(1, p.imported))} bytes/game)`);
