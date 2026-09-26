/** Computer analysis of the whole game: evaluation graph, move judgements and annotation. */
import { useEffect, useState } from 'react';
import { annotateGame, analyzeGame, judge, useGameAnalysis } from '../engine/gameAnalysis';
import { winningChances } from '../engine/engine';
import { useGameStore } from '../state/gameStore';
import { useSettings } from '../state/settings';
import { toast } from './Toasts';

const W = 600;
const H = 90;

export function GameAnalysisPanel({ nativeAvailable }: { nativeAvailable: boolean }) {
  const game = useGameStore((s) => s.game);
  const current = useGameStore((s) => s.node);
  useGameStore((s) => s.version);
  const goTo = useGameStore((s) => s.goTo);
  const { evals, running: anyRunning, done, total, cancel, rootId } = useGameAnalysis();
  const running = anyRunning && rootId === game.root.id;
  // Stop analysing when another game is opened.
  useEffect(() => {
    const st = useGameAnalysis.getState();
    if (st.running && st.rootId !== game.root.id) st.cancel?.();
  }, [game]);
  const settings = useSettings();
  const [depth, setDepth] = useState(16);
  const main = game.mainline();
  const hasEvals = evals.has(game.root.id);

  if (!main.length) return null;

  const start = () => {
    const backend = settings.engineBackend === 'native' && nativeAvailable ? 'native' : 'wasm';
    void analyzeGame(game, { backend, depth, threads: settings.engineThreads });
  };

  if (!hasEvals && !running) {
    return (
      <div className="card" style={{ padding: '8px 10px' }}>
        <div className="row">
          <span className="grow small muted">Computer analysis of all {main.length} moves</span>
          <select className="select" style={{ width: 'auto' }} value={depth} onChange={(e) => setDepth(+e.target.value)} title="Search depth per move">
            {[10, 12, 14, 16, 18, 20, 22].map((d) => (
              <option key={d} value={d}>depth {d}</option>
            ))}
          </select>
          <button className="btn primary sm" onClick={start}>Analyse game</button>
        </div>
      </div>
    );
  }

  const nodes = [game.root, ...main];
  const points = nodes.map((n, i) => {
    const e = evals.get(n.id);
    const wc = e ? winningChances(e.score) : null;
    return { n, x: (i / Math.max(1, nodes.length - 1)) * W, y: wc === null ? null : H / 2 - (wc * H) / 2 };
  });
  const known = points.filter((p) => p.y !== null) as Array<{ n: typeof nodes[0]; x: number; y: number }>;
  // White's share is the area below the curve.
  const area = known.length
    ? `M0,${H} ${known.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} L${known[known.length - 1].x.toFixed(1)},${H} Z`
    : '';
  const counts = { white: { inaccuracy: 0, mistake: 0, blunder: 0 }, black: { inaccuracy: 0, mistake: 0, blunder: 0 } };
  const marks: Array<{ x: number; y: number; kind: string; n: typeof nodes[0] }> = [];
  for (const p of known) {
    const j = judge(p.n, evals);
    if (!j) continue;
    counts[p.n.ply % 2 === 1 ? 'white' : 'black'][j]++;
    marks.push({ x: p.x, y: p.y, kind: j, n: p.n });
  }
  const cur = points.find((p) => p.n === current);
  const color = { inaccuracy: '#56b4e9', mistake: '#e69f00', blunder: '#df5353' } as Record<string, string>;

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left) / rect.width) * (nodes.length - 1));
    goTo(nodes[Math.max(0, Math.min(nodes.length - 1, i))]);
  };

  const summary = (side: 'white' | 'black') => {
    const c = counts[side];
    return (
      <span className="small">
        <span className={`color-dot ${side[0]}`} style={{ display: 'inline-block', marginRight: 4 }} />
        <span style={{ color: color.inaccuracy }}>{c.inaccuracy} ?!</span> · <span style={{ color: color.mistake }}>{c.mistake} ?</span> ·{' '}
        <span style={{ color: color.blunder }}>{c.blunder} ??</span>
      </span>
    );
  };

  return (
    <div className="card" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 80, cursor: 'pointer', borderRadius: 4, background: 'var(--black-bar)' }} onClick={onClick}>
        <rect x={0} y={0} width={W} height={H} fill="var(--black-bar)" />
        <path d={area} fill="var(--white-bar)" />
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="rgba(214,79,0,0.5)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {marks.map((m, i) => (
          <circle key={i} cx={m.x} cy={m.y} r={3.5} fill={color[m.kind]} vectorEffect="non-scaling-stroke" />
        ))}
        {cur && <line x1={cur.x} x2={cur.x} y1={0} y2={H} stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="row wrap">
        {running ? (
          <>
            <div className="progress grow">
              <div style={{ width: `${(100 * done) / Math.max(1, total)}%` }} />
            </div>
            <span className="small muted nowrap">
              {done}/{total}
            </span>
            <button className="btn sm" onClick={() => cancel?.()}>Stop</button>
          </>
        ) : (
          <>
            {summary('white')}
            {summary('black')}
            <span className="spacer" />
            <button
              className="btn sm"
              onClick={() => {
                const n = annotateGame(game, evals);
                useGameStore.getState().markChanged();
                toast(`Added evaluations and ${n} move annotation${n === 1 ? '' : 's'} to the game`, 'success');
              }}
            >
              Add to notation
            </button>
            <button className="btn sm ghost" onClick={() => useGameAnalysis.setState({ evals: new Map() })}>Clear</button>
          </>
        )}
      </div>
    </div>
  );
}
