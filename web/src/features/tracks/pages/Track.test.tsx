import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Song } from '../../../types';
import { Track } from './Track.js';
import { renderWithQueryClient, createTestQueryClient } from '../../../lib/testing.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const makeSong = (id: string): Song =>
  ({
    id,
    title: `Song ${id}`,
    artistId: 'ar-1',
    artistName: 'Artist One',
    albumId: 'al-1',
    albumName: 'Album One',
    year: 2020,
    genre: 'Rock',
    duration: 200,
    starred: false,
    explicit: false,
    mtime: 0,
    active: true,
    coverArtMissing: false,
    gapless: false,
  }) as Song;

function renderTrack(path: string, queryClient = createTestQueryClient()) {
  const location = memoryLocation({ path });
  return {
    location,
    ...renderWithQueryClient(
      <Router hook={location.hook}>
        <NotificationProvider>
          <Route path="/tracks/:id">{() => <Track />}</Route>
        </NotificationProvider>
      </Router>,
      queryClient,
    ),
  };
}

const songCalls = () => mockApi.mock.calls.filter((call) => String(call[0]).startsWith('/songs/'));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Track detail (react-query, P5)', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/songs/')) {
        return { song: makeSong(path.split('/')[2]) };
      }
      return {};
    });
  });

  it('serves a remount from the cache without refetching', async () => {
    const queryClient = createTestQueryClient();
    const first = renderTrack('/tracks/t1', queryClient);
    await screen.findByText('Song t1');
    first.unmount();

    renderTrack('/tracks/t1', queryClient);
    await screen.findByText('Song t1');

    expect(songCalls()).toHaveLength(1);
  });

  it('renders the error state with retry; retrying refetches and recovers', async () => {
    let fail = true;
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/songs/')) {
        if (fail) throw new Error('Network down');
        return { song: makeSong('t1') };
      }
      return {};
    });

    renderTrack('/tracks/t1');

    expect((await screen.findByRole('alert')).textContent).toContain('Network down');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByText('Song t1');
    expect(screen.queryByRole('alert')).toBeFalsy();
    expect(songCalls()).toHaveLength(2);
  });

  it('fetches the new id on navigation and cannot be clobbered by a late previous response', async () => {
    const pending = new Map<string, (value: unknown) => void>();
    mockApi.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          if (path.startsWith('/songs/')) {
            pending.set(path.split('/')[2], resolve);
            return;
          }
          resolve({});
        }),
    );

    const { location } = renderTrack('/tracks/t1');
    await waitFor(() => expect(pending.has('t1')).toBe(true));

    act(() => location.navigate('/tracks/t2'));
    await waitFor(() => expect(pending.has('t2')).toBe(true));
    pending.get('t2')!({ song: makeSong('t2') });
    await screen.findByText('Song t2');

    // The t1 response lands late; the page must keep showing t2.
    pending.get('t1')!({ song: makeSong('t1') });
    await act(async () => {});

    expect(screen.getByText('Song t2')).toBeTruthy();
    expect(screen.queryByText('Song t1')).toBeFalsy();
  });

  it('invalidates the songs lists when the track is deleted', async () => {
    const queryClient = createTestQueryClient();
    const listKey = ['songs', 'list', { libraryId: null }] as const;
    queryClient.setQueryData(listKey, { songs: [makeSong('t1')] });

    renderTrack('/tracks/t1', queryClient);
    await screen.findByText('Song t1');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);

    await waitFor(() => {
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    });
    expect(mockApi.mock.calls.some((call) => String(call[0]) === '/songs/t1' && call[1]?.method === 'DELETE')).toBe(true);
  });
});
