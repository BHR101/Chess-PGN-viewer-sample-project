/** HTTP API + static web UI + engine WebSocket. */
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { createWriteStream, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { ChessError } from '@pgnx/core';
import { type DB, dbStats, openDatabase } from './db.js';
import { EngineProcess, findEngine } from './engine.js';
import { clearExplorerMemoryCache, explore, type ExplorerFilters, warmExplorerCache } from './explorer.js';
import { GameInputError, createGame, deleteGame, gamesPgn, getGame, updateGame } from './games.js';
import { JobManager } from './jobs.js';
import { type GameQuery, matchingIds, searchGames, suggest } from './search.js';

export interface ServerOptions {
  dbPath: string;
  host?: string;
  port?: number;
  /** Directory with the built web UI (defaults to packages/web/dist). */
  webDir?: string;
  logger?: boolean;
  enginePath?: string | null;
  maxEngines?: number;
}

const VERSION = '0.1.0';

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

/** Map query-string parameters onto a GameQuery. */
export function parseGameQuery(q: Record<string, unknown>): GameQuery {
  const color = str(q.color);
  const order = str(q.order);
  return {
    player: str(q.player),
    playerExact: bool(q.playerExact),
    color: color === 'white' || color === 'black' ? color : 'any',
    opponent: str(q.opponent),
    white: str(q.white),
    black: str(q.black),
    event: str(q.event),
    site: str(q.site),
    dateFrom: str(q.dateFrom),
    dateTo: str(q.dateTo),
    result: str(q.result),
    minElo: num(q.minElo),
    maxElo: num(q.maxElo),
    eco: str(q.eco),
    opening: str(q.opening),
    minPlies: num(q.minPlies),
    maxPlies: num(q.maxPlies),
    annotated: bool(q.annotated),
    fen: str(q.fen),
    sort: str(q.sort) as GameQuery['sort'],
    order: order === 'asc' ? 'asc' : 'desc',
    offset: num(q.offset),
    limit: num(q.limit),
  };
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

export async function createServer(opts: ServerOptions): Promise<{ app: FastifyInstance; db: DB; jobs: JobManager }> {
  const db = openDatabase(opts.dbPath);
  const jobs = new JobManager(resolve(opts.dbPath), () => clearExplorerMemoryCache());
  const enginePath = opts.enginePath === undefined ? findEngine() : opts.enginePath;
  const maxEngines = opts.maxEngines ?? 4;
  let activeEngines = 0;

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 16 * 1024 * 1024 });
  await app.register(fastifyWebsocket);

  // Raw PGN uploads are streamed straight to disk.
  app.addContentTypeParser(['application/octet-stream', 'application/x-chess-pgn'], (_req, payload, done) => {
    done(null, payload);
  });
  app.addContentTypeParser('text/plain', { parseAs: 'string', bodyLimit: 64 * 1024 * 1024 }, (_req, body, done) => {
    done(null, body);
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof GameInputError || err instanceof ChessError) {
      return reply.code(400).send({ error: err.message });
    }
    const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (code >= 500) app.log.error(err);
    return reply.code(code).send({ error: err.message });
  });

  app.get('/api/info', async () => ({
    version: VERSION,
    stats: dbStats(db),
    engine: enginePath ? { available: true, path: enginePath } : { available: false },
    importing: jobs.busy,
  }));

  app.get('/api/games', async (req) => searchGames(db, parseGameQuery(req.query as Record<string, unknown>)));

  app.get('/api/games/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const g = Number.isInteger(id) ? getGame(db, id) : null;
    if (!g) return reply.code(404).send({ error: 'Game not found' });
    return g;
  });

  app.post('/api/games', async (req, reply) => {
    const body = req.body as { pgn?: string } | string;
    const pgn = typeof body === 'string' ? body : body?.pgn;
    if (!pgn) return badRequest(reply, 'Missing PGN');
    const id = createGame(db, pgn);
    clearExplorerMemoryCache();
    return reply.code(201).send({ id });
  });

  app.put('/api/games/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { pgn?: string } | string;
    const pgn = typeof body === 'string' ? body : body?.pgn;
    if (!pgn) return badRequest(reply, 'Missing PGN');
    updateGame(db, id, pgn);
    return { id };
  });

  app.delete('/api/games/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!deleteGame(db, id)) return reply.code(404).send({ error: 'Game not found' });
    return { deleted: id };
  });

  app.get('/api/explorer', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const fen = str(q.fen);
    if (!fen) return badRequest(reply, 'Missing fen');
    const filters: ExplorerFilters = {
      minElo: num(q.minElo),
      maxElo: num(q.maxElo),
      yearFrom: num(q.yearFrom),
      yearTo: num(q.yearTo),
    };
    return explore(db, fen, filters, Math.min(num(q.games) ?? 8, 50));
  });

  app.get('/api/suggest/:kind', async (req, reply) => {
    const kind = (req.params as { kind: string }).kind;
    if (kind !== 'players' && kind !== 'events' && kind !== 'sites') return reply.code(404).send({ error: 'Unknown kind' });
    return suggest(db, kind, String((req.query as { q?: string }).q ?? ''));
  });

  // ---- import
  app.post('/api/import', async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const name = str(q.name) ?? 'upload.pgn';
    const dir = mkdtempSync(join(tmpdir(), 'pgnx-upload-'));
    const file = join(dir, 'upload.pgn');
    const body = req.body;
    if (typeof body === 'string') {
      await pipeline(async function* () {
        yield body;
      }, createWriteStream(file));
    } else if (body && typeof (body as NodeJS.ReadableStream).pipe === 'function') {
      await pipeline(body as NodeJS.ReadableStream, createWriteStream(file));
    } else {
      return badRequest(reply, 'Send the PGN file as the request body (application/octet-stream)');
    }
    const job = jobs.submit(name, [file], {
      dedupe: bool(q.dedupe) ?? true,
      stripAnnotations: bool(q.stripAnnotations) ?? false,
    }, [file, dir]);
    return reply.code(202).send(job);
  });

  app.get('/api/jobs', async () => jobs.list());
  app.get('/api/jobs/:id', async (req, reply) => {
    const job = jobs.get((req.params as { id: string }).id);
    return job ?? reply.code(404).send({ error: 'Job not found' });
  });
  app.delete('/api/jobs/:id', async (req, reply) => {
    return jobs.cancel((req.params as { id: string }).id) ? { cancelled: true } : reply.code(404).send({ error: 'Job not found' });
  });

  // ---- export
  const exportHandler = async (ids: Iterable<number[]>, reply: FastifyReply, filename: string) => {
    reply.header('Content-Type', 'application/x-chess-pgn; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    const iter = ids[Symbol.iterator]();
    async function* generate() {
      for (;;) {
        const next = iter.next();
        if (next.done) return;
        yield gamesPgn(db, next.value).join('\n');
        yield '\n';
        // Let other requests through between chunks.
        await new Promise((r) => setImmediate(r));
      }
    }
    const { Readable } = await import('node:stream');
    return reply.send(Readable.from(generate()));
  };

  app.get('/api/export', async (req, reply) => {
    const q = parseGameQuery(req.query as Record<string, unknown>);
    return exportHandler(matchingIds(db, q, 500), reply, 'games.pgn');
  });

  app.post('/api/export', async (req, reply) => {
    const body = req.body as { ids?: number[] };
    if (!Array.isArray(body?.ids)) return badRequest(reply, 'Expected {"ids": [...]}');
    const ids = body.ids.filter((x) => Number.isInteger(x)).slice(0, 100_000);
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500));
    return exportHandler(chunks, reply, 'selection.pgn');
  });

  // ---- engine
  app.get('/api/engine', { websocket: true }, (socket) => {
    if (!enginePath) {
      socket.send(JSON.stringify({ type: 'error', message: 'No native engine found. Set STOCKFISH_PATH.' }));
      socket.close();
      return;
    }
    if (activeEngines >= maxEngines) {
      socket.send(JSON.stringify({ type: 'error', message: 'Too many engine sessions' }));
      socket.close();
      return;
    }
    activeEngines++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        activeEngines--;
      }
    };
    const engine = new EngineProcess(
      enginePath,
      (line) => {
        if (socket.readyState === socket.OPEN) socket.send(line);
      },
      () => {
        release();
        if (socket.readyState === socket.OPEN) socket.close();
      },
    );
    socket.on('message', (data: Buffer) => {
      for (const line of data.toString('utf8').split('\n')) {
        if (line.trim() && !engine.send(line)) {
          socket.send(`info string rejected command: ${line.slice(0, 80)}`);
        }
      }
    });
    socket.on('close', () => {
      engine.quit();
      release();
    });
  });

  // ---- static web UI
  const webDir = opts.webDir ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', async (_req, reply) =>
      reply.type('text/html').send('<h1>PGN Explorer API</h1><p>Web UI not built. Run <code>npm run build</code>.</p>'),
    );
  }

  // Pre-compute explorer results for the main opening positions if the cache is cold.
  app.addHook('onReady', async () => {
    const cached = db.prepare('SELECT 1 FROM explorer_cache LIMIT 1').get();
    if (!cached && db.prepare('SELECT 1 FROM games LIMIT 1').get()) {
      setTimeout(() => {
        try {
          warmExplorerCache(db);
        } catch (e) {
          app.log.warn(e);
        }
      }, 100).unref();
    }
  });

  app.addHook('onClose', async () => {
    await jobs.shutdown();
    db.close();
  });

  return { app, db, jobs };
}
