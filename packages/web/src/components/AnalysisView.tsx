import { useLayoutEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../state/useMediaQuery';
import { AnnotationEditor, Controls, FenBar, GameInfo } from './AnalysisParts';
import { BoardArea } from './BoardArea';
import { BoardEditor } from './BoardEditor';
import { HeadersDialog } from './Dialogs';
import { EnginePanel } from './EnginePanel';
import { ExplorerPanel } from './ExplorerPanel';
import { GameAnalysisPanel } from './GameAnalysisPanel';
import { MoveTree } from './MoveTree';

export type SideTab = 'moves' | 'explorer';

/**
 * Size the board to the height left in its column after the controls below
 * it, capped by a share of the viewport width. Returns null on narrow screens
 * (where the board simply takes the full width).
 */
function useBoardSize(wide: boolean) {
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState<number | null>(null);
  const stacked = useMediaQuery('(max-width: 900px)');
  useLayoutEffect(() => {
    const col = ref.current;
    if (!col || stacked) {
      setSize(null);
      return;
    }
    const measure = () => {
      const kids = [...col.children] as HTMLElement[];
      const wrap = col.querySelector('.board-wrap');
      const others = kids.filter((k) => k !== wrap).reduce((sum, k) => sum + k.getBoundingClientRect().height, 0);
      const gap = parseFloat(getComputedStyle(col).rowGap) || 0;
      const availH = col.clientHeight - others - gap * (kids.length - 1);
      const maxW = window.innerWidth * (wide ? 0.44 : 0.66);
      setSize(Math.floor(Math.max(260, Math.min(availH + 30, maxW))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(col);
    for (const k of col.children) ro.observe(k);
    const mo = new MutationObserver(() => {
      for (const k of col.children) ro.observe(k);
      measure();
    });
    mo.observe(col, { childList: true });
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [wide, stacked]);
  return { ref, size };
}

export function AnalysisView({ nativeEngine, tab, setTab }: { nativeEngine: boolean; tab: SideTab; setTab: (t: SideTab) => void }) {
  const wide = useMediaQuery('(min-width: 1500px)');
  const [editHeaders, setEditHeaders] = useState(false);
  const [setup, setSetup] = useState(false);
  const { ref: colRef, size } = useBoardSize(wide);
  const notation = (
    <div className="card panel fill">
      <div className="panel-body">
        <MoveTree />
      </div>
      <AnnotationEditor />
    </div>
  );
  return (
    <div className={`analysis${wide ? ' three' : ''}`}>
      <section className="board-col" ref={colRef} style={size ? ({ '--board-size': `${size}px` } as React.CSSProperties) : undefined}>
        <BoardArea />
        <Controls onSetup={() => setSetup(true)} />
        <FenBar />
        <GameAnalysisPanel nativeAvailable={nativeEngine} />
      </section>
      <section className="side-col">
        <GameInfo onEditHeaders={() => setEditHeaders(true)} />
        <EnginePanel nativeAvailable={nativeEngine} />
        {wide ? (
          notation
        ) : (
          <div className="card panel fill">
            <div className="tabs">
              <button className={`tab${tab === 'moves' ? ' active' : ''}`} onClick={() => setTab('moves')}>
                Moves
              </button>
              <button className={`tab${tab === 'explorer' ? ' active' : ''}`} onClick={() => setTab('explorer')}>
                Explorer
              </button>
            </div>
            {tab === 'moves' ? (
              <>
                <div className="panel-body">
                  <MoveTree />
                </div>
                <AnnotationEditor />
              </>
            ) : (
              <ExplorerPanel />
            )}
          </div>
        )}
      </section>
      {wide && (
        <section className="side-col">
          <div className="card panel fill">
            <ExplorerPanel />
          </div>
        </section>
      )}
      {editHeaders && <HeadersDialog onClose={() => setEditHeaders(false)} />}
      {setup && <BoardEditor onClose={() => setSetup(false)} />}
    </div>
  );
}
