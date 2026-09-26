const { open, shot } = require('./h.cjs');
(async () => {
  const { browser, page, errors } = await open();
  for (const f of process.argv.slice(2)) {
    await page.getByTitle('Open or paste PGN / FEN').click();
    page.once('dialog', (d) => d.accept());
    await page.locator('.modal input[type=file]').setInputFiles(f);
    const t = await page.locator('.toast').last().innerText({ timeout: 10000 }).catch(() => '(no toast)');
    await page.waitForTimeout(400);
    const hdr = await page.locator('main').innerText();
    console.log(require('path').basename(f), '→', t.replace(/\s+/g, ' '), '| header:', hdr.split('\n').filter((l) => /,|Latin|Müller|M.ller/.test(l)).slice(0, 4).join(' / '));
    await shot(page, 'open-' + require('path').basename(f));
    await page.locator('.toast').evaluateAll((els) => els.forEach((e) => e.remove())).catch(() => {});
  }
  console.log('errors', errors);
  await browser.close();
})();
