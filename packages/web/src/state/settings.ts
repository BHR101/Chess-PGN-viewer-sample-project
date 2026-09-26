/** User preferences, persisted in localStorage. */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ExplorerFilters } from '../api';

export type Theme = 'system' | 'light' | 'dark';
export type BoardTheme = 'brown' | 'blue' | 'green' | 'grey';
export type EngineBackend = 'native' | 'wasm';

export interface Settings {
  theme: Theme;
  boardTheme: BoardTheme;
  orientation: 'white' | 'black';
  showCoordinates: boolean;
  animation: boolean;
  showLegalMoves: boolean;
  engineOn: boolean;
  engineBackend: EngineBackend;
  multiPv: number;
  engineThreads: number;
  explorerFilters: ExplorerFilters;
  showExplorerArrows: boolean;
  set<K extends keyof Omit<Settings, 'set'>>(key: K, value: Settings[K]): void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      theme: 'system',
      boardTheme: 'brown',
      orientation: 'white',
      showCoordinates: true,
      animation: true,
      showLegalMoves: true,
      engineOn: false,
      engineBackend: 'native',
      multiPv: 3,
      engineThreads: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)),
      explorerFilters: {},
      showExplorerArrows: true,
      set: (key, value) => set({ [key]: value } as Partial<Settings>),
    }),
    { name: 'pgnx-settings' },
  ),
);
