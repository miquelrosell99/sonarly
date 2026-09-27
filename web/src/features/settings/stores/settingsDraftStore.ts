// Staged (unsaved) edits for Settings pages, held outside any single page so
// the draft survives tab switches within Settings: change a parameter on one
// tab, click another tab, come back — the staged value and the save bar are
// still there. The store holds only the delta over the server preferences;
// the hook layer merges it over them for display and prunes keys that revert
// to the server value.
import { create } from 'zustand';
import type { UserPreferences } from '../../../types/index.js';

interface SettingsDraftState {
  draft: Partial<UserPreferences>;
  /** Replaces the draft wholesale (the hook prunes before calling). */
  replace: (draft: Partial<UserPreferences>) => void;
  clear: () => void;
}

export const useSettingsDraftStore = create<SettingsDraftState>((set) => ({
  draft: {},
  replace: (draft) => set({ draft }),
  clear: () => set({ draft: {} }),
}));
