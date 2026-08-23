import { useCallback, useState } from 'react';
import { useLocation } from 'wouter';
import type { Album, Song } from '@sonarly/shared';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { api } from '../lib/api.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayActions } from './usePlayActions.js';

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

type LoadingId = 'play' | 'shuffle-play' | 'play-next' | 'add-to-queue' | null;

export function useAlbumContextMenu(album: Album): ContextMenuSection[] {
  const { playSongs, shufflePlay, playNext, addToQueue } = usePlayActions();
  const { notify } = useNotification();
  const [, navigate] = useLocation();
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
      playSongs(songs);
    });
  }, [withAlbumSongs, playSongs]);

  const handleShufflePlay = useCallback(async () => {
    await withAlbumSongs('shuffle-play', (songs) => {
      shufflePlay(songs);
    });
  }, [withAlbumSongs, shufflePlay]);

  const handlePlayNext = useCallback(async () => {
    await withAlbumSongs('play-next', (songs) => {
      playNext(songs);
    });
  }, [withAlbumSongs, playNext]);

  const handleAddToQueue = useCallback(async () => {
    await withAlbumSongs('add-to-queue', (songs) => {
      addToQueue(songs);
    });
  }, [withAlbumSongs, addToQueue]);

  const sections: ContextMenuSection[] = [
    {
      title: 'Playback',
      items: [
        { id: 'play', label: 'Play', icon: 'mdi-play', disabled, loading: loadingId === 'play', onClick: handlePlay },
        { id: 'shuffle-play', label: 'Shuffle play', icon: 'mdi-shuffle', disabled, loading: loadingId === 'shuffle-play', onClick: handleShufflePlay },
        { id: 'play-next', label: 'Play next', icon: 'mdi-playlist-plus', disabled, loading: loadingId === 'play-next', onClick: handlePlayNext },
        { id: 'add-to-queue', label: 'Add to queue', icon: 'mdi-playlist-play', disabled, loading: loadingId === 'add-to-queue', onClick: handleAddToQueue },
      ],
    },
  ];

  if (album.artistId) {
    sections.push({
      items: [
        { id: 'go-to-artist', label: 'Go to artist', icon: 'mdi-account-music', onClick: () => navigate(`/artists/${album.artistId}`) },
      ],
    });
  }

  return sections;
}
