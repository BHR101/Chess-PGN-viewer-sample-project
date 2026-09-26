import { useMemo } from 'react';
import { FLAG_CASTLE, QUEEN, parseSquare } from '@pgnx/core';
import { type Arrow, Board } from '../board/Board';
import { formatScore, winningChances } from '../engine/engine';
import { useEngineState } from '../engine/useEngine';
import { positionOf, useGameStore } from '../state/gameStore';
import { useSettings } from '../state/settings';
import { useExplorerHover } from './explorerHover';

export function EvalBar({ flipped }: { flipped: boolean }) {
  const analysis = useEngineState((s) => s.analysis);
  const on = useSettings((s) => s.engineOn);
  const best = analysis?.lines[0];
  const wc = best ? winningChances(best.score) : 0;
  const whiteShare = on && best ? (1 + wc) / 2 : 0.5;
  const label = best ? formatScore(best.score).replace('+', '') : '';
  return (
    <div className={`eval-bar${flipped ? ' flipped' : ''}`} title={on && best ? `Evaluation ${formatScore(best.score)}` : 'Engine off'}>
      <div className="fill" style={{ height: `${whiteShare * 100}%` }} />
      <div className="mid" />
      {on && best && (
        <div
          className="label"
          style={
            (wc >= 0) !== flipped
              ? { bottom: 3, color: '#333' }
              : { top: 3, color: '#ddd' }
          }
        >
          {label}
        </div>
      )}
    </div>
  );
}

export function BoardArea() {
  const node = useGameStore((s) => s.node);
  useGameStore((s) => s.version);
  const playMove = useGameStore((s) => s.playMove);
  const forward = useGameStore((s) => s.forward);
  const back = useGameStore((s) => s.back);
  const settings = useSettings();
  const analysis = useEngineState((s) => s.analysis);
  const hover = useExplorerHover((s) => s.uci);

  const pos = positionOf(node);
  const { dests, legal } = useMemo(() => {
    const moves = pos.legalMoves();
    const d = new Map<number, number[]>();
    for (const m of moves) {
      const from = m & 63;
      const to = (m >> 6) & 63;
      if (!d.has(from)) d.set(from, []);
      if (!d.get(from)!.includes(to)) d.get(from)!.push(to);
      // Castling can also be done by dropping the king on the rook.
      if (m & FLAG_CASTLE) {
        const rookSq = to > from ? from + 3 : from - 4;
        if (!d.get(from)!.includes(rookSq)) d.get(from)!.push(rookSq);
      }
    }
    return { dests: d, legal: moves };
  }, [pos]);

  const lastMove: [number, number] | null = node.move ? [node.move & 63, (node.move >> 6) & 63] : null;
  const check = pos.inCheck() ? pos.kings[pos.turn] : null;

  const arrows: Arrow[] = [];
  if (hover) {
    arrows.push({ from: parseSquare(hover.slice(0, 2)), to: parseSquare(hover.slice(2, 4)), color: '#2f6fdb', opacity: 0.75 });
  }
  if (settings.engineOn && analysis && analysis.fen === node.fen) {
    analysis.lines.forEach((l, i) => {
      if (!l.uci[0]) return;
      const u = l.uci[0];
      arrows.push({
        from: parseSquare(u.slice(0, 2)),
        to: parseSquare(u.slice(2, 4)),
        color: '#15781b',
        opacity: i === 0 ? 0.8 : 0.35,
        width: i === 0 ? 1 : 0.7,
      });
    });
  }

  const onMove = (from: number, to: number, promo?: number) => {
    const m = legal.find((c) => {
      if ((c & 63) !== from) return false;
      const cto = (c >> 6) & 63;
      const rookSq = c & FLAG_CASTLE ? (cto > from ? from + 3 : from - 4) : -1;
      if (cto !== to && rookSq !== to) return false;
      const cp = (c >> 12) & 7;
      return cp === (promo ?? (cp ? QUEEN : 0));
    });
    if (m !== undefined) playMove(m);
  };

  const flipped = settings.orientation === 'black';
  return (
    <div className="board-wrap">
      <EvalBar flipped={flipped} />
      <Board
        fen={node.fen}
        orientation={settings.orientation}
        lastMove={lastMove}
        check={check}
        dests={dests}
        onMove={onMove}
        arrows={arrows}
        showCoordinates={settings.showCoordinates}
        showDests={settings.showLegalMoves}
        animation={settings.animation}
        theme={settings.boardTheme}
        onWheel={(d) => (d > 0 ? forward() : back())}
      />
    </div>
  );
}
