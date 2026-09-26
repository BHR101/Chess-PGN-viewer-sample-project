import { PgnSplitter } from '../../packages/core/src/pgn.ts';
const s = new PgnSplitter();
const out = [...s.push('[White "a"]\n\n1. d4 d5 *\n\n1. e4 c5 2. Nf3 d6 *\n\n1. c4 e5 1-0\n'), ...s.finish()];
console.log(out.length, JSON.stringify(out));
