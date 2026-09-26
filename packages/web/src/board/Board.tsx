/**
 * Interactive chessboard: click-to-move and drag-and-drop with legal move
 * hints, promotion picker, move animation, last-move/check highlights,
 * engine/explorer arrows and user-drawn shapes (right-click / right-drag).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PIECE_IMAGES } from './pieces';
import './board.css';

export interface Arrow {
  from: number;
  to: number;
  color: string;
  /** 0..1 */
  opacity?: number;
  /** Relative width, 1 = default. */
  width?: number;
}

export interface BoardProps {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: [number, number] | null;
  check?: number | null;
  /** Legal destinations per origin square; omit to make the board read-only. */
  dests?: Map<number, number[]> | null;
  /** Side allowed to move pieces (defaults to side to move in fen). */
  onMove?: (from: number, to: number, promotion?: number) => void;
  arrows?: Arrow[];
  /** Circled squares (e.g. from [%csl] comment commands). */
  circles?: Array<{ sq: number; color: string }>;
  showCoordinates?: boolean;
  showDests?: boolean;
  animation?: boolean;
  theme?: string;
  onWheel?: (direction: 1 | -1) => void;
  className?: string;
}

interface PieceItem {
  id: number;
  sq: number;
  piece: string; // e.g. "wN"
}

const FILES = 'abcdefgh';

export function parseBoard(fen: string): (string | null)[] {
  const board: (string | null)[] = new Array(64).fill(null);
  const rows = fen.split(' ')[0].split('/');
  for (let i = 0; i < 8 && i < rows.length; i++) {
    let f = 0;
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '8') f += +ch;
      else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        board[(7 - i) * 8 + f] = color + ch.toUpperCase();
        f++;
      }
    }
  }
  return board;
}

let pieceIdCounter = 1;

/** Match pieces between two boards so moved pieces keep their identity (for animation). */
export function diffPieces(prev: PieceItem[], board: (string | null)[]): PieceItem[] {
  const result: PieceItem[] = [];
  const unmatchedNew: Array<{ sq: number; piece: string }> = [];
  const prevBySq = new Map(prev.map((p) => [p.sq, p]));
  const used = new Set<number>();
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (!piece) continue;
    const old = prevBySq.get(sq);
    if (old && old.piece === piece) {
      result.push(old);
      used.add(old.id);
    } else unmatchedNew.push({ sq, piece });
  }
  const vanished = prev.filter((p) => !used.has(p.id));
  for (const n of unmatchedNew) {
    let best: PieceItem | null = null;
    let bestDist = Infinity;
    for (const v of vanished) {
      if (v.piece !== n.piece || used.has(v.id)) continue;
      const d = Math.abs((v.sq & 7) - (n.sq & 7)) + Math.abs((v.sq >> 3) - (n.sq >> 3));
      if (d < bestDist) {
        bestDist = d;
        best = v;
      }
    }
    if (best) {
      used.add(best.id);
      result.push({ id: best.id, sq: n.sq, piece: n.piece });
    } else {
      result.push({ id: pieceIdCounter++, sq: n.sq, piece: n.piece });
    }
  }
  return result;
}

interface DragState {
  from: number;
  pointerId: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

interface Shape {
  from: number;
  to: number;
}

export function Board(props: BoardProps) {
  const {
    fen, orientation, lastMove, check, dests, onMove, arrows = [], circles: markCircles = [], showCoordinates = true, showDests = true,
    animation = true, theme = 'brown', onWheel, className,
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const board = useMemo(() => parseBoard(fen), [fen]);
  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const [pieces, setPieces] = useState<PieceItem[]>(() => diffPieces([], board));
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [promotion, setPromotion] = useState<{ from: number; to: number } | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [drawing, setDrawing] = useState<{ from: number; to: number } | null>(null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    setPieces((prev) => diffPieces(prev, board));
    setAnimate(animation);
    setSelected(null);
    setPromotion(null);
    setShapes([]);
  }, [board, animation]);

  const flip = orientation === 'black';
  const sqToXY = useCallback((sq: number) => {
    const f = sq & 7;
    const r = sq >> 3;
    return flip ? { x: 7 - f, y: r } : { x: f, y: 7 - r };
  }, [flip]);

  const squareAt = useCallback((clientX: number, clientY: number): number | null => {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const y = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return flip ? y * 8 + (7 - x) : (7 - y) * 8 + x;
  }, [flip]);

  const canMoveFrom = (sq: number) => !!dests?.get(sq)?.length;

  const tryMove = (from: number, to: number) => {
    if (!dests?.get(from)?.includes(to)) return false;
    const piece = board[from];
    const toRank = to >> 3;
    if (piece && piece[1] === 'P' && (toRank === 7 || toRank === 0)) {
      setPromotion({ from, to });
      return true;
    }
    setSelected(null);
    // Skip the slide animation for dragged pieces (they are already there).
    onMove?.(from, to);
    return true;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) {
      const sq = squareAt(e.clientX, e.clientY);
      if (sq !== null) setDrawing({ from: sq, to: sq });
      return;
    }
    if (e.button !== 0) return;
    setShapes([]);
    if (promotion) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (sq === null) return;
    if (selected !== null && selected !== sq && dests?.get(selected)?.includes(sq)) {
      setAnimate(animation);
      tryMove(selected, sq);
      return;
    }
    if (canMoveFrom(sq)) {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const rect = ref.current!.getBoundingClientRect();
      setSelected(sq);
      setDrag({
        from: sq,
        pointerId: e.pointerId,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      });
      e.preventDefault();
    } else {
      setSelected(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (drawing) {
      const sq = squareAt(e.clientX, e.clientY);
      if (sq !== null && sq !== drawing.to) setDrawing({ ...drawing, to: sq });
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    const rect = ref.current!.getBoundingClientRect();
    const moved = drag.moved || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4;
    setDrag({ ...drag, x: e.clientX - rect.left, y: e.clientY - rect.top, moved });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drawing && e.button === 2) {
      const { from, to } = drawing;
      setDrawing(null);
      setShapes((prev) => {
        const i = prev.findIndex((s) => s.from === from && s.to === to);
        return i >= 0 ? prev.filter((_, k) => k !== i) : [...prev, { from, to }];
      });
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    const sq = squareAt(e.clientX, e.clientY);
    const from = drag.from;
    setDrag(null);
    if (drag.moved) {
      setAnimate(false);
      if (sq !== null && sq !== from && tryMove(from, sq)) return;
      // Dropped off a legal square: keep the piece selected for click-to-move.
    }
  };

  useEffect(() => {
    if (!promotion) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPromotion(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [promotion]);

  const wheelRef = useRef(0);
  const handleWheel = (e: React.WheelEvent) => {
    if (!onWheel) return;
    const now = Date.now();
    if (now - wheelRef.current < 60) return;
    wheelRef.current = now;
    onWheel(e.deltaY > 0 ? 1 : -1);
  };

  const selectedDests = selected !== null ? dests?.get(selected) ?? [] : [];
  const squares = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const sq = flip ? y * 8 + (7 - x) : (7 - y) * 8 + x;
      const light = ((sq >> 3) + (sq & 7)) % 2 === 1;
      const classes = ['sq', light ? 'light' : 'dark'];
      if (lastMove && (lastMove[0] === sq || lastMove[1] === sq)) classes.push('last');
      if (selected === sq) classes.push('selected');
      if (check === sq) classes.push('check');
      const isDest = showDests && selectedDests.includes(sq);
      if (isDest) classes.push(board[sq] ? 'dest-capture' : 'dest');
      squares.push(
        <div key={sq} className={classes.join(' ')}>
          {showCoordinates && x === 0 && <span className="coord rank">{(sq >> 3) + 1}</span>}
          {showCoordinates && y === 7 && <span className="coord file">{FILES[sq & 7]}</span>}
        </div>,
      );
    }
  }

  const allArrows: Arrow[] = [
    ...arrows,
    ...shapes.filter((s) => s.from !== s.to).map((s) => ({ from: s.from, to: s.to, color: 'var(--shape-color)', opacity: 0.8 })),
    ...(drawing && drawing.from !== drawing.to ? [{ from: drawing.from, to: drawing.to, color: 'var(--shape-color)', opacity: 0.6 }] : []),
  ];
  const circles = [
    ...markCircles,
    ...shapes.filter((s) => s.from === s.to).map((s) => ({ sq: s.from, color: 'var(--shape-color)' })),
    ...(drawing && drawing.from === drawing.to ? [{ sq: drawing.from, color: 'var(--shape-color)' }] : []),
  ];

  return (
    <div
      ref={ref}
      className={`board theme-${theme} ${className ?? ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        setDrag(null);
        setDrawing(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={handleWheel}
      role="grid"
      aria-label="Chessboard"
    >
      <div className="squares">{squares}</div>
      <div className="pieces">
        {pieces.map((p) => {
          const { x, y } = sqToXY(p.sq);
          const dragging = drag && drag.moved && drag.from === p.sq;
          const style: React.CSSProperties = dragging
            ? {
                transform: `translate(calc(${drag.x}px - 50%), calc(${drag.y}px - 50%))`,
                backgroundImage: `url("${PIECE_IMAGES[p.piece]}")`,
                zIndex: 10,
                transition: 'none',
                cursor: 'grabbing',
              }
            : {
                transform: `translate(${x * 100}%, ${y * 100}%)`,
                backgroundImage: `url("${PIECE_IMAGES[p.piece]}")`,
                transition: animate ? undefined : 'none',
              };
          const movable = !!dests && p.piece[0] === turn && canMoveFrom(p.sq);
          return <div key={p.id} className={`piece${movable ? ' movable' : ''}${dragging ? ' dragging' : ''}`} style={style} />;
        })}
      </div>
      {(allArrows.length > 0 || circles.length > 0) && (
        <svg className="arrows" viewBox="0 0 8 8">
          {circles.map((c, i) => {
            const { x, y } = sqToXY(c.sq);
            return <circle key={`c${i}`} cx={x + 0.5} cy={y + 0.5} r={0.45} fill="none" stroke={c.color} strokeWidth={0.07} opacity={0.8} />;
          })}
          {allArrows.map((a, i) => {
            const f = sqToXY(a.from);
            const t = sqToXY(a.to);
            const x1 = f.x + 0.5;
            const y1 = f.y + 0.5;
            const x2 = t.x + 0.5;
            const y2 = t.y + 0.5;
            const len = Math.hypot(x2 - x1, y2 - y1);
            const w = 0.15 * (a.width ?? 1);
            const head = 0.32 * Math.max(0.8, a.width ?? 1);
            const ux = (x2 - x1) / len;
            const uy = (y2 - y1) / len;
            const ex = x2 - ux * head;
            const ey = y2 - uy * head;
            const sx = x1 + ux * 0.2;
            const sy = y1 + uy * 0.2;
            const px = -uy;
            const py = ux;
            return (
              <g key={i} opacity={a.opacity ?? 0.85}>
                <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={a.color} strokeWidth={w} strokeLinecap="round" />
                <polygon
                  points={`${x2},${y2} ${ex + (px * head) / 1.6},${ey + (py * head) / 1.6} ${ex - (px * head) / 1.6},${ey - (py * head) / 1.6}`}
                  fill={a.color}
                />
              </g>
            );
          })}
        </svg>
      )}
      {promotion && (
        <div className="promotion" onPointerDown={(e) => {
          e.stopPropagation();
          setPromotion(null);
        }}>
          {(['Q', 'N', 'R', 'B'] as const).map((t, i) => {
            const { x } = sqToXY(promotion.to);
            const toTop = sqToXY(promotion.to).y === 0;
            const y = toTop ? i : 7 - i;
            const color = board[promotion.from]![0];
            return (
              <button
                key={t}
                className="promo-choice"
                style={{ left: `${x * 12.5}%`, top: `${y * 12.5}%`, backgroundImage: `url("${PIECE_IMAGES[color + t]}")` }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const { from, to } = promotion;
                  setPromotion(null);
                  setSelected(null);
                  onMove?.(from, to, { Q: 5, R: 4, B: 3, N: 2 }[t]);
                }}
                aria-label={`Promote to ${t}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
