/**
 * Pure per-game processing for the importer: parse one raw PGN game, replay
 * the main line, compute position hashes, classify the opening and pack
 * everything into a compact record. Runs inside worker threads.
 */
import {
  Position, START_FEN, encodeMoves, extractMovetext, hashToBigInt, openingAt, scanPgn,
} from '@pgnx/core';
import { resultCode } from '../db.js';

export interface ProcessOptions {
  /** Number of plies (from the start of each game) to add to the position index. */
  indexPlies: number;
  /** Drop comments, NAGs and variations. */
  stripAnnotations?: boolean;
}

export interface ProcessedGame {
  white: string;
  black: string;
  event: string | null;
  site: string | null;
  date: number | null;
  year: number | null;
  round: string | null;
  result: number;
  whiteElo: number | null;
  blackElo: number | null;
  eco: string | null;
  opening: { eco: string; name: string } | null;
  plyCount: number;
  startFen: string | null;
  moves: Uint8Array;
  movetext: string | null;
  tags: string | null;
  fingerprint: number;
  /** Position hashes for plies 0..n (signed 64-bit). */
  hashes: BigInt64Array;
  /** Move key played from each indexed position (0xffff = game ended there). */
  next: Uint16Array;
  /** Problems found (illegal moves etc.); the game is still imported up to the problem. */
  warning?: string;
}

export type ProcessResult = { ok: true; game: ProcessedGame } | { ok: false; error: string };

const MAIN_TAGS = new Set([
  'Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result', 'WhiteElo', 'BlackElo', 'ECO', 'FEN', 'SetUp',
  'PlyCount', 'Opening', 'Variation',
]);

const UNKNOWN = new Set(['', '?', '-', '??', '???']);

function clean(v: string | undefined): string | null {
  if (v === undefined) return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return UNKNOWN.has(s) ? null : s;
}

/** Parse "YYYY.MM.DD" with "??" placeholders into yyyymmdd (unknown parts = 00). */
export function parseDate(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(\d{4}|\?{4})[.\-/](\d{2}|\?{2})[.\-/](\d{2}|\?{2})/.exec(v.trim()) ?? /^(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const y = parseInt(m[1], 10);
  if (!Number.isFinite(y) || y < 1000 || y > 2999) return null;
  const mo = m[2] ? parseInt(m[2], 10) : NaN;
  const d = m[3] ? parseInt(m[3], 10) : NaN;
  const mm = Number.isFinite(mo) && mo >= 1 && mo <= 12 ? mo : 0;
  const dd = mm && Number.isFinite(d) && d >= 1 && d <= 31 ? d : 0;
  return y * 10000 + mm * 100 + dd;
}

export function formatDate(d: number | null): string {
  if (!d) return '????.??.??';
  const y = Math.floor(d / 10000);
  const m = Math.floor(d / 100) % 100;
  const day = d % 100;
  return `${y}.${m ? String(m).padStart(2, '0') : '??'}.${day ? String(day).padStart(2, '0') : '??'}`;
}

function parseElo(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 && n < 4000 ? n : null;
}

/** 52-bit FNV-1a style hash over strings and bytes, used to detect duplicate games. */
function fingerprint(parts: string[], bytes: Uint8Array): number {
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;
  const mix = (c: number) => {
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  };
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) mix(p.charCodeAt(i));
    mix(0);
  }
  for (let i = 0; i < bytes.length; i++) mix(bytes[i]);
  return (h2 & 0xfffff) * 4294967296 + (h1 >>> 0);
}

export function processGame(raw: string, opts: ProcessOptions): ProcessResult {
  const scanned = scanPgn(raw);
  if (!scanned.length) return { ok: false, error: 'No game found' };
  const s = scanned[0];
  const h = s.headers;
  const variant = h.Variant?.toLowerCase();
  if (variant && variant !== 'standard' && variant !== 'from position' && variant !== 'chess') {
    return { ok: false, error: `Unsupported variant "${h.Variant}"` };
  }
  let startFen: string | null = null;
  let pos: Position;
  try {
    pos = h.FEN ? Position.fromFen(h.FEN) : Position.start();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const fen = pos.fen();
  if (fen !== START_FEN) startFen = fen;

  const sans = s.moves;
  const n = sans.length;
  const moves = new Int32Array(n);
  const indexCount = Math.min(n, opts.indexPlies) + 1;
  const hashes = new BigInt64Array(indexCount);
  const next = new Uint16Array(indexCount).fill(0xffff);
  let opening: { eco: string; name: string } | null = null;
  let warning: string | undefined;
  let played = 0;
  const classify = startFen === null;
  for (let i = 0; i < n; i++) {
    if (i < indexCount) hashes[i] = hashToBigInt(pos.hashHi, pos.hashLo);
    const m = pos.parseSan(sans[i]);
    if (m < 0 || (m === 0 && pos.inCheck())) {
      warning = `Illegal move "${sans[i]}" at ply ${i + 1}; game truncated`;
      break;
    }
    if (i < indexCount) next[i] = m & 0x7fff;
    pos.play(m);
    moves[i] = m;
    played++;
    if (classify && i < 40) {
      const o = openingAt(pos.hashHi, pos.hashLo);
      if (o) opening = o;
    }
  }
  if (played === 0 && Object.keys(h).length === 0) {
    // Neither tags nor a single legal move: this is not a game (junk text).
    return { ok: false, error: warning ? `Not a game: ${warning}` : 'Not a game: no tags and no moves' };
  }
  const indexed = Math.min(played, opts.indexPlies) + 1;
  if (played < indexCount) {
    // Record the final position (game end) if it is within the indexed range.
    hashes[played] = hashToBigInt(pos.hashHi, pos.hashLo);
    next[played] = 0xffff;
  }

  const moveBytes = encodeMoves(moves.subarray(0, played));
  let movetext: string | null = null;
  if (s.annotated && !opts.stripAnnotations && !warning) movetext = extractMovetext(raw);

  const white = clean(h.White) ?? '?';
  const black = clean(h.Black) ?? '?';
  const date = parseDate(h.Date) ?? parseDate(h.UTCDate) ?? parseDate(h.EventDate);
  const result = resultCode(h.Result ?? s.result);
  const extra: Record<string, string> = {};
  let hasExtra = false;
  for (const [k, v] of Object.entries(h)) {
    if (!MAIN_TAGS.has(k)) {
      extra[k] = v;
      hasExtra = true;
    }
  }
  const eco = clean(h.ECO)?.toUpperCase() ?? opening?.eco ?? null;
  return {
    ok: true,
    game: {
      white,
      black,
      event: clean(h.Event),
      site: clean(h.Site),
      date,
      year: date ? Math.floor(date / 10000) : null,
      round: clean(h.Round),
      result,
      whiteElo: parseElo(h.WhiteElo),
      blackElo: parseElo(h.BlackElo),
      eco: eco && /^[A-E]\d\d$/.test(eco) ? eco : opening?.eco ?? null,
      opening: opening ? { eco: opening.eco, name: opening.name } : null,
      plyCount: played,
      startFen,
      moves: moveBytes,
      movetext,
      tags: hasExtra ? JSON.stringify(extra) : null,
      // Very short games (forfeits, placeholders) also need event and round to be told apart.
      fingerprint: fingerprint(
        [white.toLowerCase(), black.toLowerCase(), String(date ?? ''), String(result), startFen ?? '',
          ...(played < 20 ? [(h.Event ?? '').toLowerCase(), h.Round ?? ''] : [])],
        moveBytes,
      ),
      hashes: indexed === hashes.length ? hashes : hashes.slice(0, indexed),
      next: indexed === next.length ? next : next.slice(0, indexed),
      warning,
    },
  };
}

