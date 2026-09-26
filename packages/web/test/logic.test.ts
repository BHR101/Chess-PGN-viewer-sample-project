import { describe, expect, it } from 'vitest';
import { parseGame } from '@pgnx/core';
import { diffPieces, parseBoard } from '../src/board/Board';
import { formatScore, pvToSan, winningChances } from '../src/engine/engine';
import { annotateGame, judge, type NodeEval } from '../src/engine/gameAnalysis';

describe('engine helpers', () => {
  it('formats scores', () => {
    expect(formatScore({ cp: 34 })).toBe('+0.34');
    expect(formatScore({ cp: -120 })).toBe('-1.20');
    expect(formatScore({ mate: 3 })).toBe('#3');
    expect(formatScore({ mate: -2 })).toBe('#-2');
  });

  it('maps scores to winning chances', () => {
    expect(winningChances({ cp: 0 })).toBe(0);
    expect(winningChances({ cp: 300 })).toBeGreaterThan(0.4);
    expect(winningChances({ cp: -300 })).toBeCloseTo(-winningChances({ cp: 300 }));
    expect(winningChances({ mate: 2 })).toBe(1);
    expect(winningChances({ mate: -5 })).toBe(-1);
    expect(winningChances({ mate: 0, cp: -1 })).toBe(-1);
  });

  it('converts UCI principal variations to SAN', () => {
    expect(pvToSan('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'])).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
    // Stops at the first illegal move.
    expect(pvToSan('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'e2e4'])).toEqual(['e4']);
  });
});

describe('game analysis judgements', () => {
  it('classifies moves by the drop in winning chances and annotates', () => {
    const g = parseGame('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0');
    const nodes = [g.root, ...g.mainline()];
    const cps = [30, 30, 40, 0, 20, 20, 900];
    const evals = new Map<number, NodeEval>();
    nodes.forEach((n, i) => {
      evals.set(n.id, i === nodes.length - 1
        ? { score: { mate: 0, cp: 1 }, best: null, pv: [], depth: 0 }
        : { score: { cp: cps[i] }, best: i === 5 ? 'g7g6' : null, pv: i === 5 ? ['g7g6', 'c4f7'] : [], depth: 16 });
    });
    const nf6 = nodes[6];
    expect(judge(nf6, evals)).toBe('blunder');
    expect(judge(nodes[1], evals)).toBeNull();
    const n = annotateGame(g, evals);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(nf6.nags).toContain(4);
    expect(nf6.comment).toContain('[%eval');
    // The engine's preferred move is added as a variation.
    expect(nf6.parent!.children.map((c) => c.san)).toContain('g6');
  });
});

describe('board piece matching', () => {
  it('keeps identities for moved pieces so they animate', () => {
    const a = diffPieces([], parseBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
    const b = diffPieces(a, parseBoard('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'));
    const pawnBefore = a.find((p) => p.sq === 12)!;
    const pawnAfter = b.find((p) => p.sq === 28)!;
    expect(pawnAfter.id).toBe(pawnBefore.id);
    expect(b.length).toBe(32);
    // Castling moves both king and rook.
    const c1 = diffPieces([], parseBoard('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'));
    const c2 = diffPieces(c1, parseBoard('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1'));
    expect(c2.find((p) => p.sq === 6)!.id).toBe(c1.find((p) => p.sq === 4)!.id);
    expect(c2.find((p) => p.sq === 5)!.id).toBe(c1.find((p) => p.sq === 7)!.id);
  });
});

import { parseComment } from '../src/state/comments';

describe('comment commands', () => {
  it('extracts clocks, evals, arrows and highlights', () => {
    const c = parseComment('Nice move [%clk 0:03:21] [%eval 0.35] [%cal Ge2e4,Rd7d5] [%csl Yd4]');
    expect(c.text).toBe('Nice move');
    expect(c.clock).toBe('03:21');
    expect(c.eval).toBe('0.35');
    expect(c.arrows).toEqual([
      { color: '#15781b', from: 'e2', to: 'e4' },
      { color: '#882020', from: 'd7', to: 'd5' },
    ]);
    expect(c.highlights).toEqual([{ color: '#e68f00', sq: 'd4' }]);
    expect(parseComment('[%clk 1:00:00]').text).toBe('');
  });
});

import { buildCollection, entryGame } from '../src/state/gameStore';

describe('PGN collections', () => {
  it('parses large inputs lazily with header labels', () => {
    const one = (i: number) => `[Event "Ev \\"${i}\\""]\n[White "W${i}"]\n[Black "B${i}"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 {${'x'.repeat(200)}} Nc6 1-0\n\n`;
    const text = Array.from({ length: 2000 }, (_, i) => one(i)).join('');
    const entries = buildCollection(text);
    expect(entries.length).toBe(2000);
    expect(entries[7].game).toBeUndefined();
    expect(entries[7].label).toBe('W7 – B7 1-0 · Ev "7"');
    expect(entryGame(entries[7]).mainline().length).toBe(4);
    const small = buildCollection(one(1) + one(2));
    expect(small[1].game?.header('White')).toBe('W2');
  });
});
