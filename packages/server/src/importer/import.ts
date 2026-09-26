/**
 * Import coordinator: streams PGN files, splits them into games, fans the
 * parsing out to worker threads and writes the results into SQLite in file
 * order, inside large transactions.
 */
import { createReadStream, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename } from 'node:path';
import type { Worker } from 'node:worker_threads';
import type { Statement } from 'better-sqlite3';
import { PgnSplitter } from '@pgnx/core';
import {
  type DB, createGameIndexes, dropGameIndexes, getMeta, invalidateCaches, openDatabase, refreshCounts, setMeta,
} from '../db.js';
import { clearExplorerMemoryCache, warmExplorerCache } from '../explorer.js';
import { siblingModule, spawnWorker } from '../util/worker.js';
import type { ProcessedGame, ProcessOptions } from './process.js';
import type { ParseRequest, ParseResponse } from './worker.js';

export interface ImportOptions {
  /** Plies per game added to the position index (default: database setting, 60). */
  indexPlies?: number;
  stripAnnotations?: boolean;
  /** Skip games whose players, date, result and moves match an existing game (default true). */
  dedupe?: boolean;
  /** Parser worker threads (default: CPU count - 1, at least 1). */
  workers?: number;
  /** Games per worker batch. */
  batchSize?: number;
  /** Drop and rebuild secondary indexes around the import ("auto" = when the database is empty). */
  bulk?: boolean | 'auto';
  onProgress?: (p: ImportProgress) => void;
  /** Checked between batches; return true to stop early. */
  shouldCancel?: () => boolean;
}

export interface ImportProgress {
  phase: 'importing' | 'indexing' | 'done' | 'cancelled';
  file: string;
  bytesRead: number;
  totalBytes: number;
  imported: number;
  duplicates: number;
  errors: number;
  warnings: number;
  elapsedMs: number;
  gamesPerSecond: number;
  /** A few sample error messages for display. */
  errorSamples: string[];
}

interface Lookup {
  get(name: string): number;
}

/** Name -> id cache backed by a lookup table with a UNIQUE COLLATE NOCASE name column. */
function makeLookup(db: DB, table: 'players' | 'events' | 'sites'): Lookup {
  const cache = new Map<string, number>();
  for (const row of db.prepare(`SELECT id, name FROM ${table}`).iterate() as Iterable<{ id: number; name: string }>) {
    cache.set(row.name.toLowerCase(), row.id);
  }
  const insert = db.prepare(`INSERT INTO ${table}(name) VALUES (?) ON CONFLICT(name) DO NOTHING`);
  const select = db.prepare(`SELECT id FROM ${table} WHERE name = ?`);
  return {
    get(name: string): number {
      const key = name.toLowerCase();
      let id = cache.get(key);
      if (id === undefined) {
        const r = insert.run(name);
        id = r.changes ? Number(r.lastInsertRowid) : (select.get(name) as { id: number }).id;
        cache.set(key, id);
      }
      return id;
    },
  };
}

export class GameWriter {
  private players: Lookup;
  private events: Lookup;
  private sites: Lookup;
  private openings = new Map<string, number>();
  private insertGame;
  private posTarget: string;
  private posStatements = new Map<number, Statement>();
  private posParams: unknown[] = [];
  private findDup;
  private insertOpening;
  positionsInserted = 0;

  /** Fingerprints seen during this import (used when the fingerprint index is dropped). */
  private seen: Set<number> | null = null;

  constructor(private db: DB, private dedupe: boolean, private staged = false, memoryDedupe = false) {
    if (memoryDedupe) this.seen = new Set();
    this.players = makeLookup(db, 'players');
    this.events = makeLookup(db, 'events');
    this.sites = makeLookup(db, 'sites');
    for (const row of db.prepare('SELECT id, name FROM openings').all() as Array<{ id: number; name: string }>) {
      this.openings.set(row.name, row.id);
    }
    this.insertOpening = db.prepare('INSERT INTO openings(eco, name) VALUES (?, ?)');
    this.insertGame = db.prepare(
      `INSERT INTO games(id, white_id, black_id, event_id, site_id, date, round, result, white_elo, black_elo,
         min_elo, max_elo, eco, opening_id, ply_count, start_fen, moves, movetext, tags, fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    if (staged) {
      // A temporary database (deleted automatically) keeps the main file compact.
      db.exec("ATTACH DATABASE '' AS stage");
      db.exec(`CREATE TABLE stage.positions_stage (
        hash INTEGER, move INTEGER, game_id INTEGER, ply INTEGER, result INTEGER, elo INTEGER, year INTEGER)`);
      this.posTarget = 'INSERT INTO stage.positions_stage VALUES ';
    } else {
      this.posTarget = 'INSERT OR IGNORE INTO positions VALUES ';
    }
    this.findDup = db.prepare('SELECT id FROM games WHERE fingerprint = ? LIMIT 1');
  }

  private posInsert(rows: number): Statement {
    let st = this.posStatements.get(rows);
    if (!st) {
      st = this.db.prepare(this.posTarget + new Array(rows).fill('(?, ?, ?, ?, ?, ?, ?)').join(', '));
      this.posStatements.set(rows, st);
    }
    return st;
  }

  private openingId(o: { eco: string; name: string } | null): number | null {
    if (!o) return null;
    let id = this.openings.get(o.name);
    if (id === undefined) {
      id = Number(this.insertOpening.run(o.eco, o.name).lastInsertRowid);
      this.openings.set(o.name, id);
    }
    return id;
  }

  /**
   * Insert one game (call inside a transaction). Returns the new id, or null
   * for a duplicate. `id` forces a specific row id (used when replacing a game).
   */
  write(g: ProcessedGame, id: number | null = null): number | null {
    if (this.dedupe) {
      if (this.seen) {
        if (this.seen.has(g.fingerprint)) return null;
        this.seen.add(g.fingerprint);
      } else if (this.findDup.get(g.fingerprint)) {
        return null;
      }
    }
    const elos = [g.whiteElo, g.blackElo].filter((e): e is number => e !== null);
    const minElo = elos.length === 2 ? Math.min(elos[0], elos[1]) : null;
    const maxElo = elos.length ? Math.max(...elos) : null;
    const info = this.insertGame.run(
      id,
      this.players.get(g.white),
      this.players.get(g.black),
      g.event ? this.events.get(g.event) : null,
      g.site ? this.sites.get(g.site) : null,
      g.date,
      g.round,
      g.result,
      g.whiteElo,
      g.blackElo,
      minElo,
      maxElo,
      g.eco,
      this.openingId(g.opening),
      g.plyCount,
      g.startFen,
      g.moves,
      g.movetext,
      g.tags,
      g.fingerprint,
    );
    const gameId = Number(info.lastInsertRowid);
    const avgElo = elos.length === 2 ? Math.round((elos[0] + elos[1]) / 2) : elos.length ? elos[0] : null;
    const { hashes, next } = g;
    // A position that repeats within a game is recorded once (first occurrence).
    const seen = new Set<bigint>();
    const params = this.posParams;
    let rows = 0;
    for (let i = 0; i < hashes.length; i++) {
      const h = hashes[i];
      if (seen.has(h)) continue;
      seen.add(h);
      const o = rows * 7;
      params[o] = h;
      params[o + 1] = next[i];
      params[o + 2] = gameId;
      params[o + 3] = i;
      params[o + 4] = g.result;
      params[o + 5] = avgElo;
      params[o + 6] = g.year;
      rows++;
    }
    // One multi-row INSERT per game: far fewer statement executions.
    if (rows) {
      params.length = rows * 7;
      this.positionsInserted += this.posInsert(rows).run(params).changes;
    }
    return gameId;
  }

  /**
   * Move staged positions into the position index in one sorted pass (an
   * external merge sort in SQLite), which is far cheaper than millions of
   * random B-tree inserts. Returns the number of index rows added.
   */
  mergeStaged(): number {
    if (!this.staged) return this.positionsInserted;
    const r = this.db
      .prepare('INSERT OR IGNORE INTO main.positions SELECT * FROM stage.positions_stage ORDER BY hash, move, game_id')
      .run();
    this.db.exec('DETACH DATABASE stage');
    return r.changes;
  }
}

class WorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private waiting: Array<() => void> = [];

  constructor(size: number, private onResult: (r: ParseResponse) => void, private onError: (e: Error) => void) {
    const url = siblingModule(import.meta.url, 'worker');
    for (let i = 0; i < size; i++) {
      const w = spawnWorker(url);
      w.on('message', (r: ParseResponse) => {
        this.onResult(r);
        this.release(w);
      });
      w.on('error', (e: Error) => this.onError(e));
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  private release(w: Worker) {
    this.idle.push(w);
    const next = this.waiting.shift();
    if (next) next();
  }

  async submit(req: ParseRequest): Promise<void> {
    while (!this.idle.length) await new Promise<void>((r) => this.waiting.push(r));
    this.idle.pop()!.postMessage(req);
  }

  async drain(): Promise<void> {
    while (this.idle.length < this.workers.length) await new Promise<void>((r) => this.waiting.push(r));
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

/** Decode bytes as UTF-8, falling back to Windows-1252 for legacy (non UTF-8) files. */
class TextStream {
  private decoder: TextDecoder = new TextDecoder('utf-8', { fatal: true });
  private legacy = false;
  decode(chunk: Uint8Array, stream = true): string {
    if (this.legacy) return this.decoder.decode(chunk, { stream });
    try {
      return this.decoder.decode(chunk, { stream });
    } catch {
      this.legacy = true;
      this.decoder = new TextDecoder('windows-1252');
      return this.decoder.decode(chunk, { stream });
    }
  }
}

/**
 * Import PGN files into the database at `dbPath` (or an open handle).
 * Returns final progress statistics.
 */
export async function importPgnFiles(
  target: string | DB,
  files: string[],
  opts: ImportOptions = {},
): Promise<ImportProgress> {
  const db = typeof target === 'string' ? openDatabase(target, { cacheMiB: 1024 }) : target;
  const ownsDb = typeof target === 'string';
  const indexPlies = opts.indexPlies ?? Number(getMeta(db, 'index_plies') ?? 60);
  if (opts.indexPlies !== undefined) setMeta(db, 'index_plies', String(opts.indexPlies));
  const processOpts: ProcessOptions = { indexPlies, stripAnnotations: opts.stripAnnotations };
  const batchSize = opts.batchSize ?? 500;
  const nWorkers = opts.workers ?? Math.max(1, Math.min(8, availableParallelism() - 1));
  const empty = !(db.prepare('SELECT 1 FROM games LIMIT 1').get());
  const bulk = opts.bulk === 'auto' || opts.bulk === undefined ? empty : opts.bulk;

  const totalBytes = files.reduce((s, f) => s + statSync(f).size, 0);
  const t0 = Date.now();
  const progress: ImportProgress = {
    phase: 'importing', file: '', bytesRead: 0, totalBytes, imported: 0, duplicates: 0, errors: 0, warnings: 0,
    elapsedMs: 0, gamesPerSecond: 0, errorSamples: [],
  };
  const report = () => {
    progress.elapsedMs = Date.now() - t0;
    progress.gamesPerSecond = progress.elapsedMs ? Math.round((progress.imported * 1000) / progress.elapsedMs) : 0;
    opts.onProgress?.({ ...progress, errorSamples: [...progress.errorSamples] });
  };
  const sample = (msg: string) => {
    if (progress.errorSamples.length < 20) progress.errorSamples.push(msg);
  };

  // Large imports stage position rows and merge them sorted at the end.
  const staged = bulk || totalBytes > 32 * 1024 * 1024;
  if (bulk) {
    dropGameIndexes(db);
    db.exec('DROP INDEX IF EXISTS games_fingerprint');
    db.pragma('synchronous = OFF');
  }
  const writer = new GameWriter(db, opts.dedupe !== false, staged, bulk);
  const beforePositions = Number(getMeta(db, 'position_count') ?? 0);

  // Results can arrive out of order; write them strictly in submission order.
  const pending = new Map<number, ParseResponse>();
  let nextToWrite = 0;
  let fatal: Error | null = null;
  const writeBatch = db.transaction((r: ParseResponse) => {
    for (const res of r.results) {
      if (!res.ok) {
        progress.errors++;
        sample(res.error);
        continue;
      }
      if (res.game.warning) {
        progress.warnings++;
        sample(`${res.game.white} - ${res.game.black}: ${res.game.warning}`);
      }
      if (writer.write(res.game) === null) progress.duplicates++;
      else progress.imported++;
    }
  });
  // Group several worker batches per transaction to amortise commit cost.
  let sinceReport = 0;
  const flush = () => {
    while (pending.has(nextToWrite)) {
      const r = pending.get(nextToWrite)!;
      pending.delete(nextToWrite);
      nextToWrite++;
      writeBatch(r);
      sinceReport += r.results.length;
    }
    if (sinceReport >= 5000) {
      sinceReport = 0;
      report();
    }
  };
  const pool = new WorkerPool(
    nWorkers,
    (r) => {
      pending.set(r.seq, r);
      try {
        flush();
      } catch (e) {
        fatal = e as Error;
      }
    },
    (e) => {
      fatal = e;
    },
  );

  let seq = 0;
  let cancelled = false;
  try {
    for (const file of files) {
      progress.file = basename(file);
      const splitter = new PgnSplitter();
      const text = new TextStream();
      let batch: string[] = [];
      const stream = createReadStream(file, { highWaterMark: 1 << 22 });
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        if (fatal) throw fatal;
        if (opts.shouldCancel?.()) {
          cancelled = true;
          stream.destroy();
          break;
        }
        progress.bytesRead += chunk.length;
        for (const g of splitter.push(text.decode(chunk))) {
          batch.push(g);
          if (batch.length >= batchSize) {
            await pool.submit({ seq: seq++, games: batch, opts: processOpts });
            batch = [];
          }
        }
      }
      if (cancelled) break;
      splitter.push(text.decode(new Uint8Array(0), false));
      batch.push(...splitter.finish());
      if (batch.length) await pool.submit({ seq: seq++, games: batch, opts: processOpts });
    }
    await pool.drain();
    if (fatal) throw fatal;
    flush();
  } finally {
    await pool.close();
  }

  progress.phase = 'indexing';
  report();
  // Let SQLite's external sorter use helper threads for the big merge.
  db.pragma(`threads = ${Math.min(8, availableParallelism())}`);
  let t = Date.now();
  const added = writer.mergeStaged();
  if (process.env.PGNX_DEBUG) console.error(`\nmerge ${Date.now() - t}ms`);
  t = Date.now();
  setMeta(db, 'position_count', String(beforePositions + added));
  if (bulk) {
    createGameIndexes(db);
    db.exec('CREATE INDEX IF NOT EXISTS games_fingerprint ON games(fingerprint)');
    db.pragma('synchronous = NORMAL');
  }
  if (process.env.PGNX_DEBUG) console.error(`indexes ${Date.now() - t}ms`);
  t = Date.now();
  db.pragma('analysis_limit = 1000');
  db.exec('ANALYZE');
  if (process.env.PGNX_DEBUG) console.error(`analyze ${Date.now() - t}ms`);
  refreshCounts(db);
  invalidateCaches(db);
  clearExplorerMemoryCache();
  if (progress.imported > 0) warmExplorerCache(db);
  progress.phase = cancelled ? 'cancelled' : 'done';
  report();
  if (ownsDb) db.close();
  return progress;
}
