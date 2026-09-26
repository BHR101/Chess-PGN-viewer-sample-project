/** Precomputed attack/geometry tables for the mailbox move generator. */

// Direction deltas as (file, rank) pairs: N, S, E, W, NE, NW, SE, SW.
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
];

export const ORTHO_DIRS = [0, 1, 2, 3];
export const DIAG_DIRS = [4, 5, 6, 7];
export const ALL_DIRS = [0, 1, 2, 3, 4, 5, 6, 7];

/** RAYS[dir * 64 + sq] = squares walked from `sq` in direction `dir`, nearest first. */
export const RAYS: Int8Array[] = new Array(8 * 64);
export const KNIGHT_TARGETS: Int8Array[] = new Array(64);
export const KING_TARGETS: Int8Array[] = new Array(64);

/**
 * DIR_BETWEEN[a * 64 + b] = direction index to walk from a towards b if they
 * share a rank, file or diagonal, else -1.
 */
export const DIR_BETWEEN = new Int8Array(64 * 64).fill(-1);

function onBoard(f: number, r: number): boolean {
  return f >= 0 && f < 8 && r >= 0 && r < 8;
}

for (let sq = 0; sq < 64; sq++) {
  const f = sq & 7;
  const r = sq >> 3;
  for (let d = 0; d < 8; d++) {
    const [df, dr] = DIRS[d];
    const ray: number[] = [];
    let nf = f + df;
    let nr = r + dr;
    while (onBoard(nf, nr)) {
      const t = nr * 8 + nf;
      ray.push(t);
      DIR_BETWEEN[sq * 64 + t] = d;
      nf += df;
      nr += dr;
    }
    RAYS[d * 64 + sq] = Int8Array.from(ray);
  }
  const kn: number[] = [];
  for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
    if (onBoard(f + df, r + dr)) kn.push((r + dr) * 8 + f + df);
  }
  KNIGHT_TARGETS[sq] = Int8Array.from(kn);
  const kg: number[] = [];
  for (const [df, dr] of DIRS) {
    if (onBoard(f + df, r + dr)) kg.push((r + dr) * 8 + f + df);
  }
  KING_TARGETS[sq] = Int8Array.from(kg);
}

/** Castling-rights mask: rights &= CASTLE_MASK[from] & CASTLE_MASK[to]. */
export const CASTLE_MASK = new Uint8Array(64).fill(15);
CASTLE_MASK[0] = 15 & ~2; // a1 -> white queenside
CASTLE_MASK[7] = 15 & ~1; // h1 -> white kingside
CASTLE_MASK[4] = 15 & ~3; // e1 -> both white
CASTLE_MASK[56] = 15 & ~8; // a8 -> black queenside
CASTLE_MASK[63] = 15 & ~4; // h8 -> black kingside
CASTLE_MASK[60] = 15 & ~12; // e8 -> both black
