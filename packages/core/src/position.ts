import {
  BISHOP, BLACK, CASTLE_BK, CASTLE_BQ, CASTLE_WK, CASTLE_WQ, ChessError, Color, FILES,
  FLAG_CASTLE, FLAG_DOUBLE, FLAG_EP, KING, KNIGHT, NULL_MOVE, PAWN, PIECE_CHARS, QUEEN, ROOK,
  SAN_PIECE, WHITE, makeMove, moveToUci, parseSquare, squareName,
} from './types.js';
import { CASTLE_MASK, KING_TARGETS, KNIGHT_TARGETS, RAYS } from './tables.js';
import {
  CASTLE_HI, CASTLE_LO, EP_HI, EP_LO, PIECE_HI, PIECE_LO, TURN_HI, TURN_LO, hashToBigInt, hashToHex,
  hashToNumber,
} from './zobrist.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const UNDO_SIZE = 8;
const PROMO_TYPES = [QUEEN, ROOK, BISHOP, KNIGHT];

/**
 * A chess position with fast make/unmake, legal move generation, SAN
 * parsing/formatting and incremental Polyglot-compatible Zobrist hashing.
 */
export class Position {
  board = new Int8Array(64);
  turn: Color = WHITE;
  /** Castling rights bitmask (CASTLE_WK | CASTLE_WQ | CASTLE_BK | CASTLE_BQ). */
  castling = 0;
  /** En passant target square after a double pawn push, or -1. */
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  kings = new Int8Array(2);
  /** Zobrist hash halves (signed int32). Use hashHex()/hashBigInt() for display/storage. */
  hashHi = 0;
  hashLo = 0;

  private undoStack = new Int32Array(UNDO_SIZE * 64);
  private undoTop = 0;
  private moveBuf = new Int32Array(256);
  private sanBuf = new Int32Array(16);
  private checkBuf = new Int32Array(256);

  static start(): Position {
    return Position.fromFen(START_FEN);
  }

  static fromFen(fen: string): Position {
    const pos = new Position();
    pos.setFen(fen);
    return pos;
  }

  clone(): Position {
    const p = new Position();
    p.board.set(this.board);
    p.turn = this.turn;
    p.castling = this.castling;
    p.ep = this.ep;
    p.halfmove = this.halfmove;
    p.fullmove = this.fullmove;
    p.kings.set(this.kings);
    p.hashHi = this.hashHi;
    p.hashLo = this.hashLo;
    return p;
  }

  // ---------------------------------------------------------------- FEN

  setFen(fen: string): void {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) throw new ChessError(`Invalid FEN (expected at least 4 fields): ${fen}`);
    const board = new Int8Array(64);
    const rows = parts[0].split('/');
    if (rows.length !== 8) throw new ChessError(`Invalid FEN board (expected 8 ranks): ${fen}`);
    const kingCount = [0, 0];
    const kings = new Int8Array(2);
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i;
      let file = 0;
      for (const ch of rows[i]) {
        if (ch >= '1' && ch <= '8') {
          file += ch.charCodeAt(0) - 48;
          continue;
        }
        const lower = ch.toLowerCase();
        const type = PIECE_CHARS.indexOf(lower);
        if (type <= 0 || file > 7) throw new ChessError(`Invalid FEN board: ${fen}`);
        const color = ch === lower ? BLACK : WHITE;
        const sq = rank * 8 + file;
        if (type === PAWN && (rank === 0 || rank === 7)) {
          throw new ChessError(`Invalid FEN: pawn on back rank: ${fen}`);
        }
        if (type === KING) {
          kingCount[color]++;
          kings[color] = sq;
        }
        board[sq] = (color << 3) | type;
        file++;
      }
      if (file !== 8) throw new ChessError(`Invalid FEN board (rank ${rank + 1} has ${file} files): ${fen}`);
    }
    if (kingCount[0] !== 1 || kingCount[1] !== 1) {
      throw new ChessError(`Invalid FEN: each side needs exactly one king: ${fen}`);
    }
    let turn: Color;
    if (parts[1] === 'w') turn = WHITE;
    else if (parts[1] === 'b') turn = BLACK;
    else throw new ChessError(`Invalid FEN side to move: ${fen}`);

    let castling = 0;
    if (parts[2] !== '-') {
      for (const ch of parts[2]) {
        if (ch === 'K' || ch === 'H') castling |= CASTLE_WK;
        else if (ch === 'Q' || ch === 'A') castling |= CASTLE_WQ;
        else if (ch === 'k' || ch === 'h') castling |= CASTLE_BK;
        else if (ch === 'q' || ch === 'a') castling |= CASTLE_BQ;
        else throw new ChessError(`Invalid FEN castling rights: ${fen}`);
      }
    }
    // Drop castling rights that are impossible given the piece placement.
    const WK = KING, WR = ROOK, BK = (BLACK << 3) | KING, BR = (BLACK << 3) | ROOK;
    if (board[4] !== WK) castling &= ~(CASTLE_WK | CASTLE_WQ);
    if (board[7] !== WR) castling &= ~CASTLE_WK;
    if (board[0] !== WR) castling &= ~CASTLE_WQ;
    if (board[60] !== BK) castling &= ~(CASTLE_BK | CASTLE_BQ);
    if (board[63] !== BR) castling &= ~CASTLE_BK;
    if (board[56] !== BR) castling &= ~CASTLE_BQ;

    let ep = -1;
    if (parts[3] !== '-') {
      const sq = parseSquare(parts[3]);
      if (sq < 0) throw new ChessError(`Invalid FEN en passant square: ${fen}`);
      // Only keep it if it is consistent with a double push by the side that just moved.
      const r = sq >> 3;
      const pusher = turn === WHITE ? BLACK : WHITE;
      const pawnSq = turn === WHITE ? sq - 8 : sq + 8;
      const originSq = turn === WHITE ? sq + 8 : sq - 8;
      if (
        r === (turn === WHITE ? 5 : 2) &&
        board[pawnSq] === ((pusher << 3) | PAWN) &&
        board[sq] === 0 &&
        board[originSq] === 0
      ) {
        ep = sq;
      }
    }
    const halfmove = parts.length > 4 ? parseInt(parts[4], 10) : 0;
    const fullmove = parts.length > 5 ? parseInt(parts[5], 10) : 1;

    this.board = board;
    this.turn = turn;
    this.castling = castling;
    this.ep = ep;
    this.halfmove = Number.isFinite(halfmove) && halfmove >= 0 ? halfmove : 0;
    this.fullmove = Number.isFinite(fullmove) && fullmove >= 1 ? fullmove : 1;
    this.kings = kings;
    this.undoTop = 0;
    if (this.isAttacked(kings[turn ^ 1], turn)) {
      throw new ChessError(`Invalid FEN: side not to move is in check: ${fen}`);
    }
    this.computeHash();
  }

  /** Full FEN. The en passant square is only written when a legal ep capture exists. */
  fen(): string {
    return `${this.epd()} ${this.halfmove} ${this.fullmove}`;
  }

  /** FEN without the move counters (useful as a position identity string). */
  epd(): string {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 8 + f];
        if (!p) {
          empty++;
          continue;
        }
        if (empty) {
          s += empty;
          empty = 0;
        }
        const ch = PIECE_CHARS[p & 7];
        s += p >> 3 ? ch : ch.toUpperCase();
      }
      if (empty) s += empty;
      if (r) s += '/';
    }
    let c = '';
    if (this.castling & CASTLE_WK) c += 'K';
    if (this.castling & CASTLE_WQ) c += 'Q';
    if (this.castling & CASTLE_BK) c += 'k';
    if (this.castling & CASTLE_BQ) c += 'q';
    const ep = this.ep >= 0 && this.hasLegalEp() ? squareName(this.ep) : '-';
    return `${s} ${this.turn === WHITE ? 'w' : 'b'} ${c || '-'} ${ep}`;
  }

  // ---------------------------------------------------------------- hashing

  private epCapturable(): boolean {
    // Polyglot rule: a pawn of the side to move stands next to the double-pushed pawn.
    const ep = this.ep;
    const from = this.turn === WHITE ? ep - 8 : ep + 8;
    const pawn = (this.turn << 3) | PAWN;
    const f = ep & 7;
    return (f > 0 && this.board[from - 1] === pawn) || (f < 7 && this.board[from + 1] === pawn);
  }

  private hasLegalEp(): boolean {
    const ep = this.ep;
    const us = this.turn;
    const capSq = us === WHITE ? ep - 8 : ep + 8;
    const pawn = (us << 3) | PAWN;
    const f = ep & 7;
    const board = this.board;
    for (const from of [capSq - 1, capSq + 1]) {
      if ((from & 7) !== f - 1 && (from & 7) !== f + 1) continue;
      if (from < 0 || from > 63 || board[from] !== pawn) continue;
      const captured = board[capSq];
      board[from] = 0;
      board[capSq] = 0;
      board[ep] = pawn;
      const ok = !this.isAttacked(this.kings[us], us ^ 1);
      board[from] = pawn;
      board[capSq] = captured;
      board[ep] = 0;
      if (ok) return true;
    }
    return false;
  }

  computeHash(): void {
    let hi = 0;
    let lo = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = this.board[sq];
      if (p) {
        hi ^= PIECE_HI[p * 64 + sq];
        lo ^= PIECE_LO[p * 64 + sq];
      }
    }
    hi ^= CASTLE_HI[this.castling];
    lo ^= CASTLE_LO[this.castling];
    if (this.ep >= 0 && this.epCapturable()) {
      hi ^= EP_HI[this.ep & 7];
      lo ^= EP_LO[this.ep & 7];
    }
    if (this.turn === WHITE) {
      hi ^= TURN_HI;
      lo ^= TURN_LO;
    }
    this.hashHi = hi | 0;
    this.hashLo = lo | 0;
  }

  hashHex(): string {
    return hashToHex(this.hashHi, this.hashLo);
  }

  hashBigInt(): bigint {
    return hashToBigInt(this.hashHi, this.hashLo);
  }

  hashNumber(): number {
    return hashToNumber(this.hashHi, this.hashLo);
  }

  // ---------------------------------------------------------------- attacks

  /** Is `sq` attacked by any piece of color `by`? */
  isAttacked(sq: number, by: number): boolean {
    const board = this.board;
    const f = sq & 7;
    if (by === WHITE) {
      if (sq >= 8) {
        if (f > 0 && board[sq - 9] === PAWN) return true;
        if (f < 7 && board[sq - 7] === PAWN) return true;
      }
    } else if (sq < 56) {
      const bp = (BLACK << 3) | PAWN;
      if (f > 0 && board[sq + 7] === bp) return true;
      if (f < 7 && board[sq + 9] === bp) return true;
    }
    const base = by << 3;
    const knight = base | KNIGHT;
    const kt = KNIGHT_TARGETS[sq];
    for (let i = 0; i < kt.length; i++) if (board[kt[i]] === knight) return true;
    const king = base | KING;
    const kg = KING_TARGETS[sq];
    for (let i = 0; i < kg.length; i++) if (board[kg[i]] === king) return true;
    const rook = base | ROOK;
    const bishop = base | BISHOP;
    const queen = base | QUEEN;
    for (let d = 0; d < 8; d++) {
      const ray = RAYS[d * 64 + sq];
      for (let i = 0; i < ray.length; i++) {
        const p = board[ray[i]];
        if (!p) continue;
        if (p === queen || p === (d < 4 ? rook : bishop)) return true;
        break;
      }
    }
    return false;
  }

  inCheck(): boolean {
    return this.isAttacked(this.kings[this.turn], this.turn ^ 1);
  }

  // ---------------------------------------------------------------- make / unmake

  /** Play a (pseudo-)legal move. No legality check is performed. */
  play(m: number): void {
    const board = this.board;
    const us = this.turn;
    let top = this.undoTop;
    if (top + UNDO_SIZE > this.undoStack.length) {
      const bigger = new Int32Array(this.undoStack.length * 2);
      bigger.set(this.undoStack);
      this.undoStack = bigger;
    }
    const stack = this.undoStack;
    let hi = this.hashHi;
    let lo = this.hashLo;
    if (this.ep >= 0 && this.epCapturable()) {
      hi ^= EP_HI[this.ep & 7];
      lo ^= EP_LO[this.ep & 7];
    }
    stack[top] = m;
    stack[top + 2] = this.castling;
    stack[top + 3] = this.ep;
    stack[top + 4] = this.halfmove;
    stack[top + 5] = this.hashHi;
    stack[top + 6] = this.hashLo;
    stack[top + 7] = this.fullmove;
    this.undoTop = top + UNDO_SIZE;

    if (m === NULL_MOVE) {
      stack[top + 1] = 0;
      this.ep = -1;
      this.halfmove++;
    } else {
      const from = m & 63;
      const to = (m >> 6) & 63;
      const piece = board[from];
      let captured: number;
      if (m & FLAG_EP) {
        const capSq = us === WHITE ? to - 8 : to + 8;
        captured = board[capSq];
        board[capSq] = 0;
        hi ^= PIECE_HI[captured * 64 + capSq];
        lo ^= PIECE_LO[captured * 64 + capSq];
      } else {
        captured = board[to];
        if (captured) {
          hi ^= PIECE_HI[captured * 64 + to];
          lo ^= PIECE_LO[captured * 64 + to];
        }
      }
      stack[top + 1] = captured;
      const promo = (m >> 12) & 7;
      const placed = promo ? (us << 3) | promo : piece;
      board[from] = 0;
      board[to] = placed;
      hi ^= PIECE_HI[piece * 64 + from] ^ PIECE_HI[placed * 64 + to];
      lo ^= PIECE_LO[piece * 64 + from] ^ PIECE_LO[placed * 64 + to];
      if ((piece & 7) === KING) {
        this.kings[us] = to;
        if (m & FLAG_CASTLE) {
          const rook = (us << 3) | ROOK;
          const rFrom = to > from ? from + 3 : from - 4;
          const rTo = to > from ? from + 1 : from - 1;
          board[rFrom] = 0;
          board[rTo] = rook;
          hi ^= PIECE_HI[rook * 64 + rFrom] ^ PIECE_HI[rook * 64 + rTo];
          lo ^= PIECE_LO[rook * 64 + rFrom] ^ PIECE_LO[rook * 64 + rTo];
        }
      }
      const oldC = this.castling;
      const newC = oldC & CASTLE_MASK[from] & CASTLE_MASK[to];
      if (newC !== oldC) {
        hi ^= CASTLE_HI[oldC] ^ CASTLE_HI[newC];
        lo ^= CASTLE_LO[oldC] ^ CASTLE_LO[newC];
        this.castling = newC;
      }
      this.halfmove = (piece & 7) === PAWN || captured ? 0 : this.halfmove + 1;
      this.ep = m & FLAG_DOUBLE ? (from + to) >> 1 : -1;
    }
    this.turn = (us ^ 1) as Color;
    if (us === BLACK) this.fullmove++;
    hi ^= TURN_HI;
    lo ^= TURN_LO;
    if (this.ep >= 0 && this.epCapturable()) {
      hi ^= EP_HI[this.ep & 7];
      lo ^= EP_LO[this.ep & 7];
    }
    this.hashHi = hi;
    this.hashLo = lo;
  }

  /** Undo the last move made with play(). */
  undo(): void {
    if (this.undoTop === 0) throw new ChessError('Nothing to undo');
    const top = (this.undoTop -= UNDO_SIZE);
    const stack = this.undoStack;
    const m = stack[top];
    const captured = stack[top + 1];
    this.castling = stack[top + 2];
    this.ep = stack[top + 3];
    this.halfmove = stack[top + 4];
    this.hashHi = stack[top + 5];
    this.hashLo = stack[top + 6];
    this.fullmove = stack[top + 7];
    const us = (this.turn ^ 1) as Color;
    this.turn = us;
    if (m === NULL_MOVE) return;
    const board = this.board;
    const from = m & 63;
    const to = (m >> 6) & 63;
    const promo = (m >> 12) & 7;
    const moved = board[to];
    board[from] = promo ? (us << 3) | PAWN : moved;
    if (m & FLAG_EP) {
      board[to] = 0;
      board[us === WHITE ? to - 8 : to + 8] = captured;
    } else {
      board[to] = captured;
    }
    if ((moved & 7) === KING) {
      this.kings[us] = from;
      if (m & FLAG_CASTLE) {
        const rook = (us << 3) | ROOK;
        const rFrom = to > from ? from + 3 : from - 4;
        const rTo = to > from ? from + 1 : from - 1;
        board[rTo] = 0;
        board[rFrom] = rook;
      }
    }
  }

  /** Number of moves on the internal undo stack. */
  get depth(): number {
    return this.undoTop / UNDO_SIZE;
  }

  // ---------------------------------------------------------------- move generation

  /** Generate pseudo-legal moves into `out` starting at index `n`; returns the new count. */
  generatePseudo(out: Int32Array, n = 0): number {
    const board = this.board;
    const us = this.turn;
    const them = us ^ 1;
    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (!p || p >> 3 !== us) continue;
      const type = p & 7;
      if (type === PAWN) {
        n = this.genPawn(sq, out, n);
      } else if (type === KNIGHT || type === KING) {
        const targets = type === KNIGHT ? KNIGHT_TARGETS[sq] : KING_TARGETS[sq];
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          const q = board[t];
          if (!q || q >> 3 === them) out[n++] = sq | (t << 6);
        }
        if (type === KING) n = this.genCastling(sq, out, n);
      } else {
        const d0 = type === BISHOP ? 4 : 0;
        const d1 = type === ROOK ? 4 : 8;
        for (let d = d0; d < d1; d++) {
          const ray = RAYS[d * 64 + sq];
          for (let i = 0; i < ray.length; i++) {
            const t = ray[i];
            const q = board[t];
            if (!q) {
              out[n++] = sq | (t << 6);
            } else {
              if (q >> 3 === them) out[n++] = sq | (t << 6);
              break;
            }
          }
        }
      }
    }
    return n;
  }

  private genPawn(sq: number, out: Int32Array, n: number): number {
    const board = this.board;
    const us = this.turn;
    const dir = us === WHITE ? 8 : -8;
    const rank = sq >> 3;
    const lastRank = us === WHITE ? 6 : 1; // rank from which a push promotes
    const startRank = us === WHITE ? 1 : 6;
    const f = sq & 7;
    const one = sq + dir;
    if (!board[one]) {
      if (rank === lastRank) {
        for (const pt of PROMO_TYPES) out[n++] = sq | (one << 6) | (pt << 12);
      } else {
        out[n++] = sq | (one << 6);
        if (rank === startRank && !board[one + dir]) out[n++] = sq | ((one + dir) << 6) | FLAG_DOUBLE;
      }
    }
    for (let side = -1; side <= 1; side += 2) {
      if ((side === -1 && f === 0) || (side === 1 && f === 7)) continue;
      const t = one + side;
      const q = board[t];
      if (q && q >> 3 !== us) {
        if (rank === lastRank) {
          for (const pt of PROMO_TYPES) out[n++] = sq | (t << 6) | (pt << 12);
        } else {
          out[n++] = sq | (t << 6);
        }
      } else if (t === this.ep) {
        out[n++] = sq | (t << 6) | FLAG_EP;
      }
    }
    return n;
  }

  private genCastling(sq: number, out: Int32Array, n: number): number {
    const board = this.board;
    const us = this.turn;
    const them = us ^ 1;
    const home = us === WHITE ? 4 : 60;
    if (sq !== home) return n;
    const kRight = us === WHITE ? CASTLE_WK : CASTLE_BK;
    const qRight = us === WHITE ? CASTLE_WQ : CASTLE_BQ;
    if (!(this.castling & (kRight | qRight))) return n;
    if (this.isAttacked(home, them)) return n;
    if (
      this.castling & kRight &&
      !board[home + 1] &&
      !board[home + 2] &&
      !this.isAttacked(home + 1, them) &&
      !this.isAttacked(home + 2, them)
    ) {
      out[n++] = home | ((home + 2) << 6) | FLAG_CASTLE;
    }
    if (
      this.castling & qRight &&
      !board[home - 1] &&
      !board[home - 2] &&
      !board[home - 3] &&
      !this.isAttacked(home - 1, them) &&
      !this.isAttacked(home - 2, them)
    ) {
      out[n++] = home | ((home - 2) << 6) | FLAG_CASTLE;
    }
    return n;
  }

  /** Whether the pseudo-legal move `m` leaves our king safe. */
  isLegal(m: number): boolean {
    const us = this.turn;
    this.play(m);
    const ok = !this.isAttacked(this.kings[us], us ^ 1);
    this.undo();
    return ok;
  }

  /** All legal moves in the position. */
  legalMoves(): number[] {
    const buf = this.moveBuf;
    const n = this.generatePseudo(buf);
    const res: number[] = [];
    for (let i = 0; i < n; i++) if (this.isLegal(buf[i])) res.push(buf[i]);
    return res;
  }

  hasLegalMove(): boolean {
    const buf = this.checkBuf;
    const n = this.generatePseudo(buf);
    for (let i = 0; i < n; i++) if (this.isLegal(buf[i])) return true;
    return false;
  }

  isCheckmate(): boolean {
    return this.inCheck() && !this.hasLegalMove();
  }

  isStalemate(): boolean {
    return !this.inCheck() && !this.hasLegalMove();
  }

  /** Neither side can possibly mate (K v K, K+minor v K, K+B v K+B same colour bishops). */
  isInsufficientMaterial(): boolean {
    let minors = 0;
    let bishopsLight = 0;
    let bishopsDark = 0;
    let knights = 0;
    for (let sq = 0; sq < 64; sq++) {
      const t = this.board[sq] & 7;
      if (!t || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors++;
      if (t === KNIGHT) knights++;
      else if (((sq >> 3) + (sq & 7)) & 1) bishopsLight++;
      else bishopsDark++;
    }
    if (minors <= 1) return true;
    return knights === 0 && (bishopsLight === 0 || bishopsDark === 0);
  }

  // ---------------------------------------------------------------- SAN

  /**
   * Collect from-squares of our pieces of `type` that pseudo-legally move to
   * `to` (captures and quiet moves; castling excluded). Returns count in `out`.
   */
  private candidatesTo(type: number, to: number, out: Int32Array): number {
    const board = this.board;
    const us = this.turn;
    const piece = (us << 3) | type;
    const target = board[to];
    if (target && target >> 3 === us) return 0;
    let n = 0;
    if (type === PAWN) {
      const dir = us === WHITE ? 8 : -8;
      const f = to & 7;
      if (target || to === this.ep) {
        if (f > 0 && board[to - dir - 1] === piece && ((to - dir - 1) & 7) === f - 1) out[n++] = to - dir - 1;
        if (f < 7 && board[to - dir + 1] === piece) out[n++] = to - dir + 1;
      } else {
        const one = to - dir;
        if (one >= 0 && one < 64) {
          if (board[one] === piece) out[n++] = one;
          else if (!board[one]) {
            const two = one - dir;
            const r = to >> 3;
            if (r === (us === WHITE ? 3 : 4) && board[two] === piece) out[n++] = two;
          }
        }
      }
      return n;
    }
    if (type === KNIGHT || type === KING) {
      const t = type === KNIGHT ? KNIGHT_TARGETS[to] : KING_TARGETS[to];
      for (let i = 0; i < t.length; i++) if (board[t[i]] === piece) out[n++] = t[i];
      return n;
    }
    const d0 = type === BISHOP ? 4 : 0;
    const d1 = type === ROOK ? 4 : 8;
    for (let d = d0; d < d1; d++) {
      const ray = RAYS[d * 64 + to];
      for (let i = 0; i < ray.length; i++) {
        const p = board[ray[i]];
        if (!p) continue;
        if (p === piece) out[n++] = ray[i];
        break;
      }
    }
    return n;
  }

  /** Build the full move encoding (with flags) for a from/to/promo triple. */
  private encode(from: number, to: number, promo: number): number {
    const p = this.board[from] & 7;
    let flags = 0;
    if (p === PAWN) {
      if (to === this.ep && (to & 7) !== (from & 7)) flags = FLAG_EP;
      else if (Math.abs(to - from) === 16) flags = FLAG_DOUBLE;
    } else if (p === KING && Math.abs(to - from) === 2) {
      flags = FLAG_CASTLE;
    }
    return makeMove(from, to, promo, flags);
  }

  /** Format a legal move in Standard Algebraic Notation (with +/# suffix). */
  san(m: number): string {
    if (m === NULL_MOVE) return '--';
    const from = m & 63;
    const to = (m >> 6) & 63;
    const type = this.board[from] & 7;
    let s: string;
    if (m & FLAG_CASTLE) {
      s = to > from ? 'O-O' : 'O-O-O';
    } else if (type === PAWN) {
      s = '';
      if ((from & 7) !== (to & 7)) s = FILES[from & 7] + 'x';
      s += squareName(to);
      const promo = (m >> 12) & 7;
      if (promo) s += '=' + SAN_PIECE[promo];
    } else {
      s = SAN_PIECE[type];
      const buf = this.sanBuf;
      const n = this.candidatesTo(type, to, buf);
      let others = 0;
      let sameFile = false;
      let sameRank = false;
      for (let i = 0; i < n; i++) {
        const c = buf[i];
        if (c === from) continue;
        if (!this.isLegal(c | (to << 6))) continue;
        others++;
        if ((c & 7) === (from & 7)) sameFile = true;
        if (c >> 3 === from >> 3) sameRank = true;
      }
      if (others) {
        if (!sameFile) s += FILES[from & 7];
        else if (!sameRank) s += String.fromCharCode(49 + (from >> 3));
        else s += squareName(from);
      }
      if (this.board[to]) s += 'x';
      s += squareName(to);
    }
    this.play(m);
    if (this.inCheck()) s += this.hasLegalMove() ? '+' : '#';
    this.undo();
    return s;
  }

  /**
   * Parse a move in SAN (lenient: accepts missing/extra check marks, "0-0",
   * missing "=" for promotions, long algebraic "Ng1-f3" and UCI "g1f3").
   * Returns the legal move or -1 if the text does not describe exactly one legal move.
   */
  parseSan(input: string): number {
    let s = input;
    let end = s.length;
    // Strip check/mate/annotation suffixes.
    while (end > 0) {
      const c = s.charCodeAt(end - 1);
      if (c === 43 /* + */ || c === 35 /* # */ || c === 33 /* ! */ || c === 63 /* ? */) end--;
      else break;
    }
    if (end !== s.length) s = s.slice(0, end);
    if (s.length < 2) return -1;
    if (s.endsWith('e.p.')) s = s.slice(0, -4);
    const c0 = s.charCodeAt(0);
    if (c0 === 79 /* O */ || c0 === 48 /* 0 */) {
      if (s === 'O-O' || s === '0-0' || s === 'OO') return this.parseCastle(true);
      if (s === 'O-O-O' || s === '0-0-0' || s === 'OOO') return this.parseCastle(false);
      return -1;
    }
    if (s === '--' || s === 'Z0' || s === '@@') return NULL_MOVE;

    let type = PAWN;
    let i = 0;
    let len = s.length;
    const pIdx = 'PNBRQK'.indexOf(s[0]);
    if (pIdx >= 0) {
      type = pIdx + 1;
      i = 1;
    }
    // Promotion suffix.
    let promo = 0;
    const last = s[len - 1];
    const promoIdx = 'NBRQnbrq'.indexOf(last);
    if (promoIdx >= 0 && len >= 3) {
      const before = s[len - 2];
      if (before === '=' || (before >= '1' && before <= '8')) {
        promo = (promoIdx & 3) + 2;
        len -= before === '=' ? 2 : 1;
      }
    }
    if (len - i < 2) return -1;
    const toF = s.charCodeAt(len - 2) - 97;
    const toR = s.charCodeAt(len - 1) - 49;
    if (toF < 0 || toF > 7 || toR < 0 || toR > 7) return -1;
    const to = toR * 8 + toF;
    let disF = -1;
    let disR = -1;
    for (let k = i; k < len - 2; k++) {
      const ch = s.charCodeAt(k);
      if (ch >= 97 && ch <= 104) disF = ch - 97;
      else if (ch >= 49 && ch <= 56) disR = ch - 49;
      else if (ch === 120 /* x */ || ch === 45 /* - */ || ch === 58 /* : */) continue;
      else return this.retryAsBishop(input);
    }
    if (type === PAWN && disF >= 0 && disR >= 0) {
      // Coordinate notation ("e2e4", "e7e8q"): the piece is whatever stands on from.
      const from = disR * 8 + disF;
      const p = this.board[from];
      if (!p || p >> 3 !== this.turn) return -1;
      const pt = p & 7;
      if (pt === KING && Math.abs(to - from) === 2 && (from === 4 || from === 60)) {
        return this.parseCastle(to > from);
      }
      if (pt !== PAWN) type = pt;
    }
    const buf = this.moveBuf;
    const n = this.candidatesTo(type, to, buf);
    let found = -1;
    const promoRank = this.turn === WHITE ? 7 : 0;
    for (let k = 0; k < n; k++) {
      const from = buf[k];
      if (disF >= 0 && (from & 7) !== disF) continue;
      if (disR >= 0 && from >> 3 !== disR) continue;
      let pr = 0;
      if (type === PAWN && toR === promoRank) pr = promo || QUEEN;
      else if (promo) continue;
      const m = this.encode(from, to, pr);
      if (!this.isLegal(m)) continue;
      if (found >= 0) return -1; // ambiguous
      found = m;
    }
    if (found < 0 && s[0] === 'b') return this.retryAsBishop(input);
    return found;
  }

  private retryAsBishop(input: string): number {
    if (input[0] !== 'b') return -1;
    return this.parseSan('B' + input.slice(1));
  }

  private parseCastle(kingside: boolean): number {
    const home = this.turn === WHITE ? 4 : 60;
    if (this.kings[this.turn] !== home) return -1;
    const buf = new Int32Array(4);
    const n = this.genCastling(home, buf, 0);
    const to = kingside ? home + 2 : home - 2;
    for (let k = 0; k < n; k++) {
      if (((buf[k] >> 6) & 63) === to && this.isLegal(buf[k])) return buf[k];
    }
    return -1;
  }

  /** Parse a UCI move ("e2e4", "e7e8q", "e1g1") into a legal move or -1. */
  parseUci(uci: string): number {
    if (uci === '0000') return NULL_MOVE;
    if (uci.length < 4 || uci.length > 5) return -1;
    const from = parseSquare(uci.slice(0, 2));
    const to = parseSquare(uci.slice(2, 4));
    if (from < 0 || to < 0) return -1;
    const promo = uci.length === 5 ? 'nbrq'.indexOf(uci[4].toLowerCase()) + 2 : 0;
    if (uci.length === 5 && promo < 2) return -1;
    const legal = this.legalMoves();
    for (const m of legal) {
      if ((m & 63) === from && ((m >> 6) & 63) === to && ((m >> 12) & 7) === promo) return m;
    }
    return -1;
  }

  /** Parse and play a SAN move; throws on illegal moves. Returns the move. */
  playSan(san: string): number {
    const m = this.parseSan(san);
    if (m < 0) throw new ChessError(`Illegal or ambiguous move "${san}" in ${this.fen()}`);
    this.play(m);
    return m;
  }

  /** Play a UCI move; throws on illegal moves. */
  playUci(uci: string): number {
    const m = this.parseUci(uci);
    if (m < 0) throw new ChessError(`Illegal move "${uci}" in ${this.fen()}`);
    this.play(m);
    return m;
  }

  uci(m: number): string {
    return moveToUci(m);
  }

  /** Piece at a square as a FEN character, or '' if empty. */
  pieceAt(sq: number): string {
    const p = this.board[sq];
    if (!p) return '';
    const ch = PIECE_CHARS[p & 7];
    return p >> 3 ? ch : ch.toUpperCase();
  }
}
