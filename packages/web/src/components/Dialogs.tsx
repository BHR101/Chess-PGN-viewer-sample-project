import { useEffect, useRef, useState } from 'react';
import { type Job, api, uploadPgn } from '../api';
import { useGameStore } from '../state/gameStore';
import { navigate } from '../state/router';
import { type BoardTheme, useSettings } from '../state/settings';
import { IconFile, IconPlus, IconTrash, IconUpload } from './icons';
import { Modal } from './Modal';
import { toast, toastError } from './Toasts';

// ---------------------------------------------------------------- headers

export function HeadersDialog({ onClose }: { onClose: () => void }) {
  const game = useGameStore((s) => s.game);
  const [rows, setRows] = useState<Array<[string, string]>>(() =>
    [...game.headers.entries()].filter(([k]) => k !== 'FEN' && k !== 'SetUp'),
  );
  const set = (i: number, col: 0 | 1, v: string) =>
    setRows((r) => r.map((row, k) => (k === i ? ((col === 0 ? [v, row[1]] : [row[0], v]) as [string, string]) : row)));
  const save = () => {
    useGameStore.getState().setHeaders(rows);
    onClose();
  };
  return (
    <Modal
      title="Game details"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Apply</button>
        </>
      }
    >
      <div className="header-table">
        {rows.map(([k, v], i) => (
          <div key={i} style={{ display: 'contents' }}>
            <input className="input" value={k} onChange={(e) => set(i, 0, e.target.value)} aria-label="Tag name" />
            {k === 'Result' ? (
              <select className="select" value={v} onChange={(e) => set(i, 1, e.target.value)}>
                {['*', '1-0', '0-1', '1/2-1/2'].map((r) => <option key={r}>{r}</option>)}
              </select>
            ) : (
              <input className="input" value={v} onChange={(e) => set(i, 1, e.target.value)} aria-label={`${k} value`} />
            )}
            <button className="btn ghost icon" onClick={() => setRows((r) => r.filter((_, x) => x !== i))} title="Remove tag">
              <IconTrash />
            </button>
          </div>
        ))}
      </div>
      <div>
        <button className="btn sm" onClick={() => setRows((r) => [...r, ['', '']])}>
          <IconPlus /> Add tag
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- open / paste PGN

export function OpenPgnDialog({ onClose, onImport }: { onClose: () => void; onImport: () => void }) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const open = (pgn: string) => {
    try {
      const n = useGameStore.getState().loadPgn(pgn);
      navigate('/analysis');
      toast(n > 1 ? `Opened ${n} games — switch between them in the game panel` : 'Game opened');
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  const openFile = async (f: File) => {
    if (f.size > 20 * 1024 * 1024) {
      toast('Large file: import it into the database instead for fast searching.', 'info', 6000);
      onImport();
      return;
    }
    open(await f.text());
  };
  const loadFen = () => {
    try {
      useGameStore.getState().newGame(text.trim());
      navigate('/analysis');
      onClose();
    } catch (e) {
      toastError(e);
    }
  };
  const looksLikeFen = /^[1-8pnbrqkPNBRQK/]+ [wb] /.test(text.trim());
  return (
    <Modal
      title="Open PGN or FEN"
      onClose={onClose}
      wide
      footer={
        <>
          <input ref={fileRef} type="file" accept=".pgn,.txt,application/x-chess-pgn" hidden onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <IconFile /> Open file…
          </button>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!text.trim()} onClick={() => (looksLikeFen ? loadFen() : open(text))}>
            {looksLikeFen ? 'Set up position' : 'Open'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Paste one or more games in PGN, or a FEN position. Games opened here are viewed locally; use <b>Save to database</b> to keep them.
      </p>
      <textarea
        className="input mono"
        rows={14}
        autoFocus
        placeholder={'[Event "..."]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------- import into database

function fmtBytes(n: number) {
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

export function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [over, setOver] = useState(false);
  const [dedupe, setDedupe] = useState(true);
  const [strip, setStrip] = useState(false);
  const [upload, setUpload] = useState<{ name: string; loaded: number; total: number } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [recent, setRecent] = useState<Job[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.jobs().then((jobs) => {
      setRecent(jobs);
      const running = jobs.find((j) => j.status === 'running' || j.status === 'queued');
      if (running) setJob(running);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return;
    const t = setInterval(async () => {
      try {
        const j = await api.job(job.id);
        setJob(j);
        if (j.status === 'done') {
          toast(`Imported ${j.progress?.imported.toLocaleString()} games`, 'success');
          onDone();
        } else if (j.status === 'failed') toast(`Import failed: ${j.error}`, 'error');
      } catch (e) {
        toastError(e);
      }
    }, 400);
    return () => clearInterval(t);
  }, [job, onDone]);

  const start = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      try {
        setUpload({ name: f.name, loaded: 0, total: f.size });
        const j = await uploadPgn(f, { dedupe, stripAnnotations: strip }, (loaded, total) => setUpload({ name: f.name, loaded, total }));
        setUpload(null);
        setJob(j);
      } catch (e) {
        setUpload(null);
        toastError(e);
      }
    }
  };

  const p = job?.progress;
  const active = job && (job.status === 'running' || job.status === 'queued');
  const pctDone = p && p.totalBytes ? (100 * p.bytesRead) / p.totalBytes : 0;
  return (
    <Modal title="Import PGN into the database" onClose={onClose} footer={<button className="btn" onClick={onClose}>{active ? 'Continue in background' : 'Close'}</button>}>
      {!upload && !active && (
        <>
          <div
            className={`dropzone${over ? ' over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              if (e.dataTransfer.files.length) void start(e.dataTransfer.files);
            }}
          >
            <IconUpload style={{ width: 28, height: 28 }} />
            <div style={{ marginTop: 8 }}>
              <strong>Drop PGN files here</strong> or click to choose
            </div>
            <div className="small">Files of any size are streamed to the local server and indexed in the background.</div>
            <input ref={fileRef} type="file" accept=".pgn,.txt,application/x-chess-pgn" multiple hidden onChange={(e) => e.target.files && start(e.target.files)} />
          </div>
          <div className="row wrap" style={{ gap: 18 }}>
            <label className="switch">
              <input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} />
              <span className="track" /> Skip duplicate games
            </label>
            <label className="switch">
              <input type="checkbox" checked={strip} onChange={(e) => setStrip(e.target.checked)} />
              <span className="track" /> Discard comments &amp; variations
            </label>
          </div>
          <p className="faint small" style={{ margin: 0 }}>
            For very large databases (millions of games) the command line is fastest: <code>npm run cli -- import games.pgn</code>
          </p>
        </>
      )}
      {upload && (
        <div className="field">
          <div className="row">
            <span className="grow ellipsis">Uploading {upload.name}</span>
            <span className="muted small">
              {fmtBytes(upload.loaded)} / {fmtBytes(upload.total)}
            </span>
          </div>
          <div className="progress">
            <div style={{ width: `${(100 * upload.loaded) / Math.max(1, upload.total)}%` }} />
          </div>
        </div>
      )}
      {job && (
        <div className="field">
          <div className="row">
            <span className="grow ellipsis">
              <b>{job.name}</b> — {job.status === 'running' && p ? p.phase : job.status}
            </span>
            {active && <span className="spinner" />}
            {active && (
              <button className="btn sm danger" onClick={() => api.cancelJob(job.id).catch(toastError)}>
                Cancel
              </button>
            )}
          </div>
          <div className={`progress${p?.phase === 'indexing' ? ' indeterminate' : ''}`}>
            <div style={{ width: `${job.status === 'done' ? 100 : pctDone}%` }} />
          </div>
          {p && (
            <div className="stat-grid">
              <div className="stat"><div className="v">{p.imported.toLocaleString()}</div><div className="k">Imported</div></div>
              <div className="stat"><div className="v">{p.gamesPerSecond.toLocaleString()}</div><div className="k">Games / sec</div></div>
              <div className="stat"><div className="v">{p.duplicates.toLocaleString()}</div><div className="k">Duplicates</div></div>
              <div className="stat"><div className="v">{(p.errors + p.warnings).toLocaleString()}</div><div className="k">Problems</div></div>
            </div>
          )}
          {p && p.errorSamples.length > 0 && (
            <div className="error-list">
              {p.errorSamples.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
          {job.error && <div className="error-list">{job.error}</div>}
          {job.status === 'done' && (
            <div className="row">
              <button className="btn primary" onClick={() => { navigate('/database'); onClose(); }}>Browse games</button>
              <button className="btn" onClick={() => setJob(null)}>Import more</button>
            </div>
          )}
        </div>
      )}
      {!active && recent.filter((j) => j.id !== job?.id && j.progress).length > 0 && (
        <div className="field">
          <div className="label">Recent imports</div>
          {recent.filter((j) => j.id !== job?.id && j.progress).slice(0, 5).map((j) => (
            <div key={j.id} className="row small">
              <span className="grow ellipsis">{j.name}</span>
              <span className="muted">{j.progress!.imported.toLocaleString()} games · {j.status}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- settings & shortcuts

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const toggle = (key: 'showCoordinates' | 'animation' | 'showLegalMoves', label: string) => (
    <label className="switch">
      <input type="checkbox" checked={s[key]} onChange={(e) => s.set(key, e.target.checked)} />
      <span className="track" /> {label}
    </label>
  );
  return (
    <Modal title="Settings" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="field">
        <label>Theme</label>
        <select className="select" value={s.theme} onChange={(e) => s.set('theme', e.target.value as typeof s.theme)}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      <div className="field">
        <label>Board colours</label>
        <div className="row">
          {(['brown', 'blue', 'green', 'grey'] as BoardTheme[]).map((t) => (
            <button key={t} className={`btn${s.boardTheme === t ? ' active' : ''}`} onClick={() => s.set('boardTheme', t)} style={{ textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Board</label>
        {toggle('showCoordinates', 'Show coordinates')}
        {toggle('animation', 'Animate moves')}
        {toggle('showLegalMoves', 'Show legal moves')}
      </div>
      <div className="field">
        <label>Engine threads (native engine)</label>
        <input
          className="input"
          type="number"
          min={1}
          max={64}
          value={s.engineThreads}
          onChange={(e) => s.set('engineThreads', Math.max(1, Math.min(64, +e.target.value || 1)))}
          style={{ width: 100 }}
        />
      </div>
    </Modal>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ['← / →', 'Previous / next move'],
  ['Home / End', 'Start / end of the line'],
  ['↑ / ↓', 'Switch between variations'],
  ['Mouse wheel over board', 'Step through moves'],
  ['F', 'Flip the board'],
  ['L', 'Toggle the engine'],
  ['E', 'Toggle explorer / moves tab'],
  ['Right-click / right-drag on board', 'Draw circles / arrows'],
  ['Right-click a move', 'Promote, make main line, delete'],
  ['Ctrl/⌘ + S', 'Save game to database'],
  ['?', 'Show this help'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      {SHORTCUTS.map(([k, v]) => (
        <div key={k} className="row" style={{ justifyContent: 'space-between' }}>
          <span>{v}</span>
          <kbd>{k}</kbd>
        </div>
      ))}
    </Modal>
  );
}
