// Shared Playwright helpers (uses the repo's playwright + system Edge).
// Target server: PGNX_URL (default http://localhost:3000). Output: qa/out/.
const { chromium } = require('playwright');
const path = require('path');
const OUTDIR = path.join(__dirname, '..', 'out');
const OUT = path.join(OUTDIR, 'shots');
const BASE = (process.env.PGNX_URL || 'http://localhost:3000').replace(/\/$/, '');
const FIXTURES = path.join(__dirname, '..', 'fixtures');
require('fs').mkdirSync(OUT, { recursive: true });

async function open(url = BASE + '/', opts = {}) {
  if (url.startsWith('/')) url = BASE + url;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: opts.colorScheme || 'dark', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url);
  await page.waitForSelector('button[title=Settings]'); await page.waitForTimeout(300);
  return { browser, ctx, page, errors };
}

async function sq(page, name) {
  const box = await page.locator('[aria-label=Chessboard]').boundingBox();
  const flipped = await page.evaluate(() => {
    const r = document.querySelector('[aria-label=Chessboard] .coord.rank');
    return r && r.textContent === '1';
  });
  const f = name.charCodeAt(0) - 97, r = +name[1] - 1;
  const s = box.width / 8;
  const x = flipped ? 7 - f : f, y = flipped ? r : 7 - r;
  return { x: box.x + s * (x + 0.5), y: box.y + s * (y + 0.5) };
}
async function drag(page, a, b) {
  const p = await sq(page, a), q = await sq(page, b);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await page.mouse.move(q.x, q.y, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(150);
}
async function click(page, a, b) {
  const p = await sq(page, a); await page.mouse.click(p.x, p.y); await page.waitForTimeout(80);
  if (b) { const q = await sq(page, b); await page.mouse.click(q.x, q.y); await page.waitForTimeout(150); }
}
const fen = (page) => page.locator('input[aria-label=FEN]').inputValue();
const movesText = (page) => page.locator('.moves').innerText().catch(() => '');
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
async function key(page, k, n = 1) { for (let i = 0; i < n; i++) await page.keyboard.press(k); await page.waitForTimeout(60); }

const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`); }

module.exports = { BASE, OUTDIR, FIXTURES, open, sq, drag, click, fen, movesText, shot, key, check, results, OUT };
