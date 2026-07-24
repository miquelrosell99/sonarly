import { useCallback, useState } from 'react';
import type { Album, Song } from '@sonarly/shared';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { api } from '../api.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayActions } from './usePlayActions.js';

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

type LoadingId = 'play' | 'play-next' | 'add-to-queue' | null;

export function useAlbumContextMenu(album: Album): ContextMenuSection[] {
  const { playSongs, playNext, addToQueue } = usePlayActions();
  const { notify } = useNotification();
  const [loadingId, setLoadingId] = useState<LoadingId>(null);
  const disabled = album.shownSongCount === 0;

  const withAlbumSongs = useCallback(
    async (id: LoadingId, action: (songs: Song[]) => void | Promise<void>) => {
      setLoadingId(id);
      try {
        const detail = await api<AlbumDetail>(`/albums/${album.id}`);
        await action(detail.songs);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Failed to load album', 'error');
      } finally {
        setLoadingId(null);
      }
    },
    [album.id, notify],
  );

  const handlePlay = useCallback(async () => {
    await withAlbumSongs('play', (songs) => {
      playSongs(songs, 0);
    });
  }, [withAlbumSongs, playSongs]);

  const handlePlayNext = useCallback(async () => {
    await withAlbumSongs('play-next', (songs) => {
      for (let i = songs.length - 1; i >= 0; i--) {
        playNext(songs[i]);
      }
    });
  }, [withAlbumSongs, playNext]);

  const handleAddToQueue = useCallback(async () => {
    await withAlbumSongs('add-to-queue', (songs) => {
      addToQueue(songs);
    });
  }, [withAlbumSongs, addToQueue]);

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
