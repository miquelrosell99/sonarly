import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import type { Song } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { PageState } from '../../../components/PageState.js';
import { usePlayer, type PlayerSong, type QueueContext } from '../../../stores/playerStore.js';
import { useNowPlaying } from '../stores/nowPlayingStore.js';

interface PlaylistDetailResponse {
  playlist: { entries: ({ id: string; artist?: string; album?: string } & Record<string, unknown>)[] };
}

interface AlbumDetailResponse {
  album: { songs: Song[] };
}

// Deep-link target: /now-playing/<playlist|album>/<contextId>/<songId>
// Loads the context as the queue, starts at the given song, opens the Now
// Playing overlay, and lands on the context page underneath (Immich-style:
// the link carries both the item and its surrounding context).
export function NowPlayingRoute() {
  const { context, contextId, songId } = useParams<{ context: string; contextId: string; songId: string }>();
  const [, setLocation] = useLocation();
  const playQueue = usePlayer((state) => state.playQueue);
  const openNowPlaying = useNowPlaying((state) => state.open);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const run = async () => {
      let songs: PlayerSong[];
      let contextPath: string;
      const queueContext: QueueContext | null =
        context === 'playlist' ? { type: 'playlist', id: contextId }
        : context === 'album' ? { type: 'album', id: contextId }
        : null;

      if (!queueContext) {
        setError('Unknown playback context.');
        return;
      }

      if (queueContext.type === 'playlist') {
        const detail = await api<PlaylistDetailResponse>(`/playlists/${contextId}`);
        songs = detail.playlist.entries.map((entry) => ({
          ...entry,
          artistName: entry.artist as string | undefined,
          albumName: entry.album as string | undefined,
        })) as unknown as PlayerSong[];
        contextPath = `/playlists/${contextId}`;
      } else {
        const detail = await api<AlbumDetailResponse>(`/albums/${contextId}`);
        songs = detail.album.songs as unknown as PlayerSong[];
        contextPath = `/albums/${contextId}`;
      }

      if (songs.length === 0) {
        setError('Nothing to play here.');
        return;
      }

      const startIndex = Math.max(0, songs.findIndex((song) => song.id === songId));
      playQueue(songs, startIndex, false, queueContext);
      openNowPlaying();
      setLocation(contextPath);
    };

    run().catch((err) => setError(err instanceof Error ? err.message : 'Failed to start playback'));
  }, [context, contextId, songId, playQueue, openNowPlaying, setLocation]);

  return (
    <PageState loading={!error} error={error} loadingMessage="Starting playback…">
      <></>
    </PageState>
  );
}
