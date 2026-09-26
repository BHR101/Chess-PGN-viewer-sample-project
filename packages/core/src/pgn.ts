import { Game, GameNode, SEVEN_TAG_ROSTER, defaultTag, newNode, plyFromFen } from './game.js';
import { Position, START_FEN } from './position.js';
import { ChessError } from './types.js';

/**
 * Callbacks for the PGN walker. The walker is a lenient, allocation-light
 * tokenizer that understands tags, move numbers, SAN tokens, NAGs, suffix
 * annotations (!, ?, !?, ...), brace and rest-of-line comments, nested
 * variations, escape lines (%) and game termination markers.
 */
export interface PgnVisitor {
  beginGame(): void;
  header(name: string, value: string): void;
  move(san: string): void;
  nag(nag: number): void;
  comment(text: string): void;
  beginVariation(): void;
  endVariation(): void;
  /** Called for the termination marker (may be missing in sloppy PGN). */
  result(result: string): void;
  endGame(): void;
}

const SUFFIX_NAGS: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };

export const NAG_SYMBOLS: Record<number, string> = {
  1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!', 7: '□', 10: '=', 13: '∞', 14: '⩲', 15: '⩱',
  16: '±', 17: '∓', 18: '+−', 19: '−+', 22: '⨀', 23: '⨀', 32: '⟳', 33: '⟳', 36: '→', 37: '→',
  40: '↑', 41: '↑', 132: '⇆', 133: '⇆', 138: '⊕', 139: '⊕', 140: '∆', 146: 'N',
};

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

function isWs(c: number): boolean {
  return c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0xfeff || c === 160;
}

// Characters that terminate a symbol token.
const DELIM = new Uint8Array(128);
for (const ch of ' \t\r\n\f{}()[];$"') DELIM[ch.charCodeAt(0)] = 1;

/**
 * Walk PGN text (possibly containing many games) and emit visitor events.
 */
export function walkPgn(text: string, v: PgnVisitor): void {
  const len = text.length;
  let i = 0;
  let inGame = false;
  let inMovetext = false;
  let depth = 0;
  let lineStart = true;

  const endGame = () => {
    while (depth > 0) {
      v.endVariation();
      depth--;
    }
    v.endGame();
    inGame = false;
    inMovetext = false;
  };
  const ensureGame = () => {
    if (!inGame) {
      v.beginGame();
      inGame = true;
    }
  };

  while (i < len) {
    const c = text.charCodeAt(i);
    if (c === 10) {
      lineStart = true;
      i++;
      continue;
    }
    if (isWs(c)) {
      i++;
      continue;
    }
    const atLineStart = lineStart;
    lineStart = false;

    if (c === 37 /* % */ && atLineStart) {
      while (i < len && text.charCodeAt(i) !== 10) i++;
      continue;
    }
    if (c === 91 /* [ */) {
      if (inMovetext) endGame();
      ensureGame();
      // Tag pair.
      i++;
      while (i < len && isWs(text.charCodeAt(i))) i++;
      const nameStart = i;
      while (i < len) {
        const d = text.charCodeAt(i);
        if (isWs(d) || d === 34 || d === 93) break;
        i++;
      }
      const name = text.slice(nameStart, i);
      while (i < len && isWs(text.charCodeAt(i)) && text.charCodeAt(i) !== 10) i++;
      let value = '';
      if (text.charCodeAt(i) === 34 /* " */) {
        i++;
        let start = i;
        let parts: string[] | null = null;
        while (i < len) {
          const d = text.charCodeAt(i);
          if (d === 92 /* \ */ && i + 1 < len) {
            const n = text.charCodeAt(i + 1);
            if (n === 34 || n === 92) {
              (parts ??= []).push(text.slice(start, i));
              start = i + 1;
              i += 2;
              continue;
            }
          }
          if (d === 34) {
            // A quote followed by optional spaces and "]" closes the value;
            // otherwise treat it as a literal (sloppy PGN).
            let j = i + 1;
            while (j < len && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9)) j++;
            if (j >= len || text.charCodeAt(j) === 93 || text.charCodeAt(j) === 10 || text.charCodeAt(j) === 13) break;
          }
          if (d === 10) break;
          i++;
        }
        value = parts ? parts.join('') + text.slice(start, i) : text.slice(start, i);
        if (text.charCodeAt(i) === 34) i++;
      } else {
        const start = i;
        while (i < len && text.charCodeAt(i) !== 93 && text.charCodeAt(i) !== 10) i++;
        value = text.slice(start, i).trim();
      }
      while (i < len && text.charCodeAt(i) !== 93 && text.charCodeAt(i) !== 10) i++;
      if (text.charCodeAt(i) === 93) i++;
      if (name) v.header(name, value);
      continue;
    }

    ensureGame();
    if (c === 123 /* { */) {
      const start = i + 1;
      const close = text.indexOf('}', start);
      const stop = close < 0 ? len : close;
      v.comment(text.slice(start, stop).trim());
      inMovetext = true;
      i = stop + 1;
      continue;
    }
    if (c === 59 /* ; */) {
      const start = i + 1;
      let stop = text.indexOf('\n', start);
      if (stop < 0) stop = len;
      v.comment(text.slice(start, stop).trim());
      inMovetext = true;
      i = stop;
      continue;
    }
    if (c === 40 /* ( */) {
      inMovetext = true;
      depth++;
      v.beginVariation();
      i++;
      continue;
    }
    if (c === 41 /* ) */) {
      if (depth > 0) {
        depth--;
        v.endVariation();
      }
      i++;
      continue;
    }
    if (c === 36 /* $ */) {
      i++;
      const start = i;
      while (i < len) {
        const d = text.charCodeAt(i);
        if (d < 48 || d > 57) break;
        i++;
      }
      const n = parseInt(text.slice(start, i), 10);
      if (Number.isFinite(n)) v.nag(n);
      inMovetext = true;
      continue;
    }
    if (c === 34 /* stray quote */ || c === 93 || c === 125) {
      i++;
      continue;
    }

    // Symbol token.
    const start = i;
    while (i < len) {
      const d = text.charCodeAt(i);
      if (d < 128 && DELIM[d]) break;
      if (d === 160 || d === 0xfeff) break;
      i++;
    }
    let tok = text.slice(start, i);
    inMovetext = true;

    if (RESULTS.has(tok) || tok === '½-½' || tok === '1/2' || tok === '0.5-0.5') {
      if (depth === 0) {
        v.result(tok === '*' || tok === '1-0' || tok === '0-1' ? tok : '1/2-1/2');
        endGame();
      }
      continue;
    }
    // Strip a leading move number ("12.", "12...", "12.e4").
    const c0 = tok.charCodeAt(0);
    if (c0 >= 48 && c0 <= 57 && !tok.startsWith('0-0')) {
      let k = 0;
      while (k < tok.length && tok.charCodeAt(k) >= 48 && tok.charCodeAt(k) <= 57) k++;
      if (k === tok.length || tok.charCodeAt(k) !== 46 /* . */) {
        // Not a move number; could be garbage like "1" - skip it.
        if (k === tok.length) continue;
      }
      while (k < tok.length && (tok.charCodeAt(k) === 46 || tok.charCodeAt(k) === 32)) k++;
      tok = tok.slice(k);
      if (!tok) continue;
    }
    // Dots between tokens ("..." after a comment).
    if (tok.charCodeAt(0) === 46) {
      let k = 0;
      while (k < tok.length && tok.charCodeAt(k) === 46) k++;
      tok = tok.slice(k);
      if (!tok) continue;
    }
    // Standalone suffix annotations like "!" or "?!".
    const suffix = SUFFIX_NAGS[tok];
    if (suffix) {
      v.nag(suffix);
      continue;
    }
    // Split trailing glyphs off the move ("e4!?", "Nf3+?").
    let end = tok.length;
    while (end > 0) {
      const d = tok.charCodeAt(end - 1);
      if (d === 33 || d === 63) end--;
      else break;
    }
    if (end < tok.length) {
      const glyph = tok.slice(end);
      tok = tok.slice(0, end);
      if (tok) v.move(tok);
      const nag = SUFFIX_NAGS[glyph];
      if (nag) v.nag(nag);
      continue;
    }
    if (tok) v.move(tok);
  }
  if (inGame) endGame();
}

// ---------------------------------------------------------------- full parser

export interface ParseOptions {
  /** Stop after this many games. */
  maxGames?: number;
}

class TreeBuilder implements PgnVisitor {
  games: Game[] = [];
  private game!: Game;
  private headers = new Map<string, string>();
  private pos!: Position;
  private node!: GameNode;
  /** Pending comment to attach as startComment to the next move. */
  private pendingStart: string | undefined;
  /** Stack of [node, position] saved on variation entry. */
  private stack: Array<{ node: GameNode; pos: Position; skip: number }> = [];
  /** >0 while skipping the remainder of a line after an illegal move. */
  private skip = 0;
  private started = false;

  beginGame(): void {
    this.headers = new Map();
    this.started = false;
    this.stack = [];
    this.skip = 0;
    this.pendingStart = undefined;
  }

  header(name: string, value: string): void {
    this.headers.set(name, value);
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    let fen = START_FEN;
    const fenTag = this.headers.get('FEN');
    const errors: string[] = [];
    if (fenTag) {
      try {
        fen = Position.fromFen(fenTag).fen();
      } catch (e) {
        errors.push(`Invalid FEN tag: ${(e as Error).message}`);
      }
    }
    this.game = new Game(fen);
    this.game.errors = errors;
    // Preserve header order: seven tag roster first, then the rest as they appeared.
    const h = new Map<string, string>();
    for (const t of SEVEN_TAG_ROSTER) h.set(t, this.headers.get(t) ?? defaultTag(t));
    for (const [k, val] of this.headers) if (!h.has(k)) h.set(k, val);
    if (fen !== START_FEN) {
      h.set('SetUp', '1');
      h.set('FEN', fen);
    }
    this.game.headers = h;
    this.pos = Position.fromFen(fen);
    this.node = this.game.root;
  }

  move(san: string): void {
    this.start();
    if (this.skip) return;
    const m = this.pos.parseSan(san);
    if (m < 0 || (m === 0 && this.pos.inCheck())) {
      this.game.errors.push(`Illegal move "${san}" after ${this.node.san || 'start'} (${this.pos.fen()})`);
      this.skip = 1;
      return;
    }
    const existing = this.node.children.find((c) => c.move === m);
    const pos = this.pos;
    const san2 = pos.san(m);
    pos.play(m);
    let child: GameNode;
    if (existing) {
      child = existing;
    } else {
      child = newNode(this.node, m, san2, pos.fen(), this.node.ply + 1);
      this.node.children.push(child);
    }
    if (this.pendingStart !== undefined) {
      child.startComment = child.startComment ? `${child.startComment} ${this.pendingStart}` : this.pendingStart;
      this.pendingStart = undefined;
    }
    this.node = child;
  }

  nag(nag: number): void {
    this.start();
    if (this.skip || !this.node.parent) return;
    if (!this.node.nags.includes(nag)) this.node.nags.push(nag);
  }

  comment(text: string): void {
    this.start();
    if (this.skip || !text) return;
    // A comment at the very start of a variation (or game) precedes the next move.
    const top = this.stack[this.stack.length - 1];
    if (top && this.node === top.node.parent) {
      this.pendingStart = this.pendingStart ? `${this.pendingStart} ${text}` : text;
      return;
    }
    this.node.comment = this.node.comment ? `${this.node.comment} ${text}` : text;
  }

  beginVariation(): void {
    this.start();
    const parent = this.node.parent;
    this.stack.push({ node: this.node, pos: this.pos, skip: this.skip });
    if (this.skip || !parent) {
      // Variation after an illegal move or before any move: skip it entirely.
      this.skip++;
      return;
    }
    this.node = parent;
    this.pos = Position.fromFen(parent.fen);
    this.pendingStart = undefined;
  }

  endVariation(): void {
    const top = this.stack.pop();
    if (!top) return;
    this.node = top.node;
    this.pos = top.pos;
    this.skip = top.skip;
    this.pendingStart = undefined;
  }

  result(result: string): void {
    this.start();
    if (!this.headers.has('Result') || this.game.headers.get('Result') === '*') {
      this.game.headers.set('Result', result);
    }
  }

  endGame(): void {
    if (!this.started && this.headers.size === 0) return;
    this.start();
    this.games.push(this.game);
  }
}

/** Parse PGN text containing any number of games into full move trees. */
export function parsePgn(text: string): Game[] {
  const b = new TreeBuilder();
  walkPgn(text, b);
  return b.games;
}

/** Parse exactly one game; throws if the text contains none. */
export function parseGame(text: string): Game {
  const games = parsePgn(text);
  if (!games.length) throw new ChessError('No game found in PGN');
  return games[0];
}

// ---------------------------------------------------------------- writer

export interface WriteOptions {
  /** Maximum line length for the movetext (default 80). 0 disables wrapping. */
  maxLineLength?: number;
  comments?: boolean;
  variations?: boolean;
  nags?: boolean;
  headers?: boolean;
}

function escapeTag(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function cleanComment(c: string): string {
  return c.replace(/}/g, ')');
}

class LineWriter {
  lines: string[] = [];
  private cur = '';
  constructor(private max: number) {}
  token(t: string): void {
    if (!this.cur) {
      this.cur = t;
    } else if (this.max > 0 && this.cur.length + 1 + t.length > this.max) {
      this.lines.push(this.cur);
      this.cur = t;
    } else {
      this.cur += ' ' + t;
    }
  }
  /** Comments may be long: split them into words so wrapping still works. */
  comment(c: string): void {
    const words = cleanComment(c).split(/\s+/).filter(Boolean);
    if (!words.length) {
      this.token('{ }');
      return;
    }
    words[0] = '{' + words[0];
    words[words.length - 1] += '}';
    for (const w of words) this.token(w);
  }
  finish(): string {
    if (this.cur) this.lines.push(this.cur);
    return this.lines.join('\n');
  }
}

/** Serialize the movetext (moves, comments, NAGs, variations) of a game. */
export function writeMovetext(game: Game, opts: WriteOptions = {}): string {
  const w = new LineWriter(opts.maxLineLength ?? 80);
  const withComments = opts.comments !== false;
  const withVariations = opts.variations !== false;
  const withNags = opts.nags !== false;

  const moveNumber = (node: GameNode, force: boolean) => {
    const prevPly = node.ply - 1;
    const moveNo = Math.floor(prevPly / 2) + 1;
    if (prevPly % 2 === 0) w.token(`${moveNo}.`);
    else if (force) w.token(`${moveNo}...`);
  };
  const writeMove = (node: GameNode, force: boolean) => {
    if (withComments && node.startComment) {
      w.comment(node.startComment);
      force = true;
    }
    moveNumber(node, force);
    w.token(node.san);
    if (withNags) for (const n of node.nags) w.token(`$${n}`);
    if (withComments && node.comment) w.comment(node.comment);
  };

  if (withComments && game.root.comment) w.comment(game.root.comment);
  // Iterative traversal to cope with very long games without deep recursion.
  const walk = (start: GameNode, force: boolean) => {
    let parent = start;
    let forceNext = force;
    while (parent.children.length) {
      const main = parent.children[0];
      writeMove(main, forceNext);
      forceNext = withComments && !!main.comment;
      if (withVariations) {
        for (let k = 1; k < parent.children.length; k++) {
          const alt = parent.children[k];
          w.token('(');
          writeMove(alt, true);
          walk(alt, withComments && !!alt.comment);
          w.token(')');
          forceNext = true;
        }
      }
      parent = main;
    }
  };
  walk(game.root, true);
  w.token(game.result);
  return w.finish().replace(/\( /g, '(').replace(/ \)/g, ')');
}

/**
 * Format a bare main line (no tree) as movetext. Much cheaper than building a
 * Game when exporting large numbers of unannotated games.
 */
export function formatMainline(start: Position, moves: ArrayLike<number>, result: string, maxLineLength = 80): string {
  const w = new LineWriter(maxLineLength);
  const pos = start;
  let ply = (pos.fullmove - 1) * 2 + pos.turn;
  for (let i = 0; i < moves.length; i++) {
    if (ply % 2 === 0) w.token(`${ply / 2 + 1}.`);
    else if (i === 0) w.token(`${(ply - 1) / 2 + 1}...`);
    w.token(pos.san(moves[i]));
    pos.play(moves[i]);
    ply++;
  }
  w.token(result);
  return w.finish();
}

/** Serialize headers (in the given order) followed by movetext into a PGN game. */
export function formatPgn(headers: Iterable<[string, string]>, movetext: string): string {
  let s = '';
  for (const [k, v] of headers) s += `[${k} "${escapeTag(v)}"]\n`;
  return `${s}\n${movetext}\n`;
}

/** Serialize a game to PGN (headers + movetext). */
export function writePgn(game: Game, opts: WriteOptions = {}): string {
  let s = '';
  if (opts.headers !== false) {
    for (const [k, v] of game.headers) s += `[${k} "${escapeTag(v)}"]\n`;
    s += '\n';
  }
  return s + writeMovetext(game, opts) + '\n';
}

// ---------------------------------------------------------------- fast scanning for import

/** Result of scanning a single game without building a move tree. */
export interface ScannedGame {
  headers: Record<string, string>;
  /** SAN tokens of the main line. */
  moves: string[];
  /** True if the game has comments, NAGs or variations. */
  annotated: boolean;
  /** Result token found in the movetext, if any. */
  result?: string;
}

class ScanVisitor implements PgnVisitor {
  games: ScannedGame[] = [];
  private cur!: ScannedGame;
  private depth = 0;
  beginGame(): void {
    this.cur = { headers: {}, moves: [], annotated: false };
    this.depth = 0;
  }
  header(name: string, value: string): void {
    this.cur.headers[name] = value;
  }
  move(san: string): void {
    if (this.depth === 0) this.cur.moves.push(san);
  }
  nag(): void {
    this.cur.annotated = true;
  }
  comment(): void {
    this.cur.annotated = true;
  }
  beginVariation(): void {
    this.depth++;
    this.cur.annotated = true;
  }
  endVariation(): void {
    this.depth--;
  }
  result(r: string): void {
    this.cur.result = r;
  }
  endGame(): void {
    if (this.cur.moves.length || Object.keys(this.cur.headers).length) this.games.push(this.cur);
  }
}

/** Quickly extract headers and main-line SAN tokens of every game in `text`. */
export function scanPgn(text: string): ScannedGame[] {
  const v = new ScanVisitor();
  walkPgn(text, v);
  return v.games;
}

/**
 * Extract the movetext portion (everything after the tag section) of a raw
 * single-game PGN string. Used to store annotated games verbatim.
 */
export function extractMovetext(raw: string): string {
  let i = 0;
  const len = raw.length;
  let lastTagEnd = 0;
  while (i < len) {
    const c = raw.charCodeAt(i);
    if (isWs(c)) {
      i++;
      continue;
    }
    if (c === 91) {
      let inQuote = false;
      while (i < len) {
        const d = raw.charCodeAt(i);
        if (d === 92 && inQuote) {
          i += 2;
          continue;
        }
        if (d === 34) inQuote = !inQuote;
        else if (d === 10) inQuote = false;
        else if (d === 93 && !inQuote) break;
        i++;
      }
      i++;
      lastTagEnd = i;
      continue;
    }
    if (c === 37) {
      while (i < len && raw.charCodeAt(i) !== 10) i++;
      continue;
    }
    break;
  }
  return raw.slice(Math.max(lastTagEnd, i)).trim();
}

// ---------------------------------------------------------------- streaming splitter

/**
 * Splits a stream of PGN text into single-game strings. Feed chunks with
 * push(); complete games are returned as soon as the next game starts.
 * Boundaries are tag sections (lines starting with "[") that follow
 * movetext, which is how virtually all PGN databases are laid out. Brace
 * comments are tracked so "[" inside a multi-line comment is not a boundary.
 */
export class PgnSplitter {
  private buf = '';
  private pos = 0;
  private gameStart = 0;
  private inComment = false;
  private inLineComment = false;
  private sawMovetext = false;
  private atLineStart = true;
  private inTag = false;
  private inQuote = false;

  push(chunk: string): string[] {
    const out: string[] = [];
    if (this.gameStart > 0) {
      this.buf = this.buf.slice(this.gameStart);
      this.pos -= this.gameStart;
      this.gameStart = 0;
    }
    this.buf += chunk;
    const buf = this.buf;
    const len = buf.length;
    let i = this.pos;
    let inComment = this.inComment;
    let inLineComment = this.inLineComment;
    let sawMovetext = this.sawMovetext;
    let atLineStart = this.atLineStart;
    let inTag = this.inTag;
    let inQuote = this.inQuote;
    for (; i < len; i++) {
      const c = buf.charCodeAt(i);
      if (c === 10) {
        atLineStart = true;
        inLineComment = false;
        if (inTag) {
          // Unterminated tag line: end it at the newline.
          inTag = false;
          inQuote = false;
        }
        continue;
      }
      const wasLineStart = atLineStart;
      if (c !== 32 && c !== 9 && c !== 13) atLineStart = false;
      if (inComment) {
        if (c === 125) inComment = false;
        continue;
      }
      if (inLineComment) continue;
      if (inTag) {
        if (c === 92 && inQuote) {
          i++;
          continue;
        }
        if (c === 34) inQuote = !inQuote;
        else if (c === 93 && !inQuote) inTag = false;
        continue;
      }
      if (c === 91 && wasLineStart) {
        if (sawMovetext) {
          out.push(buf.slice(this.gameStart, i));
          this.gameStart = i;
          sawMovetext = false;
        }
        inTag = true;
        inQuote = false;
        continue;
      }
      if (c === 123) {
        inComment = true;
        sawMovetext = true;
      } else if (c === 59) {
        inLineComment = true;
      } else if (c === 37 && wasLineStart) {
        inLineComment = true;
      } else if (c !== 32 && c !== 9 && c !== 13 && c !== 0xfeff) {
        sawMovetext = true;
      }
    }
    this.pos = i;
    this.inComment = inComment;
    this.inLineComment = inLineComment;
    this.sawMovetext = sawMovetext;
    this.atLineStart = atLineStart;
    this.inTag = inTag;
    this.inQuote = inQuote;
    return out;
  }

  /** Return the last pending game (if any) at end of input. */
  finish(): string[] {
    const rest = this.buf.slice(this.gameStart);
    this.buf = '';
    this.pos = 0;
    this.gameStart = 0;
    return rest.trim() ? [rest] : [];
  }

  /** Number of buffered characters not yet emitted. */
  get pending(): number {
    return this.buf.length - this.gameStart;
  }
}

export { plyFromFen };
