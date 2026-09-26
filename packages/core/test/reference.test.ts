import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Position, moveToUci } from '../src/index.js';

interface RefGame {
  fen: string;
  hash: string;
  plies: [san: string, uci: string, fen: string, hash: string][];
  checkmate: boolean;
  stalemate: boolean;
  insufficient: boolean;
  legal: string[];
}

const games: RefGame[] = JSON.parse(
  readFileSync(new URL('./fixtures/reference-games.json', import.meta.url), 'utf8'),
);

describe('differential test against python-chess', () => {
  it('has fixtures', () => expect(games.length).toBeGreaterThan(100));

  it('matches SAN, UCI, FEN and Polyglot hashes for every ply', () => {
    let plies = 0;
    for (const g of games) {
      const pos = Position.fromFen(g.fen);
      expect(pos.hashHex()).toBe(g.hash);
      for (const [san, uci, fen, hash] of g.plies) {
        const m = pos.parseSan(san);
        expect(m, `${san} in ${pos.fen()}`).toBeGreaterThanOrEqual(0);
        expect(moveToUci(m)).toBe(uci);
        expect(pos.san(m)).toBe(san);
        expect(pos.parseUci(uci)).toBe(m);
        pos.play(m);
        expect(pos.fen()).toBe(fen);
        expect(pos.hashHex()).toBe(hash);
        plies++;
      }
      expect(pos.isCheckmate()).toBe(g.checkmate);
      expect(pos.isStalemate()).toBe(g.stalemate);
      expect(pos.isInsufficientMaterial()).toBe(g.insufficient);
      expect(pos.legalMoves().map(moveToUci).sort()).toEqual(g.legal);
      // Unwind the whole game and check we're back at the start.
      while (pos.depth) pos.undo();
      expect(pos.hashHex()).toBe(g.hash);
    }
    expect(plies).toBeGreaterThan(10000);
  });
});
