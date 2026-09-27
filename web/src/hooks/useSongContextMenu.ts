import type { Song } from '../types';
import { useLocation } from 'wouter';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { usePlayActions } from './usePlayActions.js';
import { useAdminContextMenu } from './useAdminContextMenu.js';

export interface SongContextMenuOptions {
  /** Destructive action (the view owns the confirm + invalidate flow). */
  onDelete?: () => void;
}

export function useSongContextMenu(
  song: Song,
  onEdit: () => void,
  isAdmin?: boolean,
  options?: SongContextMenuOptions,
): ContextMenuSection[] {
  const { playSong, playNext, addToQueue } = usePlayActions();
  const [, navigate] = useLocation();

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
      items: [
        ...(song.albumId
          ? [{ id: 'go-to-album', label: 'Go to album', icon: 'mdi-album', onClick: () => navigate(`/albums/${song.albumId}`) }]
          : []),
        ...(song.artistId
          ? [{ id: 'go-to-artist', label: 'Go to artist', icon: 'mdi-account-music', onClick: () => navigate(`/artists/${song.artistId}`) }]
          : []),
      ],
    },
  ];

  if (options?.onDelete && (isAdmin ?? true)) {
    sections.push({
      items: [
        { id: 'delete', label: 'Delete', icon: 'mdi-delete', variant: 'danger', onClick: options.onDelete },
      ],
    });
  }

  sections.push({
    items: [{ id: 'edit', label: 'Edit', icon: 'mdi-pencil', onClick: onEdit }],
  });

  return useAdminContextMenu(sections, isAdmin ?? true);
}
