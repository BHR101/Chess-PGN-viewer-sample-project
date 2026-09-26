/** Smaller building blocks of the analysis view: game header, controls, FEN bar, annotation editor. */
import { useEffect, useRef, useState } from 'react';
import { type GameNode, Position, openingOfPosition } from '@pgnx/core';
import { api } from '../api';
import { commentText } from '../state/comments';
import { confirmDiscard, positionOf, useGameStore } from '../state/gameStore';
import { navigate } from '../state/router';
import { useSettings } from '../state/settings';
import {
  IconBoard, IconCopy, IconCpu, IconDownload, IconEdit, IconFirst, IconFlip, IconLast, IconNext, IconPlus, IconPrev, IconSave,
  IconSearch, IconTrash,
} from './icons';
import { toast, toastError } from './Toasts';

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-chess-pgn' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(s: string) {
  return s.replace(/[^\w.-]+/g, '_').slice(0, 60);
}

/** Opening name of the deepest named position along the path to the current node. */
function useOpening() {
  const node = useGameStore((s) => s.node);
  let n: typeof node | null = node;
  while (n) {
    const o = openingOfPosition(positionOf(n));
    if (o) return o;
    n = n.parent;
  }
  return null;
}

export function GameInfo({ onEditHeaders }: { onEditHeaders: () => void }) {
  const game = useGameStore((s) => s.game);
  useGameStore((s) => s.version);
  const gameId = useGameStore((s) => s.gameId);
  const dirty = useGameStore((s) => s.dirty);
  const collection = useGameStore((s) => s.collection);
  const collectionIndex = useGameStore((s) => s.collectionIndex);
  const opening = useOpening();
  const h = (k: string) => {
    const v = game.headers.get(k);
    return v && v !== '?' && v !== '????.??.??' ? v : '';
  };
  const [saving, setSaving] = useState(false);

  const save = async (asNew: boolean) => {
    setSaving(true);
    try {
      const pgn = useGameStore.getState().toPgn();
      if (gameId !== null && !asNew) {
        await api.updateGame(gameId, pgn);
        useGameStore.getState().markSaved(gameId);
        toast('Game saved', 'success');
      } else {
        const { id } = await api.createGame(pgn);
        useGameStore.getState().markSaved(id);
        navigate(`/game/${id}`, true);
        toast(`Saved as game #${id}`, 'success');
      }
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (gameId === null || !confirm(`Delete game #${gameId} from the database?`)) return;
    try {
      await api.deleteGame(gameId);
      toast('Game deleted', 'success');
      useGameStore.getState().newGame();
      navigate('/analysis');
    } catch (e) {
      toastError(e);
    }
  };

  const pgn = () => useGameStore.getState().toPgn();
  const white = h('White') || 'White';
  const black = h('Black') || 'Black';
  return (
    <div className="card game-info">
      <div className="player-grid">
        <div className="players">
          <span className="color-dot w" /> <span className="ellipsis">{white}</span>
          {h('WhiteElo') && <span className="elo">{h('WhiteElo')}</span>}
        </div>
        <span className="result">{game.result.replace('1/2-1/2', '½-½')}</span>
        <div className="players">
          <span className="color-dot b" /> <span className="ellipsis">{black}</span>
          {h('BlackElo') && <span className="elo">{h('BlackElo')}</span>}
        </div>
      </div>
      <div className="game-meta">
        {h('Event') && <span>{h('Event')}</span>}
        {h('Site') && <span>{h('Site')}</span>}
        {h('Date') && <span>{h('Date').replace(/\.\?\?/g, '')}</span>}
        {h('Round') && <span>Round {h('Round')}</span>}
        {gameId !== null && <span className="badge">#{gameId}</span>}
        {dirty && <span className="badge accent">unsaved changes</span>}
      </div>
      {opening && (
        <div className="opening-name">
          <span className="eco">{opening.eco}</span>
          {opening.name}
        </div>
      )}
      {collection.length > 1 && (
        <select
          className="select"
          value={collectionIndex}
          onChange={(e) => {
            const st = useGameStore.getState();
            if (st.dirty && !confirm('Discard unsaved changes to the current game?')) return;
            st.selectFromCollection(+e.target.value);
          }}
        >
          {collection.slice(0, 5000).map((c, i) => (
            <option key={i} value={i}>
              {i + 1}. {c.label}
            </option>
          ))}
        </select>
      )}
      <div className="row wrap" style={{ marginTop: 4 }}>
        <button className="btn sm" onClick={onEditHeaders} title="Edit game details">
          <IconEdit /> Details
        </button>
        {gameId !== null && (
          <button className="btn sm primary" disabled={!dirty || saving} onClick={() => save(false)}>
            <IconSave /> Save
          </button>
        )}
        <button className={`btn sm${gameId === null && dirty ? ' primary' : ''}`} disabled={saving || game.root.children.length === 0} onClick={() => save(true)}>
          <IconPlus /> {gameId === null ? 'Save to database' : 'Save as new'}
        </button>
        <button
          className="btn sm"
          onClick={() => navigator.clipboard.writeText(pgn()).then(() => toast('PGN copied to clipboard'))}
          title="Copy PGN"
        >
          <IconCopy /> PGN
        </button>
        <button className="btn sm icon" onClick={() => downloadText(`${safeName(`${white}-${black}`)}.pgn`, pgn())} title="Download PGN">
          <IconDownload />
        </button>
        {gameId !== null && (
          <button className="btn sm icon danger" onClick={remove} title="Delete from database">
            <IconTrash />
          </button>
        )}
      </div>
    </div>
  );
}

export function Controls({ onSetup }: { onSetup: () => void }) {
  const { toStart, back, forward, toEnd } = useGameStore.getState();
  const node = useGameStore((s) => s.node);
  const s = useSettings();
  return (
    <div className="controls">
      <div className="nav-buttons">
        <button className="btn icon" onClick={toStart} disabled={!node.parent} title="Start (Home)">
          <IconFirst />
        </button>
        <button className="btn icon" onClick={back} disabled={!node.parent} title="Back (←)">
          <IconPrev />
        </button>
        <button className="btn icon" onClick={forward} disabled={!node.children.length} title="Forward (→)">
          <IconNext />
        </button>
        <button className="btn icon" onClick={toEnd} disabled={!node.children.length} title="End (End)">
          <IconLast />
        </button>
      </div>
      <div className="spacer" />
      <button className="btn icon" onClick={onSetup} title="Set up a position">
        <IconBoard />
      </button>
      <button className="btn icon" onClick={() => s.set('orientation', s.orientation === 'white' ? 'black' : 'white')} title="Flip board (F)">
        <IconFlip />
      </button>
      <button className={`btn${s.engineOn ? ' active' : ''}`} onClick={() => s.set('engineOn', !s.engineOn)} title="Toggle engine (L)">
        <IconCpu /> Engine
      </button>
    </div>
  );
}

export function FenBar() {
  const fen = useGameStore((s) => s.node.fen);
  const [text, setText] = useState(fen);
  useEffect(() => setText(fen), [fen]);
  const apply = () => {
    const t = text.trim();
    if (!t || t === fen) return;
    try {
      const p = Position.fromFen(t);
      if (!confirmDiscard()) {
        setText(fen);
        return;
      }
      useGameStore.getState().newGame(p.fen());
      navigate('/analysis');
    } catch (e) {
      toastError(e);
      setText(fen);
    }
  };
  return (
    <div className="fen-bar">
      <input
        className="input mono"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply();
          else if (e.key === 'Escape') setText(fen);
        }}
        onBlur={() => setText(fen)}
        spellCheck={false}
        aria-label="FEN"
        title="FEN of the current position — paste a FEN and press Enter to set up a position"
      />
      <button className="btn icon" title="Copy FEN" onClick={() => navigator.clipboard.writeText(fen).then(() => toast('FEN copied'))}>
        <IconCopy />
      </button>
      <button className="btn icon" title="Find games with this position" onClick={() => navigate(`/database?fen=${encodeURIComponent(fen)}`)}>
        <IconSearch />
      </button>
    </div>
  );
}

const MOVE_NAGS: Array<[number, string, string]> = [
  [1, '!', 'Good move'],
  [2, '?', 'Mistake'],
  [3, '!!', 'Brilliant move'],
  [4, '??', 'Blunder'],
  [5, '!?', 'Interesting move'],
  [6, '?!', 'Dubious move'],
];
const EVAL_NAGS: Array<[number, string, string]> = [
  [18, '+−', 'White is winning'],
  [16, '±', 'White is better'],
  [14, '⩲', 'White is slightly better'],
  [10, '=', 'Equal position'],
  [13, '∞', 'Unclear position'],
  [15, '⩱', 'Black is slightly better'],
  [17, '∓', 'Black is better'],
  [19, '−+', 'Black is winning'],
];

/** Split a comment into its human-readable text and embedded [%...] commands. */
function splitComment(raw: string | undefined): { text: string; commands: string } {
  const commands = (raw ?? '').match(/\[%[^\]]*\]/g) ?? [];
  return { text: commentText(raw), commands: commands.join(' ') };
}

export function AnnotationEditor() {
  const node = useGameStore((s) => s.node);
  useGameStore((s) => s.version);
  const { setComment, toggleNag } = useGameStore.getState();
  const [text, setText] = useState(() => splitComment(node.comment).text);
  const textRef = useRef(text);
  textRef.current = text;
  const commit = (n: GameNode, value: string) => {
    const { text: before, commands } = splitComment(n.comment);
    if (value.trim() !== before) setComment(n, `${value.trim()} ${commands}`);
  };
  useEffect(() => {
    setText(splitComment(node.comment).text);
    // Save pending text when the current move changes (e.g. a move played on the
    // board keeps the textarea focused, so no blur happens) or on unmount.
    return () => commit(node, textRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);
  const save = () => commit(node, text);
  const textarea = (placeholder: string) => (
    <textarea className="input" rows={2} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} />
  );
  if (!node.parent) {
    return <div className="annotate">{textarea('Comment before the first move…')}</div>;
  }
  return (
    <div className="annotate">
      <div className="nag-buttons">
        {[...MOVE_NAGS, ...EVAL_NAGS].map(([nag, sym, title]) => (
          <button key={nag} className={`btn sm${node.nags.includes(nag) ? ' active' : ''}`} title={title} onClick={() => toggleNag(node, nag)}>
            {sym}
          </button>
        ))}
      </div>
      {textarea(`Comment after ${node.san}…`)}
    </div>
  );
}
