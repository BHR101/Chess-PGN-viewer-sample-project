import { parsePgn, parseGame, writePgn } from './lib.ts';
for (const t of ['[White "abc\\"]\n[Black "x"]\n\n1. e4 *', '[White "a \\"q\\" b"]\n\n*', '[Event "a\nb"]\n\n1. e4 *', '[White "x" ]\n[Black"y"]\n[Round  "3"  ]\n*']) {
  const g = parseGame(t); console.log(JSON.stringify([...g.headers]), g.mainline().length);
  console.log(writePgn(g).split('\n\n')[0]);
}
