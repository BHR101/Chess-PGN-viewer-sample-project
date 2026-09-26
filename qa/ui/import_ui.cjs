// Import one or more PGN files through the UI's Import dialog and wait for completion.
const { open, shot, check, BASE } = require('./h.cjs');
const files = process.argv.slice(2);
(async () => {
  const { browser, page, errors } = await open();
  const t0 = Date.now();
  await page.getByTitle('Import PGN files into the database').click();
  await page.locator('.modal input[type=file]').setInputFiles(files);
  await page.getByRole('button', { name: 'Browse games' }).waitFor({ timeout: 30 * 60 * 1000 });
  await shot(page, 'import-' + require('path').basename(files[0]));
  const statText = (await page.locator('.modal').innerText()).replace(/\s+/g, ' ');
  console.log('dialog:', statText.slice(0, 400));
  console.log('seconds:', ((Date.now() - t0) / 1000).toFixed(1));
  const jobs = await (await page.request.get(BASE + '/api/jobs')).json();
  const j = jobs[jobs.length - 1] ?? jobs[0];
  console.log('job:', JSON.stringify(j).slice(0, 3000));
  check('no page errors during import', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
