/** Global engine state: one engine instance driven by settings and the current position. */
import { useEffect } from 'react';
import { create } from 'zustand';
import { useGameStore } from '../state/gameStore';
import { useSettings } from '../state/settings';
import { type Analysis, Engine } from './engine';

interface EngineState {
  analysis: Analysis | null;
  engineName: string;
  error: string | null;
  ready: boolean;
}

export const useEngineState = create<EngineState>(() => ({ analysis: null, engineName: '', error: null, ready: false }));

let engine: Engine | null = null;

/** Mount once near the root: keeps the engine in sync with settings and the board. */
export function useEngineDriver(nativeAvailable: boolean) {
  const on = useSettings((s) => s.engineOn);
  const backendPref = useSettings((s) => s.engineBackend);
  const multiPv = useSettings((s) => s.multiPv);
  const threads = useSettings((s) => s.engineThreads);
  const fen = useGameStore((s) => s.node.fen);
  const backend = backendPref === 'native' && nativeAvailable ? 'native' : 'wasm';

  useEffect(() => {
    if (!on) {
      useEngineState.setState({ analysis: null, ready: false, error: null });
      return;
    }
    const e = new Engine(
      { backend, multiPv: useSettings.getState().multiPv, threads },
      (analysis) => useEngineState.setState({ analysis }),
      () => useEngineState.setState({ engineName: e.name, error: e.error, ready: e.isReady }),
    );
    engine = e;
    useEngineState.setState({ analysis: null, error: null, ready: false, engineName: '' });
    e.analyze(useGameStore.getState().node.fen);
    return () => {
      e.destroy();
      if (engine === e) engine = null;
    };
  }, [on, backend, threads]);

  useEffect(() => {
    engine?.setMultiPv(multiPv);
  }, [multiPv]);

  useEffect(() => {
    if (on) engine?.analyze(fen);
  }, [fen, on]);
}
