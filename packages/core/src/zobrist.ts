import { POLYGLOT_HI, POLYGLOT_LO } from './polyglot-keys.js';
import { WHITE } from './types.js';

/**
 * Zobrist keys indexed by our piece encoding: PIECE_HI[piece * 64 + sq].
 * Values are stored as signed 32-bit integers so XOR results stay int32.
 */
export const PIECE_HI = new Int32Array(16 * 64);
export const PIECE_LO = new Int32Array(16 * 64);
export const CASTLE_HI = new Int32Array(16);
export const CASTLE_LO = new Int32Array(16);
export const EP_HI = new Int32Array(8);
export const EP_LO = new Int32Array(8);
export const TURN_HI = POLYGLOT_HI[780] | 0;
export const TURN_LO = POLYGLOT_LO[780] | 0;

for (let color = 0; color < 2; color++) {
  for (let type = 1; type <= 6; type++) {
    // Polyglot "kind": black pawn 0, white pawn 1, black knight 2, ...
    const kind = 2 * (type - 1) + (color === WHITE ? 1 : 0);
    const piece = (color << 3) | type;
    for (let sq = 0; sq < 64; sq++) {
      PIECE_HI[piece * 64 + sq] = POLYGLOT_HI[kind * 64 + sq] | 0;
      PIECE_LO[piece * 64 + sq] = POLYGLOT_LO[kind * 64 + sq] | 0;
    }
  }
}

// Castling rights bitmask (WK=1, WQ=2, BK=4, BQ=8) -> combined key.
// Polyglot order: 768 white short, 769 white long, 770 black short, 771 black long.
for (let rights = 0; rights < 16; rights++) {
  let hi = 0;
  let lo = 0;
  for (let bit = 0; bit < 4; bit++) {
    if (rights & (1 << bit)) {
      hi ^= POLYGLOT_HI[768 + bit];
      lo ^= POLYGLOT_LO[768 + bit];
    }
  }
  CASTLE_HI[rights] = hi | 0;
  CASTLE_LO[rights] = lo | 0;
}

for (let f = 0; f < 8; f++) {
  EP_HI[f] = POLYGLOT_HI[772 + f] | 0;
  EP_LO[f] = POLYGLOT_LO[772 + f] | 0;
}

/** Combine the two halves into a signed 64-bit BigInt (SQLite INTEGER friendly). */
export function hashToBigInt(hi: number, lo: number): bigint {
  return BigInt.asIntN(64, (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0));
}

/** Split a (signed or unsigned) 64-bit BigInt hash back into halves. */
export function bigIntToHash(h: bigint): [number, number] {
  const u = BigInt.asUintN(64, h);
  return [Number(u >> 32n) | 0, Number(u & 0xffffffffn) | 0];
}

/** Hex string of the unsigned 64-bit hash, e.g. "463b96181691fc9c". */
export function hashToHex(hi: number, lo: number): string {
  return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}

/**
 * A 52-bit JS-number key derived from the hash, handy for Map keys where a
 * negligible collision rate is acceptable (e.g. opening lookups).
 */
export function hashToNumber(hi: number, lo: number): number {
  return (hi & 0xfffff) * 4294967296 + (lo >>> 0);
}
