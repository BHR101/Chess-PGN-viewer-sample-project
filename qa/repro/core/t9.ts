import { parseGame, writePgn } from './lib.ts';
const g = parseGame('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/4K2R w X - 0 1"]\n\n1. e4 e5 2. Nf3 *');
console.log(g.errors, g.startFen, g.mainline().map(n => n.san).join(' ')); console.log(writePgn(g));
const c = parseGame('1. e4 {' + 'x'.repeat(66) + ' [%eval 0.23]} *'); const w = writePgn(c, {headers:false}); console.log(JSON.stringify(w), JSON.stringify(parseGame(w).root.children[0].comment));
