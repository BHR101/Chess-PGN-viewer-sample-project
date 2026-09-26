/**
 * Query benchmarks against an imported database.
 *   node --conditions=development --import tsx bench/queries.ts bench/out/1m.sqlite
 */
import { Position } from '@pgnx/core';
import { explore, openDatabase, searchGames, getGame, type GameQuery } from '../packages/server/src/index.js';
import { clearExplorerMemoryCache } from '../packages/server/src/explorer.js';

const db = openDatabase(process.argv[2] ?? 'bench/out/1m.sqlite');
db.exec('DELETE FROM explorer_cache');

function time<T>(label: string, fn: () => T, runs = 1): T {
  let r!: T;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) r = fn();
  const ms = (performance.now() - t0) / runs;
  console.log(`${label.padEnd(58)} ${ms.toFixed(1).padStart(8)} ms`);
  return r;
}

const fenAfter = (moves: string) => {
  const p = Position.start();
  for (const m of moves.split(' ').filter(Boolean)) p.playSan(m);
  return p.fen();
};

console.log('--- explorer (cold = no cache) ---');
for (const line of ['', 'e4', 'e4 e5', 'd4 Nf6 c4', 'e4 e5 Nf3 Nc6 Bb5', 'Nc3 e5 e4 Nc6 Nf3']) {
  const fen = fenAfter(line);
  clearExplorerMemoryCache();
  db.exec('DELETE FROM explorer_cache');
  const r = time(`explore [${line || 'start'}] cold`, () => explore(db, fen));
  console.log(`    -> ${r.total.games} games, ${r.moves.length} moves`);
  clearExplorerMemoryCache();
  time(`explore [${line || 'start'}] persisted cache`, () => explore(db, fen));
  time(`explore [${line || 'start'}] memory cache`, () => explore(db, fen), 100);
}
clearExplorerMemoryCache();
time('explore start, minElo 2400 (cold)', () => explore(db, fenAfter(''), { minElo: 2400 }));

console.log('--- search ---');
const queries: Array<[string, GameQuery]> = [
  ['no filter, newest first', {}],
  ['no filter, sort by date desc', { sort: 'date' }],
  ['no filter, page 1000 (offset 50k)', { offset: 50_000 }],
  ['player substring "Carlsen"', { player: 'Carlsen' }],
  ['player "Carlsen" sort date', { player: 'Carlsen', sort: 'date' }],
  ['exact player', { player: 'Carlsen, Magnus', playerExact: true }],
  ['player + result win', { player: 'Anand', result: 'win' }],
  ['event substring "Linares"', { event: 'Linares' }],
  ['date range 2000-2005', { dateFrom: '2000', dateTo: '2005' }],
  ['both players >= 2700', { minElo: 2700 }],
  ['eco B90-B99', { eco: 'B90-B99' }],
  ['opening name "Sicilian"', { opening: 'Sicilian' }],
  ['combined: Carlsen, 2400+, 2010-2020, white', { player: 'Carlsen', minElo: 2400, dateFrom: '2010', dateTo: '2020', color: 'white' }],
  ['position after 1.e4 e5 2.Nf3 Nc6 3.Bb5', { fen: fenAfter('e4 e5 Nf3 Nc6 Bb5') }],
  ['sort by white name', { sort: 'white', order: 'asc' }],
];
for (const [label, q] of queries) {
  const r = time(label, () => searchGames(db, q));
  console.log(`    -> ${r.total}${r.totalCapped ? '+' : ''} games`);
}
console.log('--- game loading ---');
time('load + format 100 games', () => {
  for (let i = 1; i <= 100; i++) getGame(db, i * 9973);
});
