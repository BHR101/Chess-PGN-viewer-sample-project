/**
 * Native UCI engine bridge (Stockfish). Each client connection gets its own
 * engine process. Only a safe subset of UCI is forwarded: in particular
 * options that touch the file system (e.g. "Debug Log File") are rejected.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { availableParallelism } from 'node:os';
import { delimiter, join } from 'node:path';
import { Position } from '@pgnx/core';

const CANDIDATES = [
  '/usr/games/stockfish',
  '/usr/local/bin/stockfish',
  '/usr/bin/stockfish',
  '/opt/homebrew/bin/stockfish',
  'C:\\Program Files\\Stockfish\\stockfish.exe',
];

function executable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Locate a Stockfish binary: $STOCKFISH_PATH, then $PATH, then common locations. */
export function findEngine(): string | null {
  const env = process.env.STOCKFISH_PATH;
  if (env) return executable(env) ? env : null;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const name of ['stockfish', 'stockfish.exe']) {
      const p = join(dir, name);
      if (dir && executable(p)) return p;
    }
  }
  return CANDIDATES.find(executable) ?? null;
}

const ALLOWED_OPTIONS: Record<string, (v: string) => string | null> = {
  multipv: (v) => clampInt(v, 1, 10),
  threads: (v) => clampInt(v, 1, availableParallelism()),
  hash: (v) => clampInt(v, 1, 4096),
  'skill level': (v) => clampInt(v, 0, 20),
  uci_showwdl: (v) => (v === 'true' || v === 'false' ? v : null),
  uci_limitstrength: (v) => (v === 'true' || v === 'false' ? v : null),
  uci_elo: (v) => clampInt(v, 1320, 3190),
  'move overhead': (v) => clampInt(v, 0, 5000),
};

function clampInt(v: string, min: number, max: number): string | null {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return String(Math.min(max, Math.max(min, n)));
}

const FEN_RE = /^[1-8pnbrqkPNBRQK/]+ [wb] (-|[KQkqA-Ha-h]+) (-|[a-h][36]) \d+ \d+$/;
const MOVES_RE = /^([a-h][1-8][a-h][1-8][qrbn]?|0000)( ([a-h][1-8][a-h][1-8][qrbn]?|0000))*$/;
const GO_RE = /^go( (infinite|ponder|depth \d{1,3}|nodes \d{1,12}|movetime \d{1,9}|mate \d{1,3}|[wb]time \d{1,9}|[wb]inc \d{1,9}|movestogo \d{1,4}))*$/;

/** Validate and normalise a UCI command from a client; returns null if rejected. */
export function sanitizeUciCommand(raw: string): string | null {
  const cmd = raw.trim().replace(/\s+/g, ' ');
  if (['uci', 'isready', 'ucinewgame', 'stop', 'ponderhit'].includes(cmd)) return cmd;
  if (GO_RE.test(cmd)) return cmd;
  if (cmd.startsWith('position ')) {
    const m = /^position (startpos|fen (.+?))(?: moves (.+))?$/.exec(cmd);
    if (!m) return null;
    if (m[2] && !FEN_RE.test(m[2])) return null;
    if (m[3] && !MOVES_RE.test(m[3])) return null;
    // Engines may crash on impossible positions or illegal moves: validate semantically.
    try {
      const pos = m[2] ? Position.fromFen(m[2]) : Position.start();
      for (const mv of m[3]?.split(' ') ?? []) {
        if (pos.parseUci(mv) < 0) return null;
        pos.playUci(mv);
      }
    } catch {
      return null;
    }
    return cmd;
  }
  const opt = /^setoption name (.+?) value (.+)$/i.exec(cmd);
  if (opt) {
    const check = ALLOWED_OPTIONS[opt[1].toLowerCase()];
    const value = check?.(opt[2].toLowerCase());
    return value == null ? null : `setoption name ${opt[1]} value ${value}`;
  }
  return null;
}

export class EngineProcess {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = '';
  closed = false;

  constructor(path: string, private onLine: (line: string) => void, onExit: () => void) {
    this.proc = spawn(path, [], { stdio: 'pipe' });
    // Writing to a crashed engine raises EPIPE on stdin; the exit handler deals with it.
    this.proc.stdin.on('error', () => {
      this.closed = true;
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.onLine(line);
      }
    });
    this.proc.on('exit', () => {
      this.closed = true;
      onExit();
    });
    this.proc.on('error', () => {
      this.closed = true;
      onExit();
    });
  }

  send(cmd: string): boolean {
    const safe = sanitizeUciCommand(cmd);
    if (!safe || this.closed) return false;
    this.proc.stdin.write(safe + '\n');
    return true;
  }

  quit(): void {
    if (this.closed) return;
    try {
      this.proc.stdin.write('quit\n');
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (!this.closed) this.proc.kill('SIGKILL');
    }, 500).unref();
  }
}
