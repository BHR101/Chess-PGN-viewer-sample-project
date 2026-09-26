import { Position, START_FEN } from './position.js';
import { ChessError, NULL_MOVE, moveToUci } from './types.js';

/** A node in the move tree. The root node has no move and holds the start position. */
export interface GameNode {
  id: number;
  /** Encoded move leading to this node (0 for the root). */
  move: number;
  san: string;
  uci: string;
  /** Position after the move. */
  fen: string;
  /** Ply index of the position after the move (root = ply of the start position). */
  ply: number;
  parent: GameNode | null;
  /** children[0] is the main continuation, the rest are variations. */
  children: GameNode[];
  /** Comment written after the move (for the root: comment before the first move). */
  comment?: string;
  /** Comment written before the move (only meaningful at the start of a variation). */
  startComment?: string;
  nags: number[];
}

export type Headers = Map<string, string>;

export const SEVEN_TAG_ROSTER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];

/** Default value of a Seven Tag Roster header. */
export function defaultTag(name: string): string {
  return name === 'Result' ? '*' : name === 'Date' ? '????.??.??' : '?';
}

let nodeIdCounter = 1;

export function newNode(parent: GameNode | null, move: number, san: string, fen: string, ply: number): GameNode {
  return { id: nodeIdCounter++, move, san, uci: move ? moveToUci(move) : parent ? '0000' : '', fen, ply, parent, children: [], nags: [] };
}

/** Ply number for a FEN: 0 for white to move at move 1, 1 for black to move at move 1, ... */
export function plyFromFen(fen: string): number {
  const parts = fen.split(/\s+/);
  const full = parseInt(parts[5] ?? '1', 10) || 1;
  return (full - 1) * 2 + (parts[1] === 'b' ? 1 : 0);
}

/** A game: headers plus a tree of moves with comments, NAGs and variations. */
export class Game {
  headers: Headers = new Map();
  root: GameNode;
  /** Parse problems that were tolerated (illegal moves truncate the line). */
  errors: string[] = [];

  constructor(startFen: string = START_FEN) {
    const pos = Position.fromFen(startFen);
    const fen = pos.fen();
    this.root = newNode(null, 0, '', fen, plyFromFen(fen));
    for (const t of SEVEN_TAG_ROSTER) this.headers.set(t, defaultTag(t));
    if (fen !== START_FEN) {
      this.headers.set('SetUp', '1');
      this.headers.set('FEN', fen);
    }
  }

  get startFen(): string {
    return this.root.fen;
  }

  get result(): string {
    return this.headers.get('Result') ?? '*';
  }

  header(name: string): string | undefined {
    return this.headers.get(name);
  }

  /** Nodes along the main line, excluding the root. */
  mainline(): GameNode[] {
    const res: GameNode[] = [];
    let n = this.root;
    while (n.children.length) {
      n = n.children[0];
      res.push(n);
    }
    return res;
  }

  /** The last node of the main line. */
  end(): GameNode {
    let n = this.root;
    while (n.children.length) n = n.children[0];
    return n;
  }

  findNode(id: number): GameNode | undefined {
    const stack = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.id === id) return n;
      for (const c of n.children) stack.push(c);
    }
    return undefined;
  }

  /** Position at a node (fresh object). */
  static positionAt(node: GameNode): Position {
    return Position.fromFen(node.fen);
  }

  /**
   * Play `move` (encoded, legal in the node's position) after `node`. If that
   * move already exists as a child, returns the existing child; otherwise a
   * new variation (or main continuation if none exists) is appended.
   */
  static addMove(node: GameNode, move: number, pos?: Position): GameNode {
    for (const c of node.children) if (c.move === move) return c;
    const p = pos ?? Position.fromFen(node.fen);
    const san = p.san(move);
    p.play(move);
    const child = newNode(node, move, san, p.fen(), node.ply + 1);
    node.children.push(child);
    return child;
  }

  static addSan(node: GameNode, san: string): GameNode {
    const p = Position.fromFen(node.fen);
    const m = p.parseSan(san);
    if (m < 0) throw new ChessError(`Illegal move ${san} at ${node.fen}`);
    return Game.addMove(node, m, p);
  }

  /** Is `node` on the main line of the game? */
  static isMainline(node: GameNode): boolean {
    let n: GameNode | null = node;
    while (n && n.parent) {
      if (n.parent.children[0] !== n) return false;
      n = n.parent;
    }
    return true;
  }

  /** Move the variation containing `node` one step up (towards being the main line). */
  static promoteVariation(node: GameNode): void {
    let n: GameNode = node;
    while (n.parent && n.parent.children[0] === n) n = n.parent;
    const parent = n.parent;
    if (!parent) return;
    const i = parent.children.indexOf(n);
    [parent.children[i - 1], parent.children[i]] = [parent.children[i], parent.children[i - 1]];
  }

  /** Make the line through `node` the main line all the way up. */
  static makeMainline(node: GameNode): void {
    let n: GameNode = node;
    while (n.parent) {
      const parent = n.parent;
      const i = parent.children.indexOf(n);
      if (i > 0) {
        parent.children.splice(i, 1);
        parent.children.unshift(n);
      }
      n = parent;
    }
  }

  /** Remove `node` and everything after it. Returns the parent. */
  static deleteNode(node: GameNode): GameNode | null {
    const parent = node.parent;
    if (!parent) return null;
    parent.children = parent.children.filter((c) => c !== node);
    return parent;
  }

  /** Path of nodes from the root (exclusive) to `node` (inclusive). */
  static path(node: GameNode): GameNode[] {
    const res: GameNode[] = [];
    let n: GameNode | null = node;
    while (n && n.parent) {
      res.push(n);
      n = n.parent;
    }
    return res.reverse();
  }

  /** Count of all move nodes in the tree. */
  countNodes(): number {
    let count = 0;
    const stack = [...this.root.children];
    while (stack.length) {
      const n = stack.pop()!;
      count++;
      for (const c of n.children) stack.push(c);
    }
    return count;
  }

  /** Create a game from a start FEN and a list of SAN or UCI moves. */
  static fromMoves(moves: string[], startFen: string = START_FEN): Game {
    const g = new Game(startFen);
    let node = g.root;
    const pos = Position.fromFen(startFen);
    for (const mv of moves) {
      let m = pos.parseSan(mv);
      if (m < 0) m = pos.parseUci(mv);
      if (m < 0) throw new ChessError(`Illegal move ${mv} at ${pos.fen()}`);
      node = Game.addMove(node, m, pos.clone());
      pos.play(m);
    }
    return g;
  }
}

export { NULL_MOVE };
