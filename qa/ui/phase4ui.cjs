const { open, drag, shot, key, check, fen } = require('./h.cjs');

const orders = {
  'QGD A': [['d2', 'd4'], ['d7', 'd5'], ['c2', 'c4'], ['e7', 'e6'], ['b1', 'c3'], ['g8', 'f6']],
  'QGD B': [['c2', 'c4'], ['e7', 'e6'], ['b1', 'c3'], ['d7', 'd5'], ['d2', 'd4'], ['g8', 'f6']],
  'Najdorf A': [['e2', 'e4'], ['c7', 'c5'], ['g1', 'f3'], ['d7', 'd6'], ['d2', 'd4'], ['c5', 'd4'], ['f3', 'd4'], ['g8', 'f6'], ['b1', 'c3'], ['a7', 'a6']],
  'Najdorf B': [['g1', 'f3'], ['c7', 'c5'], ['e2', 'e4'], ['d7', 'd6'], ['d2', 'd4'], ['c5', 'd4'], ['f3', 'd4'], ['g8', 'f6'], ['b1', 'c3'], ['a7', 'a6']],
};
(async () => {
  const { browser, page, errors } = await open();
  page.on('dialog', (d) => d.accept());
  const explorerText = async () => {
    await page.getByRole('button', { name: 'Explorer', exact: true }).click();
    await page.waitForTimeout(1200);
    return (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  };
  const newGame = async () => { await page.getByTitle('New game').click(); await page.waitForTimeout(300); };
  await newGame();
  let t = await explorerText();
  console.log('START:', t.slice(t.indexOf('Explorer'), t.indexOf('Explorer') + 400));
  await shot(page, 'p4-explorer-start');
  const totals = {};
  for (const [name, mvs] of Object.entries(orders)) {
    await newGame();
    for (const [a, b] of mvs) await drag(page, a, b);
    t = await explorerText();
    const m = t.match(/([\d,]+)\s+games/);
    totals[name] = m && m[1];
    console.log(name, '→', await fen(page), '|', t.slice(t.indexOf('Explorer'), t.indexOf('Explorer') + 260));
    await shot(page, 'p4-' + name.replace(' ', '_'));
  }
  check('UI explorer: QGD transposition same count', totals['QGD A'] && totals['QGD A'] === totals['QGD B'], JSON.stringify(totals));
  check('UI explorer: Najdorf transposition same count', totals['Najdorf A'] && totals['Najdorf A'] === totals['Najdorf B'], JSON.stringify(totals));
  // click a move in the explorer plays it
  await newGame();
  await page.getByRole('button', { name: 'Explorer', exact: true }).click(); await page.waitForTimeout(1000);
  const row = page.locator('text=/^e4$/').first();
  if (await row.count()) { await row.click(); await page.waitForTimeout(800); }
  check('clicking explorer move e4 plays it', (await fen(page)).startsWith('rnbqkbnr/pppppppp/8/8/4P3/'), await fen(page));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
