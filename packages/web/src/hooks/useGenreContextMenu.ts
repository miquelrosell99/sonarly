import { useCallback, useState } from 'react';
import type { Song } from '@sonarly/shared';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { api } from '../api.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayActions } from './usePlayActions.js';

type LoadingId = 'play' | 'play-next' | 'add-to-queue' | null;

export function useGenreContextMenu(genre: string, tracks?: Song[]): ContextMenuSection[] {
  const { playSongs, playNext, addToQueue } = usePlayActions();
  const { notify } = useNotification();
  const [loadingId, setLoadingId] = useState<LoadingId>(null);
  const disabled = tracks !== undefined && tracks.length === 0;

  const withTracks = useCallback(
    async (id: LoadingId, action: (songs: Song[]) => void | Promise<void>) => {
      setLoadingId(id);
      try {
        const songs = tracks ?? (await api<{ songs: Song[] }>(`/songs?genre=${encodeURIComponent(genre)}`)).songs;
        await action(songs);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Failed to load genre songs', 'error');
      } finally {
        setLoadingId(null);
      }
    },
    [tracks, genre, notify],
  );

  const handlePlay = useCallback(async () => {
    await withTracks('play', (songs) => {
      playSongs(songs, 0);
    });
  }, [withTracks, playSongs]);

  const handlePlayNext = useCallback(async () => {
    await withTracks('play-next', (songs) => {
      for (let i = songs.length - 1; i >= 0; i--) {
        playNext(songs[i]);
      }
    });
  }, [withTracks, playNext]);

  const handleAddToQueue = useCallback(async () => {
    await withTracks('add-to-queue', (songs) => {
      addToQueue(songs);
    });
  }, [withTracks, addToQueue]);

  return [
    {
      title: 'Playback',
      items: [
        { id: 'play', label: 'Play', icon: 'mdi-play', disabled, loading: loadingId === 'play', onClick: handlePlay },
        { id: 'play-next', label: 'Play next', icon: 'mdi-playlist-plus', disabled, loading: loadingId === 'play-next', onClick: handlePlayNext },
        { id: 'add-to-queue', label: 'Add to queue', icon: 'mdi-playlist-play', disabled, loading: loadingId === 'add-to-queue', onClick: handleAddToQueue },
      ],
    },
  ];
}
