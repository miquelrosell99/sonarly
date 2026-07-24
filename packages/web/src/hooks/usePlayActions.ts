import type { Song } from '@sonarly/shared';
import { usePlayer, type PlayerSong } from '../stores/playerStore.js';

export interface UsePlayActionsResult {
  playSong: (song: Song) => void;
  playSongs: (songs: Song[], startIndex?: number, shuffle?: boolean) => void;
  shufflePlay: (songs: Song[]) => void;
}

export function usePlayActions(): UsePlayActionsResult {
  const playNow = usePlayer((state) => state.playNow);
  const playQueue = usePlayer((state) => state.playQueue);

  const playSong = (song: Song) => {
    playNow(song as PlayerSong);
  };

  const playSongs = (songs: Song[], startIndex = 0, shuffle?: boolean) => {
    playQueue(songs as PlayerSong[], startIndex, shuffle);
  };

  const shufflePlay = (songs: Song[]) => {
    playSongs(songs, 0, true);
  };

  return { playSong, playSongs, shufflePlay };
}
