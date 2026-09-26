const { open, BASE } = require('./h.cjs');
(async () => {
  const { browser, page } = await open();
  page.on('request', (r) => { if (r.url().includes('/api/')) console.log(new Date().toISOString().slice(11, 19), '→', decodeURIComponent(r.url().replace(BASE, ''))); });
  page.on('response', (r) => { if (r.url().includes('/api/')) console.log(new Date().toISOString().slice(11, 19), '←', r.status(), decodeURIComponent(r.url().replace(BASE, '')).slice(0, 90)); });
  const fenBox = page.locator('input[aria-label=FEN]');
  await fenBox.fill('rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6'); await fenBox.press('Enter'); await page.waitForTimeout(300);
  await page.getByTitle('Find games with this position').click();
  await page.waitForTimeout(15000);
  console.log((await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 120));
  await browser.close();
})();
