import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Position, allOpenings, decodeMoves, encodeMoves, moveToUci, openingOfPosition, parseGame,
} from '../src/index.js';

const games: Array<{ fen: string; plies: [string, string, string, string][] }> = JSON.parse(
  readFileSync(new URL('./fixtures/reference-games.json', import.meta.url), 'utf8'),
);

describe('move codec', () => {
  it('round-trips every reference game', () => {
    for (const g of games) {
      const pos = Position.fromFen(g.fen);
      const moves = g.plies.map(([san]) => pos.playSan(san));
      const bytes = encodeMoves(moves);
      expect(bytes.length).toBe(moves.length * 2);
      const decoded = decodeMoves(bytes, Position.fromFen(g.fen));
      expect(decoded).toEqual(moves);
    }
  });

  it('rejects illegal keys', () => {
    const pos = Position.start();
    expect(pos.fromKey(12 | (36 << 6))).toBe(-1); // e2e5
    expect(pos.fromKey(4 | (6 << 6))).toBe(-1); // e1g1 with pieces in the way
    expect(moveToUci(pos.fromKey(12 | (28 << 6)))).toBe('e2e4');
  });
});

describe('openings', () => {
  it('loads the opening table', () => {
    expect(allOpenings().length).toBeGreaterThan(3000);
  });

  it('names positions, including transpositions', () => {
    const g = parseGame('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 *');
    const o = openingOfPosition(Position.fromFen(g.end().fen));
    expect(o?.eco).toBe('B90');
    expect(o?.name).toMatch(/Najdorf/);
    const t = parseGame('1. Nf3 d5 2. d4 *');
    expect(openingOfPosition(Position.fromFen(t.end().fen))?.eco).toMatch(/^[AD]/);
  });
});
