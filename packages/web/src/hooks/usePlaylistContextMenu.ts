import { useCallback, useState } from 'react';
import type { Playlist, Song } from '@sonarly/shared';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { api } from '../lib/api.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayActions } from './usePlayActions.js';

interface PlaylistDetail {
  playlist: Playlist & { songCount: number; entries: Song[] };
}

type LoadingId = 'play' | 'play-next' | 'add-to-queue' | 'convert' | null;

export function usePlaylistContextMenu(
  playlist: Playlist,
  onEdit: () => void,
  onConvert: () => void,
): ContextMenuSection[] {
  const { playSongs, playNext, addToQueue } = usePlayActions();
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
        { id: 'play-next', label: 'Play next', icon: 'mdi-playlist-plus', loading: loadingId === 'play-next', onClick: handlePlayNext },
        { id: 'add-to-queue', label: 'Add to queue', icon: 'mdi-playlist-play', loading: loadingId === 'add-to-queue', onClick: handleAddToQueue },
      ],
    },
    {
      items: [{ id: 'edit', label: 'Edit', icon: 'mdi-pencil', onClick: onEdit }],
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

  return sections;
}
