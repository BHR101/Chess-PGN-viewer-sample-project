import { parsePgn, parseGame, writePgn, Position, Game, encodeMoves, decodeMoves, perft } from './lib.ts';
const P = (f: string) => Position.fromFen(f);
function trySan(fen: string, sans: string[]) {
  const p = P(fen);
  for (const s of sans) {
    const m = p.parseSan(s);
    console.log(fen.split(' ')[0].slice(0,20), s, '->', m < 0 ? 'ILLEGAL' : p.san(m) + ' ' + p.uci(m));
  }
}
// promotions
trySan('8/4P3/8/8/8/8/8/k6K w - - 0 1', ['e8=Q', 'e8Q', 'e8=N', 'e8', 'e8q', 'e7e8q', 'e8=K', 'e8=P']);
trySan('3r4/4P3/8/8/8/8/8/k6K w - - 0 1', ['exd8=N+', 'exd8N', 'exd8=R', 'ed8=Q', 'e7d8b']);
// castling
trySan('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['O-O', '0-0', 'O-O-O', '0-0-0', 'e1g1', 'e1c1', 'OO', 'Kg1']);
trySan('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1', ['O-O', 'O-O-O']);
// through check: black rook on f8 attacks f1
trySan('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1', ['O-O', 'O-O-O']);
// queenside b1 attacked ok, d1 attacked not ok
trySan('1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1', ['O-O-O']);
trySan('3rk3/8/8/8/8/8/8/R3K2R w KQ - 0 1', ['O-O-O']);
// in check
trySan('4k3/8/8/8/8/8/8/R3K2r w Q - 0 1', ['O-O-O']);
// ep legal
trySan('4k3/8/8/2pP4/8/8/8/4K3 w - c6 0 2', ['dxc6', 'dxc6e.p.', 'd5c6']);
// pinned ep: white K a5, P b5, black p c5 (just pushed), rook h5
trySan('4k3/8/8/KPp4r/8/8/8/8 w - c6 0 2', ['bxc6']);
console.log('pinned ep fen:', P('4k3/8/8/KPp4r/8/8/8/8 w - c6 0 2').fen());
// mate / stalemate
const fool = P('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
console.log('fool mate', fool.isCheckmate(), fool.isStalemate());
const st = P('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
console.log('stalemate', st.isCheckmate(), st.isStalemate());
// disambiguation: 3 queens

trySan('2k5/8/8/8/4Q2Q/8/K7/7Q w - - 0 1', ['Qh4e1', 'Qe1', 'Q4e1', 'Qhe1','Qee1','Q1e1']);
{ const p = P('2k5/8/8/8/4Q2Q/8/K7/7Q w - - 0 1'); for (const m of p.legalMoves()) { const s = p.san(m); if (s.includes('e1')||s.includes('d4')) console.log('gen', s, p.parseSan(s) === m); } }
trySan('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', ['Ngf3']);
trySan('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['Ngf3', 'Nf3+', 'Nf3#', 'Nf3!?', 'Nf3+!', 'Ng1f3', 'Ng1-f3', 'g1f3', 'Ne2', 'Pe4', 'e2e4', 'e2-e4']);
// bxc4 ambiguity: white pawn b3, bishop on f1? bishop e2 can take c4; pawn b3 can take c4
trySan('4k3/8/8/8/2p5/1P6/4B3/4K3 w - - 0 1', ['bxc4', 'Bxc4', 'bc4']);
trySan('4k3/8/8/8/2p5/8/4B3/4K3 w - - 0 1', ['bxc4']);
// null moves
trySan('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['--', 'Z0', '0000']);
// perft
const kiwi = P('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
console.log('kiwi perft3', perft(kiwi, 3), 'exp 97862');
console.log('pos3 perft4', perft(P('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), 4), 'exp 43238');
console.log('pos4 perft3', perft(P('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'), 3), 'exp 9467');
console.log('pos5 perft3', perft(P('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8'), 3), 'exp 62379');
