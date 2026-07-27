import type { Song } from '@sonarly/shared';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { usePlayActions } from './usePlayActions.js';
import { useAdminContextMenu } from './useAdminContextMenu.js';

export function useSongContextMenu(song: Song, onEdit: () => void, isAdmin?: boolean): ContextMenuSection[] {
  const { playSong, playNext, addToQueue } = usePlayActions();

  const sections: ContextMenuSection[] = [
    {
      title: 'Playback',
      items: [
        { id: 'play', label: 'Play', icon: 'mdi-play', onClick: () => playSong(song) },
        { id: 'play-next', label: 'Play next', icon: 'mdi-playlist-plus', onClick: () => playNext(song) },
        { id: 'add-to-queue', label: 'Add to queue', icon: 'mdi-playlist-play', onClick: () => addToQueue([song]) },
      ],
    },
    {
      items: [{ id: 'edit', label: 'Edit', icon: 'mdi-pencil', onClick: onEdit }],
    },
  ];

  return useAdminContextMenu(sections, isAdmin ?? true);
}
