import { parsePgn, parseGame, writePgn, Position, Game } from './lib.ts';
function dump(n: any, d = 0): string {
  let s = '';
  for (const c of n.children) {
    s += ' '.repeat(d) + c.san + (c.nags.length ? ' nags=' + c.nags.join(',') : '') + (c.comment ? ' {' + c.comment + '}' : '') + (c.startComment ? ' pre{' + c.startComment + '}' : '') + '\n';
    s += dump(c, d + 2);
  }
  return s;
}
function rt(label: string, pgn: string) {
  const gs = parsePgn(pgn);
  console.log('=== ' + label + ' games=' + gs.length);
  for (const g of gs) {
    const out = writePgn(g);
    const g2 = parseGame(out);
    const a = (g.root.comment ?? '') + '\n' + dump(g.root), b = (g2.root.comment ?? '') + '\n' + dump(g2.root);
    const ha = JSON.stringify([...g.headers]), hb = JSON.stringify([...g2.headers]);
    if (g.errors.length) console.log('errors:', g.errors);
    if (a !== b || ha !== hb) { console.log('ROUNDTRIP MISMATCH\n--orig\n' + a + ha + '\n--re\n' + b + hb + '\n--written\n' + out); }
    else console.log(out.split('\n\n').slice(1).join('\n\n').trim());
  }
}
rt('nested3', '1. e4 e5 (1... c5 2. Nf3 (2. Nc3 Nc6 (2... e6 3. g3 (3. f4))) 2... d6) 2. Nf3 *');
rt('var first move', '1. e4 (1. d4 d5) (1. c4) (1. Nf3 {x}) 1... e5 *');
rt('var after comment', '1. e4 {good} (1. d4 {also}) e5 *');
rt('comment parens', '1. e4 {a (b) c} e5 *');
rt('semicolon', '1. e4 ; foo {bar} baz\n e5 *');
rt('percent', '% escape line\n1. e4\n% another (1. d4)\ne5 *');
rt('movelike comment', '1. e4 {1. e4 e5 2. Nf3} e5 *');
rt('pre-first comment', '{Intro} 1. e4 e5 *');
rt('after result', '1. e4 e5 1-0 {post}');
rt('empty comment', '1. e4 {} e5 {  } *');
rt('nags', '1. e4! e5? 2. Nf3!! Nc6?? 3. Bb5!? a6?! 4. Ba4 $1 $14 $255 *');
rt('nag before first', '$1 1. e4 *');
rt('clk', '1. e4 {[%clk 1:23:45]} e5 {[%cal Ge2e4,Rd7d5] [%csl Ge4]} 2. Nf3 {[%eval 0.23] [%emt 0:00:05]} *');
rt('tags', '[Event "a \\"q\\" b"]\n[Site "C:\\x"]\n[White ""]\n[White "dup"]\n\n1. e4 *');
rt('no moves', '[Event "x"]\n[Result "1-0"]\n\n1-0');
rt('only result', '*');
rt('mismatch', '[Result "1-0"]\n\n1. e4 0-1');
rt('fen black', '[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 23"]\n\n23... e5 24. Nf3 *');
rt('fen invalid', '[SetUp "1"]\n[FEN "garbage"]\n\n1. e4 *');
rt('shredder', '[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w HAha - 0 1"]\n\n1. e4 *');
rt('960', '[SetUp "1"]\n[FEN "bqnbrkrn/pppppppp/8/8/8/8/PPPPPPPP/BQNBRKRN w GEge - 0 1"]\n\n1. e4 *');
