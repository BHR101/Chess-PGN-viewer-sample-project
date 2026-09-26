/**
 * Notation panel: main line in two columns, variations and comments inline
 * (lichess-style). Right-click a move for tree operations.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type GameNode, NAG_SYMBOLS, writePgn, Game } from '@pgnx/core';
import { commentText, parseComment } from '../state/comments';
import { useGameStore } from '../state/gameStore';
import { toast } from './Toasts';

function clockOf(n: GameNode): string | undefined {
  return n.comment?.includes('[%clk') ? parseComment(n.comment).clock : undefined;
}

function nagText(nags: number[]) {
  return nags.map((n) => NAG_SYMBOLS[n] ?? `$${n}`).join('');
}

function moveNumber(node: GameNode, forceBlack: boolean): string | null {
  const white = node.ply % 2 === 1;
  const no = Math.floor((node.ply - 1) / 2) + 1;
  if (white) return `${no}.`;
  return forceBlack ? `${no}…` : null;
}

interface MenuState {
  node: GameNode;
  x: number;
  y: number;
}

type Handlers = {
  current: GameNode;
  select: (n: GameNode) => void;
  menu: (n: GameNode, e: React.MouseEvent) => void;
};

function InlineMove({ node, force, h }: { node: GameNode; force: boolean; h: Handlers }) {
  const num = moveNumber(node, force);
  return (
    <span
      className={`inline-move${node === h.current ? ' current' : ''}`}
      data-node={node.id}
      onClick={() => h.select(node)}
      onContextMenu={(e) => h.menu(node, e)}
    >
      {num && <span className="num">{num}</span>}
      {node.san}
      {node.nags.length > 0 && <span className="nag">{nagText(node.nags)}</span>}
    </span>
  );
}

/** A variation line starting at `start` (rendered inline, recursively). */
function Line({ start, h }: { start: GameNode; h: Handlers }) {
  const parts: ReactNode[] = [];
  const render = (n: GameNode, force: boolean) => {
    const sc = commentText(n.startComment);
    const c = commentText(n.comment);
    if (sc) parts.push(<span key={`sc${n.id}`} className="comment">{sc} </span>);
    parts.push(<InlineMove key={n.id} node={n} force={force || !!sc} h={h} />);
    if (c) parts.push(<span key={`c${n.id}`} className="comment"> {c}</span>);
    parts.push(' ');
  };
  render(start, true);
  let force = !!commentText(start.comment);
  let parent = start;
  while (parent.children.length) {
    const [main, ...alts] = parent.children;
    render(main, force);
    force = !!commentText(main.comment);
    for (const alt of alts) {
      parts.push(
        <div key={`v${alt.id}`} className="variation">
          <Line start={alt} h={h} />
        </div>,
      );
      force = true;
    }
    parent = main;
  }
  return <>{parts}</>;
}

function Mainline({ root, h }: { root: GameNode; h: Handlers }) {
  const rows: ReactNode[] = [];
  let parent = root;
  let open: { idx: string; white: ReactNode | null } | null = null;
  const cell = (n: GameNode) => (
    <div
      key={n.id}
      className={`cell${n === h.current ? ' current' : ''}`}
      data-node={n.id}
      onClick={() => h.select(n)}
      onContextMenu={(e) => h.menu(n, e)}
    >
      {n.san}
      {n.nags.length > 0 && <span className="nag">{nagText(n.nags)}</span>}
      {clockOf(n) && <span className="clock">{clockOf(n)}</span>}
    </div>
  );
  const emptyCell = (key: string, text = '…') => <div key={key} className="cell empty">{text}</div>;
  const flush = (black: ReactNode) => {
    if (!open) return;
    rows.push(
      <div key={`r${rows.length}`} className="row-move">
        <div className="idx">{open.idx}</div>
        {open.white ?? emptyCell(`ew${rows.length}`)}
        {black}
      </div>,
    );
    open = null;
  };
  while (parent.children.length) {
    const [main, ...alts] = parent.children;
    const white = main.ply % 2 === 1;
    const no = String(Math.floor((main.ply - 1) / 2) + 1);
    if (white) {
      open = { idx: no, white: cell(main) };
    } else {
      if (!open) open = { idx: no, white: null };
      flush(cell(main));
    }
    const mc = commentText(main.comment);
    const msc = commentText(main.startComment);
    const interrupt = !!mc || alts.length > 0 || !!msc;
    if (interrupt) {
      if (white) flush(emptyCell(`eb${main.id}`));
      rows.push(
        <div key={`i${main.id}`} className="interrupt">
          {msc && <span className="comment">{msc} </span>}
          {mc && <span className="comment">{mc}</span>}
          {alts.map((alt) => (
            <div key={alt.id} className="variation">
              <Line start={alt} h={h} />
            </div>
          ))}
        </div>,
      );
    }
    parent = main;
  }
  flush(open ? emptyCell('last', '') : null);
  return <>{rows}</>;
}

export function MoveTree() {
  const game = useGameStore((s) => s.game);
  const current = useGameStore((s) => s.node);
  const version = useGameStore((s) => s.version);
  const goTo = useGameStore((s) => s.goTo);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Keep the current move in view.
  useEffect(() => {
    const el = ref.current?.querySelector(`[data-node="${current.id}"]`) as HTMLElement | null;
    if (!el || !ref.current) return;
    const box = ref.current.closest('.panel-body') as HTMLElement | null;
    if (!box) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top + 30 || r.bottom > b.bottom - 30) box.scrollTop += r.top - b.top - b.height / 2;
  }, [current, version]);

  const h: Handlers = {
    current,
    select: goTo,
    menu: (node, e) => {
      e.preventDefault();
      setMenu({ node, x: e.clientX, y: e.clientY });
    },
  };

  const result = game.result;
  return (
    <div className="moves" ref={ref}>
      {commentText(game.root.comment) && <div className="root-comment">{commentText(game.root.comment)}</div>}
      {game.root.children.length === 0 ? (
        <div className="empty">
          <h3>No moves yet</h3>
          Play moves on the board, or open a game from the database.
        </div>
      ) : (
        <Mainline root={game.root} h={h} />
      )}
      {game.root.children.length > 0 && result !== '*' && <div className="result-row">{result}</div>}
      {menu && <MoveMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function MoveMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const { promote, makeMainline, deleteFrom, goTo } = useGameStore.getState();
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);
  const n = menu.node;
  const isMain = Game.isMainline(n);
  const act = (fn: () => void) => (e: React.PointerEvent) => {
    e.stopPropagation();
    fn();
    onClose();
  };
  const copyLine = () => {
    const g = new Game(Game.path(n)[0]?.parent?.fen);
    let cur = g.root;
    for (const step of Game.path(n)) cur = Game.addMove(cur, step.move);
    void navigator.clipboard.writeText(writePgn(g, { headers: false }).trim());
    toast('Line copied to clipboard');
  };
  return (
    <div className="ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 200) }} onPointerDown={(e) => e.stopPropagation()}>
      <button onPointerDown={act(() => goTo(n))}>Go to move</button>
      {!isMain && <button onPointerDown={act(() => promote(n))}>Promote variation</button>}
      {!isMain && <button onPointerDown={act(() => makeMainline(n))}>Make main line</button>}
      <button onPointerDown={act(copyLine)}>Copy line as PGN</button>
      <hr />
      <button className="danger" onPointerDown={act(() => deleteFrom(n))}>Delete from here</button>
    </div>
  );
}
