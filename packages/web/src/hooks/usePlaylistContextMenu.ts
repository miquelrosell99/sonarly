import { useCallback, useState } from 'react';
import type { Playlist, Song } from '@sonarly/shared';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { api } from '../lib/api.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayActions } from './usePlayActions.js';

interface PlaylistDetail {
  playlist: Playlist & { songCount: number; entries: Song[] };
}

type LoadingId = 'play' | 'shuffle-play' | 'play-next' | 'add-to-queue' | 'convert' | null;

interface PlaylistContextMenuOptions {
  onShare?: () => void;
  onDelete?: () => void;
}

export function usePlaylistContextMenu(
  playlist: Playlist,
  onEdit: () => void,
  onConvert: () => void,
  options?: PlaylistContextMenuOptions,
): ContextMenuSection[] {
  const { playSongs, shufflePlay, playNext, addToQueue } = usePlayActions();
  const { notify } = useNotification();
  const [loadingId, setLoadingId] = useState<LoadingId>(null);

  const withEntries = useCallback(
    async (id: Exclude<LoadingId, 'convert'>, action: (songs: Song[]) => void | Promise<void>) => {
      setLoadingId(id);
      try {
        const { playlist: detail } = await api<PlaylistDetail>(`/playlists/${playlist.id}`);
        await action(detail.entries);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Failed to load playlist', 'error');
      } finally {
        setLoadingId(null);
      }
    },
    [playlist.id, notify],
  );

  const handlePlay = useCallback(async () => {
    await withEntries('play', (songs) => {
      playSongs(songs);
    });
  }, [withEntries, playSongs]);

  const handleShufflePlay = useCallback(async () => {
    await withEntries('shuffle-play', (songs) => {
      shufflePlay(songs);
    });
  }, [withEntries, shufflePlay]);

  const handlePlayNext = useCallback(async () => {
    await withEntries('play-next', (songs) => {
      playNext(songs);
    });
  }, [withEntries, playNext]);

  const handleAddToQueue = useCallback(async () => {
    await withEntries('add-to-queue', (songs) => {
      addToQueue(songs);
    });
  }, [withEntries, addToQueue]);

  const handleConvert = useCallback(async () => {
    setLoadingId('convert');
    try {
      await api(`/playlists/${playlist.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isSmart: false }),
      });
      onConvert();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to convert playlist', 'error');
    } finally {
      setLoadingId(null);
    }
  }, [playlist.id, onConvert, notify]);

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
    {
      items: [
        { id: 'edit', label: 'Edit', icon: 'mdi-pencil', onClick: onEdit },
        ...(options?.onShare
          ? [{ id: 'share', label: 'Share…', icon: 'mdi-share-variant', onClick: options.onShare }]
          : []),
      ],
    },
  ];

  if (playlist.isSmart) {
    sections.push({
      items: [
        {
          id: 'convert',
          label: 'Convert to normal playlist',
          icon: 'mdi-playlist-music',
          loading: loadingId === 'convert',
          onClick: handleConvert,
        },
      ],
    });
  }

  if (options?.onDelete) {
    sections.push({
      items: [
        {
          id: 'delete',
          label: 'Delete',
          icon: 'mdi-delete',
          variant: 'danger',
          onClick: options.onDelete,
        },
      ],
    });
  }

  return sections;
}
