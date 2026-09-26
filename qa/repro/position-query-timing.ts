/**
 * Time the position-search queries (as issued by search.ts) directly against a database file.
 *
 *   cd packages/server
 *   node --conditions=development --import tsx ../../qa/repro/position-query-timing.ts DB.sqlite "FEN" ["ORDER BY clause"]
 *
 * On a fresh connection this is fast (~50-250 ms on 110k games). Compare with the same
 * request against a long-running server: see position-search-freeze.cjs.
 */
import Database from 'better-sqlite3';
import { Position } from '../../packages/core/src/index.ts';
const [dbPath, fen, order = 'g.date DESC, g.id DESC'] = process.argv.slice(2);
if (!dbPath || !fen) throw new Error('usage: position-query-timing.ts DB.sqlite "FEN" ["ORDER BY clause"]');
const db = new Database(dbPath, { readonly: true });
const h = Position.fromFen(fen).hashBigInt();
const sql = `SELECT g.id, p.ply FROM positions p JOIN games g ON g.id = p.game_id WHERE p.hash = ? ORDER BY ${order} LIMIT 50`;
console.log('plan:', db.prepare('EXPLAIN QUERY PLAN ' + sql).all(h).map((r: any) => r.detail).join(' | '));
console.log('rows for hash:', (db.prepare('SELECT count(*) n FROM positions WHERE hash = ?').get(h) as any).n);
let t = performance.now();
const r = db.prepare(sql).all(h);
console.log('page query', r.length, 'rows', Math.round(performance.now() - t), 'ms');
t = performance.now();
const c = db.prepare('SELECT count(*) AS n FROM (SELECT 1 FROM positions p JOIN games g ON g.id = p.game_id WHERE p.hash = ? LIMIT 100001)').get(h);
console.log('count query', c, Math.round(performance.now() - t), 'ms');
console.log('sqlite_stat1:', db.prepare("SELECT idx, stat FROM sqlite_stat1 WHERE tbl IN ('games','positions') LIMIT 3").all());
