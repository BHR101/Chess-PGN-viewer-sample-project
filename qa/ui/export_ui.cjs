const { open, shot, OUTDIR } = require('./h.cjs');
(async () => {
  const { browser, page, errors } = await open('/#/database');
  await page.waitForTimeout(1000);
  await shot(page, 'database-view');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTitle('Export all matching games as PGN').click()]);
  await dl.saveAs(OUTDIR + '/exported.pgn');
  console.log('saved', dl.suggestedFilename(), 'errors', errors);
  await browser.close();
})();
