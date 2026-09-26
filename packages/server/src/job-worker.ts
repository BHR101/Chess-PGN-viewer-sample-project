/** Worker-thread entry point for a background import job (see jobs.ts). */
import { parentPort, workerData } from 'node:worker_threads';
import { importPgnFiles } from './importer/import.js';
import type { JobWorkerData, JobWorkerMessage } from './jobs.js';

const data = workerData as JobWorkerData;
const cancel = new Int32Array(data.cancelBuffer);
const post = (m: JobWorkerMessage) => parentPort!.postMessage(m);

let last = 0;
try {
  const progress = await importPgnFiles(data.dbPath, data.files, {
    ...data.options,
    shouldCancel: () => Atomics.load(cancel, 0) === 1,
    onProgress: (p) => {
      const now = Date.now();
      if (now - last > 250 || p.phase !== 'importing') {
        last = now;
        post({ type: 'progress', progress: p });
      }
    },
  });
  post({ type: 'done', progress });
} catch (e) {
  post({ type: 'error', error: (e as Error).message });
}
