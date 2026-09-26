// Open games by id in the analysis view, walk every main-line move with ArrowRight, dump FENs + UI text.
const { open, fen, movesText, shot, key, OUTDIR } = require('./h.cjs');
const fs = require('fs');
const ids = process.argv.slice(2).map(Number);
(async () => {
  const { browser, page, errors } = await open();
  const out = {};
  for (const id of ids) {
    await page.evaluate((id) => { location.hash = `#/game/${id}`; }, id);
    await page.waitForTimeout(500);
    await page.locator('body').click({ position: { x: 2, y: 895 } }).catch(() => {});
    await key(page, 'Home');
    const fens = [await fen(page)];
    for (let i = 0; i < 1000; i++) {
      await page.keyboard.press('ArrowRight');
      const f = await fen(page);
      if (f === fens[fens.length - 1]) break;
      fens.push(f);
    }
    const header = (await page.locator('.panel, aside, main').first().innerText().catch(() => '')).slice(0, 0);
    const html = await page.locator('.moves').innerHTML().catch(() => '');
    out[id] = {
      fens,
      moves: (await movesText(page)).replace(/\s+/g, ' ').slice(0, 1500),
      comments: await page.locator('.moves .comment, .moves .root-comment').allInnerTexts(),
      nags: await page.locator('.moves .nag').allInnerTexts(),
      clocks: await page.locator('.moves .clock').allInnerTexts(),
      variations: await page.locator('.moves .variation').count(),
      arrows: await page.locator('[aria-label=Chessboard] svg.arrows line, [aria-label=Chessboard] svg.arrows path, [aria-label=Chessboard] svg.arrows polygon').count(),
      circles: await page.locator('[aria-label=Chessboard] svg.arrows circle').count(),
    };
    if (process.env.SHOT) await shot(page, `game-${id}`);
  }
  out.errors = errors;
  fs.writeFileSync(OUTDIR + '/walk.json', JSON.stringify(out, null, 1));
  console.log('walked', ids.length, 'errors', errors.length, errors.slice(0, 5));
  await browser.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
