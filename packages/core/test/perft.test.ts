import { describe, expect, it } from 'vitest';
import { Position, perft, START_FEN } from '../src/index.js';

// Reference values from https://www.chessprogramming.org/Perft_Results
const CASES: Array<[string, string, number[]]> = [
  ['start', START_FEN, [20, 400, 8902, 197281, 4865609]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862, 4085603]],
  ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
  ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
  ['position 4 mirrored', 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1', [6, 264, 9467, 422333]],
  ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379, 2103487]],
  ['position 6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890, 3894594]],
];

describe('perft', () => {
  for (const [name, fen, counts] of CASES) {
    it(name, () => {
      const pos = Position.fromFen(fen);
      const hash = pos.hashHex();
      counts.forEach((expected, i) => {
        expect(perft(pos, i + 1)).toBe(expected);
      });
      // make/unmake must restore the position exactly
      expect(pos.fen()).toBe(Position.fromFen(fen).fen());
      expect(pos.hashHex()).toBe(hash);
    });
  }
});
