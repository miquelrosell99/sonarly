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
import { Composer } from '../../composers/pages/Composer.js';
import { Label } from '../../labels/pages/Label.js';
import { HomePage } from '../../home/pages/HomePage.js';

interface PlaylistDetailResponse {
  playlist: { entries: ({ id: string; artist?: string; album?: string } & Record<string, unknown>)[] };
}

interface AlbumDetailResponse {
  album: { songs: Song[] };
}

interface SongsResponse {
  songs: Song[];
}

const CONTEXTS = ['playlist', 'album', 'genre', 'composer', 'label'] as const;
type ContextType = (typeof CONTEXTS)[number];

// Overlay route, Immich-style. Three shapes:
//   /now-playing/<context>/<contextId>/<songId> — context page underneath
//   /now-playing/<songId>                       — lone track, Home underneath
//   /now-playing                                — safety net, Home underneath
// The URL stays while the overlay is open (updated as tracks change) and
// closing the overlay returns to the page the user came from (or the context
// page / home for direct visits).
export function NowPlayingRoute({ user }: { user: User | null }) {
  const params = useParams<{ context?: string; contextId?: string; songId?: string }>();
  const context = params.context;
  const contextId = params.contextId ? decodeURIComponent(params.contextId) : '';
  const songId = params.songId;
  const hasContext = context !== undefined && (CONTEXTS as readonly string[]).includes(context);

  const [, setLocation] = useLocation();
  const playQueue = usePlayer((state) => state.playQueue);
  const queueContext = usePlayer((state) => state.queueContext);
  const currentSong = usePlayer((state) => state.currentSong);
  const isOpen = useNowPlaying((state) => state.isOpen);
  const openNowPlaying = useNowPlaying((state) => state.open);
  const returnPath = useNowPlaying((state) => state.returnPath);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const songsRef = useRef<PlayerSong[]>([]);
  const wasOpenRef = useRef(false);
  const shareToken = getShareToken();
  const isGuest = Boolean(shareToken);

  const encodedId = encodeURIComponent(contextId);
  const contextPath =
    context === 'album' ? `/albums/${contextId}`
    : context === 'genre' ? `/genres/${encodedId}`
    : context === 'composer' ? `/composers/${encodedId}`
    : context === 'label' ? `/labels/${encodedId}`
    : `/playlists/${contextId}`;

  // Load context songs when the URL carries a context.
  useEffect(() => {
    if (!hasContext) {
      setReady(true);
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
        const filterKey = context === 'genre' ? 'genre' : context === 'composer' ? 'composer' : 'label';
        const res = await api<SongsResponse>(`/songs?${filterKey}=${encodeURIComponent(contextId)}`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, contextId, hasContext]);

  // Start playback when the URL targets something the store doesn't already
  // hold, then open the overlay (the guest shell has no overlay — playback
  // shows in the player bar).
  useEffect(() => {
    if (!ready) return;
    if (hasContext) {
      const alreadyPlaying =
        currentSong?.id === songId && queueContext?.type === context && queueContext.id === contextId;
      if (!alreadyPlaying) {
        const startIndex = Math.max(0, songsRef.current.findIndex((song) => song.id === songId));
        playQueue(songsRef.current, startIndex, false, { type: context as QueueContext['type'], id: contextId });
      }
    } else if (songId && currentSong?.id !== songId) {
      // Lone-track link: play just that song.
      api<{ song: Song }>(`/songs/${songId}`)
        .then((res) => playQueue([res.song as unknown as PlayerSong], 0, false, undefined))
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load track'));
      return;
    }
    if (currentSong && !isGuest) openNowPlaying();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, songId]);

  // Keep the URL in sync as tracks change while the overlay is open.
  useEffect(() => {
    if (!ready || !isOpen) return;
    if (hasContext) {
      if (!currentSong || currentSong.id === songId) return;
      if (queueContext?.type !== context || queueContext.id !== contextId) return;
      setLocation(`/now-playing/${context}/${encodedId}/${currentSong.id}`, { replace: true });
    } else if (songId && currentSong && currentSong.id !== songId) {
      setLocation(`/now-playing/${currentSong.id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id]);

  // Closing the overlay returns to where the user came from (or the context
  // page / home for direct visits).
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (ready && wasOpenRef.current) {
      const fallback = hasContext
        ? (shareToken ? `${contextPath}?shareToken=${shareToken}` : contextPath)
        : '/home';
      setLocation(returnPath ?? fallback);
      useNowPlaying.getState().setReturnPath(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ready]);

  if (error) {
    return <PageState error={error}>{null}</PageState>;
  }

  if (hasContext) {
    if (context === 'playlist') {
      return isGuest ? <GuestPlaylist /> : <PlaylistDetail user={user} />;
    }
    if (context === 'genre') return <Genre />;
    if (context === 'composer') return <Composer />;
    if (context === 'label') return <Label />;
    return user ? <Album user={user} /> : <PageState error="Sign in to view this album">{null}</PageState>;
  }
  return user ? <HomePage user={user} /> : <PageState error="Sign in to play tracks">{null}</PageState>;
}
