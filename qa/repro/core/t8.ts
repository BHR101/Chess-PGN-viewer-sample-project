import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PgnSplitter, parsePgn, parseGame, writePgn } from './lib.ts';
const dir = fileURLToPath(new URL('../../../packages/core/test/fixtures/', import.meta.url));
function dump(n: any): string { let s = ''; for (const c of n.children) s += '(' + c.san + '|' + c.nags.join(',') + '|' + (c.comment ?? '').replace(/\s+/g,' ') + '|' + (c.startComment ?? '') + dump(c) + ')'; return s; }
for (const f of readdirSync(dir).filter(f => f.endsWith('.pgn'))) {
  const text = readFileSync(dir + f, 'utf8');
  const whole = parsePgn(text);
  const sp = new PgnSplitter(); const parts: string[] = [];
  for (let i = 0; i < text.length; i += 7) parts.push(...sp.push(text.slice(i, i + 7)));
  parts.push(...sp.finish());
  const split = parts.flatMap(p => parsePgn(p));
  let bad = 0, errs = 0;
  whole.forEach((g, i) => { errs += g.errors.length; const g2 = parseGame(writePgn(g)); if (dump(g.root) !== dump(g2.root) || (g.root.comment??'').replace(/\s+/g,' ') !== (g2.root.comment??'').replace(/\s+/g,' ') || JSON.stringify([...g.headers]) !== JSON.stringify([...g2.headers])) { bad++; if (bad < 3) console.log(f, 'rt mismatch game', i, '\n', dump(g.root).slice(0,300), '\n', dump(g2.root).slice(0,300)); } });
  console.log(f, 'games', whole.length, 'split', split.length, 'splitMatch', split.length === whole.length && split.every((g, i) => dump(g.root) === dump(whole[i].root)), 'rtBad', bad, 'errors', errs);
}
