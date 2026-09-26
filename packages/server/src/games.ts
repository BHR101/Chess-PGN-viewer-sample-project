/** Loading, exporting, creating, updating and deleting individual games. */
import { Position, START_FEN, decodeMoves, formatMainline, formatPgn, hashToBigInt } from '@pgnx/core';
import { type DB, RESULT_TEXT, getMeta, invalidateCaches, setMeta } from './db.js';
import { GameWriter } from './importer/import.js';
import { formatDate, processGame } from './importer/process.js';
import { clearExplorerMemoryCache } from './explorer.js';

interface StoredGame {
  id: number;
  white: string;
  black: string;
  event: string | null;
  site: string | null;
  date: number | null;
  round: string | null;
  result: number;
  white_elo: number | null;
  black_elo: number | null;
  eco: string | null;
  opening: string | null;
  ply_count: number;
  start_fen: string | null;
  moves: Buffer;
  movetext: string | null;
  tags: string | null;
}

const LOAD_SQL = `SELECT g.id, pw.name AS white, pb.name AS black, e.name AS event, s.name AS site, g.date, g.round,
  g.result, g.white_elo, g.black_elo, g.eco, o.name AS opening, g.ply_count, g.start_fen, g.moves, g.movetext, g.tags
  FROM games g JOIN players pw ON pw.id = g.white_id JOIN players pb ON pb.id = g.black_id
  LEFT JOIN events e ON e.id = g.event_id LEFT JOIN sites s ON s.id = g.site_id
  LEFT JOIN openings o ON o.id = g.opening_id`;

function headersOf(g: StoredGame): Array<[string, string]> {
  const h: Array<[string, string]> = [
    ['Event', g.event ?? '?'],
    ['Site', g.site ?? '?'],
    ['Date', formatDate(g.date)],
    ['Round', g.round ?? '?'],
    ['White', g.white],
    ['Black', g.black],
    ['Result', RESULT_TEXT[g.result]],
  ];
  if (g.white_elo) h.push(['WhiteElo', String(g.white_elo)]);
  if (g.black_elo) h.push(['BlackElo', String(g.black_elo)]);
  if (g.eco) h.push(['ECO', g.eco]);
  if (g.opening) h.push(['Opening', g.opening]);
  if (g.tags) {
    for (const [k, v] of Object.entries(JSON.parse(g.tags) as Record<string, string>)) h.push([k, v]);
  }
  if (g.start_fen) {
    h.push(['SetUp', '1']);
    h.push(['FEN', g.start_fen]);
  }
  return h;
}

function toPgn(g: StoredGame): string {
  let movetext = g.movetext;
  if (movetext === null) {
    const pos = Position.fromFen(g.start_fen ?? START_FEN);
    const moves = decodeMoves(new Uint8Array(g.moves.buffer, g.moves.byteOffset, g.moves.byteLength), pos.clone());
    movetext = formatMainline(pos, moves, RESULT_TEXT[g.result]);
  }
  return formatPgn(headersOf(g), movetext);
}

export interface GameDetail {
  id: number;
  pgn: string;
  headers: Array<[string, string]>;
  plies: number;
}

export function getGame(db: DB, id: number): GameDetail | null {
  const g = db.prepare(`${LOAD_SQL} WHERE g.id = ?`).get(id) as StoredGame | undefined;
  if (!g) return null;
  return { id: g.id, pgn: toPgn(g), headers: headersOf(g), plies: g.ply_count };
}

/** PGN texts for a list of game ids (in the given order). */
export function gamesPgn(db: DB, ids: number[]): string[] {
  if (!ids.length) return [];
  const rows = db.prepare(`${LOAD_SQL} WHERE g.id IN (${ids.map(() => '?').join(',')})`).all(...ids) as StoredGame[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.filter((id) => byId.has(id)).map((id) => toPgn(byId.get(id)!));
}

function indexPlies(db: DB): number {
  return Number(getMeta(db, 'index_plies') ?? 60);
}

function adjustCounts(db: DB, games: number, positions: number) {
  setMeta(db, 'game_count', String(Number(getMeta(db, 'game_count') ?? 0) + games));
  setMeta(db, 'position_count', String(Number(getMeta(db, 'position_count') ?? 0) + positions));
  invalidateCaches(db);
  clearExplorerMemoryCache();
}

/** Remove a game's rows from the position index by replaying its moves. */
function deletePositions(db: DB, id: number): number {
  const g = db.prepare('SELECT start_fen, moves FROM games WHERE id = ?').get(id) as
    | { start_fen: string | null; moves: Buffer }
    | undefined;
  if (!g) return 0;
  const pos = Position.fromFen(g.start_fen ?? START_FEN);
  const del = db.prepare('DELETE FROM positions WHERE hash = ? AND game_id = ?');
  const limit = indexPlies(db);
  let removed = del.run(hashToBigInt(pos.hashHi, pos.hashLo), id).changes;
  const bytes = new Uint8Array(g.moves.buffer, g.moves.byteOffset, g.moves.byteLength);
  const keys = bytes.length >> 1;
  for (let i = 0; i < keys && i < limit; i++) {
    const m = pos.fromKey(bytes[2 * i] | (bytes[2 * i + 1] << 8));
    if (m < 0) break;
    pos.play(m);
    removed += del.run(hashToBigInt(pos.hashHi, pos.hashLo), id).changes;
  }
  return removed;
}

export class GameInputError extends Error {}

function processOrThrow(db: DB, pgn: string) {
  const r = processGame(pgn, { indexPlies: indexPlies(db) });
  if (!r.ok) throw new GameInputError(r.error);
  if (r.game.warning) throw new GameInputError(r.game.warning);
  return r.game;
}

/** Add a new game from PGN text. Returns its id. */
export function createGame(db: DB, pgn: string): number {
  const game = processOrThrow(db, pgn);
  return db.transaction(() => {
    const writer = new GameWriter(db, false);
    const id = writer.write(game)!;
    adjustCounts(db, 1, writer.positionsInserted);
    return id;
  })();
}

/** Replace an existing game (keeping its id) with the given PGN. */
export function updateGame(db: DB, id: number, pgn: string): void {
  const game = processOrThrow(db, pgn);
  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM games WHERE id = ?').get(id)) throw new GameInputError(`Game ${id} not found`);
    const removed = deletePositions(db, id);
    db.prepare('DELETE FROM games WHERE id = ?').run(id);
    const writer = new GameWriter(db, false);
    writer.write(game, id);
    adjustCounts(db, 0, writer.positionsInserted - removed);
  })();
}

export function deleteGame(db: DB, id: number): boolean {
  return db.transaction(() => {
    const removed = deletePositions(db, id);
    const n = db.prepare('DELETE FROM games WHERE id = ?').run(id).changes;
    if (n) adjustCounts(db, -1, -removed);
    return n > 0;
  })();
}
