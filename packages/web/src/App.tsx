import { useCallback, useEffect, useState } from 'react';
import { type Info, api } from './api';
import { AnalysisView, type SideTab } from './components/AnalysisView';
import { DatabaseView } from './components/DatabaseView';
import { ImportDialog, OpenPgnDialog, SettingsDialog, ShortcutsDialog } from './components/Dialogs';
import {
  IconBoard, IconDb, IconFile, IconKeyboard, IconMonitor, IconMoon, IconPlus, IconSettings, IconSun, IconUpload,
} from './components/icons';
import { Toasts, toast, toastError } from './components/Toasts';
import { useEngineDriver } from './engine/useEngine';
import { useGameStore } from './state/gameStore';
import { navigate, parseHash, useHash } from './state/router';
import { useSettings } from './state/settings';

function useTheme() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const m = matchMedia('(prefers-color-scheme: dark)');
    m.addEventListener('change', apply);
    return () => m.removeEventListener('change', apply);
  }, [theme]);
}

type DialogKind = 'import' | 'open' | 'settings' | 'shortcuts' | null;

export function App() {
  useTheme();
  const hash = useHash();
  const route = parseHash(hash);
  const [info, setInfo] = useState<Info | null>(null);
  const [offline, setOffline] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [tab, setTab] = useState<SideTab>('moves');
  const settings = useSettings();

  const refreshInfo = useCallback(() => {
    api.info().then((i) => {
      setInfo(i);
      setOffline(false);
    }).catch(() => setOffline(true));
  }, []);
  useEffect(refreshInfo, [refreshInfo]);
  // While an import runs in the background, poll for progress and refresh stats when it ends.
  const [importPct, setImportPct] = useState<number | null>(null);
  useEffect(() => {
    if (!info?.importing) {
      setImportPct(null);
      return;
    }
    const t = setInterval(async () => {
      try {
        const jobs = await api.jobs();
        const running = jobs.find((j) => j.status === 'running');
        const p = running?.progress;
        setImportPct(p ? (p.phase === 'indexing' ? 100 : Math.round((100 * p.bytesRead) / Math.max(1, p.totalBytes))) : 0);
        if (!running && !jobs.some((j) => j.status === 'queued')) refreshInfo();
      } catch {
        /* server restarting */
      }
    }, 1500);
    return () => clearInterval(t);
  }, [info?.importing, refreshInfo]);
  useEngineDriver(!!info?.engine.available);

  // Load games referenced by the URL.
  const gameId = route.gameId;
  const plyParam = route.params.get('ply');
  const fenParam = route.view === 'analysis' ? route.params.get('fen') : null;
  useEffect(() => {
    if (gameId === undefined) return;
    const st = useGameStore.getState();
    const ply = plyParam !== null ? +plyParam : undefined;
    if (st.gameId === gameId) {
      if (ply !== undefined) {
        let n = st.game.root;
        while (n.children.length && n.ply < ply) n = n.children[0];
        st.goTo(n);
      }
      return;
    }
    if (st.dirty && !confirm('Discard unsaved changes to the current game?')) return;
    api
      .game(gameId)
      .then((g) => useGameStore.getState().loadPgn(g.pgn, { gameId: g.id, ply }))
      .catch(toastError);
  }, [gameId, plyParam]);
  useEffect(() => {
    if (!fenParam) return;
    try {
      useGameStore.getState().newGame(fenParam);
    } catch (e) {
      toastError(e);
    }
  }, [fenParam]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || dialog) return;
      const g = useGameStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const pgn = g.toPgn();
        (g.gameId !== null ? api.updateGame(g.gameId, pgn).then(() => g.gameId!) : api.createGame(pgn).then((r) => r.id))
          .then((id) => {
            useGameStore.getState().markSaved(id);
            toast('Game saved', 'success');
          })
          .catch(toastError);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (route.view !== 'analysis') return;
      switch (e.key) {
        case 'ArrowLeft': g.back(); break;
        case 'ArrowRight': g.forward(); break;
        case 'Home': g.toStart(); break;
        case 'End': g.toEnd(); break;
        case 'ArrowUp': g.switchVariation(-1); break;
        case 'ArrowDown': g.switchVariation(1); break;
        case 'f': settings.set('orientation', settings.orientation === 'white' ? 'black' : 'white'); break;
        case 'l': settings.set('engineOn', !settings.engineOn); break;
        case 'e': setTab((x) => (x === 'moves' ? 'explorer' : 'moves')); break;
        case '?': setDialog('shortcuts'); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.view, dialog, settings]);

  const newGame = () => {
    const st = useGameStore.getState();
    if (st.dirty && !confirm('Discard unsaved changes to the current game?')) return;
    st.newGame();
    navigate('/analysis');
  };

  const cycleTheme = () => settings.set('theme', settings.theme === 'system' ? 'light' : settings.theme === 'light' ? 'dark' : 'system');
  const ThemeIcon = settings.theme === 'dark' ? IconMoon : settings.theme === 'light' ? IconSun : IconMonitor;
  const stats = info?.stats;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-logo"><span /><span /><span /><span /></div>
          <span className="hide-sm">PGN Explorer</span>
        </div>
        <nav className="nav">
          <button className={`btn${route.view === 'analysis' ? ' active' : ''}`} onClick={() => navigate(gameId ? `/game/${gameId}` : '/analysis')}>
            <IconBoard /> <span className="hide-sm">Analysis</span>
          </button>
          <button className={`btn${route.view === 'database' ? ' active' : ''}`} onClick={() => navigate('/database')}>
            <IconDb /> <span className="hide-sm">Database</span>
          </button>
        </nav>
        <span className="spacer" />
        {offline && <span className="badge" style={{ color: 'var(--danger)' }}>server offline</span>}
        {info?.importing && (
          <button className="btn sm" onClick={() => setDialog('import')} title="Import running — click for details">
            <span className="spinner" /> Importing{importPct !== null ? ` ${importPct}%` : '…'}
          </button>
        )}
        {stats && (
          <span className="header-stats" title={`${stats.positions.toLocaleString()} indexed positions`}>
            {stats.games.toLocaleString()} games · {stats.players.toLocaleString()} players
          </span>
        )}
        <button className="btn" onClick={newGame} title="New game">
          <IconPlus /> <span className="hide-sm">New</span>
        </button>
        <button className="btn" onClick={() => setDialog('open')} title="Open or paste PGN / FEN">
          <IconFile /> <span className="hide-sm">Open</span>
        </button>
        <button className="btn primary" onClick={() => setDialog('import')} title="Import PGN files into the database">
          <IconUpload /> <span className="hide-sm">Import</span>
        </button>
        <button className="btn ghost icon" onClick={cycleTheme} title={`Theme: ${settings.theme}`}>
          <ThemeIcon />
        </button>
        <button className="btn ghost icon hide-sm" onClick={() => setDialog('shortcuts')} title="Keyboard shortcuts (?)">
          <IconKeyboard />
        </button>
        <button className="btn ghost icon" onClick={() => setDialog('settings')} title="Settings">
          <IconSettings />
        </button>
      </header>
      <main className="main">
        {route.view === 'database' ? (
          <DatabaseView params={route.params} gameCount={stats?.games ?? 0} dataVersion={stats?.dataVersion ?? ''} />
        ) : (
          <AnalysisView nativeEngine={!!info?.engine.available} tab={tab} setTab={setTab} />
        )}
      </main>
      {dialog === 'import' && (
        <ImportDialog
          onClose={() => {
            setDialog(null);
            refreshInfo();
          }}
          onDone={refreshInfo}
        />
      )}
      {dialog === 'open' && <OpenPgnDialog onClose={() => setDialog(null)} onImport={() => setDialog('import')} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      <Toasts />
    </div>
  );
}
