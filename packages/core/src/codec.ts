import { Position } from './position.js';
import { NULL_MOVE } from './types.js';

/**
 * Compact binary encoding of a move sequence: 2 bytes per ply (little
 * endian), each being the flag-free move key `from | to << 6 | promo << 12`.
 * Decoding needs the start position to restore move flags (castling, en
 * passant, double push), which is cheap and needs no move generation.
 */
export function encodeMoves(moves: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(moves.length * 2);
  for (let i = 0; i < moves.length; i++) {
    const k = moves[i] & 0x7fff;
    out[2 * i] = k & 0xff;
    out[2 * i + 1] = k >> 8;
  }
  return out;
}

/** Decode move keys (without validation of legality). */
export function decodeMoveKeys(bytes: Uint8Array): number[] {
  const res: number[] = new Array(bytes.length >> 1);
  for (let i = 0; i < res.length; i++) res[i] = bytes[2 * i] | (bytes[2 * i + 1] << 8);
  return res;
}

/**
 * Replay encoded moves from `pos` (mutated), returning full move encodings.
 * Throws if a move is not legal.
 */
export function decodeMoves(bytes: Uint8Array, pos: Position): number[] {
  const keys = decodeMoveKeys(bytes);
  const res: number[] = new Array(keys.length);
  for (let i = 0; i < keys.length; i++) {
    const m = pos.fromKey(keys[i]);
    if (m < 0) throw new Error(`Corrupt move data at ply ${i + 1}`);
    pos.play(m);
    res[i] = m;
  }
  return res;
}

export { NULL_MOVE };
