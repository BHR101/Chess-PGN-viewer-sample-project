import { describe, expect, it } from 'vitest';
import { Game, PgnSplitter, Position, decodeMoves, encodeMoves, moveToUci, parseGame, parsePgn, scanPgn, writePgn } from '../src/index.js';

const after = (moves: string, fen?: string) => {
  const p = fen ? Position.fromFen(fen) : Position.start();
  for (const m of moves.split(' ').filter(Boolean)) p.playSan(m);
  return p;
};

describe('regressions found in review', () => {
  it('keeps the main line when a variation repeats the main move', () => {
    const g = parseGame('1. e4 (1. e4 e5 2. Nf3) 1... c5 2. Nf3 *');
    expect(g.mainline().map((n) => n.san)).toEqual(['e4', 'c5', 'Nf3']);
    expect(g.root.children.length).toBe(2);
    const g2 = parseGame('1. e4 e5 2. Nf3 (2. Nf3 {alt} Nc6 3. Bb5) 2... Nf6 *');
    expect(g2.mainline().map((n) => n.san)).toEqual(['e4', 'e5', 'Nf3', 'Nf6']);
    expect(g2.mainline()[2].comment).toBeUndefined();
  });

  it('does not read coordinate moves from the b-file as bishop moves', () => {
    expect(after('e4 e5').parseSan('b1e2')).toBe(-1);
    expect(after('e4 e5 Nf3 Nc6').parseSan('b1d3')).toBe(-1);
    expect(moveToUci(after('e4 e5').parseSan('bc4'))).toBe('f1c4');
    expect(moveToUci(after('e4 e5').parseSan('b1c3'))).toBe('b1c3');
  });

  it('rejects pawn pushes onto occupied squares and promotions without a piece', () => {
    expect(after('e4 f5').parseSan('f5')).toBe(-1);
    expect(moveToUci(after('e4 f5').parseSan('exf5'))).toBe('e4f5');
    const p = Position.fromFen('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    expect(p.parseSan('b8')).toBe(-1);
    expect(p.parseSan('b8=Q')).toBe(-1);
    expect(moveToUci(p.parseSan('axb8=Q'))).toBe('a7b8q');
    expect(p.parseSan('a8')).toBe(-1);
    expect(moveToUci(p.parseSan('a8=N'))).toBe('a7a8n');
  });

  it('skips stray annotation tokens and understands 0000', () => {
    expect(parseGame('1. e4 e5 2. Nf3 += Nc6 3. Bb5 +- a6 *').mainline().length).toBe(6);
    const g = parseGame('1. e4 e5 2. Nf3 += Nc6 *');
    expect(g.mainline()[2].nags).toContain(14);
    const ep = parseGame('[FEN "4k3/8/8/4Pp2/8/8/8/4K3 w - f6 0 1"]\n\n1. exf6 e.p. Kf7 *');
    expect(ep.mainline().map((n) => n.san)).toEqual(['exf6', 'Kf7']);
    expect(ep.errors).toEqual([]);
    expect(parseGame('1. e4 0000 2. d4 *').mainline().map((n) => n.san)).toEqual(['e4', '--', 'd4']);
  });

  it('attaches comments after the result to the game instead of creating a new one', () => {
    const text = '[Event "a"]\n\n1. e4 e5 1-0 {White wins on time}\n\n[Event "b"]\n\n1. d4 *\n';
    const games = parsePgn(text);
    expect(games.map((g) => g.header('Event'))).toEqual(['a', 'b']);
    expect(games[0].end().comment).toBe('White wins on time');
    expect(parsePgn('1. e4 1-0 $1').length).toBe(1);
    expect(scanPgn(text).length).toBe(2);
    // Header-less games separated only by results still split.
    expect(parsePgn('1. e4 e5 1-0 1. d4 0-1').length).toBe(2);
  });

  it('splits files that start with a byte order mark correctly', () => {
    const s = new PgnSplitter();
    const text = '﻿[Event "A"]\n[White "x"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. d4 *\n';
    const games = [...s.push(text), ...s.finish()];
    expect(games.length).toBe(2);
    expect(parseGame(games[0]).header('White')).toBe('x');
  });

  it('rejects null moves in check consistently', () => {
    const p = after('e4 f6 Qh5+');
    expect(p.parseSan('--')).toBe(-1);
    const g = Game.fromMoves(['e4', 'e5', '--', 'd6']);
    const moves = g.mainline().map((n) => n.move);
    expect(decodeMoves(encodeMoves(moves), Position.start())).toEqual(moves);
  });

  it('keeps comment text intact when writing', () => {
    const g = parseGame('1. e4 {see ( this ) line} (1. d4 {( x )}) 1... e5 *');
    const out = writePgn(g, { headers: false, maxLineLength: 0 }).trim();
    expect(out).toBe('1. e4 {see ( this ) line} (1. d4 {( x )}) 1... e5 *');
  });

  it('rejects promotion suffixes on castling', () => {
    const p = Position.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(p.parseUci('e1g1q')).toBe(-1);
    expect(moveToUci(p.parseUci('e1g1'))).toBe('e1g1');
  });

  it('leaves a position unchanged when setFen fails', () => {
    const p = Position.start();
    const before = p.fen();
    const hash = p.hashHex();
    expect(() => p.setFen('4k3/8/8/8/8/8/8/4R1K1 w - - 0 1')).toThrow();
    expect(p.fen()).toBe(before);
    expect(p.hashHex()).toBe(hash);
  });
});
