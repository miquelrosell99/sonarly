import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { User } from '@sonarly/shared';
import { NowPlayingRoute } from './NowPlayingRoute.js';
import { usePlayer, resetPlayer, type PlayerSong } from '../../../stores/playerStore.js';
import { useNowPlaying, resetNowPlaying } from '../stores/nowPlayingStore.js';

// The underlay pages own their data fetching; we assert exactly what the
// route itself requests, so stub them out.
vi.mock('../../playlists/pages/PlaylistDetail.js', () => ({ PlaylistDetail: () => null }));
vi.mock('../../playlists/pages/GuestPlaylist.js', () => ({ GuestPlaylist: () => null }));
vi.mock('../../albums/pages/Album.js', () => ({ Album: () => null }));
vi.mock('../../genres/pages/Genre.js', () => ({ Genre: () => null }));
vi.mock('../../composers/pages/Composer.js', () => ({ Composer: () => null }));
vi.mock('../../labels/pages/Label.js', () => ({ Label: () => null }));
vi.mock('../../home/pages/HomePage.js', () => ({ HomePage: () => null }));

const user = { id: 'u1', username: 'tester', isAdmin: false } as User;

function song(id: string): PlayerSong {
  return { id, title: `Title ${id}`, duration: 100 } as PlayerSong;
}

const queueSongs = [song('song-1'), song('song-2'), song('song-3'), song('song-4')];
const coldSongs = [song('song-3'), song('song-4'), song('song-5')];

let fetchMock: ReturnType<typeof vi.fn>;

function callsTo(fragment: string): unknown[][] {
  return fetchMock.mock.calls.filter((call) => String(call[0]).includes(fragment));
}

async function mountAt(path: string) {
  const location = memoryLocation({ path });
  await act(async () => {
    render(
      <Router hook={location.hook}>
        <Route path="/now-playing/:context/:contextId/:songId">{() => <NowPlayingRoute user={user} />}</Route>
        <Route path="/now-playing/:songId">{() => <NowPlayingRoute user={user} />}</Route>
        <Route path="/now-playing">{() => <NowPlayingRoute user={user} />}</Route>
      </Router>,
    );
  });
}

describe('NowPlayingRoute (FF5: no context re-fetch when the store already holds the queue)', () => {
  beforeEach(() => {
    resetPlayer();
    resetNowPlaying();
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/playlists/pl-1')) {
        return Response.json({ playlist: { entries: coldSongs } });
      }
      if (url.includes('/api/songs/song-9')) {
        return Response.json({ song: song('song-9') });
      }
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    resetPlayer();
    resetNowPlaying();
  });

  it('refreshing a context URL with a seeded queue makes zero requests', async () => {
    usePlayer.getState().playQueue(queueSongs, 2, false, { type: 'playlist', id: 'pl-1' });

    await mountAt('/now-playing/playlist/pl-1/song-3');

    expect(callsTo('/api/playlists/pl-1')).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    // Playback continues from the persisted queue, overlay opens.
    const state = usePlayer.getState();
    expect(state.currentSong?.id).toBe('song-3');
    expect(state.queue).toHaveLength(4);
    expect(useNowPlaying.getState().isOpen).toBe(true);
  });

  it('cold deep link lazily resolves exactly one context', async () => {
    await mountAt('/now-playing/playlist/pl-1/song-4');

    expect(callsTo('/api/playlists/pl-1')).toHaveLength(1);
    const state = usePlayer.getState();
    expect(state.currentSong?.id).toBe('song-4');
    expect(state.queue.map((s) => s.id)).toEqual(['song-3', 'song-4', 'song-5']);
  });

  it('lone-song URL served from the store queue makes zero requests', async () => {
    usePlayer.getState().playQueue(queueSongs, 0, false, undefined);

    await mountAt('/now-playing/song-2');

    expect(callsTo('/api/songs/song-2')).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(usePlayer.getState().currentSong?.id).toBe('song-2');
  });

  it('cold lone-song URL fetches exactly that song', async () => {
    await mountAt('/now-playing/song-9');

    expect(callsTo('/api/songs/song-9')).toHaveLength(1);
    expect(usePlayer.getState().currentSong?.id).toBe('song-9');
  });

  it('preserves shuffle state on refresh instead of rebuilding the queue', async () => {
    usePlayer.getState().playQueue(queueSongs, 1, true, { type: 'playlist', id: 'pl-1' });
    const before = usePlayer.getState();
    const shuffledBefore = [...before.shuffledIndices];
    expect(before.shuffle).toBe(true);

    const currentId = before.currentSong?.id;
    await mountAt(`/now-playing/playlist/pl-1/${currentId}`);

    const after = usePlayer.getState();
    expect(after.shuffle).toBe(true);
    expect([...after.shuffledIndices]).toEqual(shuffledBefore);
    expect(after.currentSong?.id).toBe(currentId);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
