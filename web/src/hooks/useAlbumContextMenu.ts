import { useCallback, useState } from 'react';
import { useLocation } from 'wouter';
import type { Album, Song } from '../types';
import type { ContextMenuSection } from '../components/ItemContextMenu.js';
import { api } from '../lib/api.js';
import { downloadSongs } from '../lib/download.js';
import { getShareToken } from '../lib/shareToken.js';
import { useNotification } from '../contexts/NotificationContext.js';
import { usePlayActions } from './usePlayActions.js';

interface AlbumDetail {
  album: Album;
  songs: Song[];
}

/**
 * The subset of the album shape the context menu actually reads. Full Albums
 * (album lists/cards) carry `shownSongCount` for the empty-album disable
 * check; search hits don't, and the menu stays enabled for them — matching
 * the long-standing runtime behavior for subset DTOs.
 */
export type AlbumMenuTarget = Pick<Album, 'id'> & Partial<Pick<Album, 'artistId' | 'shownSongCount'>>;

export interface AlbumContextMenuOptions {
  /** Destructive action (the view owns the confirm + invalidate flow). */
  onDelete?: () => void;
  isAdmin?: boolean;
  /**
   * Whether the Download entry shows. Session surfaces default to true;
   * share-link guests default to false — pass the shared playlist's
   * shareDownload flag explicitly for guest surfaces.
   */
  allowDownload?: boolean;
}

type LoadingId = 'play' | 'shuffle-play' | 'play-next' | 'add-to-queue' | 'download' | null;

export function useAlbumContextMenu(album: AlbumMenuTarget, options?: AlbumContextMenuOptions): ContextMenuSection[] {
  const { playSongs, shufflePlay, playNext, addToQueue } = usePlayActions();
  const { notify } = useNotification();
  const [, navigate] = useLocation();
  const [loadingId, setLoadingId] = useState<LoadingId>(null);
  const disabled = album.shownSongCount === 0;
  const allowDownload = options?.allowDownload ?? getShareToken() === undefined;

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

  // One resolution: the detail fetch embeds the songs; the ids then drive a
  // single ZIP pack request.
  const handleDownload = useCallback(async () => {
    await withAlbumSongs('download', (songs) => downloadSongs(songs.map((song) => song.id)));
  }, [withAlbumSongs]);

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

  if (allowDownload) {
    sections.push({
      items: [
        {
          id: 'download',
          label: 'Download',
          icon: 'mdi-download',
          disabled,
          loading: loadingId === 'download',
          onClick: handleDownload,
        },
      ],
    });
  }

  if (album.artistId) {
    sections.push({
      items: [
        { id: 'go-to-artist', label: 'Go to artist', icon: 'mdi-account-music', onClick: () => navigate(`/artists/${album.artistId}`) },
      ],
    });
  }

  if (options?.onDelete && (options.isAdmin ?? true)) {
    sections.push({
      items: [
        { id: 'delete', label: 'Delete', icon: 'mdi-delete', variant: 'danger', onClick: options.onDelete },
      ],
    });
  }

  return sections;
}
