// Starts the API server (with auto-reload) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn('node', ['--conditions=development', '--import', 'tsx', '--watch', 'packages/server/src/cli.ts', 'serve', ...process.argv.slice(2)], { stdio: 'inherit' }),
  spawn('npx', ['vite', '--config', 'packages/web/vite.config.ts', 'packages/web'], { stdio: 'inherit' }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
