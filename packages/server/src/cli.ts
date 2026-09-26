#!/usr/bin/env node
/**
 * pgnx — command line interface.
 *
 *   pgnx serve   [--db FILE] [--port 3000] [--host 127.0.0.1]
 *   pgnx import  FILE... [--db FILE] [--index-plies 60] [--no-dedupe] [--strip-annotations] [--workers N]
 *   pgnx export  [--db FILE] [--out FILE] [--player NAME] [--eco B90] [--fen FEN] ...
 *   pgnx search  [--db FILE] [filters] [--limit 20]
 *   pgnx explore [--db FILE] [--fen FEN | --moves "e4 e5 Nf3"] [--min-elo N]
 *   pgnx stats   [--db FILE]
 */
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Position } from '@pgnx/core';
import { dbStats, openDatabase } from './db.js';
import { explore } from './explorer.js';
import { gamesPgn } from './games.js';
import { importPgnFiles } from './importer/import.js';
import { type GameQuery, matchingIds, searchGames } from './search.js';
import { createServer } from './server.js';

const DEFAULT_DB = process.env.PGNX_DB ?? 'data/pgnx.sqlite';

const FILTER_OPTIONS = {
  player: { type: 'string' },
  color: { type: 'string' },
  opponent: { type: 'string' },
  white: { type: 'string' },
  black: { type: 'string' },
  event: { type: 'string' },
  site: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  result: { type: 'string' },
  'min-elo': { type: 'string' },
  'max-elo': { type: 'string' },
  eco: { type: 'string' },
  opening: { type: 'string' },
  fen: { type: 'string' },
} as const;

function queryFrom(v: Record<string, string | boolean | undefined>): GameQuery {
  const s = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
  const n = (k: string) => (s(k) ? Number(s(k)) : undefined);
  return {
    player: s('player'),
    color: (s('color') as GameQuery['color']) ?? 'any',
    opponent: s('opponent'),
    white: s('white'),
    black: s('black'),
    event: s('event'),
    site: s('site'),
    dateFrom: s('from'),
    dateTo: s('to'),
    result: s('result'),
    minElo: n('min-elo'),
    maxElo: n('max-elo'),
    eco: s('eco'),
    opening: s('opening'),
    fen: s('fen'),
  };
}

function fmtBytes(n: number): string {
  return n > 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`;
}

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  switch (command) {
    case 'serve': {
      const { values } = parseArgs({
        args: rest,
        options: {
          db: { type: 'string', default: DEFAULT_DB },
          port: { type: 'string', default: process.env.PORT ?? '3000' },
          host: { type: 'string', default: process.env.HOST ?? '127.0.0.1' },
          'web-dir': { type: 'string' },
        },
      });
      const { app } = await createServer({ dbPath: resolve(values.db!), webDir: values['web-dir'] });
      const address = await app.listen({ port: Number(values.port), host: values.host });
      console.log(`PGN Explorer running at ${address.replace('127.0.0.1', 'localhost')}  (database: ${resolve(values.db!)})`);
      const stop = async () => {
        await app.close();
        process.exit(0);
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      break;
    }
    case 'import': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          db: { type: 'string', default: DEFAULT_DB },
          'index-plies': { type: 'string' },
          'no-dedupe': { type: 'boolean', default: false },
          'strip-annotations': { type: 'boolean', default: false },
          workers: { type: 'string' },
        },
      });
      if (!positionals.length) throw new Error('usage: pgnx import FILE... [--db FILE]');
      const t0 = Date.now();
      const p = await importPgnFiles(resolve(values.db!), positionals.map((f) => resolve(f)), {
        indexPlies: values['index-plies'] ? Number(values['index-plies']) : undefined,
        dedupe: !values['no-dedupe'],
        stripAnnotations: values['strip-annotations'],
        workers: values.workers ? Number(values.workers) : undefined,
        onProgress: (p) => {
          const pct = p.totalBytes ? ((100 * p.bytesRead) / p.totalBytes).toFixed(1) : '?';
          process.stderr.write(
            `\r${p.phase.padEnd(9)} ${pct}%  ${p.imported.toLocaleString()} games  ${p.gamesPerSecond.toLocaleString()}/s  ` +
              `dup ${p.duplicates}  err ${p.errors}   `,
          );
        },
      });
      process.stderr.write('\n');
      console.log(
        `Imported ${p.imported.toLocaleString()} games in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
          `(${p.duplicates} duplicates skipped, ${p.errors} errors, ${p.warnings} warnings).`,
      );
      for (const e of p.errorSamples.slice(0, 10)) console.log(`  ! ${e}`);
      break;
    }
    case 'export': {
      const { values } = parseArgs({
        args: rest,
        options: { db: { type: 'string', default: DEFAULT_DB }, out: { type: 'string' }, ...FILTER_OPTIONS },
      });
      const db = openDatabase(resolve(values.db!), { readonly: true });
      const out = values.out ? createWriteStream(values.out) : process.stdout;
      let n = 0;
      for (const ids of matchingIds(db, queryFrom(values), 1000)) {
        const text = gamesPgn(db, ids).join('\n') + '\n';
        if (!out.write(text)) await new Promise((r) => out.once('drain', r));
        n += ids.length;
      }
      if (values.out) {
        await new Promise<void>((r) => (out as NodeJS.WritableStream).end(() => r()));
        console.error(`Exported ${n} games to ${values.out}`);
      }
      break;
    }
    case 'search': {
      const { values } = parseArgs({
        args: rest,
        options: { db: { type: 'string', default: DEFAULT_DB }, limit: { type: 'string', default: '20' }, ...FILTER_OPTIONS },
      });
      const db = openDatabase(resolve(values.db!), { readonly: true });
      const r = searchGames(db, { ...queryFrom(values), limit: Number(values.limit), sort: 'date' });
      for (const g of r.games) {
        console.log(`#${g.id}\t${g.date}\t${g.white} (${g.whiteElo ?? '-'}) - ${g.black} (${g.blackElo ?? '-'})\t${g.result}\t${g.eco ?? ''}\t${g.event ?? ''}`);
      }
      console.log(`${r.total.toLocaleString()}${r.totalCapped ? '+' : ''} games (${r.elapsedMs} ms)`);
      break;
    }
    case 'explore': {
      const { values } = parseArgs({
        args: rest,
        options: {
          db: { type: 'string', default: DEFAULT_DB },
          fen: { type: 'string' },
          moves: { type: 'string' },
          'min-elo': { type: 'string' },
        },
      });
      const db = openDatabase(resolve(values.db!));
      const pos = values.fen ? Position.fromFen(values.fen) : Position.start();
      for (const m of (values.moves ?? '').split(/\s+/).filter(Boolean)) pos.playSan(m);
      const r = explore(db, pos.fen(), { minElo: values['min-elo'] ? Number(values['min-elo']) : undefined });
      console.log(`${r.fen}${r.opening ? `  —  ${r.opening.eco} ${r.opening.name}` : ''}`);
      console.log(`${r.total.games.toLocaleString()} games (${r.elapsedMs} ms${r.cached ? ', cached' : ''})`);
      for (const m of r.moves.slice(0, 20)) {
        const pct = (x: number) => ((100 * x) / m.games).toFixed(0).padStart(3) + '%';
        console.log(`  ${m.san.padEnd(8)} ${m.games.toLocaleString().padStart(10)}  W${pct(m.white)} D${pct(m.draws)} B${pct(m.black)}  Ø${m.avgElo ?? '-'}`);
      }
      break;
    }
    case 'stats': {
      const { values } = parseArgs({ args: rest, options: { db: { type: 'string', default: DEFAULT_DB } } });
      const s = dbStats(openDatabase(resolve(values.db!), { readonly: true }));
      console.log(`games      ${s.games.toLocaleString()}`);
      console.log(`players    ${s.players.toLocaleString()}`);
      console.log(`events     ${s.events.toLocaleString()}`);
      console.log(`positions  ${s.positions.toLocaleString()} (first ${s.indexPlies} plies per game)`);
      console.log(`file size  ${fmtBytes(s.fileBytes)}`);
      break;
    }
    default:
      console.log(`PGN Explorer

Usage:
  pgnx serve   [--db FILE] [--port 3000] [--host 127.0.0.1]
  pgnx import  FILE... [--db FILE] [--index-plies 60] [--no-dedupe] [--strip-annotations] [--workers N]
  pgnx export  [--db FILE] [--out FILE] [filters]
  pgnx search  [--db FILE] [filters] [--limit 20]
  pgnx explore [--db FILE] [--fen FEN | --moves "e4 e5 Nf3"] [--min-elo N]
  pgnx stats   [--db FILE]

Filters: --player --color white|black --opponent --white --black --event --site
         --from YYYY[.MM.DD] --to YYYY[.MM.DD] --result 1-0|0-1|1/2-1/2|win|loss|draw
         --min-elo --max-elo --eco B90|B9|B90-B99 --opening NAME --fen FEN

Default database: ${DEFAULT_DB} (override with --db or PGNX_DB)`);
  }
}

main().catch((e) => {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
});
