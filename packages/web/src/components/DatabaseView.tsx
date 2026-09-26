/** Database browser: filters, virtualized game list and a preview pane. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Game, type GameNode, parseGame } from '@pgnx/core';
import { type GameQuery, type GameRow, api } from '../api';
import { Board } from '../board/Board';
import { useGameStore } from '../state/gameStore';
import { navigate } from '../state/router';
import { useSettings } from '../state/settings';
import { IconDownload, IconFirst, IconLast, IconNext, IconPrev, IconSearch, IconX } from './icons';
import { toastError } from './Toasts';

const FILTER_KEYS = [
  'player', 'color', 'opponent', 'white', 'black', 'event', 'site', 'dateFrom', 'dateTo', 'result', 'minElo', 'maxElo',
  'eco', 'opening', 'minPlies', 'maxPlies', 'annotated', 'fen', 'sort', 'order',
] as const;

type Filters = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

export function filtersFromParams(p: URLSearchParams): Filters {
  const f: Filters = {};
  for (const k of FILTER_KEYS) {
    const v = p.get(k);
    if (v) f[k] = v;
  }
  return f;
}

function paramsFromFilters(f: Filters): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) if (f[k]) p.set(k, f[k]!);
  return p.toString();
}

function toQuery(f: Filters): GameQuery {
  const n = (v?: string) => (v ? Number(v) : undefined);
  return {
    player: f.player,
    color: (f.color as GameQuery['color']) || undefined,
    opponent: f.opponent,
    white: f.white,
    black: f.black,
    event: f.event,
    site: f.site,
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    result: f.result,
    minElo: n(f.minElo),
    maxElo: n(f.maxElo),
    eco: f.eco,
    opening: f.opening,
    minPlies: n(f.minPlies) ? n(f.minPlies)! * 2 - 1 : undefined,
    maxPlies: n(f.maxPlies) ? n(f.maxPlies)! * 2 : undefined,
    annotated: f.annotated === '1' ? true : undefined,
    fen: f.fen,
    sort: f.sort ?? 'date',
    order: (f.order as 'asc' | 'desc') ?? 'desc',
  };
}

// ---------------------------------------------------------------- autocomplete input

function Suggest({ kind, value, onChange, placeholder, onEnter }: {
  kind: 'players' | 'events' | 'sites';
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onEnter: () => void;
}) {
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useMemo(() => `sg-${Math.random().toString(36).slice(2)}`, []);
  useEffect(() => {
    if (!open || value.trim().length < 2) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => api.suggest(kind, value, ctrl.signal).then(setItems).catch(() => {}), 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value, open, kind]);
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            setActive((a) => Math.min(items.length - 1, a + 1));
            e.preventDefault();
          } else if (e.key === 'ArrowUp') {
            setActive((a) => Math.max(-1, a - 1));
            e.preventDefault();
          } else if (e.key === 'Enter') {
            if (active >= 0 && items[active]) onChange(items[active]);
            setOpen(false);
            setTimeout(onEnter, 0);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        autoComplete="off"
      />
      {open && items.length > 0 && (
        <div id={listId} className="ctx-menu" style={{ position: 'absolute', top: 34, left: 0, right: 0 }} role="listbox">
          {items.map((it, i) => (
            <button
              key={it}
              style={{ background: i === active ? 'var(--bg-hover)' : undefined }}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(it);
                setOpen(false);
              }}
            >
              {it}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- filters

function FilterPanel({ filters, onApply }: { filters: Filters; onApply: (f: Filters) => void }) {
  const [draft, setDraft] = useState<Filters>(filters);
  useEffect(() => setDraft(filters), [filters]);
  const set = (k: keyof Filters) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const input = (k: keyof Filters, placeholder: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      className="input"
      value={draft[k] ?? ''}
      placeholder={placeholder}
      onChange={(e) => set(k)(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onApply(draft)}
      {...props}
    />
  );
  const apply = () => onApply(draft);
  return (
    <form
      className="filters"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <div className="field">
        <label>Player</label>
        <Suggest kind="players" value={draft.player ?? ''} onChange={set('player')} placeholder="Name (part of it is enough)" onEnter={() => onApply({ ...draft })} />
        <div className="row">
          <select className="select" value={draft.color ?? 'any'} onChange={(e) => set('color')(e.target.value === 'any' ? '' : e.target.value)}>
            <option value="any">as White or Black</option>
            <option value="white">as White</option>
            <option value="black">as Black</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Opponent</label>
        <Suggest kind="players" value={draft.opponent ?? ''} onChange={set('opponent')} placeholder="Opponent name" onEnter={apply} />
      </div>
      <div className="field">
        <label>Result</label>
        <select className="select" value={draft.result ?? ''} onChange={(e) => set('result')(e.target.value)}>
          <option value="">Any result</option>
          <option value="1-0">1-0 (White wins)</option>
          <option value="0-1">0-1 (Black wins)</option>
          <option value="1/2-1/2">½-½ (Draw)</option>
          <option value="*">* (Unfinished)</option>
          {draft.player && <option value="win">Player won</option>}
          {draft.player && <option value="loss">Player lost</option>}
          {draft.player && <option value="draw">Player drew</option>}
        </select>
      </div>
      <div className="field">
        <label>Event / Site</label>
        <Suggest kind="events" value={draft.event ?? ''} onChange={set('event')} placeholder="Event" onEnter={apply} />
        <Suggest kind="sites" value={draft.site ?? ''} onChange={set('site')} placeholder="Site" onEnter={apply} />
      </div>
      <div className="field">
        <label>Date</label>
        <div className="two">
          {input('dateFrom', 'From (YYYY[.MM.DD])')}
          {input('dateTo', 'To')}
        </div>
      </div>
      <div className="field">
        <label>Rating</label>
        <div className="two">
          {input('minElo', 'Both ≥', { inputMode: 'numeric' })}
          {input('maxElo', 'Both ≤', { inputMode: 'numeric' })}
        </div>
      </div>
      <div className="field">
        <label>Opening</label>
        <div className="two">
          {input('eco', 'ECO: B90, B9, B90-B99')}
          {input('opening', 'Name, e.g. Najdorf')}
        </div>
      </div>
      <div className="field">
        <label>Length (moves)</label>
        <div className="two">
          {input('minPlies', 'Min', { inputMode: 'numeric' })}
          {input('maxPlies', 'Max', { inputMode: 'numeric' })}
        </div>
      </div>
      <label className="switch">
        <input type="checkbox" checked={draft.annotated === '1'} onChange={(e) => set('annotated')(e.target.checked ? '1' : '')} />
        <span className="track" /> Only annotated games
      </label>
      <div className="field">
        <label>Position</label>
        <div className="row">
          <input className="input mono" value={draft.fen ?? ''} placeholder="FEN (any position)" onChange={(e) => set('fen')(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn sm"
          onClick={() => setDraft((d) => ({ ...d, fen: useGameStore.getState().node.fen }))}
          title="Use the position on the analysis board"
        >
          Use analysis board position
        </button>
      </div>
      <div className="row" style={{ position: 'sticky', bottom: -14, background: 'var(--bg-elev)', padding: '8px 0' }}>
        <button className="btn primary grow" type="submit">
          <IconSearch /> Search
        </button>
        <button type="button" className="btn" onClick={() => onApply({ sort: draft.sort, order: draft.order })}>
          Reset
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- virtualized table

const ROW_H = 32;
const PAGE = 100;
const COLS = '78px minmax(120px, 1.4fr) 52px minmax(120px, 1.4fr) 52px 58px 92px minmax(100px, 1.2fr) 48px 56px';
const HEADERS: Array<[string, string | null]> = [
  ['#', 'id'], ['White', 'white'], ['Elo', 'whiteElo'], ['Black', 'black'], ['Elo', 'blackElo'], ['Result', 'result'],
  ['Date', 'date'], ['Event', 'event'], ['ECO', 'eco'], ['Moves', 'plies'],
];

function GameTable({ query, selected, onSelect, onOpen, onTotal }: {
  query: GameQuery;
  selected: number | null;
  onSelect: (row: GameRow) => void;
  onOpen: (row: GameRow) => void;
  onTotal: (total: number, capped: boolean, ms: number) => void;
}) {
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState<Map<number, GameRow[]>>(new Map());
  const [range, setRange] = useState({ start: 0, end: 40 });
  const [loadingFirst, setLoadingFirst] = useState(true);
  const inflight = useRef(new Set<number>());
  const ref = useRef<HTMLDivElement>(null);
  const queryKey = JSON.stringify(query);
  const gen = useRef(0);

  const fetchPage = useCallback(async (page: number, g: number) => {
    if (inflight.current.has(page)) return;
    inflight.current.add(page);
    try {
      const r = await api.search({ ...query, offset: page * PAGE, limit: PAGE });
      if (g !== gen.current) return;
      setPages((p) => new Map(p).set(page, r.games));
      if (page === 0) {
        setTotal(r.total);
        onTotal(r.total, r.totalCapped, r.elapsedMs);
        setLoadingFirst(false);
      }
    } catch (e) {
      if (g === gen.current) {
        toastError(e);
        setLoadingFirst(false);
      }
    } finally {
      inflight.current.delete(page);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  useEffect(() => {
    gen.current++;
    inflight.current.clear();
    setPages(new Map());
    setTotal(0);
    setLoadingFirst(true);
    if (ref.current) ref.current.scrollTop = 0;
    void fetchPage(0, gen.current);
  }, [fetchPage]);

  useEffect(() => {
    const first = Math.floor(range.start / PAGE);
    const last = Math.floor(Math.min(range.end, Math.max(0, total - 1)) / PAGE);
    for (let p = first; p <= last; p++) if (!pages.has(p)) void fetchPage(p, gen.current);
  }, [range, total, pages, fetchPage]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const start = Math.max(0, Math.floor(el.scrollTop / ROW_H) - 10);
    const end = Math.ceil((el.scrollTop + el.clientHeight) / ROW_H) + 10;
    if (start !== range.start || end !== range.end) setRange({ start, end });
  };
  useEffect(onScroll, []);

  const rowAt = (i: number): GameRow | undefined => pages.get(Math.floor(i / PAGE))?.[i % PAGE];

  const sortBy = (key: string | null) => {
    if (!key) return;
    const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
    const same = (params.get('sort') ?? 'date') === key;
    params.set('sort', key);
    params.set('order', same && (params.get('order') ?? 'desc') === 'desc' ? 'asc' : 'desc');
    navigate(`/database?${params}`, true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
    e.preventDefault();
    let idx = -1;
    for (let i = range.start; i < Math.min(total, range.end + PAGE); i++) if (rowAt(i)?.id === selected) idx = i;
    if (e.key === 'Enter') {
      const r = idx >= 0 ? rowAt(idx) : undefined;
      if (r) onOpen(r);
      return;
    }
    const next = Math.max(0, Math.min(total - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
    const r = rowAt(next);
    if (r) {
      onSelect(r);
      const el = ref.current!;
      if (next * ROW_H < el.scrollTop) el.scrollTop = next * ROW_H;
      else if ((next + 2) * ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = (next + 2) * ROW_H - el.clientHeight;
    }
  };

  const rows = [];
  for (let i = range.start; i < Math.min(total, range.end); i++) {
    const g = rowAt(i);
    const top = ROW_H + i * ROW_H;
    if (!g) {
      rows.push(
        <div key={`l${i}`} className="gtable-row loading" style={{ top }}>
          {HEADERS.map((_, k) => <div key={k}><span className="skeleton" /></div>)}
        </div>,
      );
      continue;
    }
    rows.push(
      <div
        key={g.id}
        className={`gtable-row${g.id === selected ? ' selected' : ''}`}
        style={{ top }}
        onClick={() => onSelect(g)}
        onDoubleClick={() => onOpen(g)}
      >
        <div className="num">{g.id}</div>
        <div title={g.white}>{g.white}</div>
        <div className="num">{g.whiteElo ?? ''}</div>
        <div title={g.black}>{g.black}</div>
        <div className="num">{g.blackElo ?? ''}</div>
        <div className="res">{g.result.replace('1/2-1/2', '½-½')}</div>
        <div className="num" style={{ textAlign: 'left' }}>{g.date.replace(/\.\?\?/g, '')}</div>
        <div title={[g.event, g.site, g.round && `R${g.round}`].filter(Boolean).join(' · ')}>{g.event ?? ''}</div>
        <div title={g.opening ?? ''}>{g.eco ?? ''}</div>
        <div className="num">{Math.ceil(g.plies / 2)}{g.annotated ? ' ✎' : ''}</div>
      </div>,
    );
  }

  return (
    <div className="gtable" ref={ref} onScroll={onScroll} tabIndex={0} onKeyDown={onKeyDown} style={{ '--cols': COLS } as React.CSSProperties}>
      <div className="gtable-head">
        {HEADERS.map(([label, key]) => (
          <div key={label + key} className={query.sort === key ? 'sorted' : ''} onClick={() => sortBy(key)} title={key ? 'Sort' : undefined}>
            {label}
            {query.sort === key ? (query.order === 'asc' ? ' ▲' : ' ▼') : ''}
          </div>
        ))}
      </div>
      <div style={{ height: total * ROW_H }} />
      {rows}
      {!loadingFirst && total === 0 && (
        <div className="empty" style={{ position: 'absolute', top: 60, left: 0, right: 0 }}>
          <h3>No games found</h3>
          Adjust the filters, or import PGN files into the database.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- preview

function Preview({ row, onOpen }: { row: GameRow; onOpen: (ply?: number) => void }) {
  const [game, setGame] = useState<Game | null>(null);
  const [node, setNode] = useState<GameNode | null>(null);
  const settings = useSettings();
  useEffect(() => {
    let alive = true;
    api
      .game(row.id)
      .then((d) => {
        if (!alive) return;
        const g = parseGame(d.pgn);
        setGame(g);
        let n = g.root;
        if (row.ply) while (n.children.length && n.ply < row.ply) n = n.children[0];
        else n = g.end();
        setNode(n);
      })
      .catch(toastError);
    return () => {
      alive = false;
    };
  }, [row.id, row.ply]);
  if (!game || !node) return <div className="empty"><span className="spinner" /></div>;
  const main = game.mainline();
  const idx = node.parent ? main.indexOf(node) : -1;
  const go = (i: number) => setNode(i < 0 ? game.root : main[Math.min(i, main.length - 1)]);
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="players" style={{ fontSize: 14 }}>
        <span className="color-dot w" /> {row.white} {row.whiteElo && <span className="elo">{row.whiteElo}</span>}
      </div>
      <div className="players" style={{ fontSize: 14 }}>
        <span className="color-dot b" /> {row.black} {row.blackElo && <span className="elo">{row.blackElo}</span>}
        <span className="result">{row.result.replace('1/2-1/2', '½-½')}</span>
      </div>
      <div className="game-meta">
        {row.event && <span>{row.event}</span>}
        {row.site && <span>{row.site}</span>}
        <span>{row.date.replace(/\.\?\?/g, '')}</span>
      </div>
      {row.opening && <div className="opening-name"><span className="eco">{row.eco}</span>{row.opening}</div>}
      <Board
        fen={node.fen}
        orientation={settings.orientation}
        lastMove={node.move ? [node.move & 63, (node.move >> 6) & 63] : null}
        showCoordinates={false}
        animation={settings.animation}
        theme={settings.boardTheme}
        onWheel={(d) => go(idx + d)}
      />
      <div className="row">
        <button className="btn icon" onClick={() => go(-1)}><IconFirst /></button>
        <button className="btn icon" onClick={() => go(idx - 1)}><IconPrev /></button>
        <button className="btn icon" onClick={() => go(idx + 1)}><IconNext /></button>
        <button className="btn icon" onClick={() => go(main.length - 1)}><IconLast /></button>
        <span className="spacer" />
        <span className="muted small">{node.parent ? `${Math.ceil(node.ply / 2)}${node.ply % 2 ? '.' : '…'} ${node.san}` : 'Start'}</span>
      </div>
      <input type="range" min={-1} max={main.length - 1} value={idx} onChange={(e) => go(+e.target.value)} aria-label="Move slider" />
      <button className="btn primary" onClick={() => onOpen(node.ply)}>Open in analysis board</button>
    </div>
  );
}

// ---------------------------------------------------------------- view

export function DatabaseView({ params, gameCount }: { params: URLSearchParams; gameCount: number }) {
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const query = useMemo(() => toQuery(filters), [filters]);
  const [selected, setSelected] = useState<GameRow | null>(null);
  const [stats, setStats] = useState<{ total: number; capped: boolean; ms: number } | null>(null);

  const apply = (f: Filters) => navigate(`/database?${paramsFromFilters(f)}`, true);
  const open = (row: GameRow, ply?: number) => navigate(`/game/${row.id}?ply=${ply ?? row.ply ?? 0}`);
  const activeFilters = Object.entries(filters).filter(([k, v]) => v && k !== 'sort' && k !== 'order');

  return (
    <div className="database">
      <FilterPanel filters={filters} onApply={apply} />
      <section className="results">
        <div className="results-toolbar">
          <b>
            {stats ? `${stats.total.toLocaleString()}${stats.capped ? '+' : ''} games` : 'Searching…'}
          </b>
          {stats && <span className="faint small">{stats.ms} ms</span>}
          {activeFilters.length === 0 && gameCount > 0 && <span className="faint small">(whole database)</span>}
          {activeFilters.map(([k, v]) => (
            <span key={k} className="badge accent" title={k}>
              {k === 'fen' ? 'position' : `${k}: ${v}`}
              <button
                className="btn ghost icon sm"
                style={{ width: 16, height: 16, marginLeft: 4 }}
                onClick={() => apply({ ...filters, [k]: '' })}
                aria-label={`Remove ${k} filter`}
              >
                <IconX />
              </button>
            </span>
          ))}
          <span className="spacer" />
          <a className="btn sm" href={api.exportUrl(query)} download title="Export all matching games as PGN">
            <IconDownload /> Export PGN
          </a>
        </div>
        <GameTable
          query={query}
          selected={selected?.id ?? null}
          onSelect={setSelected}
          onOpen={(r) => open(r)}
          onTotal={(total, capped, ms) => setStats({ total, capped, ms })}
        />
      </section>
      <aside className="preview">
        {selected ? (
          <Preview key={selected.id} row={selected} onOpen={(ply) => open(selected, ply)} />
        ) : (
          <div className="empty">
            <h3>No game selected</h3>
            Click a game to preview it; double-click or press Enter to open it on the analysis board.
          </div>
        )}
      </aside>
    </div>
  );
}

