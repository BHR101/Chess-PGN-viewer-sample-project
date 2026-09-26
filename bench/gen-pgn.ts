/**
 * Synthetic PGN database generator for benchmarks.
 *
 *   npx tsx --conditions=development bench/gen-pgn.ts <games> <out.pgn> [seed]
 *
 * Games are played with a cheap piece-square-table policy sampled through a
 * softmax, so the opening tree is realistically skewed (popular lines repeat,
 * deep positions are unique). Headers draw from pools of players, events and
 * sites, with plausible Elo, dates and result distributions. A small share of
 * games carry comments, NAGs and variations. Work is spread over worker threads.
 */
import { createWriteStream } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Position, moveToUci } from '@pgnx/core';

// --- deterministic PRNG -----------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Magnus', 'Hikaru', 'Fabiano', 'Ian', 'Ding', 'Alireza', 'Wesley', 'Anish', 'Levon', 'Maxime', 'Viswanathan', 'Garry', 'Judit', 'Hou', 'Ju', 'Aleksandra', 'Vladimir', 'Sergey', 'Teimour', 'Peter', 'Boris', 'Mikhail', 'Anatoly', 'Bobby', 'Jose', 'Emanuel', 'Tigran', 'Paul', 'Richard', 'Nona', 'Maia', 'Alexandra', 'Koneru', 'Humpy', 'Gukesh', 'Rameshbabu', 'Nodirbek', 'Vincent', 'Arjun', 'Jan-Krzysztof'];
const LAST = ['Carlsen', 'Nakamura', 'Caruana', 'Nepomniachtchi', 'Liren', 'Firouzja', 'So', 'Giri', 'Aronian', 'Vachier-Lagrave', 'Anand', 'Kasparov', 'Polgar', 'Yifan', 'Wenjun', 'Goryachkina', 'Kramnik', 'Karjakin', 'Radjabov', 'Svidler', 'Gelfand', 'Tal', 'Karpov', 'Fischer', 'Capablanca', 'Lasker', 'Petrosian', 'Morphy', 'Reti', 'Gaprindashvili', 'Chiburdanidze', 'Kosteniuk', 'Dommaraju', 'Praggnanandhaa', 'Abdusattorov', 'Keymer', 'Erigaisi', 'Duda', 'Rapport', 'Mamedyarov', 'Topalov', 'Ivanchuk', 'Short', 'Adams', 'Grischuk', 'Dominguez', 'Wojtaszek', 'Harikrishna', 'Vidit', 'Shirov'];
const CITIES = ['Wijk aan Zee', 'Linares', 'Dortmund', 'Moscow', 'London', 'St. Louis', 'Tbilisi', 'Stavanger', 'Bucharest', 'Zagreb', 'Paris', 'Chennai', 'Baku', 'Reykjavik', 'Hastings', 'Gibraltar', 'Biel', 'Sochi', 'Doha', 'Madrid'];
const EVENT_KINDS = ['Open', 'Masters', 'Invitational', 'Championship', 'Memorial', 'Rapid', 'Blitz', 'Olympiad', 'Cup', 'Classic'];

// Piece-square tables (from white's perspective), roughly "sensible" play.
const PST: Record<number, number[]> = {
  1: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0, -10, -5, 5, 0, 0, 0, 25, 25, 0, 0, 0, 5, 5, 10, 27, 27, 10, 5, 5, 10, 10, 20, 30, 30, 20, 10, 10, 50, 50, 50, 50, 50, 50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 5, 5, 0, -20, -40, -30, 5, 10, 15, 15, 10, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 10, 15, 15, 10, 0, -30, -40, -20, 0, 0, 0, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  3: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 5, 0, 0, 0, 0, 5, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  4: [0, 0, 0, 5, 5, 0, 0, 0, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 5, 10, 10, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  5: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 5, 0, 0, 0, 0, -10, -10, 5, 5, 5, 5, 5, 0, -10, 0, 0, 5, 5, 5, 5, 0, -5, -5, 0, 5, 5, 5, 5, 0, -5, -10, 0, 5, 5, 5, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  6: [20, 30, 10, 0, 0, 10, 30, 20, 20, 20, 0, 0, 0, 0, 20, 20, -10, -20, -20, -20, -20, -20, -20, -10, -20, -30, -30, -40, -40, -30, -30, -20, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30],
};
const VALUE = [0, 100, 320, 330, 500, 900, 0];

function pst(type: number, sq: number, color: number): number {
  return PST[type][color === 0 ? sq : sq ^ 56];
}

function chooseMove(pos: Position, rnd: () => number, ply: number): number {
  const moves = pos.legalMoves();
  const us = pos.turn;
  const temp = ply < 12 ? 9 : ply < 30 ? 18 : 30;
  const scores = new Float64Array(moves.length);
  let max = -Infinity;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const from = m & 63;
    const to = (m >> 6) & 63;
    const p = pos.board[from] & 7;
    const cap = pos.board[to] & 7;
    let s = pst(p, to, us) - pst(p, from, us) + VALUE[cap] * 0.9;
    if ((m >> 12) & 7) s += 800;
    if (m & (1 << 15)) s += 60;
    // Avoid hanging the piece on an attacked square (very rough).
    if (pos.isAttacked(to, us ^ 1)) s -= VALUE[p] * 0.7;
    scores[i] = s;
    if (s > max) max = s;
  }
  let total = 0;
  for (let i = 0; i < scores.length; i++) {
    scores[i] = Math.exp((scores[i] - max) / temp);
    total += scores[i];
  }
  let r = rnd() * total;
  for (let i = 0; i < scores.length; i++) {
    r -= scores[i];
    if (r <= 0) return moves[i];
  }
  return moves[moves.length - 1];
}

interface Pools {
  players: Array<{ name: string; elo: number }>;
  events: Array<{ name: string; site: string; year: number }>;
}

function makePools(seed: number): Pools {
  const rnd = mulberry32(seed);
  const players: Pools['players'] = [];
  for (let i = 0; i < 6000; i++) {
    const last = LAST[Math.floor(rnd() * LAST.length)];
    const first = FIRST[Math.floor(rnd() * FIRST.length)];
    const suffix = i < LAST.length * 2 ? '' : ` ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`;
    players.push({ name: `${last}${suffix}, ${first}`, elo: Math.round(1600 + rnd() * 1250) });
  }
  const events: Pools['events'] = [];
  for (let i = 0; i < 3000; i++) {
    const city = CITIES[Math.floor(rnd() * CITIES.length)];
    const year = 1970 + Math.floor(rnd() * 56);
    const kind = EVENT_KINDS[Math.floor(rnd() * EVENT_KINDS.length)];
    events.push({ name: `${city} ${kind} ${year}`, site: city, year });
  }
  return { players, events };
}

function genGames(start: number, count: number, seed: number): string {
  const pools = makePools(seed);
  const rnd = mulberry32(seed * 7919 + start);
  let out = '';
  for (let g = start; g < start + count; g++) {
    const w = pools.players[Math.floor(Math.pow(rnd(), 1.6) * pools.players.length)];
    let b = pools.players[Math.floor(Math.pow(rnd(), 1.6) * pools.players.length)];
    if (b === w) b = pools.players[(pools.players.indexOf(w) + 1) % pools.players.length];
    const ev = pools.events[Math.floor(rnd() * pools.events.length)];
    const pos = Position.start();
    const annotate = rnd() < 0.04;
    const maxPlies = 30 + Math.floor(rnd() * 130);
    let movetext = '';
    let result = '*';
    let ply = 0;
    for (; ply < maxPlies; ply++) {
      if (!pos.hasLegalMove()) {
        result = pos.inCheck() ? (pos.turn === 0 ? '0-1' : '1-0') : '1/2-1/2';
        break;
      }
      if (pos.isInsufficientMaterial() || pos.halfmove >= 100) {
        result = '1/2-1/2';
        break;
      }
      const m = chooseMove(pos, rnd, ply);
      if (ply % 2 === 0) movetext += `${ply / 2 + 1}. `;
      movetext += pos.san(m) + ' ';
      if (annotate && rnd() < 0.08) movetext += `{A comment about ${moveToUci(m)}} `;
      if (annotate && rnd() < 0.05) movetext += '$' + (1 + Math.floor(rnd() * 6)) + ' ';
      if (annotate && rnd() < 0.05) {
        // A one-move alternative to the move just written.
        const alt = pos.legalMoves().find((x) => x !== m);
        if (alt !== undefined) {
          movetext += `(${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'} ${pos.san(alt)}) `;
          if (ply % 2 === 0) movetext += `${ply / 2 + 1}... `;
        }
      }
      pos.play(m);
    }
    if (result === '*') {
      const diff = (w.elo - b.elo) / 400;
      const pw = 1 / (1 + Math.pow(10, -diff));
      const r = rnd();
      const drawShare = 0.35;
      result = r < drawShare ? '1/2-1/2' : r < drawShare + (1 - drawShare) * pw ? '1-0' : '0-1';
    }
    const month = 1 + Math.floor(rnd() * 12);
    const day = 1 + Math.floor(rnd() * 28);
    const date = rnd() < 0.05 ? `${ev.year}.??.??` : `${ev.year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
    out += `[Event "${ev.name}"]\n[Site "${ev.site}"]\n[Date "${date}"]\n[Round "${1 + Math.floor(rnd() * 11)}"]\n` +
      `[White "${w.name}"]\n[Black "${b.name}"]\n[Result "${result}"]\n[WhiteElo "${w.elo}"]\n[BlackElo "${b.elo}"]\n` +
      `[PlyCount "${ply}"]\n\n`;
    // Wrap movetext at ~80 columns.
    let line = '';
    for (const tok of (movetext + result).split(' ')) {
      if (line.length + tok.length + 1 > 80) {
        out += line + '\n';
        line = tok;
      } else {
        line = line ? `${line} ${tok}` : tok;
      }
    }
    out += line + '\n\n';
  }
  return out;
}

/** Start a worker running this .ts file (registers tsx inside the worker). */
function spawnWorker(url: URL, data: unknown): Worker {
  const code =
    `import('tsx/esm/api').then((m) => { m.register(); return import(${JSON.stringify(url.href)}); })` +
    `.catch((e) => { console.error(e); process.exit(1); });`;
  return new Worker(code, { eval: true, workerData: data });
}

if (isMainThread) {
  const total = parseInt(process.argv[2] ?? '10000', 10);
  const outPath = process.argv[3] ?? 'bench/out/games.pgn';
  const seed = parseInt(process.argv[4] ?? '42', 10);
  const threads = Math.max(1, availableParallelism() - 0);
  const chunk = 2000;
  const out = createWriteStream(outPath);
  let next = 0;
  let written = 0;
  const pending = new Map<number, string>();
  let nextToWrite = 0;
  const t0 = Date.now();
  await new Promise<void>((resolve) => {
    let active = 0;
    const launch = () => {
      if (next >= total) {
        if (active === 0) resolve();
        return;
      }
      const start = next;
      const count = Math.min(chunk, total - start);
      next += count;
      active++;
      const w = spawnWorker(new URL(import.meta.url), { start, count, seed });
      w.once('message', (text: string) => {
        pending.set(start, text);
        while (pending.has(nextToWrite)) {
          const t = pending.get(nextToWrite)!;
          pending.delete(nextToWrite);
          out.write(t);
          nextToWrite += Math.min(chunk, total - nextToWrite);
        }
        written += count;
        if (written % 20000 < chunk) process.stderr.write(`\r${written}/${total} games (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        active--;
        w.terminate();
        launch();
      });
    };
    for (let i = 0; i < threads; i++) launch();
  });
  await new Promise((r) => out.end(r));
  process.stderr.write(`\nwrote ${total} games to ${outPath} in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
} else {
  const { start, count, seed } = workerData as { start: number; count: number; seed: number };
  parentPort!.postMessage(genGames(start, count, seed));
}
