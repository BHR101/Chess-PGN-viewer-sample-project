import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Position, START_FEN, parseGame, parsePgn, scanPgn } from '@pgnx/core';
import {
  type DB, createGame, deleteGame, explore, getGame, importPgnFiles, openDatabase, searchGames, updateGame, dbStats,
} from '../src/index.js';
import { SAMPLE_PGN, tempDir, writeTemp } from './helpers.js';

const coreFixture = (name: string) =>
  readFileSync(new URL(`../../core/test/fixtures/${name}`, import.meta.url), 'utf8');

let tmp: ReturnType<typeof tempDir>;
let db: DB;

beforeAll(async () => {
  tmp = tempDir();
  const file = writeTemp(tmp.dir, 'sample.pgn', SAMPLE_PGN);
  const p = await importPgnFiles(join(tmp.dir, 'test.sqlite'), [file], { workers: 2 });
  expect(p.imported).toBe(6);
  expect(p.errors).toBe(1); // unsupported variant
  expect(p.warnings).toBe(1); // illegal move, truncated
  db = openDatabase(join(tmp.dir, 'test.sqlite'));
});

afterAll(() => {
  db?.close();
  tmp.cleanup();
});

describe('import', () => {
  it('stores normalised header fields', () => {
    const r = searchGames(db, { player: 'Carlsen', sort: 'date', order: 'asc' });
    expect(r.total).toBe(3);
    expect(r.games.map((g) => g.date)).toEqual(['2019.??.??', '2020.05.01', '2020.05.02']);
    const first = r.games[1];
    expect(first).toMatchObject({ white: 'Carlsen, Magnus', black: 'Caruana, Fabiano', whiteElo: 2850, result: '1-0', event: 'Test Open', site: 'Berlin' });
    expect(first.eco).toBe('C84');
    expect(first.opening).toMatch(/Ruy Lopez/);
  });

  it('skips duplicates on re-import', async () => {
    const file = writeTemp(tmp.dir, 'again.pgn', SAMPLE_PGN);
    const p = await importPgnFiles(db, [file], { workers: 1 });
    expect(p.imported).toBe(0);
    expect(p.duplicates).toBe(6);
  });

  it('keeps annotated movetext verbatim and regenerates plain games', () => {
    const najdorf = searchGames(db, { white: 'Caruana' }).games[0];
    expect(najdorf.annotated).toBe(true);
    const g = parseGame(getGame(db, najdorf.id)!.pgn);
    expect(g.mainline().length).toBe(12);
    expect(g.root.children[0].children[0].children[0].children[0].children[0].children[0].children[0].children[0].children[0].children[0].comment).toBe('Najdorf');
    expect(g.countNodes()).toBe(14);
  });

  it('round-trips games through the database', () => {
    const ids = searchGames(db, { limit: 100 }).games.map((g) => g.id);
    const original = parsePgn(SAMPLE_PGN);
    for (const id of ids) {
      const stored = parseGame(getGame(db, id)!.pgn);
      const match = original.find((o) => o.header('White') === stored.header('White') && o.header('Black') === stored.header('Black') && o.header('Event') === stored.header('Event'));
      expect(match, stored.header('Event')).toBeTruthy();
      expect(stored.mainline().map((n) => n.uci)).toEqual(match!.mainline().map((n) => n.uci));
      expect(stored.startFen).toBe(match!.startFen);
    }
  });

  it('truncates games with illegal moves', () => {
    const bad = searchGames(db, { player: 'Bad, Bob' }).games[0];
    expect(bad.plies).toBe(2);
  });
});

describe('search', () => {
  it('filters by result relative to a player', () => {
    expect(searchGames(db, { player: 'Carlsen', result: 'win' }).total).toBe(2);
    expect(searchGames(db, { player: 'Carlsen', result: 'draw' }).total).toBe(1);
    expect(searchGames(db, { player: 'Carlsen', result: 'loss' }).total).toBe(0);
    expect(searchGames(db, { player: 'Carlsen', color: 'black' }).total).toBe(2);
    expect(searchGames(db, { player: 'Carlsen', opponent: 'Doe' }).total).toBe(1);
  });

  it('filters by date, elo, eco, event and plies', () => {
    expect(searchGames(db, { dateFrom: '2020' }).total).toBe(2);
    expect(searchGames(db, { dateTo: '2019.12.31' }).total).toBe(2);
    expect(searchGames(db, { minElo: 2800 }).total).toBe(2);
    expect(searchGames(db, { eco: 'B9' }).total).toBe(1);
    expect(searchGames(db, { eco: 'C00-C99' }).total).toBe(3);
    expect(searchGames(db, { event: 'club' }).total).toBe(2);
    expect(searchGames(db, { minPlies: 10 }).total).toBe(2);
    expect(searchGames(db, { annotated: true }).total).toBe(1);
    expect(searchGames(db, { opening: 'Sicilian' }).total).toBe(1);
  });

  it('finds games by position (transpositions included)', () => {
    const pos = Position.start();
    for (const m of ['e4', 'e5', 'Nf3', 'Nc6']) pos.playSan(m);
    const r = searchGames(db, { fen: pos.fen() });
    expect(r.total).toBe(2);
    expect(r.games.every((g) => g.ply === 4)).toBe(true);
  });

  it('sorts and paginates', () => {
    const all = searchGames(db, { sort: 'white', order: 'asc', limit: 100 }).games.map((g) => g.white);
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    const page = searchGames(db, { sort: 'id', order: 'asc', limit: 2, offset: 2 });
    expect(page.games.length).toBe(2);
    expect(page.total).toBe(6);
  });
});

describe('explorer', () => {
  it('aggregates next moves with results', () => {
    const r = explore(db, START_FEN);
    expect(r.total.games).toBe(5); // setup game does not start from the initial position
    const e4 = r.moves.find((m) => m.san === 'e4')!;
    expect(e4).toMatchObject({ games: 4, white: 1, draws: 1, black: 1 });
    expect(r.moves.find((m) => m.san === 'd4')!.black).toBe(1);
    expect(r.topGames[0].whiteElo! + r.topGames[0].blackElo!).toBe(2850 + 2820);
  });

  it('applies rating filters', () => {
    const r = explore(db, START_FEN, { minElo: 2800 });
    expect(r.total.games).toBe(2);
  });

  it('reports games ending in a position', () => {
    const pos = Position.start();
    for (const m of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']) pos.playSan(m);
    expect(explore(db, pos.fen()).ended).toBe(1);
  });
});

describe('editing games keeps the position index consistent', () => {
  it('create, update and delete', () => {
    const before = explore(db, START_FEN).total.games;
    const id = createGame(db, '[White "New, Nick"]\n[Black "Old, Olga"]\n[Result "1-0"]\n\n1. c4 e5 2. g3 1-0');
    expect(explore(db, START_FEN).moves.find((m) => m.san === 'c4')?.games).toBe(1);
    expect(explore(db, START_FEN).total.games).toBe(before + 1);
    updateGame(db, id, '[White "New, Nick"]\n[Black "Old, Olga"]\n[Result "0-1"]\n\n1. b3 e5 0-1');
    const after = explore(db, START_FEN);
    expect(after.moves.find((m) => m.san === 'c4')).toBeUndefined();
    expect(after.moves.find((m) => m.san === 'b3')?.black).toBe(1);
    expect(getGame(db, id)!.pgn).toContain('1. b3 e5 0-1');
    expect(deleteGame(db, id)).toBe(true);
    expect(explore(db, START_FEN).total.games).toBe(before);
    expect(getGame(db, id)).toBeNull();
    expect(dbStats(db).games).toBe(6);
  });

  it('rejects invalid PGN', () => {
    expect(() => createGame(db, '1. e4 e5 2. Ke3 *')).toThrow(/Illegal/);
  });
});

describe('explorer matches a brute-force count on real games', () => {
  it('kasparov - deep blue', async () => {
    const t = tempDir();
    try {
      const text = coreFixture('kasparov-deep-blue-1997.pgn') + '\n' + coreFixture('stockfish-learning.pgn');
      const file = writeTemp(t.dir, 'kdb.pgn', text);
      const dbPath = join(t.dir, 'kdb.sqlite');
      await importPgnFiles(dbPath, [file], { workers: 1, indexPlies: 30 });
      const d = openDatabase(dbPath);
      // Brute force: count for every position in the first 30 plies of each game.
      const counts = new Map<string, number>();
      for (const s of scanPgn(text)) {
        const pos = s.headers.FEN ? Position.fromFen(s.headers.FEN) : Position.start();
        const seen = new Set<string>();
        const add = () => {
          const k = pos.hashHex();
          if (!seen.has(k)) {
            seen.add(k);
            counts.set(pos.fen(), (counts.get(pos.fen()) ?? 0) + 1);
          }
        };
        add();
        for (const san of s.moves.slice(0, 30)) {
          pos.playSan(san);
          add();
        }
      }
      for (const [fen, n] of counts) expect(explore(d, fen).total.games, fen).toBe(n);
      d.close();
    } finally {
      t.cleanup();
    }
  });
});
