import { useEffect, useState } from 'react';
import { type ExplorerResult, type GameRow, api } from '../api';
import { useGameStore } from '../state/gameStore';
import { navigate } from '../state/router';
import { useSettings } from '../state/settings';
import { useExplorerHover } from './explorerHover';

function pct(n: number, total: number) {
  return total ? (100 * n) / total : 0;
}

export function WdlBar({ w, d, b }: { w: number; d: number; b: number }) {
  const total = w + d + b;
  const pw = pct(w, total);
  const pd = pct(d, total);
  const pb = pct(b, total);
  const label = (p: number) => (p >= 12 ? `${Math.round(p)}%` : '');
  return (
    <div className="wdl-bar" title={`White ${pw.toFixed(1)}% · Draw ${pd.toFixed(1)}% · Black ${pb.toFixed(1)}%`}>
      <span className="w" style={{ width: `${pw}%` }}>{label(pw)}</span>
      <span className="d" style={{ width: `${pd}%` }}>{label(pd)}</span>
      <span className="b" style={{ width: `${pb}%` }}>{label(pb)}</span>
    </div>
  );
}

const ELO_OPTIONS = [0, 1600, 1800, 2000, 2200, 2400, 2500, 2600, 2700];

export function MiniGameList({ games, onOpen }: { games: Array<GameRow & { ply?: number }>; onOpen: (g: GameRow & { ply?: number }) => void }) {
  return (
    <div className="mini-games">
      {games.map((g) => (
        <div key={g.id} className="mini-game" onClick={() => onOpen(g)} title="Open game at this position">
          <div className="ellipsis">
            <b>{g.white}</b> {g.whiteElo ? <span className="faint">{g.whiteElo}</span> : null} – <b>{g.black}</b>{' '}
            {g.blackElo ? <span className="faint">{g.blackElo}</span> : null}
          </div>
          <div className="res">{g.result.replace('1/2-1/2', '½-½')}</div>
          <div className="faint ellipsis">
            {[g.event, g.date.replace(/\.\?\?/g, '')].filter(Boolean).join(' · ')}
          </div>
          <div className="faint">{g.eco ?? ''}</div>
        </div>
      ))}
    </div>
  );
}

export function ExplorerPanel() {
  const node = useGameStore((s) => s.node);
  const playUci = useGameStore((s) => s.playUci);
  const filters = useSettings((s) => s.explorerFilters);
  const setSetting = useSettings((s) => s.set);
  const setHover = useExplorerHover((s) => s.set);
  const [data, setData] = useState<ExplorerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      api
        .explorer(node.fen, filters, ctrl.signal)
        .then((r) => {
          setData(r);
          setError(null);
        })
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        })
        .finally(() => setLoading(false));
    }, 60);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [node.fen, filters]);

  useEffect(() => () => setHover(null), [setHover]);

  const openGame = (g: GameRow & { ply?: number }) => navigate(`/game/${g.id}?ply=${g.ply ?? 0}`);
  const fresh = data && data.fen.split(' ').slice(0, 4).join(' ') === node.fen.split(' ').slice(0, 4).join(' ') ? data : null;
  const total = fresh?.total;

  return (
    <div className="panel fill">
      <div className="explorer-head">
        <div className="row">
          <div className="grow ellipsis">
            {fresh?.opening ? (
              <span className="opening-name">
                <span className="eco">{fresh.opening.eco}</span>
                {fresh.opening.name}
              </span>
            ) : (
              <span className="muted">Opening explorer</span>
            )}
          </div>
          {loading && <span className="spinner" />}
          {fresh && !loading && <span className="faint small">{fresh.elapsedMs} ms</span>}
        </div>
        <div className="row wrap">
          <select
            className="select"
            style={{ width: 'auto' }}
            value={filters.minElo ?? 0}
            onChange={(e) => setSetting('explorerFilters', { ...filters, minElo: +e.target.value || undefined })}
            title="Minimum average rating"
          >
            {ELO_OPTIONS.map((e) => (
              <option key={e} value={e}>
                {e ? `Avg Elo ≥ ${e}` : 'Any rating'}
              </option>
            ))}
          </select>
          <input
            className="input"
            style={{ width: 90 }}
            placeholder="From year"
            inputMode="numeric"
            defaultValue={filters.yearFrom ?? ''}
            onBlur={(e) => setSetting('explorerFilters', { ...filters, yearFrom: +e.target.value || undefined })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <input
            className="input"
            style={{ width: 90 }}
            placeholder="To year"
            inputMode="numeric"
            defaultValue={filters.yearTo ?? ''}
            onBlur={(e) => setSetting('explorerFilters', { ...filters, yearTo: +e.target.value || undefined })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
      </div>
      <div className="panel-body">
        {error && <div className="empty" style={{ color: 'var(--danger)' }}>{error}</div>}
        {fresh && total && total.games === 0 && (
          <div className="empty">
            <h3>No games in the database reach this position</h3>
            {node.ply > fresh.indexPlies ? `The position index covers the first ${fresh.indexPlies} plies of each game.` : 'Try widening the filters or importing more games.'}
          </div>
        )}
        {fresh && total && total.games > 0 && (
          <>
            <table className="explorer-table">
              <thead>
                <tr>
                  <th>Move</th>
                  <th className="num">Games</th>
                  <th style={{ width: '45%' }}>White / Draw / Black</th>
                  <th className="num">Ø Elo</th>
                </tr>
              </thead>
              <tbody>
                {fresh.moves.map((m) => (
                  <tr
                    key={m.uci}
                    onClick={() => {
                      setHover(null);
                      playUci(m.uci);
                    }}
                    onMouseEnter={() => setHover(m.uci)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <td className="san">{m.san}</td>
                    <td className="num">
                      {m.games.toLocaleString()}
                      <div className="faint small">{pct(m.games, total.games).toFixed(1)}%</div>
                    </td>
                    <td>
                      <WdlBar w={m.white} d={m.draws} b={m.black} />
                    </td>
                    <td className="num">{m.avgElo ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Σ</td>
                  <td className="num">{total.games.toLocaleString()}</td>
                  <td>
                    <WdlBar w={total.white} d={total.draws} b={total.black} />
                  </td>
                  <td />
                </tr>
                {fresh.ended > 0 && (
                  <tr>
                    <td colSpan={4} className="faint small">
                      {fresh.ended.toLocaleString()} game{fresh.ended > 1 ? 's' : ''} ended in this position
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
            <div className="section-title row">
              <span className="grow">Top games</span>
              <button className="btn ghost sm" onClick={() => navigate(`/database?fen=${encodeURIComponent(node.fen)}`)}>
                All {total.games.toLocaleString()} games →
              </button>
            </div>
            <MiniGameList games={fresh.topGames} onOpen={openGame} />
            {fresh.recentGames.length > 0 && (
              <>
                <div className="section-title">Recent games</div>
                <MiniGameList games={fresh.recentGames} onOpen={openGame} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
