import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Game, PgnSplitter, Position, extractMovetext, parseGame, parsePgn, scanPgn, writePgn,
} from '../src/index.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const reference: Record<string, Array<{
  headers: Record<string, string>;
  mainline: string[];
  nodes: number;
  finalFen: string;
  errors: number;
}>> = JSON.parse(fixture('pgn-reference.json'));

describe('PGN parsing matches python-chess', () => {
  for (const [file, expected] of Object.entries(reference)) {
    it(file, () => {
      const games = parsePgn(fixture(file));
      expect(games.length).toBe(expected.length);
      games.forEach((g, i) => {
        const ref = expected[i];
        expect(g.mainline().map((n) => n.uci)).toEqual(ref.mainline);
        expect(g.countNodes()).toBe(ref.nodes);
        expect(g.end().fen).toBe(ref.finalFen);
        expect(g.errors.length > 0).toBe(ref.errors > 0);
        for (const [k, v] of Object.entries(ref.headers)) {
          if (k === 'FEN') expect(Position.fromFen(g.header(k)!).fen()).toBe(Position.fromFen(v).fen());
          // python-chess keeps PGN escapes in tag values; we unescape per the PGN spec.
          else expect(g.header(k), k).toBe(v.replace(/\\(["\\])/g, '$1'));
        }
      });
    });
  }
});

describe('PGN writing', () => {
  for (const file of Object.keys(reference)) {
    it(`round-trips ${file}`, () => {
      const games = parsePgn(fixture(file));
      const text = games.map((g) => writePgn(g)).join('\n');
      const again = parsePgn(text);
      expect(again.length).toBe(games.length);
      again.forEach((g, i) => {
        expect(writePgn(g)).toBe(writePgn(games[i]));
        expect(g.countNodes()).toBe(games[i].countNodes());
      });
    });
  }

  it('writes comments, NAGs and variations in standard form', () => {
    const g = parseGame('{Start} 1. e4 e5 2. Nf3!? Nc6 $1 3. Bb5 (3. Bc4 {Italian} Bc5) (3. d4) 3... a6 *');
    expect(writePgn(g, { headers: false, maxLineLength: 0 }).trim()).toBe(
      '{Start} 1. e4 e5 2. Nf3 $5 Nc6 $1 3. Bb5 (3. Bc4 {Italian} 3... Bc5) (3. d4) 3... a6 *',
    );
  });

  it('keeps comments at the start of a variation', () => {
    const g = parseGame('1. e4 ({Or} 1. d4 d5) 1... e5 *');
    const alt = g.root.children[1];
    expect(alt.startComment).toBe('Or');
    expect(writePgn(g, { headers: false }).trim()).toBe('1. e4 ({Or} 1. d4 d5) 1... e5 *');
  });

  it('escapes tag values and wraps long lines', () => {
    const g = Game.fromMoves('e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 c4 c6 cxb5 axb5 Nc3 Bb7 Bg5 b4 Nb1 h6 Bh4 c5 dxe5'.split(' '));
    g.headers.set('Event', 'He said "hi" \\o/');
    const text = writePgn(g);
    expect(text).toContain('[Event "He said \\"hi\\" \\\\o/"]');
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    expect(parseGame(text).header('Event')).toBe('He said "hi" \\o/');
  });
});

describe('lenient parsing', () => {
  it('handles missing spaces, lowercase promotions, 0-0 and LAN', () => {
    const g = parseGame('1.e4 e5 2.Ng1-f3 Nb8c6 3.Bf1c4 Bf8-c5 4.0-0 Ng8f6 5.d2d3 d7d6 *');
    expect(g.mainline().map((n) => n.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'd3', 'd6']);
  });

  it('parses games without headers separated by results', () => {
    const games = parsePgn('1. e4 e5 1-0\n\n1. d4 d5 0-1\n1. c4 1/2-1/2');
    expect(games.map((g) => g.result)).toEqual(['1-0', '0-1', '1/2-1/2']);
    expect(games.map((g) => g.mainline().length)).toEqual([2, 2, 1]);
  });

  it('records illegal moves as errors and keeps the legal prefix', () => {
    const g = parseGame('1. e4 e5 2. Ke3 Nc6 *');
    expect(g.mainline().length).toBe(2);
    expect(g.errors.length).toBe(1);
  });

  it('supports null moves', () => {
    const g = parseGame('1. e4 -- 2. d4 *');
    expect(g.mainline().map((n) => n.san)).toEqual(['e4', '--', 'd4']);
  });

  it('interprets lowercase b as a bishop when no pawn move fits', () => {
    const g = parseGame('1. e4 e5 2. bc4 *');
    expect(g.mainline()[2].san).toBe('Bc4');
  });
});

describe('scanPgn / extractMovetext', () => {
  it('extracts headers and mainline SAN without building a tree', () => {
    const scanned = scanPgn(fixture('edge-cases.pgn'));
    expect(scanned.length).toBe(5);
    expect(scanned[0].headers.White).toBe('Doe, John');
    expect(scanned[0].headers.Event).toBe('Edge "quoted" event [with brackets]');
    expect(scanned[0].annotated).toBe(true);
    expect(scanned[0].moves.length).toBe(20);
    expect(scanned[4].annotated).toBe(false);
    expect(scanned[4].result).toBe('1-0');
  });

  it('extracts the movetext after tags', () => {
    expect(extractMovetext('[A "x]"]\n[B "y"]\n\n1. e4 *\n')).toBe('1. e4 *');
  });
});

describe('PgnSplitter', () => {
  it('splits a stream at tag sections regardless of chunk boundaries', () => {
    const text = fixture('kasparov-deep-blue-1997.pgn') + '\n' + fixture('edge-cases.pgn') + fixture('stockfish-learning.pgn');
    const expected = parsePgn(text).length;
    for (const size of [1, 7, 64, 1000, 1 << 20]) {
      const s = new PgnSplitter();
      const games: string[] = [];
      for (let i = 0; i < text.length; i += size) games.push(...s.push(text.slice(i, i + size)));
      games.push(...s.finish());
      const parsed = games.flatMap((g) => parsePgn(g));
      expect(parsed.length, `chunk size ${size}`).toBe(expected);
    }
  });

  it('does not split on "[" inside multi-line comments', () => {
    const text = '[Event "a"]\n\n1. e4 {comment\n[%clk 0:01:00]} e5 *\n\n[Event "b"]\n\n1. d4 *\n';
    const s = new PgnSplitter();
    const games = [...s.push(text), ...s.finish()];
    expect(games.length).toBe(2);
    expect(parseGame(games[0]).mainline().length).toBe(2);
  });
});
