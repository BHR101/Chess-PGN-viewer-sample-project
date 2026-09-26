const { open, fen, movesText, key, FIXTURES } = require('./h.cjs');
(async () => {
  const { browser, page } = await open();
  page.on('dialog', (d) => d.accept());
  await page.getByTitle('Open or paste PGN / FEN').click();
  await page.locator('.modal input[type=file]').setInputFiles(FIXTURES + '/badfen.pgn');
  await page.waitForTimeout(800);
  const toast = await page.locator('.toast').allInnerTexts();
  await key(page, 'End');
  console.log('toast:', toast.join(' | '), '\nmoves:', (await movesText(page)).replace(/\s+/g, ' '), '\nFEN:', await fen(page));
  await browser.close();
})();
