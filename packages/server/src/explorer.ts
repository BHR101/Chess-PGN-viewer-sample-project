/** Opening / position explorer backed by the position index. */
import { Position, moveKeyToUci, openingOfPosition } from '@pgnx/core';
import { type DB, getMeta } from './db.js';
import { type GameRow, toGameRow } from './search.js';

export interface ExplorerFilters {
  /** Minimum average Elo of the two players. */
  minElo?: number;
  maxElo?: number;
  yearFrom?: number;
  yearTo?: number;
}

export interface MoveStats {
  uci: string;
  san: string;
  games: number;
  white: number;
  draws: number;
  black: number;
  avgElo: number | null;
  lastYear: number | null;
}

export interface ExplorerResult {
  fen: string;
  hash: string;
  total: { games: number; white: number; draws: number; black: number };
  /** Games that ended in exactly this position. */
  ended: number;
  moves: MoveStats[];
  topGames: Array<GameRow & { ply: number }>;
  recentGames: Array<GameRow & { ply: number }>;
  opening: { eco: string; name: string } | null;
  /** Plies per game covered by the index. */
  indexPlies: number;
  elapsedMs: number;
  cached: boolean;
}

interface Row {
  move: number | null;
  n: number;
  w: number;
  d: number;
  b: number;
  elo: number | null;
  year: number | null;
}

function filterSql(f: ExplorerFilters): { sql: string; params: number[] } {
  const parts: string[] = [];
  const params: number[] = [];
  if (f.minElo) {
    parts.push('elo >= ?');
    params.push(f.minElo);
  }
  if (f.maxElo) {
    parts.push('elo <= ?');
    params.push(f.maxElo);
  }
  if (f.yearFrom) {
    parts.push('year >= ?');
    params.push(f.yearFrom);
  }
  if (f.yearTo) {
    parts.push('year <= ?');
    params.push(f.yearTo);
  }
  return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
}

const memCache = new Map<string, ExplorerResult>();
const MEM_CACHE_SIZE = 500;

/** Queries slower than this are persisted in the explorer_cache table. */
const PERSIST_THRESHOLD_MS = 20;

export function explore(db: DB, fen: string, filters: ExplorerFilters = {}, gameLimit = 8): ExplorerResult {
  const t0 = performance.now();
  const pos = Position.fromFen(fen);
  const hash = pos.hashBigInt();
  const dataVersion = getMeta(db, 'data_version') ?? '0';
  const key = `${hash}|${filters.minElo ?? ''}|${filters.maxElo ?? ''}|${filters.yearFrom ?? ''}|${filters.yearTo ?? ''}|${gameLimit}`;
  const memKey = `${dataVersion}|${key}`;
  const hit = memCache.get(memKey);
  if (hit) {
    memCache.delete(memKey);
    memCache.set(memKey, hit);
    return { ...hit, fen: pos.fen(), elapsedMs: Math.round(performance.now() - t0), cached: true };
  }
  const stored = db.prepare('SELECT value FROM explorer_cache WHERE key = ?').get(key) as { value: string } | undefined;
  if (stored) {
    const res = JSON.parse(stored.value) as ExplorerResult;
    remember(memKey, res);
    return { ...res, fen: pos.fen(), elapsedMs: Math.round(performance.now() - t0), cached: true };
  }

  const { sql, params } = filterSql(filters);
  const rows = db
    .prepare(
      `SELECT move, count(*) AS n, sum(result = 1) AS w, sum(result = 3) AS d, sum(result = 2) AS b,
              avg(elo) AS elo, max(year) AS year
       FROM positions WHERE hash = ?${sql} GROUP BY move`,
    )
    .all(hash, ...params) as Row[];

  const total = { games: 0, white: 0, draws: 0, black: 0 };
  let ended = 0;
  const moves: MoveStats[] = [];
  for (const r of rows) {
    total.games += r.n;
    total.white += r.w;
    total.draws += r.d;
    total.black += r.b;
    if (r.move === null) {
      ended += r.n;
      continue;
    }
    const m = pos.fromKey(r.move);
    if (m < 0) continue; // hash collision safety net
    moves.push({
      uci: moveKeyToUci(r.move),
      san: pos.san(m),
      games: r.n,
      white: r.w,
      draws: r.d,
      black: r.b,
      avgElo: r.elo === null ? null : Math.round(r.elo),
      lastYear: r.year,
    });
  }
  moves.sort((a, b) => b.games - a.games || a.san.localeCompare(b.san));

  const fetchGames = (order: string) => {
    const refs = db
      .prepare(`SELECT game_id AS id, ply FROM positions WHERE hash = ?${sql} ORDER BY ${order} LIMIT ?`)
      .all(hash, ...params, gameLimit) as Array<{ id: number; ply: number }>;
    return loadRows(db, refs);
  };
  const topGames = total.games ? fetchGames('elo DESC, game_id DESC') : [];
  const recentGames = total.games ? fetchGames('year DESC, game_id DESC') : [];
  const opening = openingOfPosition(pos);

  const elapsed = performance.now() - t0;
  const res: ExplorerResult = {
    fen: pos.fen(),
    hash: pos.hashHex(),
    total,
    ended,
    moves,
    topGames,
    recentGames,
    opening: opening ? { eco: opening.eco, name: opening.name } : null,
    indexPlies: Number(getMeta(db, 'index_plies') ?? 60),
    elapsedMs: Math.round(elapsed),
    cached: false,
  };
  remember(memKey, res);
  if (elapsed > PERSIST_THRESHOLD_MS && !db.readonly) {
    db.prepare('INSERT OR REPLACE INTO explorer_cache(key, value) VALUES (?, ?)').run(key, JSON.stringify(res));
  }
  return res;
}

function remember(key: string, res: ExplorerResult) {
  memCache.set(key, res);
  if (memCache.size > MEM_CACHE_SIZE) memCache.delete(memCache.keys().next().value!);
}

export function clearExplorerMemoryCache(): void {
  memCache.clear();
}

function loadRows(db: DB, refs: Array<{ id: number; ply: number }>): Array<GameRow & { ply: number }> {
  if (!refs.length) return [];
  const rows = db
    .prepare(
      `SELECT g.id, pw.name AS white, pb.name AS black, g.white_elo AS whiteElo, g.black_elo AS blackElo,
         e.name AS event, s.name AS site, g.date, g.round, g.result, g.eco, o.name AS opening, g.ply_count AS plies,
         g.movetext IS NOT NULL AS annotated
       FROM games g JOIN players pw ON pw.id = g.white_id JOIN players pb ON pb.id = g.black_id
       LEFT JOIN events e ON e.id = g.event_id LEFT JOIN sites s ON s.id = g.site_id
       LEFT JOIN openings o ON o.id = g.opening_id
       WHERE g.id IN (${refs.map(() => '?').join(',')})`,
    )
    .all(...refs.map((r) => r.id)) as Parameters<typeof toGameRow>[0][];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return refs.filter((r) => byId.has(r.id)).map((r) => ({ ...toGameRow(byId.get(r.id)!), ply: r.ply }));
}

/**
 * Pre-compute (and persist) explorer results for the most common opening
 * positions so the first clicks after an import are instant.
 */
export function warmExplorerCache(db: DB, depth = 2, breadth = 6): void {
  const visit = (fen: string, d: number) => {
    const r = explore(db, fen);
    if (d <= 0) return;
    for (const m of r.moves.slice(0, breadth)) {
      const p = Position.fromFen(fen);
      p.playUci(m.uci);
      visit(p.fen(), d - 1);
    }
  };
  visit(Position.start().fen(), depth);
}
