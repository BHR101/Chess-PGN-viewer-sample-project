/**
 * Whole-game analysis: evaluates every position of the main line to a fixed
 * depth with a dedicated engine instance, then classifies moves by the drop
 * in winning chances (lichess-style thresholds).
 */
import { create } from 'zustand';
import type { GameNode } from '@pgnx/core';
import { Game } from '@pgnx/core';
import { type Score, type Transport, nativeTransport, pvToSan, wasmTransport, winningChances } from './engine';

export interface NodeEval {
  score: Score;
  best: string | null;
  pv: string[];
  depth: number;
}

export type Judgement = 'inaccuracy' | 'mistake' | 'blunder';

interface AnalysisStore {
  /** Evaluation of the position at each node (by node id). */
  evals: Map<number, NodeEval>;
  running: boolean;
  done: number;
  total: number;
  /** Root node id of the game being / last analysed. */
  rootId: number | null;
  cancel: (() => void) | null;
}

export const useGameAnalysis = create<AnalysisStore>(() => ({
  evals: new Map(),
  running: false,
  done: 0,
  total: 0,
  rootId: null,
  cancel: null,
}));

function evaluate(t: { send: (c: string) => void }, fen: string, depth: number, waiters: { resolve: ((e: NodeEval) => void) | null; last: NodeEval | null; turn: 'w' | 'b' }) {
  return new Promise<NodeEval>((resolve) => {
    waiters.resolve = resolve;
    waiters.last = null;
    waiters.turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    t.send(`position fen ${fen}`);
    t.send(`go depth ${depth}`);
  });
}

let analysisRun = 0;

/** Analyse the main line of `game`. Resolves when finished or cancelled. */
export async function analyzeGame(game: Game, opts: { backend: 'native' | 'wasm'; depth: number; threads: number }) {
  const store = useGameAnalysis;
  store.getState().cancel?.();
  const runId = ++analysisRun;
  const nodes: GameNode[] = [game.root, ...game.mainline()];
  let cancelled = false;
  const w: { resolve: ((e: NodeEval) => void) | null; last: NodeEval | null; turn: 'w' | 'b' } = { resolve: null, last: null, turn: 'w' };
  let transport: Transport;
  const onLine = (line: string) => {
    if (line.startsWith('info ') && line.includes(' pv ') && !line.includes(' multipv 2')) {
      const t = line.split(' ');
      const i = t.indexOf('score');
      if (i < 0 || t[i + 3] === 'lowerbound' || t[i + 3] === 'upperbound') return;
      const sign = w.turn === 'w' ? 1 : -1;
      const v = +t[i + 2];
      const score: Score = t[i + 1] === 'mate' ? { mate: v * sign } : { cp: v * sign };
      const pv = t.slice(t.indexOf('pv') + 1);
      w.last = { score, best: pv[0] ?? null, pv, depth: +t[t.indexOf('depth') + 1] };
    } else if (line.startsWith('bestmove')) {
      const r = w.resolve;
      w.resolve = null;
      const best = line.split(' ')[1];
      r?.(w.last ?? { score: { cp: 0 }, best: best === '(none)' ? null : best, pv: [], depth: 0 });
    }
  };
  const onError = () => {
    cancelled = true;
    w.resolve?.({ score: { cp: 0 }, best: null, pv: [], depth: 0 });
  };
  transport = opts.backend === 'native' ? nativeTransport(onLine, onError, () => {}) : wasmTransport(onLine, onError);
  transport.send('uci');
  if (opts.backend === 'native') transport.send(`setoption name Threads value ${opts.threads}`);
  transport.send('setoption name Hash value 128');
  transport.send('ucinewgame');
  store.setState({
    evals: new Map(),
    running: true,
    done: 0,
    total: nodes.length,
    rootId: game.root.id,
    cancel: () => {
      cancelled = true;
      transport.send('stop');
    },
  });
  for (const node of nodes) {
    if (cancelled) break;
    let e: NodeEval;
    const pos = Game.positionAt(node);
    if (!pos.hasLegalMove()) {
      e = { score: pos.inCheck() ? { mate: 0, cp: pos.turn === 0 ? -1 : 1 } : { cp: 0 }, best: null, pv: [], depth: 0 };
    } else {
      e = await evaluate(transport, node.fen, opts.depth, w);
    }
    if (cancelled || runId !== analysisRun) break;
    const evals = new Map(store.getState().evals);
    evals.set(node.id, e);
    store.setState({ evals, done: store.getState().done + 1 });
  }
  transport.close();
  // A newer run may have started meanwhile; only the latest run clears the state.
  if (runId === analysisRun) store.setState({ running: false, cancel: null });
}

/** Judge the move leading to `node` from the evaluations before and after it. */
export function judge(node: GameNode, evals: Map<number, NodeEval>): Judgement | null {
  if (!node.parent) return null;
  const before = evals.get(node.parent.id);
  const after = evals.get(node.id);
  if (!before || !after) return null;
  const white = node.ply % 2 === 1;
  const sign = white ? 1 : -1;
  const drop = sign * (winningChances(before.score) - winningChances(after.score));
  // Winning chances range over [-1, 1]; lichess uses 0.3 / 0.2 / 0.1 on the [0, 1] scale.
  if (drop >= 0.6) return 'blunder';
  if (drop >= 0.4) return 'mistake';
  if (drop >= 0.2) return 'inaccuracy';
  return null;
}

const NAG_FOR: Record<Judgement, number> = { inaccuracy: 6, mistake: 2, blunder: 4 };

/**
 * Write the analysis into the game: [%eval] comments on every move and, for
 * inaccuracies/mistakes/blunders, a NAG plus the engine's preferred line as
 * a variation. Returns the number of annotated moves.
 */
export function annotateGame(game: Game, evals: Map<number, NodeEval>): number {
  let count = 0;
  for (const node of game.mainline()) {
    const e = evals.get(node.id);
    if (!e) continue;
    const evalText = e.score.mate !== undefined ? (e.score.mate === 0 ? '' : `#${e.score.mate}`) : ((e.score.cp ?? 0) / 100).toFixed(2);
    const clean = (node.comment ?? '').replace(/\s*\[%eval [^\]]*\]\s*/g, ' ').trim();
    node.comment = evalText ? `${clean} [%eval ${evalText}]`.trim() : clean || undefined;
    const j = judge(node, evals);
    if (!j) continue;
    count++;
    node.nags = [...node.nags.filter((n) => n < 1 || n > 6), NAG_FOR[j]];
    const prev = evals.get(node.parent!.id);
    if (prev?.pv.length && prev.best && prev.best !== node.uci && node.parent) {
      let cur = node.parent;
      const pos = Game.positionAt(cur);
      const san = pvToSan(cur.fen, prev.pv.slice(0, 8));
      for (const s of san) {
        const m = pos.parseSan(s);
        if (m < 0) break;
        cur = Game.addMove(cur, m, pos.clone());
        pos.play(m);
      }
      const label = j[0].toUpperCase() + j.slice(1);
      const first = node.parent.children.find((c) => c.uci === prev.best);
      if (first && first !== node) first.startComment = `${label}. Better was`;
    }
  }
  return count;
}
