/** Parse worker: turns batches of raw PGN games into ProcessedGame records. */
import { parentPort } from 'node:worker_threads';
import { processGame, type ProcessOptions, type ProcessResult } from './process.js';

export interface ParseRequest {
  seq: number;
  games: string[];
  opts: ProcessOptions;
}

export interface ParseResponse {
  seq: number;
  results: ProcessResult[];
}

parentPort!.on('message', (req: ParseRequest) => {
  const results: ProcessResult[] = new Array(req.games.length);
  const transfer: ArrayBuffer[] = [];
  for (let i = 0; i < req.games.length; i++) {
    let r: ProcessResult;
    try {
      r = processGame(req.games[i], req.opts);
    } catch (e) {
      r = { ok: false, error: `Internal error: ${(e as Error).message}` };
    }
    if (r.ok) {
      transfer.push(r.game.moves.buffer as ArrayBuffer, r.game.hashes.buffer as ArrayBuffer, r.game.next.buffer as ArrayBuffer);
    }
    results[i] = r;
  }
  const res: ParseResponse = { seq: req.seq, results };
  parentPort!.postMessage(res, transfer);
});
