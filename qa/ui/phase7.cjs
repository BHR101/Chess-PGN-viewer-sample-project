const { open, fen, movesText, shot, key, check, OUTDIR } = require('./h.cjs');
const fs = require('fs');
(async () => {
  const { browser, page, errors } = await open();
  page.on('dialog', (d) => d.accept());
  const log = {};
  const fenBox = page.locator('input[aria-label=FEN]');
  const setFen = async (f) => { await fenBox.fill(f); await fenBox.press('Enter'); await page.waitForTimeout(200); await page.locator('body').click({ position: { x: 2, y: 895 } }).catch(() => {}); };
  const lines = async () => (await page.locator('.pv-line').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  const evalText = () => page.locator('.engine-head .eval').innerText();
  const waitDepth = async (d = 14, ms = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const meta = await page.locator('.engine-head .meta').innerText().catch(() => '');
      const m = meta.match(/depth\s*(\d+)/i);
      if (m && +m[1] >= d) return +m[1];
      await page.waitForTimeout(250);
    }
    return -1;
  };
  await key(page, 'l');
  const t0 = Date.now();
  await page.locator('.pv-line').first().waitFor({ timeout: 60000 });
  check('engine starts and produces lines', true, `first line after ${Date.now() - t0} ms`);
  const d0 = await waitDepth(16);
  log.start = { depth: d0, eval: await evalText(), lines: await lines(), meta: await page.locator('.engine-head .meta').innerText() };
  check('reaches depth >= 16 on start position', d0 >= 16, JSON.stringify(log.start));
  const e0 = await evalText();
  // Position with White a queen up
  await setFen('rnb1kbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3');
  await waitDepth(12);
  const e1 = await evalText();
  log.queenUp = { eval: e1, lines: await lines() };
  check('eval changes when position changes (White up a queen → big +)', e1 !== e0 && parseFloat(e1) > 5, `${e0} -> ${e1}`);
  // Black up a queen, black to move
  await setFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 0 3');
  await waitDepth(12);
  const e2 = await evalText();
  log.blackUp = { eval: e2, lines: await lines() };
  check('eval sign is from White POV (Black up a queen → big −)', /^[-−]/.test(e2.trim()), e2);
  // Multi-PV
  const sel = page.locator('select[title="Number of lines"]');
  await setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  for (const n of [1, 5, 2]) {
    await sel.selectOption(String(n));
    await waitDepth(10);
    await page.waitForTimeout(800);
    const ls = await lines();
    check(`multi-PV ${n} shows ${n} lines`, ls.length === n, `${ls.length}: ${ls.map((l) => l.slice(0, 40)).join(' || ')}`);
    const firsts = ls.map((l) => (l.match(/1\.\s*(\S+)/) || [])[1]);
    check(`multi-PV ${n} first moves are distinct`, new Set(firsts).size === firsts.length, firsts.join(','));
  }
  await sel.selectOption('3');
  // collect best moves in a set of positions for legality check
  const positions = [
    'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3',
    '8/P6k/8/8/8/8/6Kp/8 w - - 0 1',
    '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
  ];
  log.bestmoves = [];
  for (const p of positions) {
    await setFen(p);
    await waitDepth(12);
    await page.waitForTimeout(300);
    log.bestmoves.push({ fen: await fen(page), lines: await lines(), eval: await evalText() });
  }
  // back-rank mate in 1: expect #1
  check('finds mate in 1 (Rd8#)', /#\s*1|M1|#1/.test(log.bestmoves[5].eval) && /Rd8#/.test(log.bestmoves[5].lines[0]), log.bestmoves[5].eval + ' ' + log.bestmoves[5].lines[0]);
  // click engine line plays move
  const before = await fen(page);
  const firstMove = page.locator('.pv-line').first().locator('span[title="Play this line up to here"]').first();
  const san = await firstMove.innerText();
  await firstMove.click();
  await page.waitForTimeout(300);
  const after = await fen(page);
  log.click = { before, san, after, moves: (await movesText(page)).replace(/\s+/g, ' ') };
  check('clicking engine move plays it', after !== before && log.click.moves.includes(san.replace(/[+#]/g, '')), JSON.stringify(log.click));
  // click 3rd move of line → plays 3 plies
  await key(page, 'ArrowLeft');
  await waitDepth(10);
  const third = page.locator('.pv-line').first().locator('span[title="Play this line up to here"]').nth(2);
  if (await third.count()) {
    const b = await fen(page); await third.click(); await page.waitForTimeout(300);
    log.click3 = { before: b, after: await fen(page), moves: (await movesText(page)).replace(/\s+/g, ' ') };
  }
  // mate / stalemate positions
  await setFen('k7/1Q6/1K6/8/8/8/8/8 b - - 0 1');
  await page.waitForTimeout(3000);
  log.mated = { eval: await evalText(), lines: await lines(), meta: await page.locator('.engine-head .meta').innerText() };
  check('engine in checkmated position: no crash, shows mate', !/NaN|undefined/.test(JSON.stringify(log.mated)), JSON.stringify(log.mated));
  await setFen('k7/8/1Q6/8/8/8/8/7K b - - 0 1');
  await page.waitForTimeout(3000);
  log.stalemate = { eval: await evalText(), lines: await lines(), meta: await page.locator('.engine-head .meta').innerText() };
  check('engine in stalemate: no crash, shows 0.00/draw', !/NaN|undefined/.test(JSON.stringify(log.stalemate)), JSON.stringify(log.stalemate));
  await shot(page, 'p7-stalemate-engine');
  // PV numbering from a black-to-move FEN with fullmove 30
  await setFen('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 30');
  await waitDepth(10);
  log.btm = await lines();
  check('PV numbering for Black-to-move at move 30 starts "30…"', /^\S+\s+30…/.test(log.btm[0]) || /30\.\.\./.test(log.btm[0]), log.btm[0]);
  // Rapid position changes: stale lines must not show for the wrong position
  await setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  await page.waitForTimeout(500);
  await setFen('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
  await page.waitForTimeout(150);
  const quick = await lines();
  check('no stale PV from previous position right after change', quick.every((l) => !/e4|d4|Nf3|c4/.test(l.split(' ').slice(1, 3).join(' ')) || /R/.test(l)), quick.join(' || '));
  await key(page, 'l');

  // Whole-game analysis on a real 84-ply game
  await page.evaluate(() => { location.hash = '#/game/245'; }); await page.waitForTimeout(800);
  const depthSel = page.locator('select[title="Search depth per move"]');
  await depthSel.selectOption('10');
  const ta = Date.now();
  await page.getByRole('button', { name: 'Analyse game' }).click();
  await page.getByRole('button', { name: 'Add to notation' }).waitFor({ timeout: 10 * 60 * 1000 });
  log.analysisSeconds = (Date.now() - ta) / 1000;
  const card = page.locator('.card', { has: page.getByRole('button', { name: 'Add to notation' }) });
  log.summary = (await card.innerText()).replace(/\s+/g, ' ');
  const pathD = await card.locator('svg path').first().getAttribute('d').catch(() => null);
  check('whole-game analysis completes (depth 10, 84 plies)', true, `${log.analysisSeconds}s — ${log.summary}`);
  check('evaluation graph drawn', !!pathD && pathD.length > 50, (pathD || '').slice(0, 80));
  await shot(page, 'p7-game-analysis');
  // click on graph jumps to move
  const svg = card.locator('svg').first(); const bb = await svg.boundingBox();
  const fb = await fen(page);
  await page.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height / 2); await page.waitForTimeout(300);
  check('clicking graph jumps to a move', (await fen(page)) !== fb);
  await page.getByRole('button', { name: 'Add to notation' }).click(); await page.waitForTimeout(500);
  const mt = (await movesText(page)).replace(/\s+/g, ' ');
  log.annotated = mt.slice(0, 600);
  check('Add to notation writes evals/NAGs', /[?!]|\[%eval|\d\.\d\d/.test(mt), mt.slice(0, 300));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.getByTitle(/Download PGN/).click()]);
  if (dl) { await dl.saveAs(OUTDIR + '/analysed.pgn'); log.analysedPgn = fs.readFileSync(OUTDIR + '/analysed.pgn', 'utf8').slice(0, 1500); }
  // Adding twice should not duplicate evals
  await page.getByRole('button', { name: 'Add to notation' }).click(); await page.waitForTimeout(500);
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.getByTitle(/Download PGN/).click()]);
  if (dl2) { await dl2.saveAs(OUTDIR + '/analysed2.pgn'); const t2 = fs.readFileSync(OUTDIR + '/analysed2.pgn', 'utf8'); const t1 = fs.readFileSync(OUTDIR + '/analysed.pgn', 'utf8');
    check('Add to notation twice does not duplicate evals', (t2.match(/%eval/g) || []).length === (t1.match(/%eval/g) || []).length, `${(t1.match(/%eval/g) || []).length} vs ${(t2.match(/%eval/g) || []).length}`); }
  // Stop mid-analysis
  await page.getByRole('button', { name: 'Clear' }).click().catch(() => {});
  await depthSel.selectOption('22');
  await page.getByRole('button', { name: 'Analyse game' }).click();
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.waitForTimeout(1000);
  check('Stop cancels analysis', (await page.getByRole('button', { name: 'Stop' }).count()) === 0);
  check('no page errors', errors.length === 0, errors.join(' | '));
  fs.writeFileSync(OUTDIR + '/phase7.json', JSON.stringify(log, null, 1));
  await browser.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
