import { create } from 'zustand';

/** Move (UCI) currently hovered in the explorer or engine panel, shown as an arrow on the board. */
export const useExplorerHover = create<{ uci: string | null; set: (uci: string | null) => void }>((set) => ({
  uci: null,
  set: (uci) => set({ uci }),
}));
