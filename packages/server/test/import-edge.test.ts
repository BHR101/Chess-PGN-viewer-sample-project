import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseGame } from '@pgnx/core';
import { START_FEN } from '@pgnx/core';
import { GameWriter, explore, getGame, importPgnFiles, openDatabase, processGame, searchGames } from '../src/index.js';
import { tempDir } from './helpers.js';

let tmp: ReturnType<typeof tempDir>;
beforeAll(() => {
  tmp = tempDir();
});
afterAll(() => tmp.cleanup());

async function importBytes(name: string, bytes: Buffer | string, opts = {}) {
  const file = join(tmp.dir, name);
  writeFileSync(file, bytes);
  const dbPath = join(tmp.dir, `${name}.sqlite`);
  const progress = await importPgnFiles(dbPath, [file], { workers: 1, ...opts });
  return { progress, db: openDatabase(dbPath) };
}

describe('importer edge cases', () => {
  it('decodes legacy Latin-1 files', async () => {
    const text = '[Event "Café"]\n[White "Müller, Jürgen"]\n[Black "Ståhlberg"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n';
    const { progress, db } = await importBytes('latin1.pgn', Buffer.from(text, 'latin1'));
    expect(progress.imported).toBe(1);
    const g = searchGames(db, {}).games[0];
    expect(g.white).toBe('Müller, Jürgen');
    expect(g.event).toBe('Café');
    db.close();
  });

  it('handles CRLF line endings, a BOM and escape lines', async () => {
    const text = '﻿% exported by some tool\r\n[Event "Win"]\r\n[White "A"]\r\n[Black "B"]\r\n[Result "0-1"]\r\n\r\n1. f3 e5 2. g4 Qh4# 0-1\r\n\r\n[Event "Win2"]\r\n[White "C"]\r\n[Black "D"]\r\n[Result "*"]\r\n\r\n1. d4 *\r\n';
    const { progress, db } = await importBytes('crlf.pgn', text);
    expect(progress.imported).toBe(2);
    const g = searchGames(db, { event: 'Win', sort: 'id', order: 'asc' }).games[0];
    expect(g.plies).toBe(4);
    expect(g.result).toBe('0-1');
    db.close();
  });

  it('copes with empty files and junk', async () => {
    const empty = await importBytes('empty.pgn', '');
    expect(empty.progress.imported).toBe(0);
    empty.db.close();
    const junk = await importBytes('junk.pgn', 'this is not a pgn file\n\n{unterminated comment');
    expect(junk.progress.imported).toBe(0);
    expect(junk.progress.errors).toBe(1);
    junk.db.close();
  });

  it('strips annotations when asked', async () => {
    const text = '[White "A"]\n[Black "B"]\n\n1. e4 {comment} (1. d4) 1... e5 $1 *\n';
    const { db } = await importBytes('strip.pgn', text, { stripAnnotations: true });
    const g = searchGames(db, {}).games[0];
    expect(g.annotated).toBe(false);
    const pgn = getGame(db, g.id)!.pgn;
    expect(parseGame(pgn).countNodes()).toBe(2);
    db.close();
  });

  it('keeps extra tags and custom start positions', async () => {
    const text = '[Event "Study"]\n[Annotator "Someone"]\n[TimeControl "180+2"]\n[SetUp "1"]\n[FEN "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1"]\n[Result "*"]\n\n1. e4 Kxe4 *\n';
    const { db } = await importBytes('tags.pgn', text);
    const g = searchGames(db, {}).games[0];
    const detail = getGame(db, g.id)!;
    expect(detail.headers).toContainEqual(['Annotator', 'Someone']);
    expect(detail.headers).toContainEqual(['TimeControl', '180+2']);
    expect(detail.headers).toContainEqual(['FEN', '8/8/8/4k3/8/8/4P3/4K3 w - - 0 1']);
    expect(parseGame(detail.pgn).mainline().map((n) => n.san)).toEqual(['e4', 'Kxe4']);
    db.close();
  });

  it('imports several files in one go and merges into an existing database', async () => {
    const a = join(tmp.dir, 'a.pgn');
    const b = join(tmp.dir, 'b.pgn');
    writeFileSync(a, '[White "A"]\n[Black "B"]\n\n1. e4 *\n');
    writeFileSync(b, '[White "C"]\n[Black "D"]\n\n1. d4 *\n');
    const dbPath = join(tmp.dir, 'multi.sqlite');
    expect((await importPgnFiles(dbPath, [a, b], { workers: 2 })).imported).toBe(2);
    writeFileSync(a, '[White "E"]\n[Black "F"]\n\n1. c4 *\n');
    // Second import into a non-empty database uses the incremental path.
    expect((await importPgnFiles(dbPath, [a], { workers: 1 })).imported).toBe(1);
    const db = openDatabase(dbPath);
    expect(searchGames(db, {}).total).toBe(3);
    db.close();
  });

  it('refuses to change the index depth of a non-empty database', async () => {
    const dbPath = join(tmp.dir, 'depth.sqlite');
    const f = join(tmp.dir, 'depth.pgn');
    writeFileSync(f, '[White "A"]\n[Black "B"]\n\n1. e4 *\n');
    await importPgnFiles(dbPath, [f], { workers: 1, indexPlies: 10 });
    writeFileSync(f, '[White "C"]\n[Black "D"]\n\n1. d4 *\n');
    await expect(importPgnFiles(dbPath, [f], { workers: 1, indexPlies: 20 })).rejects.toThrow(/index/);
    expect((await importPgnFiles(dbPath, [f], { workers: 1, indexPlies: 10 })).imported).toBe(1);
  });

  it('recovers staged positions after an interrupted import', () => {
    const dbPath = join(tmp.dir, 'crash.sqlite');
    let db = openDatabase(dbPath);
    const writer = new GameWriter(db, true, true);
    const r = processGame('[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Nf3 *', { indexPlies: 60 });
    if (!r.ok) throw new Error(r.error);
    db.transaction(() => writer.write(r.game))();
    // Simulate a crash: the stage is never merged.
    db.close();
    db = openDatabase(dbPath);
    expect(explore(db, START_FEN).total.games).toBe(1);
    db.close();
  });
});
