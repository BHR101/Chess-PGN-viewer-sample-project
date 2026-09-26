/**
 * The game being viewed/edited on the analysis board. The move tree is a
 * mutable core `Game`; `version` is bumped on every change so React
 * components re-render.
 */
import { create } from 'zustand';
import { Game, type GameNode, Position, START_FEN, parsePgn, writePgn } from '@pgnx/core';

export interface GameState {
  game: Game;
  node: GameNode;
  version: number;
  /** Database id when the game was loaded from (or saved to) the database. */
  gameId: number | null;
  dirty: boolean;
  /** Other games from a pasted/opened PGN (for quick switching). */
  collection: Game[];

  loadGame(game: Game, opts?: { gameId?: number | null; ply?: number; collection?: Game[] }): void;
  loadPgn(pgn: string, opts?: { gameId?: number | null; ply?: number }): number;
  newGame(fen?: string): void;
  goTo(node: GameNode): void;
  forward(): void;
  back(): void;
  toStart(): void;
  toEnd(): void;
  /** Jump to the sibling variation above/below the current node. */
  switchVariation(delta: number): void;
  playMove(move: number): void;
  playUci(uci: string): boolean;
  playLine(ucis: string[]): void;
  deleteFrom(node: GameNode): void;
  promote(node: GameNode): void;
  makeMainline(node: GameNode): void;
  setComment(node: GameNode, text: string): void;
  toggleNag(node: GameNode, nag: number): void;
  setHeaders(headers: Array<[string, string]>): void;
  markSaved(id: number): void;
  /** Signal an in-place change to the tree made outside the store actions. */
  markChanged(): void;
  toPgn(): string;
}

function nodeAtPly(game: Game, ply: number): GameNode {
  let n = game.root;
  while (n.children.length && n.ply < ply) n = n.children[0];
  return n;
}

// Mutually exclusive move-annotation NAGs ($1-$6) and position evaluations ($10-$19).
const MOVE_NAGS = [1, 2, 3, 4, 5, 6];
const EVAL_NAGS = [10, 13, 14, 15, 16, 17, 18, 19];

export const useGameStore = create<GameState>((set, get) => {
  const touch = (patch: Partial<GameState> = {}, dirty = true) =>
    set((s) => ({ ...patch, version: s.version + 1, dirty: dirty || s.dirty }));

  const initial = new Game();
  return {
    game: initial,
    node: initial.root,
    version: 0,
    gameId: null,
    dirty: false,
    collection: [],

    loadGame(game, opts = {}) {
      const node = opts.ply !== undefined ? nodeAtPly(game, opts.ply) : game.root;
      set((s) => ({
        game,
        node,
        gameId: opts.gameId ?? null,
        dirty: false,
        version: s.version + 1,
        collection: opts.collection ?? s.collection,
      }));
    },

    loadPgn(pgn, opts = {}) {
      const games = parsePgn(pgn);
      if (!games.length) throw new Error('No game found in the PGN text');
      get().loadGame(games[0], { ...opts, collection: games.length > 1 ? games : [] });
      return games.length;
    },

    newGame(fen = START_FEN) {
      const g = new Game(Position.fromFen(fen).fen());
      set((s) => ({ game: g, node: g.root, gameId: null, dirty: false, version: s.version + 1, collection: [] }));
    },

    goTo(node) {
      set({ node });
    },
    forward() {
      const n = get().node;
      if (n.children.length) set({ node: n.children[0] });
    },
    back() {
      const n = get().node;
      if (n.parent) set({ node: n.parent });
    },
    toStart() {
      set({ node: get().game.root });
    },
    toEnd() {
      let n = get().node;
      while (n.children.length) n = n.children[0];
      set({ node: n });
    },
    switchVariation(delta) {
      const n = get().node;
      if (!n.parent) return;
      const sib = n.parent.children;
      const i = sib.indexOf(n) + delta;
      if (i >= 0 && i < sib.length) set({ node: sib[i] });
    },

    playMove(move) {
      const { node } = get();
      const existing = node.children.find((c) => c.move === move);
      if (existing) {
        set({ node: existing });
        return;
      }
      const child = Game.addMove(node, move);
      touch({ node: child });
    },

    playUci(uci) {
      const pos = Position.fromFen(get().node.fen);
      const m = pos.parseUci(uci);
      if (m < 0) return false;
      get().playMove(m);
      return true;
    },

    playLine(ucis) {
      for (const u of ucis) if (!get().playUci(u)) break;
    },

    deleteFrom(node) {
      const parent = Game.deleteNode(node);
      if (!parent) return;
      // If the current node was inside the deleted subtree, move to the parent.
      let cur: GameNode | null = get().node;
      let inside = false;
      while (cur) {
        if (cur === node) inside = true;
        cur = cur.parent;
      }
      touch(inside ? { node: parent } : {});
    },

    promote(node) {
      Game.promoteVariation(node);
      touch();
    },
    makeMainline(node) {
      Game.makeMainline(node);
      touch();
    },
    setComment(node, text) {
      node.comment = text.trim() || undefined;
      touch();
    },
    toggleNag(node, nag) {
      if (node.nags.includes(nag)) node.nags = node.nags.filter((n) => n !== nag);
      else {
        const group = MOVE_NAGS.includes(nag) ? MOVE_NAGS : EVAL_NAGS.includes(nag) ? EVAL_NAGS : [];
        node.nags = [...node.nags.filter((n) => !group.includes(n)), nag].sort((a, b) => a - b);
      }
      touch();
    },
    setHeaders(headers) {
      const g = get().game;
      const fen = g.headers.get('FEN');
      const setup = g.headers.get('SetUp');
      g.headers = new Map(headers.filter(([k]) => k.trim()));
      // The start position is part of the move tree and cannot be edited here.
      if (fen) {
        g.headers.set('SetUp', setup ?? '1');
        g.headers.set('FEN', fen);
      }
      touch();
    },
    markChanged() {
      touch();
    },
    markSaved(id) {
      set((s) => ({ gameId: id, dirty: false, version: s.version + 1 }));
    },
    toPgn() {
      return writePgn(get().game);
    },
  };
});

/** The position at the current node (memoised per node). */
const posCache = new WeakMap<GameNode, Position>();
export function positionOf(node: GameNode): Position {
  let p = posCache.get(node);
  if (!p) {
    p = Position.fromFen(node.fen);
    posCache.set(node, p);
  }
  return p;
}
