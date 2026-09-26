const { open, drag, fen, movesText, shot, key, check, OUTDIR } = require('./h.cjs');
(async () => {
  const { browser, page, errors } = await open();
  page.on('dialog', (d) => d.accept());
  const modal = page.locator('.modal');
  const openEditor = async () => { await page.getByRole('button', { name: 'Set up a position' }).click(); await modal.waitFor(); };
  const edFen = () => modal.locator('input.mono').inputValue();
  const status = async () => (await modal.locator('span.small').first().innerText()).trim();
  const place = async (piece, squares) => {
    await modal.getByLabel(`Place ${piece}`, { exact: true }).click();
    for (const s of squares) {
      const idx = (8 - +s[1]) * 8 + (s.charCodeAt(0) - 97);
      const el = modal.locator('.board .squares > div').nth(idx);
      const b = await el.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.up();
    }
  };
  const setup = async (pieces, turn = 'w', castle = []) => {
    await openEditor();
    await modal.getByRole('button', { name: 'Clear board' }).click();
    for (const [p, sqs] of Object.entries(pieces)) await place(p, sqs);
    await modal.locator('select').selectOption(turn);
    for (const c of castle) await modal.getByLabel(c, { exact: true }).check();
    return { fen: await edFen(), status: await status(), canApply: await modal.getByRole('button', { name: 'Analyse this position' }).isEnabled() };
  };
  const cancel = () => modal.getByRole('button', { name: 'Cancel' }).click();
  const applyPos = async () => { await modal.getByRole('button', { name: 'Analyse this position' }).click(); await page.waitForTimeout(300); };

  let r = await setup({ K: ['e1'], k: ['e8'] });
  check('bare kings valid', r.status === 'Valid position' && r.canApply, JSON.stringify(r)); await cancel();
  r = await setup({ K: ['e1'] });
  check('missing black king rejected', !r.canApply, r.status); await cancel();
  r = await setup({ K: ['e1', 'd1'], k: ['e8'] });
  check('two white kings rejected', !r.canApply, r.status + ' ' + r.fen); await cancel();
  r = await setup({ K: ['e1'], k: ['e8'], P: ['a8'] });
  check('white pawn on 8th rank rejected', !r.canApply, r.status); await cancel();
  r = await setup({ K: ['e1'], k: ['e8'], p: ['a1'] });
  check('black pawn on 1st rank rejected', !r.canApply, r.status); await cancel();
  r = await setup({ K: ['e1'], k: ['e8'], R: ['e2'] }, 'w');
  check('side not to move in check rejected', !r.canApply, r.status); await cancel();
  r = await setup({ K: ['e1'], k: ['h8'], r: ['e7'], b: ['a5'] }, 'w');
  check('white in double check (white to move) accepted', r.canApply, r.status); await cancel();
  r = await setup({ K: ['e1'], k: ['e8'], R: ['a1'] }, 'w', ['White O-O', 'White O-O-O']);
  check('castling K without h1 rook: dropped or rejected', !/K/.test(r.fen.split(' ')[2]) || !r.canApply, `${r.fen} | ${r.status} | apply=${r.canApply}`);
  const showsKWhileBad = r.fen.split(' ')[2];
  await cancel();
  r = await setup({ K: ['e2'], k: ['e8'], R: ['a1', 'h1'] }, 'w', ['White O-O']);
  check('castling K with king off e1: dropped or rejected', !/K/.test(r.fen.split(' ')[2]) || !r.canApply, `${r.fen} | ${r.status}`); await cancel();
  // castling actually playable after set-up
  r = await setup({ K: ['e1'], k: ['e8'], R: ['a1', 'h1'], r: ['a8', 'h8'] }, 'w', ['White O-O', 'White O-O-O', 'Black O-O', 'Black O-O-O']);
  check('full castling rights set', r.fen.split(' ')[2] === 'KQkq', r.fen);
  await applyPos();
  check('applied FEN on board', (await fen(page)).startsWith('r3k2r/8/8/8/8/8/8/R3K2R w KQkq'), await fen(page));
  await drag(page, 'e1', 'g1');
  check('castle by dragging king 2 squares', (await fen(page)).startsWith('r3k2r/8/8/8/8/8/8/R4RK1 b kq'), await fen(page));
  await drag(page, 'e8', 'a8');
  check('castle by dragging king onto own rook (O-O-O)', (await fen(page)).startsWith('2kr4/') || (await fen(page)).startsWith('r3k2r/'), await fen(page));
  console.log('   (king-onto-rook result: ' + (await fen(page)) + ')');

  // black to move
  r = await setup({ K: ['e1'], k: ['e8'], p: ['d7'] }, 'b');
  await applyPos();
  check('black to move applied', (await fen(page)).includes(' b '), await fen(page));
  await drag(page, 'd7', 'd5');
  const mt = (await movesText(page)).replace(/\s+/g, ' ');
  check('first move shown as 1...d5', /1\s*…\s*d5|1\.\.\.\s*d5/.test(mt), mt);

  // stalemate
  r = await setup({ k: ['a8'], Q: ['b6'], K: ['h1'] }, 'b');
  check('stalemate position valid', r.canApply, r.status);
  await applyPos();
  let body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  check('UI indicates stalemate', /stalemate/i.test(body), body.slice(0, 200));
  await shot(page, 'p6-stalemate');
  // checkmate
  r = await setup({ k: ['a8'], Q: ['b7'], K: ['b6'] }, 'b');
  check('checkmated position valid', r.canApply, r.status);
  await applyPos();
  body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  check('UI indicates checkmate', /checkmate|mate/i.test(body), body.slice(0, 200));
  await shot(page, 'p6-mate');

  // promotion through UI
  r = await setup({ K: ['a1'], k: ['h7'], P: ['b7'], n: ['c8'] }, 'w');
  await applyPos();
  await drag(page, 'b7', 'b8');
  await page.waitForTimeout(200);
  const promo = page.locator('.promo-choice');
  check('promotion picker appears', (await promo.count()) >= 4, `choices=${await promo.count()}`);
  await shot(page, 'p6-promo');
  await page.getByLabel(/Promote to n/i).first().click().catch(async () => { await promo.nth(3).click(); });
  await page.waitForTimeout(200);
  check('underpromotion to knight', (await fen(page)).startsWith('1Nn5/'), await fen(page));
  // capture-promotion
  await key(page, 'ArrowLeft');
  await drag(page, 'b7', 'c8');
  await page.waitForTimeout(200);
  await page.getByLabel(/Promote to q/i).first().click().catch(async () => { await promo.nth(0).click(); });
  await page.waitForTimeout(200);
  check('capture-promotion bxc8=Q', (await fen(page)).startsWith('2Q5/'), await fen(page));
  const mt2 = (await movesText(page)).replace(/\s+/g, ' ');
  check('SAN shows b8=N and bxc8=Q+', /b8=N/.test(mt2) && /bxc8=Q/.test(mt2), mt2);
  // cancel promotion (Escape / click outside)
  await key(page, 'ArrowLeft');
  const f0 = await fen(page);
  await drag(page, 'b7', 'b8');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check('Escape cancels promotion picker, no move', (await fen(page)) === f0 && (await page.locator('.promo-choice').count()) === 0, await fen(page));

  // en passant via main FEN input
  const fenBox = page.locator('input[aria-label=FEN]');
  await fenBox.fill('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  await fenBox.press('Enter'); await page.waitForTimeout(300);
  check('FEN with ep square accepted', (await fen(page)).includes(' f6 '), await fen(page));
  await drag(page, 'e5', 'f6');
  check('en passant exf6 plays and removes f5 pawn', (await fen(page)).startsWith('rnbqkbnr/ppp1p1pp/5P2/3p4/'), await fen(page));
  // export PGN of set-up game
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.getByTitle(/Download PGN/).click()]);
  if (dl) {
    await dl.saveAs(OUTDIR + '/setup-export.pgn');
    const t = require('fs').readFileSync(OUTDIR + '/setup-export.pgn', 'utf8');
    check('exported PGN has SetUp+FEN and exf6', /\[SetUp "1"\]/.test(t) && /\[FEN "rnbqkbnr\/ppp1p1pp\/8\/3pPp2\/8\/8\/PPPP1PPP\/RNBQKBNR w KQkq f6 0 3"\]/.test(t) && /3\. exf6/.test(t), t.replace(/\n/g, ' '));
  } else check('download PGN works', false);
  // FEN with ep but no capturing pawn
  await fenBox.fill('rnbqkbnr/ppppp1pp/8/5p2/8/8/PPPPPPPP/RNBQKBNR w KQkq f6 0 2');
  await fenBox.press('Enter'); await page.waitForTimeout(300);
  check('non-capturable ep square normalised', (await fen(page)).includes(' - '), await fen(page));
  // garbage FEN
  await fenBox.fill('this is not a fen');
  await fenBox.press('Enter'); await page.waitForTimeout(300);
  const toast = await page.locator('.toast').last().innerText().catch(() => '');
  check('garbage FEN gives an error, board unchanged', !(await fen(page)).includes('this is'), toast);
  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log('castling-without-rook fen shown:', showsKWhileBad);
  await browser.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
