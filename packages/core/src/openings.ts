import { OPENINGS_TSV } from './openings-data.js';
import { Position } from './position.js';
import { hashToNumber } from './zobrist.js';

export interface Opening {
  /** Stable index into the opening table (valid for this version of the data). */
  id: number;
  eco: string;
  name: string;
}

let byHash: Map<number, Opening> | null = null;
let list: Opening[] = [];

function load(): Map<number, Opening> {
  if (byHash) return byHash;
  byHash = new Map();
  list = [];
  for (const line of OPENINGS_TSV.split('\n')) {
    const [eco, name, hex] = line.split('\t');
    const hi = parseInt(hex.slice(0, 8), 16) | 0;
    const lo = parseInt(hex.slice(8), 16) | 0;
    const o: Opening = { id: list.length, eco, name };
    list.push(o);
    byHash.set(hashToNumber(hi, lo), o);
  }
  return byHash;
}

/** All named openings (lichess-org/chess-openings). */
export function allOpenings(): Opening[] {
  load();
  return list;
}

/** The named opening whose defining position has this hash, if any. */
export function openingAt(hashHi: number, hashLo: number): Opening | undefined {
  return load().get(hashToNumber(hashHi, hashLo));
}

/** Named opening for the given position (exact position match only). */
export function openingOfPosition(pos: Position): Opening | undefined {
  return openingAt(pos.hashHi, pos.hashLo);
}

/**
 * Classify a line: returns the deepest named opening reached along the given
 * sequence of FENs / positions (transpositions are recognised since lookups
 * are by position).
 */
export function classifyFens(fens: string[]): Opening | undefined {
  let best: Opening | undefined;
  for (const fen of fens) {
    const o = openingOfPosition(Position.fromFen(fen));
    if (o) best = o;
  }
  return best;
}
