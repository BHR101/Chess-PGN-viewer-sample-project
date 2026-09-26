import { parsePgn, parseGame, writePgn, Position, Game, encodeMoves, decodeMoves, scanPgn, PgnSplitter, classifyFens, openingOfPosition, formatMainline } from './lib.ts';
// illegal move mid-game, continue with next game
const gs = parsePgn('[Event "g1"]\n\n1. e4 e5 2. Ke3 Nc6 (2... d6) 3. Nf3 1-0\n\n[Event "g2"]\n\n1. d4 d5 *\n');
for (const g of gs) console.log(g.headers.get('Event'), g.mainline().map(n => n.san).join(' '), g.errors);
// CRLF + BOM + latin1-ish
const crlf = '﻿[Event "x"]\r\n[White "René"]\r\n\r\n1. e4 {c\r\nd} e5\r\n2. Nf3 *\r\n';
const g = parseGame(crlf); console.log(JSON.stringify([...g.headers]), g.mainline().map(n=>n.san+'|'+(n.comment??'')).join(' '));
// raw latin1 decoded bytes
const buf = Buffer.from('[White "Ren\xe9"]\n\n1. e4 *\n', 'latin1');
console.log('latin1 as utf8:', parseGame(buf.toString('utf8')).headers.get('White'));
// long game: knights shuffling 600 plies
const moves: string[] = [];
for (let i = 0; i < 150; i++) moves.push('Nf3', 'Nf6', 'Ng1', 'Ng8');
let t = Date.now();
let pgn = moves.map((m, i) => (i % 2 === 0 ? `${i/2+1}. ` : '') + m).join(' ') + ' *';
const lg = parseGame(pgn); console.log('long plies', lg.mainline().length, 'ms', Date.now()-t);
t = Date.now(); const w = writePgn(lg); console.log('write ms', Date.now()-t, parseGame(w).mainline().length);
// 5000 plies
const big: string[] = []; for (let i = 0; i < 1250; i++) big.push('Nf3', 'Nf6', 'Ng1', 'Ng8');
t = Date.now(); const bg = parseGame(big.map((m,i)=>(i%2===0?`${i/2+1}. `:'')+m).join(' ')+' *'); console.log('5000 plies ms', Date.now()-t, bg.mainline().length);
// deep nesting 2000
let nest = '1. e4 e5 '; for (let i = 0; i < 3000; i++) nest += '(1... c5 '; nest += ')'.repeat(3000) + ' *';
try { t = Date.now(); const ng = parseGame(nest); console.log('nest parse ms', Date.now()-t, ng.countNodes()); writePgn(ng); console.log('nest write ok'); } catch (e) { console.log('nest err', (e as Error).message); }
// codec
const cg = parseGame('[SetUp "1"]\n[FEN "r3k2r/1P6/8/2pP4/8/8/8/R3K2R w KQkq c6 0 1"]\n\n1. dxc6 O-O-O 2. bxc8=N Kxc8 3. O-O Kc7 4. c7 --  5. c8=R+ *');
console.log('codec game', cg.mainline().map(n=>n.san).join(' '), cg.errors);
const ms = cg.mainline().map(n => n.move);
const dec = decodeMoves(encodeMoves(ms), Position.fromFen(cg.startFen));
console.log('codec rt', JSON.stringify(dec) === JSON.stringify(ms));
// openings transposition
const a = parseGame('1. d4 Nf6 2. c4 e6 *'); const b = parseGame('1. c4 e6 2. d4 Nf6 *');
console.log(classifyFens(a.mainline().map(n=>n.fen)), classifyFens(b.mainline().map(n=>n.fen)));
const c = parseGame('1. e4 e5 2. Nf3 Nc6 3. Bb5 *'); console.log(classifyFens(c.mainline().map(n=>n.fen)));
// incremental hash vs fen roundtrip hash (pinned ep)
const p = Position.fromFen('4k3/8/8/KP5r/8/8/2p5/8 b - - 0 1');
const p2 = Position.fromFen('4k3/2p5/8/KP5r/8/8/8/8 b - - 0 1'); p2.playSan('c5');
console.log('inc hash', p2.hashHex(), 'fromFen(fen()) hash', Position.fromFen(p2.fen()).hashHex(), p2.fen());
// splitter & scan
const sp = new PgnSplitter(); const parts = [...sp.push('[E "1"]\n\n1. e4 {[not a tag]\n[x]} *\n[E "2"]\n\n1. d4 *\n'), ...sp.finish()]; console.log('split', parts.length);
console.log(JSON.stringify(scanPgn('[E "1"]\n1. e4 (1. d4) e5 *')));
