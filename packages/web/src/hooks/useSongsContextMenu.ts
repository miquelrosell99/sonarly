import type { Song } from '@sonarly/shared';
import { useLocation } from 'wouter';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { usePlayActions } from './usePlayActions.js';

export function useSongsContextMenu(
  songs: Song[],
  onEdit: () => void,
  isAdmin?: boolean,
): ContextMenuSection[] {
  const { playSong, playSongs, playNext, addToQueue } = usePlayActions();
  const [, navigate] = useLocation();

  if (songs.length === 0) return [];

  const sections: ContextMenuSection[] = [];

  if (songs.length === 1) {
    const song = songs[0];
    sections.push({
      title: 'Playback',
      items: [
        { id: 'play', label: 'Play', icon: 'mdi-play', onClick: () => playSong(song) },
        { id: 'play-next', label: 'Play next', icon: 'mdi-playlist-plus', onClick: () => playNext(song) },
        { id: 'add-to-queue', label: 'Add to queue', icon: 'mdi-playlist-play', onClick: () => addToQueue([song]) },
      ],
    });
    const navigateItems = [
      ...(song.albumId
        ? [{ id: 'go-to-album', label: 'Go to album', icon: 'mdi-album', onClick: () => navigate(`/albums/${song.albumId}`) }]
        : []),
      ...(song.artistId
        ? [{ id: 'go-to-artist', label: 'Go to artist', icon: 'mdi-account-music', onClick: () => navigate(`/artists/${song.artistId}`) }]
        : []),
    ];
    if (navigateItems.length > 0) {
      sections.push({ items: navigateItems });
    }
  } else {
    sections.push({
      title: 'Playback',
      items: [
        { id: 'play', label: 'Play', icon: 'mdi-play', onClick: () => playSongs(songs) },
        { id: 'play-next', label: 'Play next', icon: 'mdi-playlist-plus', onClick: () => playNext(songs) },
        { id: 'add-to-queue', label: 'Add to queue', icon: 'mdi-playlist-play', onClick: () => addToQueue(songs) },
      ],
    });
  }

  if (isAdmin ?? true) {
    const label = songs.length === 1 ? 'Edit' : `Edit ${songs.length} songs`;
    sections.push({
      items: [{ id: 'edit', label, icon: 'mdi-pencil', onClick: onEdit }],
    });
  }

  return sections;
}
