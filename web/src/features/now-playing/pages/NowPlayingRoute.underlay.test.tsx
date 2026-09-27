import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { QueryClientProvider } from '@tanstack/react-query';
import type { User } from '../../../types';
import { NowPlayingRoute } from './NowPlayingRoute.js';
import { usePlayer, resetPlayer, type PlayerSong } from '../../../stores/playerStore.js';
import { useNowPlaying, resetNowPlaying } from '../stores/nowPlayingStore.js';
import { createTestQueryClient } from '../../../lib/testing.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';

// The P5 follow-up with the REAL underlay pages mounted: wouter only exposes
// the matched route's params, so under /now-playing/... the detail pages used
// to receive no :id and render "not found" forever (guest-visible). The route
// now threads the contextId; these tests pin that wiring end to end,
// including the zero-request refresh contract (the underlay must not fire
// its own fetch while the player store covers the URL).
//
// Overlay-covered underlays intentionally render their loading state once
// the queue is built (invisible behind the opaque overlay, gone on close) —
// full underlay rendering is asserted through the guest flow, where the
// underlay IS the page.

const user = { id: 'u1', username: 'tester', isAdmin: false } as User;

function song(id: string): PlayerSong {
  return { id, title: `Title ${id}`, duration: 100 } as PlayerSong;
}

const coldSongs = [song('song-3'), song('song-4'), song('song-5')];

let fetchMock: ReturnType<typeof vi.fn>;

// The guest shell mounts the real AudioController; jsdom's media element has
// no playable pipeline (appsmoke.diag.test.tsx pattern).
beforeAll(() => {
  window.HTMLMediaElement.prototype.play = vi.fn(
    () => Promise.resolve(),
  ) as unknown as () => Promise<void>;
  window.HTMLMediaElement.prototype.pause = vi.fn() as () => void;
  window.HTMLMediaElement.prototype.load = vi.fn() as () => void;
});

function callsTo(fragment: string): unknown[][] {
  return fetchMock.mock.calls.filter((call) => String(call[0]).includes(fragment));
}

// Exactly the context resource — PlaylistCoverGrid also hits
// /playlists/:id/albums, which a plain substring match would count.
function contextCalls(endpoint: string): unknown[][] {
  return fetchMock.mock.calls.filter((call) => {
    const url = String(call[0]);
    return url === endpoint || url.startsWith(`${endpoint}?`);
  });
}

async function mountAt(path: string, withToken = false) {
  const location = memoryLocation({ path });
  const queryClient = createTestQueryClient();
  if (withToken) {
    window.history.pushState({}, '', `${path}?shareToken=tok-123`);
  }
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <NotificationProvider>
          <Router hook={location.hook}>
            <Route path="/now-playing/:context/:contextId/:songId">{() => <NowPlayingRoute user={user} />}</Route>
          </Router>
        </NotificationProvider>
      </QueryClientProvider>,
    );
  });
  return location;
}

describe('NowPlayingRoute underlay threading (P5 follow-up)', () => {
  beforeEach(() => {
    resetPlayer();
    resetNowPlaying();
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/playlists/pl-1')) {
        return Response.json({
          playlist: {
            id: 'pl-1',
            name: 'Shared Playlist',
            songCount: 3,
            entries: coldSongs.map((s) => ({
              id: s.id,
              title: s.title,
              album: 'The Album',
              artist: 'The Artist',
            })),
          },
        });
      }
      if (url.includes('/api/albums/al-9')) {
        return Response.json({
          album: { id: 'al-9', name: 'Album Nine', artistName: 'Artist Nine' },
          songs: coldSongs,
        });
      }
      if (url.includes('/api/songs/')) {
        return Response.json({ song: { id: 'song-4', starred: false, rating: 0 } });
      }
      if (url.includes('/api/songs')) {
        return Response.json({ songs: coldSongs, total: 3 });
      }
      if (url.includes('/api/albums')) {
        return Response.json({ albums: [] });
      }
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    window.history.pushState({}, '', '/');
    resetPlayer();
    resetNowPlaying();
  });

  it('cold album deep link never shows a param-starved "not found" and resolves one context', async () => {
    await mountAt('/now-playing/album/al-9/song-4');

    await waitFor(() => expect(usePlayer.getState().currentSong?.id).toBe('song-4'));
    // Route resolution and the briefly-enabled underlay share one cache key:
    // exactly one request.
    expect(contextCalls('/api/albums/al-9')).toHaveLength(1);
    expect(screen.queryByText('Album not found.')).toBeFalsy();
    expect(screen.queryByRole('alert')).toBeFalsy();
    await waitFor(() => expect(useNowPlaying.getState().isOpen).toBe(true));
  });

  it('cold playlist deep link resolves exactly one context and never shows "not found"', async () => {
    await mountAt('/now-playing/playlist/pl-1/song-4');

    await waitFor(() => expect(usePlayer.getState().currentSong?.id).toBe('song-4'));
    expect(contextCalls('/api/playlists/pl-1')).toHaveLength(1);
    expect(screen.queryByText('Playlist not found.')).toBeFalsy();
    expect(usePlayer.getState().queue.map((s) => s.id)).toEqual(['song-3', 'song-4', 'song-5']);
  });

  it('refresh with a store-covered queue keeps the underlay silent (zero requests)', async () => {
    usePlayer.getState().playQueue(coldSongs, 1, false, { type: 'playlist', id: 'pl-1' });

    await mountAt('/now-playing/playlist/pl-1/song-4');

    expect(fetchMock).not.toHaveBeenCalled();
    // Disabled-but-covered renders the loading state, never a bogus not-found.
    expect(screen.queryByText('Playlist not found.')).toBeFalsy();
    expect(useNowPlaying.getState().isOpen).toBe(true);
  });

  it('guest share link renders the playlist underlay instead of "not found"', async () => {
    await mountAt('/now-playing/playlist/pl-1/song-4', true);

    await waitFor(() => expect(usePlayer.getState().currentSong?.id).toBe('song-4'));
    // Guests always fetch (no overlay covers their underlay) and pass the token.
    expect(contextCalls('/api/playlists/pl-1')).toHaveLength(1);
    expect(callsTo('shareToken=tok-123').length).toBeGreaterThan(0);
    // The underlay IS the guest's page: it renders the actual playlist.
    await waitFor(() => {
      expect(screen.getAllByText('Shared Playlist').length).toBeGreaterThan(0);
      expect(screen.getByText('Title song-3')).toBeTruthy();
      expect(screen.getByText('Title song-5')).toBeTruthy();
    });
    expect(screen.queryByText('Playlist not found.')).toBeFalsy();
    // Guests never open the overlay.
    expect(useNowPlaying.getState().isOpen).toBe(false);
  });

  it('genre deep link decodes the threaded contextId exactly once', async () => {
    await mountAt(`/now-playing/genre/${encodeURIComponent('Rock Fusion')}/song-4`);

    await waitFor(() => expect(callsTo('/api/songs')).toHaveLength(1));
    const songsUrl = String(callsTo('/api/songs')[0][0]);
    expect(decodeURIComponent(songsUrl).replace(/\+/g, ' ')).toContain('genre=Rock Fusion');
    expect(callsTo('/api/albums')).toHaveLength(1);
    expect(screen.queryByText('Genre not found.')).toBeFalsy();
    expect(screen.queryByRole('alert')).toBeFalsy();
    await waitFor(() => expect(usePlayer.getState().currentSong?.id).toBe('song-4'));
  });
});
