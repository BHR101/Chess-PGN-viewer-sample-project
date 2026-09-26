/**
 * Background import jobs. Each job runs the importer in a worker thread with
 * its own database connection, so the HTTP server stays responsive. Jobs run
 * one at a time, in submission order.
 */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { Worker } from 'node:worker_threads';
import type { ImportOptions, ImportProgress } from './importer/import.js';
import { siblingModule, spawnWorker } from './util/worker.js';

export interface Job {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: ImportProgress | null;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

export interface JobWorkerData {
  dbPath: string;
  files: string[];
  options: Omit<ImportOptions, 'onProgress' | 'shouldCancel'>;
  cancelBuffer: SharedArrayBuffer;
}

export type JobWorkerMessage =
  | { type: 'progress'; progress: ImportProgress }
  | { type: 'done'; progress: ImportProgress }
  | { type: 'error'; error: string };

interface QueuedJob {
  job: Job;
  files: string[];
  options: JobWorkerData['options'];
  /** Temporary files to delete when the job finishes. */
  cleanup: string[];
}

export class JobManager {
  private jobs = new Map<string, Job>();
  private queue: QueuedJob[] = [];
  private running: { job: Job; worker: Worker; cancel: Int32Array } | null = null;

  constructor(private dbPath: string, private onFinished: (job: Job) => void = () => {}) {}

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  get busy(): boolean {
    return this.running !== null;
  }

  submit(name: string, files: string[], options: JobWorkerData['options'] = {}, cleanup: string[] = []): Job {
    const job: Job = { id: randomUUID(), name, status: 'queued', progress: null, createdAt: Date.now() };
    this.jobs.set(job.id, job);
    this.queue.push({ job, files, options, cleanup });
    this.pump();
    return job;
  }

  cancel(id: string): boolean {
    const idx = this.queue.findIndex((q) => q.job.id === id);
    if (idx >= 0) {
      const [q] = this.queue.splice(idx, 1);
      q.job.status = 'cancelled';
      this.removeFiles(q.cleanup);
      return true;
    }
    if (this.running?.job.id === id) {
      Atomics.store(this.running.cancel, 0, 1);
      return true;
    }
    return false;
  }

  private removeFiles(files: string[]) {
    for (const f of files) rmSync(f, { force: true, recursive: true });
  }

  private pump() {
    if (this.running || !this.queue.length) return;
    const q = this.queue.shift()!;
    const cancelBuffer = new SharedArrayBuffer(4);
    const data: JobWorkerData = { dbPath: this.dbPath, files: q.files, options: q.options, cancelBuffer };
    const worker = spawnWorker(siblingModule(import.meta.url, 'job-worker'), { workerData: data });
    q.job.status = 'running';
    this.running = { job: q.job, worker, cancel: new Int32Array(cancelBuffer) };
    const finish = (status: Job['status'], error?: string) => {
      if (this.running?.job !== q.job) return;
      q.job.status = status;
      q.job.error = error;
      q.job.finishedAt = Date.now();
      this.running = null;
      this.removeFiles(q.cleanup);
      void worker.terminate();
      this.onFinished(q.job);
      this.pump();
    };
    worker.on('message', (m: JobWorkerMessage) => {
      if (m.type === 'progress') q.job.progress = m.progress;
      else if (m.type === 'done') {
        q.job.progress = m.progress;
        finish(m.progress.phase === 'cancelled' ? 'cancelled' : 'done');
      } else finish('failed', m.error);
    });
    worker.on('error', (e: Error) => finish('failed', e.message));
    worker.on('exit', (code) => {
      if (code !== 0) finish('failed', `Import worker exited with code ${code}`);
    });
  }

  async shutdown(): Promise<void> {
    if (this.running) {
      Atomics.store(this.running.cancel, 0, 1);
      await this.running.worker.terminate();
    }
  }
}
