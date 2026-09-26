import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = Database.Database;

export const SCHEMA_VERSION = 1;

/** Result codes stored in games.result and positions.result. */
export const RESULT = { UNKNOWN: 0, WHITE: 1, BLACK: 2, DRAW: 3 } as const;
export const RESULT_TEXT = ['*', '1-0', '0-1', '1/2-1/2'];

export function resultCode(r: string | undefined): number {
  switch (r) {
    case '1-0':
      return RESULT.WHITE;
    case '0-1':
      return RESULT.BLACK;
    case '1/2-1/2':
      return RESULT.DRAW;
    default:
      return RESULT.UNKNOWN;
  }
}

/**
 * Secondary indexes on games. They are dropped during bulk imports and
 * rebuilt afterwards, which is much faster than maintaining them row by row.
 */
export const GAME_INDEXES: Record<string, string> = {
  games_white: 'CREATE INDEX IF NOT EXISTS games_white ON games(white_id, date)',
  games_black: 'CREATE INDEX IF NOT EXISTS games_black ON games(black_id, date)',
  games_event: 'CREATE INDEX IF NOT EXISTS games_event ON games(event_id)',
  games_date: 'CREATE INDEX IF NOT EXISTS games_date ON games(date)',
  games_eco: 'CREATE INDEX IF NOT EXISTS games_eco ON games(eco)',
  games_min_elo: 'CREATE INDEX IF NOT EXISTS games_min_elo ON games(min_elo)',
  games_max_elo: 'CREATE INDEX IF NOT EXISTS games_max_elo ON games(max_elo)',
  games_opening: 'CREATE INDEX IF NOT EXISTS games_opening ON games(opening_id)',
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS openings (
  id INTEGER PRIMARY KEY,
  eco TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE
);

-- One row per game. Header fields used for searching are normalised into
-- columns; every other tag is kept verbatim in the JSON "tags" column.
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  white_id INTEGER NOT NULL,
  black_id INTEGER NOT NULL,
  event_id INTEGER,
  site_id INTEGER,
  date INTEGER,            -- yyyymmdd, unknown month/day stored as 00; NULL if unknown
  round TEXT,
  result INTEGER NOT NULL, -- 0 = *, 1 = 1-0, 2 = 0-1, 3 = 1/2-1/2
  white_elo INTEGER,
  black_elo INTEGER,
  min_elo INTEGER,
  max_elo INTEGER,
  eco TEXT,
  opening_id INTEGER,
  ply_count INTEGER NOT NULL,
  start_fen TEXT,          -- NULL for the standard starting position
  moves BLOB NOT NULL,     -- main line, 2 bytes per ply (see core/codec.ts)
  movetext TEXT,           -- original movetext when the game has comments/variations
  tags TEXT,               -- JSON object with the remaining tags
  fingerprint INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_fingerprint ON games(fingerprint);

-- Position index: one row per (position, game) for the first N plies of each
-- game. Powers the opening explorer and "find games with this position".
CREATE TABLE IF NOT EXISTS positions (
  hash INTEGER NOT NULL,   -- Polyglot Zobrist hash (signed 64-bit)
  game_id INTEGER NOT NULL,
  ply INTEGER NOT NULL,    -- ply at which the game reached the position
  move INTEGER,            -- next move key played in the game (NULL at game end)
  result INTEGER NOT NULL,
  elo INTEGER,             -- average Elo of both players (NULL if unknown)
  year INTEGER,
  PRIMARY KEY (hash, game_id)
) WITHOUT ROWID;

-- Cache for expensive explorer queries (invalidated whenever games change).
CREATE TABLE IF NOT EXISTS explorer_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export interface OpenOptions {
  readonly?: boolean;
  /** Page cache size in MiB. */
  cacheMiB?: number;
}

export function openDatabase(path: string, opts: OpenOptions = {}): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { readonly: opts.readonly ?? false });
  if (!opts.readonly) {
    // Must be set before the first table is created.
    db.pragma('page_size = 8192');
    db.pragma('journal_mode = WAL');
  }
  db.pragma('synchronous = NORMAL');
  db.pragma(`cache_size = ${-1024 * (opts.cacheMiB ?? 256)}`);
  db.pragma('temp_store = FILE');
  db.pragma('mmap_size = 1073741824');
  db.pragma('busy_timeout = 10000');
  if (!opts.readonly) migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec(SCHEMA);
  for (const sql of Object.values(GAME_INDEXES)) db.exec(sql);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  if (!row) {
    db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  } else if (Number(row.value) > SCHEMA_VERSION) {
    throw new Error(`Database schema version ${row.value} is newer than this program supports (${SCHEMA_VERSION}).`);
  }
  if (getMeta(db, 'index_plies') === undefined) setMeta(db, 'index_plies', '60');
}

export function getMeta(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function dropGameIndexes(db: DB): void {
  for (const name of Object.keys(GAME_INDEXES)) db.exec(`DROP INDEX IF EXISTS ${name}`);
}

export function createGameIndexes(db: DB): void {
  for (const sql of Object.values(GAME_INDEXES)) db.exec(sql);
}

/** Invalidate caches after the set of games changed. */
export function invalidateCaches(db: DB): void {
  db.exec('DELETE FROM explorer_cache');
  setMeta(db, 'data_version', String(Date.now()));
}

export interface DbStats {
  games: number;
  players: number;
  events: number;
  positions: number;
  fileBytes: number;
  indexPlies: number;
  dataVersion: string;
}

export function dbStats(db: DB): DbStats {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  // max(id) is O(1) and exact unless games were deleted; fall back to count for small DBs.
  const maxId = count('SELECT coalesce(max(id), 0) AS n FROM games');
  const games = maxId < 200_000 ? count('SELECT count(*) AS n FROM games') : Number(getMeta(db, 'game_count') ?? maxId);
  const pageCount = db.pragma('page_count', { simple: true }) as number;
  const pageSize = db.pragma('page_size', { simple: true }) as number;
  return {
    games,
    players: count('SELECT coalesce(max(id), 0) AS n FROM players'),
    events: count('SELECT coalesce(max(id), 0) AS n FROM events'),
    positions: Number(getMeta(db, 'position_count') ?? 0),
    fileBytes: pageCount * pageSize,
    indexPlies: Number(getMeta(db, 'index_plies') ?? 60),
    dataVersion: getMeta(db, 'data_version') ?? '0',
  };
}

/** Recount cached statistics (after imports/deletes). */
export function refreshCounts(db: DB): void {
  const games = (db.prepare('SELECT count(*) AS n FROM games').get() as { n: number }).n;
  setMeta(db, 'game_count', String(games));
}
