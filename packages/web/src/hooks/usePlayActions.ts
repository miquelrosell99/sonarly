import type { Song } from '@sonarly/shared';
import { usePlayer, type PlayerSong } from '../stores/playerStore.js';

export interface UsePlayActionsResult {
  playSong: (song: Song) => void;
  playSongs: (songs: Song[], startIndex?: number, shuffle?: boolean) => void;
  shufflePlay: (songs: Song[]) => void;
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

  const playSongs = (songs: Song[], startIndex?: number, shuffle?: boolean) => {
    playQueue(songs as PlayerSong[], startIndex, shuffle);
  };

  const shufflePlay = (songs: Song[]) => {
    playSongs(songs, undefined, true);
  };

  const playNext = (song: Song | Song[]) => {
    playNextSong(song as PlayerSong | PlayerSong[]);
  };

  const addToQueue = (songs: Song[]) => {
    appendToQueue(songs as PlayerSong[]);
  };

  return { playSong, playSongs, shufflePlay, playNext, addToQueue };
}
