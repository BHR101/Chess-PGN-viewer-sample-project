import { Position } from './position.js';

/** Count leaf nodes of the legal move tree to the given depth (move generator validation). */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const buf = new Int32Array(256);
  const n = pos.generatePseudo(buf);
  const us = pos.turn;
  let nodes = 0;
  for (let i = 0; i < n; i++) {
    pos.play(buf[i]);
    if (!pos.isAttacked(pos.kings[us], us ^ 1)) nodes += depth === 1 ? 1 : perft(pos, depth - 1);
    pos.undo();
  }
  return nodes;
}
