import type { Song } from '../types';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { usePlayActions } from './usePlayActions.js';

/**
 * Playback-only context menu (Play all / Shuffle play) for aggregate entity
 * pages (genre, composer, label, year) whose entities have no edit/delete
 * endpoints — the header/cover right-click menu is the honest set.
 */
export function usePlayShuffleMenuSections(songs: Song[]): ContextMenuSection[] {
  const { playSongs, shufflePlay } = usePlayActions();
  const disabled = songs.length === 0;

  return [
    {
      title: 'Playback',
      items: [
        { id: 'play', label: 'Play all', icon: 'mdi-play', disabled, onClick: () => playSongs(songs) },
        { id: 'shuffle-play', label: 'Shuffle play', icon: 'mdi-shuffle', disabled, onClick: () => shufflePlay(songs) },
      ],
    },
  ];
}
