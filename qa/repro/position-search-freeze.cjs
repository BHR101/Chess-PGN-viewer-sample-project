/**
 * Repro: position search freezes the whole server when the server's DB connection
 * holds planner statistics from when the database was small.
 *
 *   node qa/repro/position-search-freeze.cjs path/to/big.sqlite
 *
 * 1. Copies the DB and rewrites sqlite_stat1 to the values a 1-game DB would have
 *    (what a server started on a near-empty DB keeps in memory).
 * 2. Starts a server on the copy and times a Najdorf position search (limit 100, sort=date).
 * 3. Runs ANALYZE from a *separate* connection (like the import worker does) and times a
 *    second position search: the server keeps using its stale statistics.
 *
 * Observed on 110k TWIC games: 44 s and 106 s (vs 65 ms on a freshly started server),
 * with /api/info blocked for the whole time.
 */
const { spawn } = require('node:child_process');
const { copyFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const Database = require('better-sqlite3');

const src = process.argv[2];
if (!src) throw new Error('usage: position-search-freeze.cjs DB.sqlite');
const dir = mkdtempSync(join(tmpdir(), 'pgnx-freeze-'));
const db = join(dir, 'copy.sqlite');
const s = new Database(src, { readonly: true });
s.backup(db).then(async () => {
  s.close();
  const w = new Database(db);
  w.exec(`UPDATE sqlite_stat1 SET stat = CASE WHEN tbl='positions' THEN '29 2 2 1'
    WHEN tbl='games' AND idx IN ('games_white','games_black') THEN '1 1 1' WHEN tbl='games' THEN '1 1' ELSE stat END`);
  w.close();
  const port = 3900 + Math.floor(Math.random() * 90);
  const cli = resolve(__dirname, '../../packages/server/dist/cli.js');
  const server = spawn(process.execPath, [cli, 'serve', '--db', db, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('running at') && r()));
  const base = `http://127.0.0.1:${port}`;
  const time = async (label, fen) => {
    const t = Date.now();
    const info = setTimeout(async () => {
      const ti = Date.now();
      await fetch(`${base}/api/info`).catch(() => {});
      console.log(`   (/api/info issued 1 s into the search answered after ${Date.now() - ti} ms)`);
    }, 1000);
    const r = await fetch(`${base}/api/games?fen=${encodeURIComponent(fen)}&sort=date&order=desc&offset=0&limit=100`).then((x) => x.json());
    clearTimeout(info);
    console.log(`${label}: total=${r.total} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  };
  await time('stale stats, Najdorf', 'rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6');
  const a = new Database(db);
  a.pragma('analysis_limit = 1000');
  a.exec('ANALYZE');
  a.close();
  await time('after ANALYZE from another connection, Sicilian 2...d6', 'rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3');
  server.kill();
  setTimeout(() => rmSync(dir, { recursive: true, force: true }), 500);
});
