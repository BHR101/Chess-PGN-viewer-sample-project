/**
 * Shared constants and small helpers.
 *
 * Squares are numbered 0..63 with a1 = 0, b1 = 1, ..., h8 = 63.
 * Pieces are encoded as `color << 3 | type`, so white pieces are 1..6 and
 * black pieces are 9..14. 0 is an empty square.
 *
 * Moves are encoded as integers:
 *   bits  0-5  from square
 *   bits  6-11 to square
 *   bits 12-14 promotion piece type (0 = none)
 *   bit  15    castling
 *   bit  16    en passant capture
 *   bit  17    double pawn push
 * The value 0 (a1a1) is reserved for the null move ("--").
 */

export type Color = 0 | 1;
export const WHITE = 0;
export const BLACK = 1;

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const FLAG_CASTLE = 1 << 15;
export const FLAG_EP = 1 << 16;
export const FLAG_DOUBLE = 1 << 17;

export const NULL_MOVE = 0;

export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

export const FILES = 'abcdefgh';
export const RANKS = '12345678';
export const PIECE_CHARS = ' pnbrqk';
export const SAN_PIECE = ['', '', 'N', 'B', 'R', 'Q', 'K'];

export const moveFrom = (m: number): number => m & 63;
export const moveTo = (m: number): number => (m >> 6) & 63;
export const movePromo = (m: number): number => (m >> 12) & 7;
export const isCastle = (m: number): boolean => (m & FLAG_CASTLE) !== 0;
export const isEnPassant = (m: number): boolean => (m & FLAG_EP) !== 0;

export const makeMove = (from: number, to: number, promo = 0, flags = 0): number =>
  from | (to << 6) | (promo << 12) | flags;

export const fileOf = (sq: number): number => sq & 7;
export const rankOf = (sq: number): number => sq >> 3;
export const squareName = (sq: number): string => FILES[sq & 7] + RANKS[sq >> 3];

export function parseSquare(name: string): number {
  if (name.length !== 2) return -1;
  const f = name.charCodeAt(0) - 97;
  const r = name.charCodeAt(1) - 49;
  if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
  return r * 8 + f;
}

export const pieceColor = (p: number): Color => (p >> 3) as Color;
export const pieceType = (p: number): number => p & 7;

/** Convert a move to UCI notation (e.g. "e2e4", "e7e8q", "0000" for null). */
export function moveToUci(m: number): string {
  if (m === NULL_MOVE) return '0000';
  const p = movePromo(m);
  return squareName(moveFrom(m)) + squareName(moveTo(m)) + (p ? PIECE_CHARS[p] : '');
}

/**
 * A compact, flag-free 16-bit move key (from | to << 6 | promo << 12), used as
 * a stable identifier for moves in the database and in the explorer.
 */
export const moveKey = (m: number): number => m & 0x7fff;

export function moveKeyToUci(k: number): string {
  return moveToUci(k & 0x7fff);
}

export class ChessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChessError';
  }
}
