/**
 * End-to-end smoke test: starts the built server on a fresh database, drives
 * the web UI in headless Chromium (import, search, open game, play moves,
 * explorer, engine, board editor) and fails on any page error.
 *
 *   npm run build && npm run test:e2e
 *
 * Set CHROMIUM_PATH to use a specific browser binary.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const dir = mkdtempSync(join(tmpdir(), 'pgnx-e2e-'));
const port = 3000 + Math.floor(Math.random() * 1000) + 1000;
const base = `http://127.0.0.1:${port}`;
const pgnFile = join(dir, 'sample.pgn');
writeFileSync(
  pgnFile,
  `[Event "E2E Open"]
[Site "Testville"]
[Date "2024.01.02"]
[Round "1"]
[White "Alpha, Ann"]
[Black "Beta, Bob"]
[Result "1-0"]
[WhiteElo "2500"]
[BlackElo "2400"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 {The Ruy Lopez} a6 (3... Nf6 4. O-O) 4. Ba4 Nf6 5. O-O Be7 1-0

[Event "E2E Open"]
[Site "Testville"]
[Date "2024.01.03"]
[Round "2"]
[White "Beta, Bob"]
[Black "Alpha, Ann"]
[Result "0-1"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 0-1
`,
);

const server = spawn(process.execPath, ['packages/server/dist/cli.js', 'serve', '--db', join(dir, 'e2e.sqlite'), '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('running at') && resolve());
  server.on('exit', (c) => reject(new Error(`server exited with ${c}`)));
  setTimeout(() => reject(new Error('server start timeout')), 15000);
});

const errors = [];
const step = (name) => console.log(`  ✓ ${name}`);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('favicon') && errors.push(m.text()));

  await page.goto(base);
  await page.waitForSelector('.board');
  step('app loads');

  await page.click('button:has-text("Import")');
  await page.setInputFiles('.dropzone input[type=file]', pgnFile);
  await page.waitForSelector('text=Browse games', { timeout: 20000 });
  step('PGN import through the UI');

  await page.click('text=Browse games');
  await page.waitForSelector('.gtable-row:not(.loading)');
  if ((await page.locator('.gtable-row').count()) !== 2) throw new Error('expected 2 games in the list');
  await page.fill('.filters input[placeholder^="Name"]', 'Alpha');
  await page.click('.filters button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.results-toolbar b')?.textContent?.startsWith('2 games'));
  step('database search');

  await page.locator('.gtable-row', { hasText: '2024.01.02' }).first().dblclick();
  await page.waitForSelector('.moves .cell');
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.querySelector('.fen-bar input')?.value.includes('r1bqk2r'));
  const moves = await page.locator('.moves').innerText();
  if (!moves.includes('The Ruy Lopez')) throw new Error('comment missing in move list');
  step('open game with comments and variations');

  await page.click('.tab:has-text("Explorer")').catch(() => {});
  await page.keyboard.press('Home');
  await page.waitForSelector('.explorer-table tbody tr');
  const firstMove = await page.locator('.explorer-table tbody tr').first().innerText();
  if (!/e4|d4/.test(firstMove)) throw new Error(`unexpected explorer row: ${firstMove}`);
  await page.locator('.explorer-table tbody tr', { hasText: 'd4' }).click();
  await page.waitForFunction(() => document.querySelector('.fen-bar input')?.value.includes('3P4'));
  step('opening explorer');

  await page.click('button:has-text("New")');
  const board = await page.locator('.board-wrap .board').boundingBox();
  const sq = (f, r) => [board.x + ((f + 0.5) * board.width) / 8, board.y + ((7.5 - r) * board.height) / 8];
  await page.mouse.click(...sq(4, 1));
  await page.mouse.click(...sq(4, 3));
  await page.waitForFunction(() => document.querySelector('.fen-bar input')?.value.startsWith('rnbqkbnr/pppppppp/8/8/4P3'));
  step('play a move on the board');

  // A comment typed and then followed by a board move must not be lost.
  await page.click('.tab:has-text("Moves")').catch(() => {});
  await page.fill('.annotate textarea', 'Best by test');
  await page.mouse.click(...sq(4, 6));
  await page.mouse.click(...sq(4, 4));
  await page.waitForFunction(() => document.querySelector('.fen-bar input')?.value.startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3'));
  if (!(await page.locator('.moves').innerText()).includes('Best by test')) throw new Error('comment lost after board move');
  step('comments survive playing on');

  await page.keyboard.press('l');
  await page.waitForSelector('.pv-line', { timeout: 30000 });
  step('engine analysis');
  await page.keyboard.press('l');

  await page.click('button[title="Set up a position"]');
  await page.click('button:has-text("Clear board")');
  await page.waitForSelector('text=each side needs exactly one king');
  await page.click('.modal button:has-text("Cancel")');
  step('board editor validation');

  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
  console.log('E2E smoke test passed');
} finally {
  await browser.close();
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}
