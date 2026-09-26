/** Position set-up: place pieces, choose side to move and castling rights, validate, analyse. */
import { useMemo, useState } from 'react';
import { Position, START_FEN } from '@pgnx/core';
import { PIECE_IMAGES } from '../board/pieces';
import { useGameStore } from '../state/gameStore';
import { navigate } from '../state/router';
import { useSettings } from '../state/settings';
import { Modal } from './Modal';

const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';
const PALETTE = ['K', 'Q', 'R', 'B', 'N', 'P'];

function toGrid(fen: string): (string | null)[] {
  const grid: (string | null)[] = new Array(64).fill(null);
  fen.split(' ')[0].split('/').forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += +ch;
      else grid[(7 - i) * 8 + f++] = ch;
    }
  });
  return grid;
}

function placement(grid: (string | null)[]): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let s = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = grid[r * 8 + f];
      if (!p) empty++;
      else {
        if (empty) s += empty;
        empty = 0;
        s += p;
      }
    }
    if (empty) s += empty;
    rows.push(s);
  }
  return rows.join('/');
}

export function BoardEditor({ onClose }: { onClose: () => void }) {
  const startFen = useGameStore((s) => s.node.fen);
  const settings = useSettings();
  const [grid, setGrid] = useState(() => toGrid(startFen));
  const [turn, setTurn] = useState<'w' | 'b'>(startFen.split(' ')[1] === 'b' ? 'b' : 'w');
  const [castling, setCastling] = useState(() => new Set((startFen.split(' ')[2] ?? '').replace('-', '').split('').filter(Boolean)));
  const [tool, setTool] = useState<string>('P');
  const [painting, setPainting] = useState(false);
  const flip = settings.orientation === 'black';

  const fen = `${placement(grid)} ${turn} ${['K', 'Q', 'k', 'q'].filter((c) => castling.has(c)).join('') || '-'} - 0 1`;
  const validation = useMemo(() => {
    try {
      return { ok: true as const, fen: Position.fromFen(fen).fen() };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.replace(fen, '').replace(/[:\s]+$/, '') };
    }
  }, [fen]);

  const paint = (sq: number, erase = false) =>
    setGrid((g) => {
      const next = [...g];
      next[sq] = erase || tool === 'x' || g[sq] === tool ? null : tool;
      return next;
    });

  const squares = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const sq = flip ? y * 8 + (7 - x) : (7 - y) * 8 + x;
      const light = ((sq >> 3) + (sq & 7)) % 2 === 1;
      const p = grid[sq];
      squares.push(
        <div
          key={sq}
          className={`sq ${light ? 'light' : 'dark'}`}
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => {
            e.preventDefault();
            setPainting(true);
            paint(sq, e.button === 2);
          }}
          onPointerEnter={(e) => painting && e.buttons && paint(sq, e.buttons === 2)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {p && (
            <div
              style={{ position: 'absolute', inset: 0, backgroundImage: `url("${PIECE_IMAGES[(p === p.toUpperCase() ? 'w' : 'b') + p.toUpperCase()]}")`, backgroundSize: 'cover' }}
            />
          )}
        </div>,
      );
    }
  }

  const paletteButton = (piece: string) => (
    <button
      key={piece}
      className={`btn icon${tool === piece ? ' active' : ''}`}
      style={{ width: 40, height: 40, backgroundImage: `url("${PIECE_IMAGES[(piece === piece.toUpperCase() ? 'w' : 'b') + piece.toUpperCase()]}")`, backgroundSize: '85%', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }}
      onClick={() => setTool(piece)}
      aria-label={`Place ${piece}`}
    />
  );

  const apply = () => {
    if (!validation.ok) return;
    const st = useGameStore.getState();
    if (st.dirty && !confirm('Discard unsaved changes to the current game?')) return;
    st.newGame(validation.fen);
    navigate('/analysis');
    onClose();
  };

  const toggleCastle = (c: string) =>
    setCastling((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });

  return (
    <Modal
      title="Set up position"
      onClose={onClose}
      wide
      footer={
        <>
          <span className={`small ${validation.ok ? 'muted' : ''}`} style={{ color: validation.ok ? undefined : 'var(--danger)', marginRight: 'auto' }}>
            {validation.ok ? 'Valid position' : validation.error}
          </span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!validation.ok} onClick={apply}>Analyse this position</button>
        </>
      }
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }} onPointerUp={() => setPainting(false)}>
        <div style={{ width: 'min(420px, 100%)' }}>
          <div className={`board theme-${settings.boardTheme}`}>
            <div className="squares">{squares}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 220, flex: 1 }}>
          <div className="field">
            <label>Pieces</label>
            <div className="row wrap">{PALETTE.map(paletteButton)}</div>
            <div className="row wrap">{PALETTE.map((p) => paletteButton(p.toLowerCase()))}</div>
            <div className="small faint">Click or drag to place; click a piece again or right-click to remove.</div>
          </div>
          <div className="field">
            <label>Side to move</label>
            <select className="select" value={turn} onChange={(e) => setTurn(e.target.value as 'w' | 'b')}>
              <option value="w">White to move</option>
              <option value="b">Black to move</option>
            </select>
          </div>
          <div className="field">
            <label>Castling</label>
            <div className="row wrap">
              {[['K', 'White O-O'], ['Q', 'White O-O-O'], ['k', 'Black O-O'], ['q', 'Black O-O-O']].map(([c, label]) => (
                <label key={c} className="row small" style={{ gap: 4 }}>
                  <input type="checkbox" checked={castling.has(c)} onChange={() => toggleCastle(c)} /> {label}
                </label>
              ))}
            </div>
          </div>
          <div className="row wrap">
            <button className="btn sm" onClick={() => { setGrid(toGrid(START_FEN)); setCastling(new Set(['K', 'Q', 'k', 'q'])); setTurn('w'); }}>Starting position</button>
            <button className="btn sm" onClick={() => { setGrid(toGrid(EMPTY_FEN)); setCastling(new Set()); }}>Clear board</button>
          </div>
          <div className="field">
            <label>FEN</label>
            <input className="input mono" readOnly value={validation.ok ? validation.fen : fen} onFocus={(e) => e.target.select()} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
