/**
 * Single-thread throughput of the chess core on a PGN file: splitting,
 * tokenizing, SAN parsing + move replay with hashing, and full tree parsing.
 *   node --conditions=development --import tsx bench/parse.ts bench/out/100k.pgn
 */
import { readFileSync } from 'node:fs';
import { Position, PgnSplitter, parsePgn, scanPgn, perft } from '@pgnx/core';

const text = readFileSync(process.argv[2] ?? 'bench/out/small.pgn', 'utf8');
const mb = text.length / 1e6;
const time = <T>(fn: () => T): [T, number] => {
  const t0 = performance.now();
  const r = fn();
  return [r, (performance.now() - t0) / 1000];
};

const [games, tSplit] = time(() => {
  const s = new PgnSplitter();
  const out = s.push(text);
  return out.concat(s.finish());
});
console.log(`split        ${games.length.toLocaleString()} games  ${(mb / tSplit).toFixed(0)} MB/s`);

const [scanned, tScan] = time(() => games.map((g) => scanPgn(g)[0]));
console.log(`tokenize     ${Math.round(games.length / tScan).toLocaleString()} games/s  ${(mb / tScan).toFixed(0)} MB/s`);

const [plies, tReplay] = time(() => {
  let n = 0;
  for (const g of scanned) {
    const pos = Position.start();
    for (const san of g.moves) {
      const m = pos.parseSan(san);
      if (m < 0) break;
      pos.play(m);
      n++;
    }
  }
  return n;
});
console.log(`SAN replay   ${Math.round(plies / tReplay).toLocaleString()} plies/s  (${Math.round(games.length / tReplay).toLocaleString()} games/s, incl. Zobrist hashing)`);

const sample = games.slice(0, Math.min(games.length, 20000)).join('\n');
const [trees, tTree] = time(() => parsePgn(sample));
console.log(`tree parse   ${Math.round(trees.length / tTree).toLocaleString()} games/s  (full move trees with FEN per node)`);

const [nodes, tPerft] = time(() => perft(Position.start(), 5));
console.log(`perft(5)     ${nodes.toLocaleString()} nodes  ${Math.round(nodes / tPerft).toLocaleString()} nodes/s`);
