import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import type { Song, User } from '@sonarly/shared';
import { api } from '../../../lib/api.js';
import { getShareToken, withShareToken } from '../../../lib/shareToken.js';
import { PageState } from '../../../components/PageState.js';
import { usePlayer, type PlayerSong, type QueueContext } from '../../../stores/playerStore.js';
import { useNowPlaying } from '../stores/nowPlayingStore.js';
import { PlaylistDetail } from '../../playlists/pages/PlaylistDetail.js';
import { GuestPlaylist } from '../../playlists/pages/GuestPlaylist.js';
import { Album } from '../../albums/pages/Album.js';
import { Genre } from '../../genres/pages/Genre.js';

interface PlaylistDetailResponse {
  playlist: { entries: ({ id: string; artist?: string; album?: string } & Record<string, unknown>)[] };
}

interface AlbumDetailResponse {
  album: { songs: Song[] };
}

interface SongsResponse {
  songs: Song[];
}

// Overlay route: /now-playing/<playlist|album>/<contextId>/<songId> renders
// the context page with Now Playing open on top, Immich-style. The URL stays
// while the overlay is open (updated as tracks change), closing the overlay
// returns to the plain context path, and sharing/refreshing the URL resumes
// playback of that song in its context.
export function NowPlayingRoute({ user }: { user: User | null }) {
  const { context, contextId, songId } = useParams<{ context: string; contextId: string; songId: string }>();
  const [, setLocation] = useLocation();
  const playQueue = usePlayer((state) => state.playQueue);
  const queueContext = usePlayer((state) => state.queueContext);
  const currentSong = usePlayer((state) => state.currentSong);
  const isOpen = useNowPlaying((state) => state.isOpen);
  const openNowPlaying = useNowPlaying((state) => state.open);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const songsRef = useRef<PlayerSong[]>([]);
  const wasOpenRef = useRef(false);
  const shareToken = getShareToken();
  const isGuest = Boolean(shareToken);

  const valid = context === 'playlist' || context === 'album' || context === 'genre';
  const contextPath =
    context === 'album' ? `/albums/${contextId}`
    : context === 'genre' ? `/genres/${encodeURIComponent(contextId)}`
    : `/playlists/${contextId}`;

  // Load the context's songs once per context.
  useEffect(() => {
    if (!valid) {
      setError('Unknown playback context.');
      return;
    }
    let cancelled = false;
    setReady(false);
    const load = async () => {
      let songs: PlayerSong[];
      if (context === 'playlist') {
        const detail = await api<PlaylistDetailResponse>(withShareToken(`/playlists/${contextId}`));
        songs = detail.playlist.entries.map((entry) => ({
          ...entry,
          artistName: entry.artist as string | undefined,
          albumName: entry.album as string | undefined,
        })) as unknown as PlayerSong[];
      } else if (context === 'album') {
        const detail = await api<AlbumDetailResponse>(`/albums/${contextId}`);
        songs = detail.album.songs as unknown as PlayerSong[];
      } else {
        const res = await api<SongsResponse>(`/songs?genre=${encodeURIComponent(contextId)}`);
        songs = res.songs as unknown as PlayerSong[];
      }
      if (cancelled) return;
      if (songs.length === 0) {
        setError('Nothing to play here.');
        return;
      }
      songsRef.current = songs;
      setReady(true);
    };
    load().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
    });
    return () => {
      cancelled = true;
    };
  }, [context, contextId, valid]);

  // Start playback when the URL targets a different song/context than the
  // store already holds, then open the overlay (signed-in users only — the
  // guest shell has no overlay, playback shows in the player bar).
  useEffect(() => {
    if (!ready) return;
    const alreadyPlaying =
      currentSong?.id === songId && queueContext?.type === context && queueContext.id === contextId;
    if (!alreadyPlaying) {
      const startIndex = Math.max(0, songsRef.current.findIndex((song) => song.id === songId));
      playQueue(songsRef.current, startIndex, false, { type: context as QueueContext['type'], id: contextId });
    }
    if (!isGuest) openNowPlaying();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, songId]);

  // Keep the URL in sync as tracks change while the overlay is open.
  useEffect(() => {
    if (!ready || !isOpen || !currentSong || currentSong.id === songId) return;
    if (queueContext?.type !== context || queueContext.id !== contextId) return;
    setLocation(`/now-playing/${context}/${contextId}/${currentSong.id}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id]);

  // Closing the overlay returns to the plain context page.
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (ready && wasOpenRef.current) {
      setLocation(shareToken ? `${contextPath}?shareToken=${shareToken}` : contextPath);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ready]);

  if (error) {
    return <PageState error={error}>{null}</PageState>;
  }

  if (context === 'playlist') {
    return isGuest ? <GuestPlaylist /> : <PlaylistDetail user={user} />;
  }
  if (context === 'genre') {
    return <Genre />;
  }
  return user ? <Album user={user} /> : <PageState error="Sign in to view this album">{null}</PageState>;
}
