import type { Song } from '@sonarly/shared';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { useSongContextMenu } from './useSongContextMenu.js';

export function useSongsContextMenu(
  songs: Song[],
  onEdit: () => void,
  isAdmin?: boolean,
): ContextMenuSection[] {
  if (songs.length === 0) return [];
  if (songs.length === 1) {
    return useSongContextMenu(songs[0], onEdit, isAdmin);
  }

  if (!isAdmin) return [];

  const label = songs.length === 1 ? 'Edit' : `Edit ${songs.length} songs`;
  return [
    {
      items: [{ id: 'edit', label, icon: 'mdi-pencil', onClick: onEdit }],
    },
  ];
}
