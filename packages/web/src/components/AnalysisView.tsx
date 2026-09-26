import { useState } from 'react';
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

export function AnalysisView({ nativeEngine, tab, setTab }: { nativeEngine: boolean; tab: SideTab; setTab: (t: SideTab) => void }) {
  const wide = useMediaQuery('(min-width: 1500px)');
  const [editHeaders, setEditHeaders] = useState(false);
  const [setup, setSetup] = useState(false);
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
      <section className="board-col">
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
