const { open, drag, click, fen, movesText, shot, key, check, sq } = require('./h.cjs');
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
(async () => {
  const { browser, page, errors } = await open();
  // fresh game
  await page.getByTitle('New game').click().catch(() => {});
  await page.waitForTimeout(300);
  const dlg = page.locator('.modal button', { hasText: /discard|new|ok|yes/i });
  if (await dlg.count()) await dlg.first().click();
  await page.waitForTimeout(200);
  check('board loads with 32 pieces', (await page.locator('[aria-label=Chessboard] .piece').count()) === 32);
  check('start FEN', (await fen(page)) === START, await fen(page));

  await drag(page, 'e2', 'e4');
  check('drag e2-e4', (await fen(page)).startsWith('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b'), await fen(page));
  await click(page, 'e7', 'e5');
  check('click e7 then e5', (await fen(page)).startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3/'), await fen(page));
  const before = await fen(page);
  await drag(page, 'e1', 'e3');
  check('illegal drag Ke1-e3 rejected', (await fen(page)) === before);
  await click(page, 'g1', 'g4');
  check('illegal click Ng1-g4 rejected', (await fen(page)) === before);
  // drag off the board
  const p = await sq(page, 'g1');
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 900, p.y, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(200);
  check('drag off-board leaves position unchanged', (await fen(page)) === before);
  check('piece count still 32 after off-board drag', (await page.locator('[aria-label=Chessboard] .piece').count()) === 32);
  // click own piece then another own piece switches selection
  await click(page, 'g1'); await click(page, 'b1'); await click(page, 'c3');
  check('reselect b1 after g1, then Nc3', (await fen(page)).includes('/2N5/'), await fen(page));
  await drag(page, 'b8', 'c6');
  await drag(page, 'g1', 'f3');
  check('moves list shows 1.e4 e5 2.Nc3 Nc6 3.Nf3', /e4[\s\S]*e5[\s\S]*Nc3[\s\S]*Nc6[\s\S]*Nf3/.test(await movesText(page)), (await movesText(page)).replace(/\s+/g, ' '));

  // navigation buttons
  await page.getByTitle('Start (Home)').click();
  check('Start button', (await fen(page)) === START);
  await page.getByTitle('Forward (→)').click(); await page.getByTitle('Forward (→)').click();
  check('Forward x2', (await fen(page)).startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/'), await fen(page));
  await page.getByTitle('End (End)').click();
  check('End button', (await fen(page)).includes('2n5/4p3/4P3/2N2N2'), await fen(page));
  await page.getByTitle('Back (←)').click();
  check('Back button', (await fen(page)).includes('/4P3/2N5/') && (await fen(page)).includes(' w '), await fen(page));
  // keyboard
  await page.locator('body').click({ position: { x: 5, y: 890 } }).catch(() => {});
  await key(page, 'Home');
  check('Home key', (await fen(page)) === START);
  await key(page, 'ArrowRight', 3);
  check('ArrowRight x3', (await fen(page)).includes('/2N5/') && (await fen(page)).includes(' b '), await fen(page));
  await key(page, 'ArrowLeft');
  check('ArrowLeft', (await fen(page)).startsWith('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/'));
  await key(page, 'End');
  check('End key', (await fen(page)).includes('2N2N2'));
  // keyboard while FEN input focused should not navigate
  await page.locator('input[aria-label=FEN]').focus();
  const f0 = await fen(page);
  await key(page, 'ArrowLeft');
  check('ArrowLeft inside FEN input does not navigate', (await fen(page)) === f0);
  await page.locator('input[aria-label=FEN]').blur();

  // variation: go to after 1...e5 and play 2.Nf3 (differs from 2.Nc3)
  await key(page, 'Home'); await key(page, 'ArrowRight', 2);
  await drag(page, 'g1', 'f3');
  const mt = await movesText(page);
  check('variation created (2.Nf3 alongside 2.Nc3)', /Nc3/.test(mt) && /Nf3/.test(mt) && (await page.locator('.moves .variation').count()) > 0, mt.replace(/\s+/g, ' '));
  // replaying an existing move should not duplicate
  await key(page, 'ArrowLeft');
  await drag(page, 'b1', 'c3');
  const cnt = (await movesText(page)).match(/Nc3/g)?.length;
  check('replaying existing move 2.Nc3 does not duplicate it', cnt === 1, `Nc3 occurrences: ${cnt}`);
  // Up/Down switch variations
  await key(page, 'ArrowLeft');
  await key(page, 'ArrowRight');
  const a = await fen(page);
  await key(page, 'ArrowDown');
  const b = await fen(page);
  await key(page, 'ArrowUp');
  const c = await fen(page);
  check('ArrowDown/Up switch between 2.Nc3 and 2.Nf3', a !== b && a === c, `${a} | ${b} | ${c}`);
  // context menu
  await key(page, 'ArrowDown');
  const cur = page.locator('.moves .current');
  await cur.click({ button: 'right' });
  const menu = page.locator('.ctx-menu');
  check('right-click move opens context menu', await menu.isVisible());
  await shot(page, 'p1-ctxmenu');
  const pm = menu.getByText('Make main line');
  if (await pm.count()) {
    await pm.dispatchEvent('pointerdown');
    await page.waitForTimeout(200);
    const t = (await movesText(page)).replace(/\s+/g, ' ');
    check('Make main line puts Nf3 first', t.indexOf('Nf3') < t.indexOf('Nc3'), t);
  } else check('Make main line option present', false);
  // delete from here
  await page.locator('.moves .current').click({ button: 'right' });
  await page.locator('.ctx-menu').getByText('Delete from here').dispatchEvent('pointerdown');
  await page.waitForTimeout(200);
  const t2 = (await movesText(page)).replace(/\s+/g, ' ');
  check('Delete from here removes 2.Nf3', !/Nf3/.test(t2) || t2.indexOf('Nf3') > t2.indexOf('Nc3'), t2);
  // undo
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
  const t3 = (await movesText(page)).replace(/\s+/g, ' ');
  check('Ctrl+Z undo restores deleted line (no undo implemented: known FAIL)', t3 !== t2, t3);

  // wheel
  await key(page, 'End');
  const e0 = await fen(page);
  const bb = await page.locator('[aria-label=Chessboard]').boundingBox();
  await page.mouse.move(bb.x + 100, bb.y + 100);
  await page.mouse.wheel(0, -120); await page.waitForTimeout(150);
  check('mouse wheel up steps back', (await fen(page)) !== e0);

  // flip
  await page.getByTitle('Flip board (F)').click(); await page.waitForTimeout(100);
  const r1 = await page.locator('[aria-label=Chessboard] .coord.rank').first().textContent();
  check('flip button flips (top rank label = 1)', r1 === '1', r1);
  const fs = await sq(page, 'e2');
  await shot(page, 'p1-flipped');
  await key(page, 'f');
  const r2 = await page.locator('[aria-label=Chessboard] .coord.rank').first().textContent();
  check('F key flips back', r2 === '8', r2);
  // move on flipped board
  await key(page, 'f'); await key(page, 'End');
  const fb = await fen(page);
  const side = fb.split(' ')[1];
  if (side === 'w') await drag(page, 'd2', 'd4'); else await drag(page, 'd7', 'd6');
  check('can move on flipped board', (await fen(page)) !== fb, await fen(page));
  await key(page, 'f');

  // theme
  const themeBtn = page.locator('button[title^="Theme:"]');
  const themes = [];
  for (let i = 0; i < 3; i++) {
    await themeBtn.click(); await page.waitForTimeout(150);
    themes.push([await themeBtn.getAttribute('title'), await page.evaluate(() => document.documentElement.dataset.theme), await page.evaluate(() => getComputedStyle(document.body).backgroundColor)]);
    await shot(page, 'p1-theme-' + i);
  }
  check('theme cycles light → dark → system', themes[0][1] === 'light' && themes[1][1] === 'dark', JSON.stringify(themes));
  check('light & dark backgrounds differ', themes[0][2] !== themes[1][2]);
  // persisted?
  await themeBtn.click(); // -> light
  await page.reload(); await page.waitForSelector('[aria-label=Chessboard] .piece');
  check('theme persists across reload', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  const gameAfterReload = (await movesText(page)).replace(/\s+/g, ' ');
  check('game survives reload (no autosave, beforeunload warns: known FAIL)', /e4/.test(gameAfterReload), gameAfterReload);
  await themeBtn.click(); await themeBtn.click(); // back to system

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
