import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { START_FEN } from '@pgnx/core';
import { createServer, findEngine, sanitizeUciCommand } from '../src/index.js';
import { SAMPLE_PGN, tempDir } from './helpers.js';

let tmp: ReturnType<typeof tempDir>;
let server: Awaited<ReturnType<typeof createServer>>;

beforeAll(async () => {
  tmp = tempDir();
  server = await createServer({ dbPath: join(tmp.dir, 'api.sqlite'), webDir: join(tmp.dir, 'missing') });
});

afterAll(async () => {
  await server.app.close();
  tmp.cleanup();
});

async function waitForJob(id: string) {
  for (let i = 0; i < 200; i++) {
    const res = await server.app.inject({ url: `/api/jobs/${id}` });
    const job = res.json();
    if (['done', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('job timed out');
}

describe('HTTP API', () => {
  it('imports an uploaded PGN in a background job', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/import?name=sample.pgn',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(SAMPLE_PGN),
    });
    expect(res.statusCode).toBe(202);
    const job = await waitForJob(res.json().id);
    expect(job.status).toBe('done');
    expect(job.progress.imported).toBe(6);
    const info = (await server.app.inject({ url: '/api/info' })).json();
    expect(info.stats.games).toBe(6);
  });

  it('searches games', async () => {
    const res = await server.app.inject({ url: '/api/games?player=carlsen&sort=date&order=asc' });
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.games[0].date).toBe('2019.??.??');
  });

  it('serves game PGN and 404s', async () => {
    const list = (await server.app.inject({ url: '/api/games?limit=1' })).json();
    const g = (await server.app.inject({ url: `/api/games/${list.games[0].id}` })).json();
    expect(g.pgn).toMatch(/^\[Event /);
    expect((await server.app.inject({ url: '/api/games/999999' })).statusCode).toBe(404);
  });

  it('explores positions', async () => {
    const res = await server.app.inject({ url: `/api/explorer?fen=${encodeURIComponent(START_FEN)}` });
    const body = res.json();
    expect(body.total.games).toBe(5);
    expect(body.moves[0].san).toBe('e4');
    expect((await server.app.inject({ url: '/api/explorer?fen=garbage' })).statusCode).toBe(400);
  });

  it('creates, updates and deletes games', async () => {
    const created = await server.app.inject({ method: 'POST', url: '/api/games', payload: { pgn: '1. f4 e5 *' } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const updated = await server.app.inject({ method: 'PUT', url: `/api/games/${id}`, payload: { pgn: '1. f4 d5 *' } });
    expect(updated.statusCode).toBe(200);
    expect((await server.app.inject({ url: `/api/games/${id}` })).json().pgn).toContain('1. f4 d5 *');
    const bad = await server.app.inject({ method: 'PUT', url: `/api/games/${id}`, payload: { pgn: '1. f5 *' } });
    expect(bad.statusCode).toBe(400);
    expect((await server.app.inject({ method: 'DELETE', url: `/api/games/${id}` })).statusCode).toBe(200);
  });

  it('exports filtered games as PGN', async () => {
    const res = await server.app.inject({ url: '/api/export?player=carlsen' });
    expect(res.headers['content-type']).toMatch(/pgn/);
    expect(res.body.match(/^\[Event /gm)?.length).toBe(3);
    const sel = await server.app.inject({ method: 'POST', url: '/api/export', payload: { ids: [1, 2] } });
    expect(sel.body.match(/^\[Event /gm)?.length).toBe(2);
  });

  it('handles odd query parameters gracefully', async () => {
    for (const q of ['player=carlsen&color=white&opponent=caruana', 'sort=constructor', 'sort=toString', 'offset=1.5&limit=2.7']) {
      const res = await server.app.inject({ url: `/api/games?${q}` });
      expect(res.statusCode, q).toBe(200);
    }
    expect((await server.app.inject({ url: '/api/games?player=carlsen&color=white&opponent=caruana' })).json().total).toBe(1);
  });

  it('rejects a non-PGN import body without leaking temp files', async () => {
    const res = await server.app.inject({ method: 'POST', url: '/api/import', payload: { not: 'pgn' } });
    expect(res.statusCode).toBe(400);
  });

  it('suggests player names', async () => {
    const res = await server.app.inject({ url: '/api/suggest/players?q=car' });
    expect(res.json()).toEqual(['Carlsen, Magnus', 'Caruana, Fabiano']);
  });
});

describe('engine command sanitizer', () => {
  it('allows safe UCI commands', () => {
    expect(sanitizeUciCommand('uci')).toBe('uci');
    expect(sanitizeUciCommand('go depth 20')).toBe('go depth 20');
    expect(sanitizeUciCommand('go infinite')).toBe('go infinite');
    expect(sanitizeUciCommand(`position fen ${START_FEN} moves e2e4 e7e5`)).toBe(`position fen ${START_FEN} moves e2e4 e7e5`);
    expect(sanitizeUciCommand('setoption name MultiPV value 3')).toBe('setoption name MultiPV value 3');
    expect(sanitizeUciCommand('setoption name Hash value 999999')).toBe('setoption name Hash value 4096');
  });

  it('rejects dangerous or malformed commands', () => {
    expect(sanitizeUciCommand('setoption name Debug Log File value /tmp/x')).toBeNull();
    expect(sanitizeUciCommand('setoption name EvalFile value /etc/passwd')).toBeNull();
    expect(sanitizeUciCommand('quit')).toBeNull();
    expect(sanitizeUciCommand('position startpos moves e2e4; rm -rf /')).toBeNull();
    expect(sanitizeUciCommand('go depth 20\nsetoption name Debug Log File value x')).toBeNull();
  });

  it('rejects impossible positions and illegal moves (they can crash engines)', () => {
    expect(sanitizeUciCommand('position fen 8/8/8/8/8/8/8/8 w - - 0 1')).toBeNull();
    expect(sanitizeUciCommand('position startpos moves e2e5')).toBeNull();
    expect(sanitizeUciCommand('position startpos moves e2e4 e7e5 g1f3')).toBe('position startpos moves e2e4 e7e5 g1f3');
  });
});

describe.runIf(findEngine())('native engine', () => {
  it('analyses a position over the WebSocket bridge', async () => {
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.app.server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/api/engine`);
    const lines: string[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        ws.send('uci');
        ws.send('isready');
        ws.send('position startpos moves e2e4');
        ws.send('go depth 8');
      };
      ws.onmessage = (e) => {
        lines.push(String(e.data));
        if (String(e.data).startsWith('bestmove')) resolve();
      };
      ws.onerror = () => reject(new Error('ws error'));
      setTimeout(() => reject(new Error('timeout')), 20000);
    });
    ws.close();
    expect(lines.some((l) => l.startsWith('id name Stockfish'))).toBe(true);
    expect(lines.some((l) => / depth 8 .* pv /.test(l))).toBe(true);
  });
});

import { isRequestAllowed } from '../src/server.js';

describe('cross-site protection', () => {
  it('allows same-origin and non-browser requests', () => {
    expect(isRequestAllowed({ host: 'localhost:3000' }, '127.0.0.1')).toBe(true);
    expect(isRequestAllowed({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }, '127.0.0.1')).toBe(true);
    expect(isRequestAllowed({ host: '[::1]:3000', origin: 'http://[::1]:3000' }, '127.0.0.1')).toBe(true);
  });

  it('rejects cross-origin requests and DNS rebinding', () => {
    expect(isRequestAllowed({ host: 'localhost:3000', origin: 'https://evil.example' }, '127.0.0.1')).toBe(false);
    expect(isRequestAllowed({ host: 'localhost:3000', origin: 'null' }, '127.0.0.1')).toBe(false);
    expect(isRequestAllowed({ host: 'evil.example:3000' }, '127.0.0.1')).toBe(false);
    // Servers bound to all interfaces accept this machine's names/addresses and allowed hosts only.
    expect(isRequestAllowed({ host: 'attacker.example:3000', origin: 'http://attacker.example:3000' }, '0.0.0.0')).toBe(false);
    expect(isRequestAllowed({ host: 'mybox.lan:3000' }, '0.0.0.0', ['mybox.lan'])).toBe(true);
    expect(isRequestAllowed({ host: 'mybox.lan:3000', origin: 'http://other.lan' }, '0.0.0.0', ['mybox.lan'])).toBe(false);
  });

  it('blocks a cross-site POST through the server', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/games',
      headers: { origin: 'https://evil.example', 'content-type': 'text/plain' },
      payload: '1. e4 *',
    });
    expect(res.statusCode).toBe(403);
  });
});
