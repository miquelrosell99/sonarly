import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useParams } from 'wouter';
import type { User } from '../../../types';
import { getShareToken, withShareToken } from '../../../lib/shareToken.js';
import { PageState } from '../../../components/PageState.js';
import { usePlaylist } from '../../../hooks/usePlaylist.js';
import { useSongsList } from '../../../hooks/useLibraryLists.js';
import { useAlbumDetail, useSongDetail } from '../../../hooks/useEntityDetails.js';
import { useLibraryStore } from '../../../stores/libraryStore.js';
import { usePlayer, type PlayerSong, type QueueContext } from '../../../stores/playerStore.js';
import { useNowPlaying } from '../stores/nowPlayingStore.js';
import { PlaylistDetail } from '../../playlists/pages/PlaylistDetail.js';
import { GuestPlaylist } from '../../playlists/pages/GuestPlaylist.js';
import { Album } from '../../albums/pages/Album.js';
import { Genre } from '../../genres/pages/Genre.js';
import { Composer } from '../../composers/pages/Composer.js';
import { Label } from '../../labels/pages/Label.js';
import { HomePage } from '../../home/pages/HomePage.js';

const CONTEXTS = ['playlist', 'album', 'genre', 'composer', 'label'] as const;
type ContextType = (typeof CONTEXTS)[number];

// Overlay route, Immich-style. Three shapes:
//   /now-playing/<context>/<contextId>/<songId> — context page underneath
//   /now-playing/<songId>                       — lone track, Home underneath
//   /now-playing                                — safety net, Home underneath
// The URL stays while the overlay is open (updated as tracks change) and
// closing the overlay returns to the page the user came from (or the context
// page / home for direct visits).
//
// Context songs resolve through the shared react-query cache — the same
// detail/list keys the underlay pages consume — so a cold deep link fetches
// the context exactly once for both the queue and the underlay (P5/F25), and
// the album branch reads the real `{album, songs}` response shape (F4).
export function NowPlayingRoute({ user }: { user: User | null }) {
  const params = useParams<{ context?: string; contextId?: string; songId?: string }>();
  const context = params.context;
  const contextId = params.contextId ? decodeURIComponent(params.contextId) : '';
  const songId = params.songId;
  const hasContext = context !== undefined && (CONTEXTS as readonly string[]).includes(context);

  const [, setLocation] = useLocation();
  const playQueue = usePlayer((state) => state.playQueue);
  const queue = usePlayer((state) => state.queue);
  const queueContext = usePlayer((state) => state.queueContext);
  const currentSong = usePlayer((state) => state.currentSong);
  const isOpen = useNowPlaying((state) => state.isOpen);
  const openNowPlaying = useNowPlaying((state) => state.open);
  const returnPath = useNowPlaying((state) => state.returnPath);
  const selectedLibraryId = useLibraryStore((state) => state.selectedLibraryId);
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

  // FF5: the player store already materializes the queue (persisted across
  // refresh). When it covers this URL, refreshing the overlay must not
  // re-download the whole context (up to 2×500 rows) to rebuild it — derive
  // the queue from the store instead. Only a queue that cannot resolve the
  // URL (cold deep link, or the referenced song is gone) lazily resolves the
  // single referenced context.
  const storeQueueCoversUrl = hasContext
    ? queueContext?.type === context &&
      queueContext.id === contextId &&
      queue.length > 0 &&
      (songId === undefined || queue.some((song) => song.id === songId))
    : false;

  // Resolve the context through the same queries the underlay pages use. All
  // of them are disabled while the store covers the URL (zero requests) and
  // outside their context type (id undefined / enabled false).
  const needsResolution = hasContext && !storeQueueCoversUrl;
  const filterKey =
    context === 'genre' ? 'genre'
    : context === 'composer' ? 'composer'
    : context === 'label' ? 'label'
    : undefined;
  const playlistQuery = usePlaylist(context === 'playlist' && needsResolution ? contextId : undefined);
  const albumQuery = useAlbumDetail(context === 'album' && needsResolution ? contextId : undefined);
  const filterSongsQuery = useSongsList(
    { libraryId: selectedLibraryId, ...(filterKey ? { [filterKey]: contextId } : {}) },
    needsResolution && filterKey !== undefined,
  );
  // Lone-track deep link: only fetched when the store queue cannot serve it.
  const loneSongStoreIndex = hasContext || !songId ? -1 : queue.findIndex((song) => song.id === songId);
  const songQuery = useSongDetail(!hasContext && loneSongStoreIndex < 0 ? songId : undefined);

  const contextSongs: PlayerSong[] | null = useMemo(() => {
    if (!needsResolution) return null;
    if (context === 'playlist') {
      const playlist = playlistQuery.data;
      if (!playlist) return null;
      return playlist.entries.map((entry) => ({
        ...entry,
        artistName: entry.artist as string | undefined,
        albumName: entry.album as string | undefined,
      })) as unknown as PlayerSong[];
    }
    if (context === 'album') {
      // F4: the wire shape is {album, songs}; the songs ride the top level.
      return albumQuery.data ? (albumQuery.data.songs as unknown as PlayerSong[]) : null;
    }
    // keepPreviousData would hand us the previous context's songs while the
    // new key loads — never build a queue from placeholder data.
    if (filterSongsQuery.isPlaceholderData) return null;
    return filterSongsQuery.data ? (filterSongsQuery.data.songs as unknown as PlayerSong[]) : null;
  }, [needsResolution, context, playlistQuery.data, albumQuery.data, filterSongsQuery.data, filterSongsQuery.isPlaceholderData]);

  const resolutionError = needsResolution
    ? context === 'playlist'
      ? playlistQuery.error
      : context === 'album'
        ? albumQuery.error
        : filterSongsQuery.error
    : null;

  const resolvedSongs: PlayerSong[] | null = hasContext
    ? storeQueueCoversUrl
      ? queue
      : contextSongs
    : null;

  // The overlay may drive side effects (playback start, URL sync, close
  // hand-back) only once the context is resolved — or immediately when the
  // store already covers the URL / there is no context at all.
  const ready = hasContext
    ? storeQueueCoversUrl || resolvedSongs !== null || resolutionError !== null
    : true;

  // Start playback when the URL targets something the store doesn't already
  // hold, then open the overlay (the guest shell has no overlay — playback
  // shows in the player bar).
  useEffect(() => {
    if (hasContext) {
      const alreadyPlaying =
        currentSong?.id === songId && queueContext?.type === context && queueContext.id === contextId;
      if (!alreadyPlaying) {
        if (!resolvedSongs) return;
        if (resolvedSongs.length === 0) return;
        const startIndex = Math.max(0, resolvedSongs.findIndex((song) => song.id === songId));
        playQueue(resolvedSongs, startIndex, false, { type: context as QueueContext['type'], id: contextId });
      }
    } else if (songId && currentSong?.id !== songId) {
      // Lone-track link: play just that song. If the store already holds it,
      // reposition within the persisted queue instead of re-fetching it.
      if (loneSongStoreIndex >= 0) {
        playQueue(queue, loneSongStoreIndex, false, undefined);
      } else if (songQuery.data) {
        playQueue([songQuery.data.song as unknown as PlayerSong], 0, false, undefined);
      } else {
        return;
      }
      return;
    }
    if (currentSong && !isGuest) openNowPlaying();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContext, context, contextId, songId, storeQueueCoversUrl, resolvedSongs, loneSongStoreIndex, songQuery.data, queue, queueContext, currentSong?.id]);

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
      const fallback = hasContext ? withShareToken(contextPath) : '/home';
      setLocation(returnPath ?? fallback);
      useNowPlaying.getState().setReturnPath(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ready]);

  const nothingToPlay =
    hasContext && !storeQueueCoversUrl && contextSongs !== null && contextSongs.length === 0;
  const routeError = resolutionError?.message ?? songQuery.error?.message ?? (nothingToPlay ? 'Nothing to play here.' : null);
  const resolutionPending = hasContext && !ready;

  if (routeError) {
    return <PageState error={routeError}>{null}</PageState>;
  }

  if (resolutionPending) {
    return <PageState loading>{null}</PageState>;
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
