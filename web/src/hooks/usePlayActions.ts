import type { Song } from '../types';
import { usePlayer, type QueueContext } from '../stores/playerStore.js';

// Song is directly assignable to PlayerSong — the generated schema Song
// already carries the optional artistName/albumName fields PlayerSong adds,
// so no casts are needed at this boundary anymore (audit F17).
export interface UsePlayActionsResult {
  playSong: (song: Song) => void;
  playSongs: (songs: Song[], startIndex?: number, shuffle?: boolean, context?: QueueContext) => void;
  shufflePlay: (songs: Song[], context?: QueueContext) => void;
  playNext: (song: Song | Song[]) => void;
  addToQueue: (songs: Song[]) => void;
}

export function usePlayActions(): UsePlayActionsResult {
  const playNow = usePlayer((state) => state.playNow);
  const playQueue = usePlayer((state) => state.playQueue);
  const playNextSong = usePlayer((state) => state.playNext);
  const appendToQueue = usePlayer((state) => state.addToQueue);

  const playSong = (song: Song) => {
    playNow(song);
  };

  const playSongs = (songs: Song[], startIndex?: number, shuffle?: boolean, context?: QueueContext) => {
    playQueue(songs, startIndex, shuffle, context);
  };

  const shufflePlay = (songs: Song[], context?: QueueContext) => {
    playSongs(songs, undefined, true, context);
  };

  const playNext = (song: Song | Song[]) => {
    playNextSong(song);
  };

  const addToQueue = (songs: Song[]) => {
    appendToQueue(songs);
  };

  return { playSong, playSongs, shufflePlay, playNext, addToQueue };
}
