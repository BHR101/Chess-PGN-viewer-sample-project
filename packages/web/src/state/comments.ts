/**
 * Embedded PGN comment commands (as written by lichess, ChessBase, cutechess…):
 *   [%eval 0.35]  [%clk 0:03:21]  [%emt 0:00:05]  [%cal Ge2e4,Rd7d5]  [%csl Gd4,Re5]
 */

export interface CommentData {
  /** Comment text without commands. */
  text: string;
  clock?: string;
  eval?: string;
  arrows: Array<{ from: string; to: string; color: string }>;
  highlights: Array<{ sq: string; color: string }>;
}

const COLORS: Record<string, string> = { G: '#15781b', R: '#882020', Y: '#e68f00', B: '#003088' };

export function parseComment(raw: string | undefined): CommentData {
  const res: CommentData = { text: '', arrows: [], highlights: [] };
  if (!raw) return res;
  res.text = raw
    .replace(/\[%(\w+)\s+([^\]]*)\]/g, (_m, cmd: string, arg: string) => {
      const a = arg.trim();
      if (cmd === 'clk') res.clock = a.replace(/^0:/, '').replace(/\.\d+$/, '');
      else if (cmd === 'eval') res.eval = a.split(',')[0];
      else if (cmd === 'cal') {
        for (const t of a.split(',')) {
          const m = /^([RGYB])([a-h][1-8])([a-h][1-8])$/.exec(t.trim());
          if (m) res.arrows.push({ color: COLORS[m[1]], from: m[2], to: m[3] });
        }
      } else if (cmd === 'csl') {
        for (const t of a.split(',')) {
          const m = /^([RGYB])([a-h][1-8])$/.exec(t.trim());
          if (m) res.highlights.push({ color: COLORS[m[1]], sq: m[2] });
        }
      }
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return res;
}

/** Comment text for display (commands removed). */
export function commentText(raw: string | undefined): string {
  return raw ? parseComment(raw).text : '';
}
