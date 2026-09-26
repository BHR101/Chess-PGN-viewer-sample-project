import { Worker, type WorkerOptions } from 'node:worker_threads';

/**
 * Start a worker for a module URL. When running from TypeScript sources
 * (development / tests), the worker registers the tsx loader before importing
 * the module; compiled builds load the .js file directly.
 */
export function spawnWorker(url: URL, options: WorkerOptions = {}): Worker {
  if (url.pathname.endsWith('.ts')) {
    const code =
      `import('tsx/esm/api').then((m) => { m.register(); return import(${JSON.stringify(url.href)}); })` +
      `.catch((e) => { console.error(e); process.exit(1); });`;
    return new Worker(code, { ...options, eval: true });
  }
  return new Worker(url, options);
}

/** Resolve a sibling module path keeping the current extension (.ts in dev, .js when built). */
export function siblingModule(base: string, name: string): URL {
  const ext = base.endsWith('.ts') ? '.ts' : '.js';
  return new URL(`./${name}${ext}`, base);
}
