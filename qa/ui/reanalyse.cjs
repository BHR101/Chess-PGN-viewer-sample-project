const { open, check, OUTDIR } = require('./h.cjs');
const fs = require('fs');
(async () => {
  const { browser, page } = await open();
  page.on('dialog', (d) => d.accept());
  await page.getByTitle('Open or paste PGN / FEN').click();
  await page.locator('.modal input[type=file]').setInputFiles(OUTDIR + '/analysed.pgn');
  await page.waitForTimeout(800);
  await page.locator('select[title="Search depth per move"]').selectOption('10');
  await page.getByRole('button', { name: 'Analyse game' }).click();
  await page.getByRole('button', { name: 'Add to notation' }).waitFor({ timeout: 300000 });
  await page.getByRole('button', { name: 'Add to notation' }).click(); await page.waitForTimeout(500);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTitle(/Download PGN/).click()]);
  await dl.saveAs(OUTDIR + '/analysed3.pgn');
  const t1 = fs.readFileSync(OUTDIR + '/analysed.pgn', 'utf8'), t3 = fs.readFileSync(OUTDIR + '/analysed3.pgn', 'utf8');
  const c = (t) => (t.match(/%eval/g) || []).length;
  check('re-analysing a reopened analysed game does not duplicate evals', c(t3) === c(t1), `before ${c(t1)} after ${c(t3)}`);
  await browser.close();
})();
