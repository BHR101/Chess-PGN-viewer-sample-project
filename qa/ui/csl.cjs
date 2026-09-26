const { open, key, shot } = require('./h.cjs');
(async () => {
  const { browser, page } = await open('/#/game/805');
  await page.waitForTimeout(500);
  for (let i = 1; i <= 5; i++) {
    await key(page, 'ArrowRight');
    const svg = await page.locator('[aria-label=Chessboard] svg.arrows').innerHTML().catch(() => '');
    console.log(i, 'circles', (svg.match(/<circle/g) || []).length, 'lines', (svg.match(/<line/g) || []).length, 'paths/polys', (svg.match(/<(path|polygon)/g) || []).length, 'rects', (svg.match(/<rect/g) || []).length, 'sq-highlights', await page.locator('[aria-label=Chessboard] .squares > div[class*=mark], [aria-label=Chessboard] .squares > div[style*=background]').count());
    if (i === 2) await shot(page, 'csl-ply2');
  }
  await browser.close();
})();
