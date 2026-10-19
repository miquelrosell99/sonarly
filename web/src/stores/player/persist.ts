import { createJSONStorage, type StateStorage } from 'zustand/middleware';
import type { PlayerSong, PlayerStore } from './types.js';

// Only the fields the player UI reads back are persisted with the queue.
// Whole-library shuffles carry ~13 MB of full song JSON (lyrics dominate),
// which blows the ~5 MB localStorage quota; zustand persist does not catch
// the quota DOMException, so it would propagate into every store action.
const PERSISTED_SONG_FIELDS = [
  'id',
  'title',
  'duration',
  'year',
  'explicit',
  'mtime',
  'active',
  'starred',
  'coverArtMissing',
  'gapless',
  'artistId',
  'artistName',
  'artistEntries',
  'albumId',
  'albumName',
  'albumCoverArt',
  'coverArt',
  'addedByAutoDj',
  'autoDjReason',
] as const;

type PersistedSong = Pick<PlayerSong, (typeof PERSISTED_SONG_FIELDS)[number]>;

function slimSong(song: PlayerSong): PersistedSong {
  const slim = {} as PersistedSong;
  for (const field of PERSISTED_SONG_FIELDS) {
    const value = song[field];
    if (value !== undefined) (slim as Record<string, unknown>)[field] = value;
  }
  return slim;
}

/** localStorage with quota errors swallowed (warned once) — see slimSong. */
function createPlayerStorage(): StateStorage {
  if (typeof window !== 'undefined' && window.localStorage) {
    // zustand persist lets storage exceptions propagate out of every
    // action that calls set(). A queue larger than the localStorage
    // quota must degrade to session-only playback, not crash the
    // player — so quota errors are swallowed (warned once).
    const local = window.localStorage;
    let quotaWarned = false;
    const warnQuota = () => {
      if (quotaWarned) return;
      quotaWarned = true;
      console.warn(
        'sonarly-player: localStorage quota exceeded; the play queue will not persist across reloads',
      );
    };
    return {
      getItem: (key) => {
        try {
          return local.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key, value) => {
        try {
          local.setItem(key, value);
        } catch {
          warnQuota();
        }
      },
      removeItem: (key) => {
        try {
          local.removeItem(key);
        } catch {
          warnQuota();
        }
      },
    };
  }
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
}

export const playerPersistOptions = {
  name: 'sonarly-player',
  storage: createJSONStorage(createPlayerStorage),
  partialize: (state: PlayerStore) => ({
    queue: state.queue.map(slimSong),
    queueIndex: state.queueIndex,
    queueContext: state.queueContext,
    volume: state.volume,
    shuffle: state.shuffle,
    repeat: state.repeat,
    shuffledIndices: state.shuffledIndices,
  }),
  // v1 is the current persisted shape; the version + identity migrate are
  // future-proofing only (plan P11) — a later shape change bumps the
  // version and adds a real migration here instead of ad-hoc keying.
  version: 1,
  migrate: (persisted: unknown) => persisted,
  onRehydrateStorage: () => (state?: PlayerStore) => {
    if (!state) return;
    if (state.queue.length > 0 && state.queueIndex >= 0 && state.queueIndex < state.queue.length) {
      state.currentSong = state.queue[state.queueIndex];
    }
    state.status = 'idle';
    state.currentTime = 0;
    state.duration = 0;
  },
};
