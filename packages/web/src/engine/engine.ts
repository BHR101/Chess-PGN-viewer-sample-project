/**
 * UCI engine client. Works over two transports with the same line protocol:
 *  - "native": a Stockfish process on the local server, via WebSocket
 *  - "wasm":   Stockfish compiled to WebAssembly, in a Web Worker
 *
 * Searches are restarted safely: a new position is only sent after the
 * previous search acknowledged "stop" with "bestmove", so stale info lines
 * never leak into the new analysis.
 */
import { Position } from '@pgnx/core';

export interface Score {
  /** Centipawns from White's point of view. */
  cp?: number;
  /** Mate in N (positive = White mates) from White's point of view. */
  mate?: number;
}

export interface PvLine {
  multipv: number;
  depth: number;
  score: Score;
  /** Win/draw/loss per mille from White's point of view, if reported. */
  wdl?: [number, number, number];
  uci: string[];
  san: string[];
}

export interface Analysis {
  fen: string;
  depth: number;
  nodes: number;
  nps: number;
  timeMs: number;
  lines: PvLine[];
  done: boolean;
}

export interface Transport {
  send(cmd: string): void;
  close(): void;
}

export function wasmTransport(onLine: (l: string) => void, onError: (e: string) => void): Transport {
  const worker = new Worker('/engine/stockfish-19-lite-single.js');
  worker.onmessage = (e) => onLine(String(e.data));
  worker.onerror = (e) => onError(e.message || 'Engine worker failed to start');
  return { send: (c) => worker.postMessage(c), close: () => worker.terminate() };
}

export function nativeTransport(onLine: (l: string) => void, onError: (e: string) => void, onOpen: () => void): Transport {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/api/engine`);
  const queue: string[] = [];
  ws.onopen = () => {
    for (const c of queue) ws.send(c);
    queue.length = 0;
    onOpen();
  };
  ws.onmessage = (e) => {
    const text = String(e.data);
    if (text.startsWith('{')) {
      try {
        const msg = JSON.parse(text);
        if (msg.type === 'error') onError(msg.message);
        return;
      } catch {
        /* fall through */
      }
    }
    onLine(text);
  };
  ws.onerror = () => onError('Could not connect to the native engine');
  return {
    send: (c) => (ws.readyState === WebSocket.OPEN ? ws.send(c) : queue.push(c)),
    close: () => ws.close(),
  };
}

/** Convert a UCI PV to SAN (stops at the first illegal move). */
export function pvToSan(fen: string, uci: string[], max = 30): string[] {
  const pos = Position.fromFen(fen);
  const out: string[] = [];
  for (const u of uci.slice(0, max)) {
    const m = pos.parseUci(u);
    if (m < 0) break;
    out.push(pos.san(m));
    pos.play(m);
  }
  return out;
}

export interface EngineOptions {
  backend: 'native' | 'wasm';
  multiPv: number;
  threads: number;
  hashMb?: number;
}

export class Engine {
  private transport: Transport;
  private ready = false;
  private searching = false;
  private pending: string | null = null;
  private current: Analysis | null = null;
  private currentTurn: 'w' | 'b' = 'w';
  private startTime = 0;
  name = '';
  error: string | null = null;

  constructor(private opts: EngineOptions, private onUpdate: (a: Analysis | null) => void, private onStatus: () => void) {
    const onLine = (l: string) => this.handleLine(l);
    const onError = (e: string) => {
      this.error = e;
      this.onStatus();
    };
    this.transport =
      opts.backend === 'native'
        ? nativeTransport(onLine, onError, () => {})
        : wasmTransport(onLine, onError);
    this.transport.send('uci');
  }

  private handleLine(line: string) {
    if (line.startsWith('id name ')) {
      this.name = line.slice(8);
      return;
    }
    if (line === 'uciok') {
      this.transport.send(`setoption name MultiPV value ${this.opts.multiPv}`);
      if (this.opts.backend === 'native') {
        this.transport.send(`setoption name Threads value ${this.opts.threads}`);
        this.transport.send(`setoption name Hash value ${this.opts.hashMb ?? 256}`);
      }
      this.transport.send('setoption name UCI_ShowWDL value true');
      this.transport.send('isready');
      return;
    }
    if (line === 'readyok') {
      if (!this.ready) {
        this.ready = true;
        this.onStatus();
      }
      this.startPending();
      return;
    }
    if (line.startsWith('bestmove')) {
      this.searching = false;
      if (this.current && !this.pending) {
        this.current = { ...this.current, done: true };
        this.onUpdate(this.current);
      }
      this.startPending();
      return;
    }
    // Ignore output of a search that is being stopped (new position pending, or a
    // finished/terminal position is displayed).
    if (line.startsWith('info ') && this.current && this.searching && !this.pending && !this.current.done) this.parseInfo(line);
  }

  private parseInfo(line: string) {
    const t = line.split(' ');
    let depth = 0;
    let multipv = 1;
    let score: Score | null = null;
    let wdl: [number, number, number] | undefined;
    let nodes = 0;
    let nps = 0;
    let time = 0;
    let pv: string[] | null = null;
    let bound = false;
    for (let i = 1; i < t.length; i++) {
      switch (t[i]) {
        case 'depth':
          depth = +t[++i];
          break;
        case 'multipv':
          multipv = +t[++i];
          break;
        case 'nodes':
          nodes = +t[++i];
          break;
        case 'nps':
          nps = +t[++i];
          break;
        case 'time':
          time = +t[++i];
          break;
        case 'score': {
          const kind = t[++i];
          const v = +t[++i];
          const sign = this.currentTurn === 'w' ? 1 : -1;
          score = kind === 'mate' ? { mate: v * sign } : { cp: v * sign };
          if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') {
            bound = true;
            i++;
          }
          break;
        }
        case 'wdl': {
          const w = +t[++i];
          const d = +t[++i];
          const l = +t[++i];
          wdl = this.currentTurn === 'w' ? [w, d, l] : [l, d, w];
          break;
        }
        case 'pv':
          pv = t.slice(i + 1);
          i = t.length;
          break;
        case 'string':
          i = t.length;
          break;
      }
    }
    if (!score || !pv || !pv.length || bound) {
      if (nodes && this.current) this.current = { ...this.current, nodes, nps: nps || this.current.nps };
      return;
    }
    const a = this.current!;
    const lines = a.lines.filter((l) => l.multipv !== multipv);
    lines.push({ multipv, depth, score, wdl, uci: pv, san: pvToSan(a.fen, pv) });
    lines.sort((x, y) => x.multipv - y.multipv);
    this.current = {
      ...a,
      depth: Math.max(depth, multipv === 1 ? depth : a.depth),
      nodes,
      nps,
      timeMs: time || Date.now() - this.startTime,
      lines: lines.filter((l) => l.multipv <= this.opts.multiPv),
    };
    this.onUpdate(this.current);
  }

  private startPending() {
    if (!this.ready || this.searching || this.pending === null) return;
    const fen = this.pending;
    this.pending = null;
    this.currentTurn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    this.current = { fen, depth: 0, nodes: 0, nps: 0, timeMs: 0, lines: [], done: false };
    this.onUpdate(this.current);
    this.startTime = Date.now();
    this.transport.send(`position fen ${fen}`);
    this.transport.send('go infinite');
    this.searching = true;
  }

  get isReady(): boolean {
    return this.ready;
  }

  analyze(fen: string) {
    const pos = Position.fromFen(fen);
    if (!pos.hasLegalMove()) {
      // Mate or stalemate: nothing to search.
      this.stop();
      const mated = pos.inCheck();
      this.current = {
        fen, depth: 0, nodes: 0, nps: 0, timeMs: 0, done: true,
        // A mate score of 0 means "already mated"; cp carries the winner's sign.
        lines: [{ multipv: 1, depth: 0, score: mated ? { mate: 0, cp: pos.turn === 0 ? -1 : 1 } : { cp: 0 }, uci: [], san: [] }],
      };
      this.onUpdate(this.current);
      return;
    }
    this.pending = fen;
    if (this.searching) this.transport.send('stop');
    else this.startPending();
  }

  setMultiPv(n: number) {
    this.opts.multiPv = n;
    const fen = this.current?.fen;
    if (this.searching) {
      // Keep a newer position that is already waiting for the restart.
      if (this.pending === null) this.pending = fen ?? null;
      this.transport.send('stop');
    }
    this.transport.send(`setoption name MultiPV value ${n}`);
    if (!this.searching && fen) this.analyze(fen);
  }

  stop() {
    this.pending = null;
    if (this.searching) this.transport.send('stop');
  }

  destroy() {
    this.stop();
    this.transport.close();
  }
}

/** Format a score for display, e.g. "+0.34", "#-3". */
export function formatScore(s: Score): string {
  if (s.mate !== undefined) return s.mate === 0 ? '#' : `#${s.mate}`;
  const v = (s.cp ?? 0) / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}

/** Map a score to White's winning chances in [-1, 1] (lichess-style sigmoid). */
export function winningChances(s: Score): number {
  if (s.mate !== undefined) return s.mate === 0 ? Math.sign(s.cp ?? 0) : s.mate > 0 ? 1 : -1;
  const cp = Math.max(-1000, Math.min(1000, s.cp ?? 0));
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}
