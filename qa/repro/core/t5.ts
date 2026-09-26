import { parseGame, Position, encodeMoves, decodeMoves, openingOfPosition, classifyFens } from './lib.ts';
const cg = parseGame('[SetUp "1"]\n[FEN "r3k2r/1P5p/8/2pP4/8/8/8/R3K2R w KQkq c6 0 1"]\n\n1. dxc6 O-O 2. bxa8=N h5 3. O-O-O h4 4. c7 h3 5. c8=B -- 6. -- Rf1 7. Rxf1+ *');
console.log('codec game', cg.mainline().map(n=>n.san).join(' '), cg.errors);
const ms = cg.mainline().map(n => n.move);
console.log('codec rt', JSON.stringify(decodeMoves(encodeMoves(ms), Position.fromFen(cg.startFen))) === JSON.stringify(ms));
for (const pg of ['1. Nf3 d5 2. d4 *', '1. d4 d5 2. Nf3 *', '1. e4 c5 2. Nf3 d6 3. d4 *', '1. Nf3 c5 2. e4 d6 3. d4 *']) {
  const g = parseGame(pg); console.log(pg, '=>', classifyFens(g.mainline().map(n => n.fen))?.name);
}
