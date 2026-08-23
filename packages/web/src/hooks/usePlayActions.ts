import type { Song } from '@sonarly/shared';
import { usePlayer, type PlayerSong, type QueueContext } from '../stores/playerStore.js';

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
    playNow(song as PlayerSong);
  };

  const playSongs = (songs: Song[], startIndex?: number, shuffle?: boolean, context?: QueueContext) => {
    playQueue(songs as PlayerSong[], startIndex, shuffle, context);
  };

  const shufflePlay = (songs: Song[], context?: QueueContext) => {
    playSongs(songs, undefined, true, context);
  };

  const playNext = (song: Song | Song[]) => {
    playNextSong(song as PlayerSong | PlayerSong[]);
  };

  const addToQueue = (songs: Song[]) => {
    appendToQueue(songs as PlayerSong[]);
  };

  return { playSong, playSongs, shufflePlay, playNext, addToQueue };
}
