/** Game search: builds parameterised SQL from a structured query. */
import { Position } from '@pgnx/core';
import type { DB } from './db.js';
import { RESULT_TEXT } from './db.js';
import { formatDate } from './importer/process.js';

export interface GameQuery {
  /** Player name (substring, case-insensitive) or exact when playerExact is set. */
  player?: string;
  playerExact?: boolean;
  /** Which side `player` played: any (default), white or black. */
  color?: 'any' | 'white' | 'black';
  opponent?: string;
  white?: string;
  black?: string;
  event?: string;
  site?: string;
  /** "YYYY", "YYYY.MM" or "YYYY.MM.DD". */
  dateFrom?: string;
  dateTo?: string;
  /** '1-0', '0-1', '1/2-1/2', '*', or relative to `player`: 'win', 'loss', 'draw'. */
  result?: string;
  /** Both players at least this rated. */
  minElo?: number;
  /** Stronger player at most this rated. */
  maxElo?: number;
  /** ECO code, prefix ("B9") or range ("B90-B99"). */
  eco?: string;
  /** Opening name substring. */
  opening?: string;
  minPlies?: number;
  maxPlies?: number;
  annotated?: boolean;
  /** Games that reached this position (within the indexed plies). */
  fen?: string;
  sort?: SortKey;
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export type SortKey = 'id' | 'date' | 'white' | 'black' | 'event' | 'whiteElo' | 'blackElo' | 'elo' | 'eco' | 'plies' | 'result';

export interface GameRow {
  id: number;
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  event: string | null;
  site: string | null;
  date: string;
  round: string | null;
  result: string;
  eco: string | null;
  opening: string | null;
  plies: number;
  annotated: boolean;
  /** For position searches: ply at which the game reached the position. */
  ply?: number;
}

const SORT_SQL: Record<SortKey, string> = {
  id: 'g.id',
  date: 'g.date',
  white: 'pw.name',
  black: 'pb.name',
  event: 'e.name',
  whiteElo: 'g.white_elo',
  blackElo: 'g.black_elo',
  elo: 'g.min_elo',
  eco: 'g.eco',
  plies: 'g.ply_count',
  result: 'g.result',
};

function likePattern(s: string): string {
  return '%' + s.trim().replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

function dateBound(s: string, upper: boolean): number | null {
  const m = /^(\d{4})(?:[.\-/](\d{1,2}))?(?:[.\-/](\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  const y = +m[1];
  const mo = m[2] ? +m[2] : upper ? 12 : 0;
  const d = m[3] ? +m[3] : upper ? 31 : 0;
  return y * 10000 + mo * 100 + d;
}

export function positionHash(fen: string): bigint {
  return Position.fromFen(fen).hashBigInt();
}

interface Built {
  where: string[];
  params: unknown[];
  joinPositions: boolean;
}

export function buildWhere(q: GameQuery): Built {
  const where: string[] = [];
  const params: unknown[] = [];
  const playerIds = (name: string, exact?: boolean) => {
    if (exact) {
      params.push(name.trim());
      return '(SELECT id FROM players WHERE name = ?)';
    }
    params.push(likePattern(name));
    return "(SELECT id FROM players WHERE name LIKE ? ESCAPE '\\')";
  };
  if (q.player?.trim()) {
    const color = q.color ?? 'any';
    if (color === 'white') where.push(`g.white_id IN ${playerIds(q.player, q.playerExact)}`);
    else if (color === 'black') where.push(`g.black_id IN ${playerIds(q.player, q.playerExact)}`);
    else {
      const a = playerIds(q.player, q.playerExact);
      const b = playerIds(q.player, q.playerExact);
      where.push(`(g.white_id IN ${a} OR g.black_id IN ${b})`);
    }
    if (q.opponent?.trim()) {
      const a = playerIds(q.opponent);
      const b = playerIds(q.opponent);
      if (color === 'white') where.push(`g.black_id IN ${a}`);
      else if (color === 'black') where.push(`g.white_id IN ${a}`);
      else where.push(`(g.white_id IN ${a} OR g.black_id IN ${b})`);
    }
  }
  if (q.white?.trim()) where.push(`g.white_id IN ${playerIds(q.white)}`);
  if (q.black?.trim()) where.push(`g.black_id IN ${playerIds(q.black)}`);
  if (q.event?.trim()) {
    params.push(likePattern(q.event));
    where.push("g.event_id IN (SELECT id FROM events WHERE name LIKE ? ESCAPE '\\')");
  }
  if (q.site?.trim()) {
    params.push(likePattern(q.site));
    where.push("g.site_id IN (SELECT id FROM sites WHERE name LIKE ? ESCAPE '\\')");
  }
  if (q.dateFrom) {
    const d = dateBound(q.dateFrom, false);
    if (d !== null) {
      where.push('g.date >= ?');
      params.push(d);
    }
  }
  if (q.dateTo) {
    const d = dateBound(q.dateTo, true);
    if (d !== null) {
      where.push('g.date <= ?');
      params.push(d);
    }
  }
  if (q.result) {
    const abs = RESULT_TEXT.indexOf(q.result);
    if (abs >= 0) {
      where.push('g.result = ?');
      params.push(abs);
    } else if (q.player?.trim() && ['win', 'loss', 'draw'].includes(q.result)) {
      if (q.result === 'draw') where.push('g.result = 3');
      else {
        const wantWhiteWin = q.result === 'win' ? 1 : 2;
        const wantBlackWin = q.result === 'win' ? 2 : 1;
        const a = playerIds(q.player, q.playerExact);
        const b = playerIds(q.player, q.playerExact);
        where.push(`((g.result = ${wantWhiteWin} AND g.white_id IN ${a}) OR (g.result = ${wantBlackWin} AND g.black_id IN ${b}))`);
      }
    }
  }
  if (q.minElo) {
    where.push('g.min_elo >= ?');
    params.push(q.minElo);
  }
  if (q.maxElo) {
    where.push('g.max_elo <= ?');
    params.push(q.maxElo);
  }
  if (q.eco?.trim()) {
    const eco = q.eco.trim().toUpperCase();
    const range = /^([A-E]\d{2})\s*-\s*([A-E]\d{2})$/.exec(eco);
    if (range) {
      where.push('g.eco BETWEEN ? AND ?');
      params.push(range[1], range[2]);
    } else if (/^[A-E]\d{2}$/.test(eco)) {
      where.push('g.eco = ?');
      params.push(eco);
    } else if (/^[A-E]\d?$/.test(eco)) {
      where.push('g.eco >= ? AND g.eco < ?');
      params.push(eco, eco + '~');
    }
  }
  if (q.opening?.trim()) {
    params.push(likePattern(q.opening));
    where.push("g.opening_id IN (SELECT id FROM openings WHERE name LIKE ? ESCAPE '\\')");
  }
  if (q.minPlies) {
    where.push('g.ply_count >= ?');
    params.push(q.minPlies);
  }
  if (q.maxPlies) {
    where.push('g.ply_count <= ?');
    params.push(q.maxPlies);
  }
  if (q.annotated !== undefined) where.push(q.annotated ? 'g.movetext IS NOT NULL' : 'g.movetext IS NULL');
  let joinPositions = false;
  if (q.fen?.trim()) {
    joinPositions = true;
    params.push(positionHash(q.fen));
    where.push('p.hash = ?');
  }
  return { where, params, joinPositions };
}

const SELECT_COLUMNS = `g.id, pw.name AS white, pb.name AS black, g.white_elo AS whiteElo, g.black_elo AS blackElo,
  e.name AS event, s.name AS site, g.date, g.round, g.result, g.eco, o.name AS opening, g.ply_count AS plies,
  g.movetext IS NOT NULL AS annotated`;

const JOINS = `JOIN players pw ON pw.id = g.white_id
  JOIN players pb ON pb.id = g.black_id
  LEFT JOIN events e ON e.id = g.event_id
  LEFT JOIN sites s ON s.id = g.site_id
  LEFT JOIN openings o ON o.id = g.opening_id`;

interface RawRow extends Omit<GameRow, 'date' | 'result' | 'annotated'> {
  date: number | null;
  result: number;
  annotated: number;
}

export function toGameRow(r: RawRow): GameRow {
  return { ...r, date: formatDate(r.date), result: RESULT_TEXT[r.result], annotated: !!r.annotated };
}

export interface SearchResult {
  games: GameRow[];
  /** Total matching games, capped at countLimit. */
  total: number;
  totalCapped: boolean;
  elapsedMs: number;
}

export function searchGames(db: DB, q: GameQuery, countLimit = 100_000): SearchResult {
  const t0 = performance.now();
  const { where, params, joinPositions } = buildWhere(q);
  const from = joinPositions ? 'positions p JOIN games g ON g.id = p.game_id' : 'games g';
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortKey = q.sort && SORT_SQL[q.sort] ? q.sort : 'id';
  const dir = q.order === 'asc' ? 'ASC' : 'DESC';
  const needsNames = ['white', 'black', 'event'].includes(sortKey);
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 1000);
  const offset = Math.max(q.offset ?? 0, 0);
  // Find the page of ids first (cheap, index-friendly), then join the display columns.
  const idSql = needsNames
    ? `SELECT g.id ${joinPositions ? ', p.ply' : ''} FROM ${from} ${JOINS} ${whereSql}
       ORDER BY ${SORT_SQL[sortKey]} ${dir}, g.id ${dir} LIMIT ? OFFSET ?`
    : `SELECT g.id ${joinPositions ? ', p.ply' : ''} FROM ${from} ${whereSql}
       ORDER BY ${SORT_SQL[sortKey]} ${dir}${sortKey === 'id' ? '' : `, g.id ${dir}`} LIMIT ? OFFSET ?`;
  const idRows = db.prepare(idSql).all(...params, limit, offset) as Array<{ id: number; ply?: number }>;
  let games: GameRow[] = [];
  if (idRows.length) {
    const rows = db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM games g ${JOINS} WHERE g.id IN (${idRows.map(() => '?').join(',')})`)
      .all(...idRows.map((r) => r.id)) as RawRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    games = idRows.map((r) => {
      const row = toGameRow(byId.get(r.id)!);
      if (r.ply !== undefined) row.ply = r.ply;
      return row;
    });
  }
  let total: number;
  if (!where.length) {
    total = (db.prepare("SELECT coalesce((SELECT value FROM meta WHERE key = 'game_count'), (SELECT count(*) FROM games)) AS n").get() as { n: number }).n;
    total = Number(total);
  } else if (offset === 0 && idRows.length < limit) {
    total = idRows.length;
  } else {
    total = (db.prepare(`SELECT count(*) AS n FROM (SELECT 1 FROM ${from} ${whereSql} LIMIT ?)`).get(...params, countLimit + 1) as { n: number }).n;
  }
  const capped = where.length > 0 && total > countLimit;
  return { games, total: capped ? countLimit : total, totalCapped: capped, elapsedMs: Math.round(performance.now() - t0) };
}

/** Iterate over all game ids matching a query in id order (for exports), in chunks. */
export function* matchingIds(db: DB, q: GameQuery, chunk = 1000): Generator<number[]> {
  const { where, params, joinPositions } = buildWhere(q);
  const from = joinPositions ? 'positions p JOIN games g ON g.id = p.game_id' : 'games g';
  const stmt = db.prepare(
    `SELECT g.id FROM ${from} WHERE g.id > ? ${where.length ? 'AND ' + where.join(' AND ') : ''} ORDER BY g.id LIMIT ?`,
  );
  let last = 0;
  for (;;) {
    const ids = (stmt.all(last, ...params, chunk) as Array<{ id: number }>).map((r) => r.id);
    if (!ids.length) return;
    yield ids;
    last = ids[ids.length - 1];
    if (ids.length < chunk) return;
  }
}

export function suggest(db: DB, kind: 'players' | 'events' | 'sites', prefix: string, limit = 15): string[] {
  const p = prefix.trim();
  if (!p) return [];
  const escaped = p.replace(/[\\%_]/g, (c) => '\\' + c);
  // Prefix matches first (index-assisted), then substring matches.
  const pre = db
    .prepare(`SELECT name FROM ${kind} WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`)
    .all(escaped + '%', limit) as Array<{ name: string }>;
  const names = pre.map((r) => r.name);
  if (names.length < limit) {
    const sub = db
      .prepare(`SELECT name FROM ${kind} WHERE name LIKE ? ESCAPE '\\' LIMIT ?`)
      .all('%' + escaped + '%', limit * 2) as Array<{ name: string }>;
    for (const r of sub) if (!names.includes(r.name) && names.length < limit) names.push(r.name);
  }
  return names;
}
