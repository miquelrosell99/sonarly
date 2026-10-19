import { useCallback, useState } from 'react';
import type { Artist, Song } from '../types';
import type { ContextMenuSection } from '../features/entities/ItemContextMenu.js';
import { api } from '../lib/api.js';
import { downloadSongs } from '../lib/download.js';
import { getShareToken } from '../lib/shareToken.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayActions } from './usePlayActions.js';
import { useAddToPlaylistStore } from '../stores/addToPlaylistStore.js';

type LoadingId = 'play' | 'shuffle-play' | 'play-next' | 'add-to-queue' | 'add-to-playlist' | 'download' | null;

export function useArtistContextMenu(artist: Artist, onEdit: () => void): ContextMenuSection[] {
  const { playSongs, shufflePlay, playNext, addToQueue } = usePlayActions();
  const { notify } = useNotification();
  const openAddToPlaylist = useAddToPlaylistStore((s) => s.open);
  const [loadingId, setLoadingId] = useState<LoadingId>(null);
  const allowDownload = getShareToken() === undefined;

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
      playSongs(songs);
    });
  }, [withSongs, playSongs]);

  const handleShufflePlay = useCallback(async () => {
    await withSongs('shuffle-play', (songs) => {
      shufflePlay(songs);
    });
  }, [withSongs, shufflePlay]);

  const handlePlayNext = useCallback(async () => {
    await withSongs('play-next', (songs) => {
      playNext(songs);
    });
  }, [withSongs, playNext]);

  const handleAddToQueue = useCallback(async () => {
    await withSongs('add-to-queue', (songs) => {
      addToQueue(songs);
    });
  }, [withSongs, addToQueue]);

  const handleDownload = useCallback(async () => {
    await withSongs('download', (songs) => downloadSongs(songs.map((song) => song.id)));
  }, [withSongs]);

  const handleAddToPlaylist = useCallback(async () => {
    await withSongs('add-to-playlist', (songs) => {
      openAddToPlaylist(songs);
    });
  }, [withSongs, openAddToPlaylist]);

  const sections: ContextMenuSection[] = [
    {
      title: 'Playback',
      items: [
        { id: 'play', label: 'Play', icon: 'mdi-play', loading: loadingId === 'play', onClick: handlePlay },
        { id: 'shuffle-play', label: 'Shuffle play', icon: 'mdi-shuffle', loading: loadingId === 'shuffle-play', onClick: handleShufflePlay },
        { id: 'play-next', label: 'Play next', icon: 'mdi-playlist-plus', loading: loadingId === 'play-next', onClick: handlePlayNext },
        { id: 'add-to-queue', label: 'Add to queue', icon: 'mdi-playlist-play', loading: loadingId === 'add-to-queue', onClick: handleAddToQueue },
      ],
    },
  ];

  if (getShareToken() === undefined) {
    sections.push({
      items: [
        {
          id: 'add-to-playlist',
          label: 'Add to playlist',
          icon: 'mdi-playlist-music',
          loading: loadingId === 'add-to-playlist',
          onClick: handleAddToPlaylist,
        },
      ],
    });
  }

  if (allowDownload) {
    sections.push({
      items: [
        {
          id: 'download',
          label: 'Download',
          icon: 'mdi-download',
          loading: loadingId === 'download',
          onClick: handleDownload,
        },
      ],
    });
  }

  sections.push({
    items: [{ id: 'edit', label: 'Edit', icon: 'mdi-pencil', onClick: onEdit }],
  });

  return sections;
}
