import { useCallback, useState } from 'react';
import type { Playlist, Song } from '../types';
import type { components } from '../contract/schema.js';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { api } from '../lib/api.js';
import { downloadSongs } from '../lib/download.js';
import { songFromPlaylistEntry } from '../lib/entityMappers.js';
import { getShareToken } from '../lib/shareToken.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayActions } from './usePlayActions.js';

type PlaylistDetailResponse = components['schemas']['PlaylistDetail'];

type LoadingId = 'play' | 'shuffle-play' | 'play-next' | 'add-to-queue' | 'download' | 'convert' | null;

interface PlaylistContextMenuOptions {
  onShare?: () => void;
  onDelete?: () => void;
  /**
   * Whether the Download entry shows. Session surfaces default to true;
   * share-link guests default to false — pass the shared playlist's
   * shareDownload flag explicitly for guest surfaces.
   */
  allowDownload?: boolean;
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
  const allowDownload = options?.allowDownload ?? getShareToken() === undefined;

  const withEntries = useCallback(
    async (id: Exclude<LoadingId, 'convert'>, action: (songs: Song[]) => void | Promise<void>) => {
      setLoadingId(id);
      try {
        const { playlist: detail } = await api<{ playlist: PlaylistDetailResponse }>(`/playlists/${playlist.id}`);
        // Wire entries are row-level PlaylistEntry shapes; widen via the shared mapper.
        await action(detail.entries.map(songFromPlaylistEntry));
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

  // One resolution: the detail fetch carries the entries; their ids drive a
  // single ZIP pack request (the share token rides the URL when present).
  const handleDownload = useCallback(async () => {
    await withEntries('download', (songs) => downloadSongs(songs.map((song) => song.id)));
  }, [withEntries]);

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
