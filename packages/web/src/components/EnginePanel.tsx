import { formatScore } from '../engine/engine';
import { useEngineState } from '../engine/useEngine';
import { useGameStore } from '../state/gameStore';
import { useSettings } from '../state/settings';
import { useExplorerHover } from './explorerHover';

function fmtNodes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}G`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

export function EnginePanel({ nativeAvailable }: { nativeAvailable: boolean }) {
  const s = useSettings();
  const { analysis, engineName, error, ready } = useEngineState();
  const node = useGameStore((st) => st.node);
  const playLine = useGameStore((st) => st.playLine);
  const setHover = useExplorerHover((h) => h.set);
  const fresh = analysis && analysis.fen === node.fen ? analysis : null;
  const best = fresh?.lines[0];
  const backend = s.engineBackend === 'native' && nativeAvailable ? 'native' : 'wasm';

  return (
    <div className="card panel">
      <div className="engine-head">
        <label className="switch" title="Toggle engine (L)">
          <input type="checkbox" checked={s.engineOn} onChange={(e) => s.set('engineOn', e.target.checked)} />
          <span className="track" />
        </label>
        {s.engineOn && best ? (
          <div className="eval">{formatScore(best.score)}</div>
        ) : (
          <div className="eval faint">{s.engineOn ? '…' : '—'}</div>
        )}
        <div className="meta">
          <div className="ellipsis">
            {s.engineOn ? engineName || (error ? 'Engine error' : 'Starting engine…') : 'Engine off'}
            <span className="faint"> · {backend === 'native' ? 'native Stockfish' : 'Stockfish WASM'}</span>
          </div>
          {s.engineOn && fresh && (
            <div className="faint">
              depth {fresh.depth} · {fmtNodes(fresh.nodes)} nodes · {fmtNodes(fresh.nps)}/s
              {best?.wdl && ` · W${(best.wdl[0] / 10).toFixed(0)} D${(best.wdl[1] / 10).toFixed(0)} L${(best.wdl[2] / 10).toFixed(0)}`}
            </div>
          )}
          {s.engineOn && !ready && !error && <div className="faint">Loading…</div>}
          {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        </div>
        <div className="engine-opts">
        <select className="select" style={{ width: 'auto' }} value={s.multiPv} onChange={(e) => s.set('multiPv', +e.target.value)} title="Number of lines">
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'line' : 'lines'}
            </option>
          ))}
        </select>
        <select
          className="select hide-sm"
          style={{ width: 'auto' }}
          value={backend}
          onChange={(e) => s.set('engineBackend', e.target.value as 'native' | 'wasm')}
          title="Engine backend"
        >
          <option value="native" disabled={!nativeAvailable}>
            Native{nativeAvailable ? '' : ' (not found)'}
          </option>
          <option value="wasm">WASM</option>
        </select>
        </div>
      </div>
      {s.engineOn && fresh && fresh.lines.length > 0 && (
        <div className="pv-lines">
          {fresh.lines.map((l) => {
            const sc = l.score;
            const positive = sc.mate !== undefined ? sc.mate > 0 || (sc.mate === 0 && (sc.cp ?? 0) > 0) : (sc.cp ?? 0) >= 0;
            const startPly = node.ply;
            return (
              <div key={l.multipv} className="pv-line">
                <span className={`score ${positive ? 'pos' : 'neg'}`}>{formatScore(sc)}</span>
                <span className="pv">
                  {l.san.map((san, i) => {
                    const ply = startPly + i;
                    const white = ply % 2 === 0;
                    const num = white ? `${ply / 2 + 1}.` : i === 0 ? `${(ply + 1) / 2}…` : '';
                    return (
                      <span key={i}>
                        {num && <span className="num">{num}</span>}
                        <span
                          onClick={() => playLine(l.uci.slice(0, i + 1))}
                          onMouseEnter={() => i === 0 && setHover(l.uci[0])}
                          onMouseLeave={() => setHover(null)}
                          title="Play this line up to here"
                        >
                          {san}
                        </span>{' '}
                      </span>
                    );
                  })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
