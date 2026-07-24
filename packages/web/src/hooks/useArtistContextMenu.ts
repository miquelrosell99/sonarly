import { useCallback, useState } from 'react';
import type { Artist, Song } from '@sonarly/shared';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { api } from '../api.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayActions } from './usePlayActions.js';

type LoadingId = 'play' | 'play-next' | 'add-to-queue' | null;

export function useArtistContextMenu(artist: Artist, onEdit: () => void): ContextMenuSection[] {
  const { playSongs, playNext, addToQueue } = usePlayActions();
  const { notify } = useNotification();
  const [loadingId, setLoadingId] = useState<LoadingId>(null);

  const withSongs = useCallback(
    async (id: LoadingId, action: (songs: Song[]) => void | Promise<void>) => {
      setLoadingId(id);
      try {
        const { songs } = await api<{ songs: Song[] }>(`/artists/${artist.id}/songs`);
        await action(songs);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Failed to load artist songs', 'error');
      } finally {
        setLoadingId(null);
      }
    },
    [artist.id, notify],
  );

  const handlePlay = useCallback(async () => {
    await withSongs('play', (songs) => {
      playSongs(songs, 0);
    });
  }, [withSongs, playSongs]);

  const handlePlayNext = useCallback(async () => {
    await withSongs('play-next', (songs) => {
      for (let i = songs.length - 1; i >= 0; i--) {
        playNext(songs[i]);
      }
    });
  }, [withSongs, playNext]);

  const handleAddToQueue = useCallback(async () => {
    await withSongs('add-to-queue', (songs) => {
      addToQueue(songs);
    });
  }, [withSongs, addToQueue]);

  return [
    {
      title: 'Playback',
      items: [
        { id: 'play', label: 'Play', icon: 'mdi-play', loading: loadingId === 'play', onClick: handlePlay },
        { id: 'play-next', label: 'Play next', icon: 'mdi-playlist-plus', loading: loadingId === 'play-next', onClick: handlePlayNext },
        { id: 'add-to-queue', label: 'Add to queue', icon: 'mdi-playlist-play', loading: loadingId === 'add-to-queue', onClick: handleAddToQueue },
      ],
    },
    {
      items: [{ id: 'edit', label: 'Edit', icon: 'mdi-pencil', onClick: onEdit }],
    },
  ];
}
