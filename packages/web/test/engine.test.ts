import { afterEach, describe, expect, it } from 'vitest';
import { type Analysis, Engine } from '../src/engine/engine';

/** Minimal fake of the Stockfish web worker: records commands, lets tests emit lines. */
class FakeWorker {
  static last: FakeWorker;
  sent: string[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: unknown = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(cmd: string) {
    this.sent.push(cmd);
  }
  emit(...lines: string[]) {
    for (const l of lines) this.onmessage?.({ data: l });
  }
  terminate() {}
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';

function setup() {
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  let latest: Analysis | null = null;
  const engine = new Engine({ backend: 'wasm', multiPv: 1, threads: 1 }, (a) => (latest = a), () => {});
  const w = FakeWorker.last;
  w.emit('id name Fakefish', 'uciok', 'readyok');
  return { engine, w, get: () => latest };
}

afterEach(() => {
  delete (globalThis as unknown as { Worker?: unknown }).Worker;
});

describe('Engine client', () => {
  it('reports scores from White’s point of view', () => {
    const { engine, w, get } = setup();
    engine.analyze(AFTER_E4);
    w.emit('info depth 10 multipv 1 score cp 30 nodes 1000 nps 1000 pv e7e5 g1f3');
    expect(get()!.lines[0].score).toEqual({ cp: -30 });
    expect(get()!.lines[0].san).toEqual(['e5', 'Nf3']);
  });

  it('ignores lines of a stopped search after reaching a mate', () => {
    const { engine, w, get } = setup();
    engine.analyze(START);
    w.emit('info depth 5 multipv 1 score cp 20 pv e2e4');
    engine.analyze(MATED);
    expect(get()!.lines[0].score.mate).toBe(0);
    w.emit('info depth 6 multipv 1 score cp 25 pv d2d4', 'bestmove d2d4');
    expect(get()!.fen).toBe(MATED);
    expect(get()!.lines).toHaveLength(1);
    expect(get()!.lines[0].score.mate).toBe(0);
  });

  it('keeps the pending position when MultiPV changes during a restart', () => {
    const { engine, w } = setup();
    engine.analyze(START);
    engine.analyze(AFTER_E4);
    engine.setMultiPv(2);
    w.emit('bestmove e2e4');
    const positions = w.sent.filter((c) => c.startsWith('position'));
    expect(positions.at(-1)).toBe(`position fen ${AFTER_E4}`);
  });
});
