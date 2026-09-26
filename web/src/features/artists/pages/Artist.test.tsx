import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Song, User } from '../../../types';
import { Artist } from './Artist.js';
import { renderWithQueryClient, createTestQueryClient } from '../../../lib/testing.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

const user = { id: 'u1', username: 'tester', isAdmin: false, blurExplicitTitles: false } as User;

const makeSong = (id: string): Song =>
  ({
    id,
    title: `Track ${id}`,
    artistId: 'ar-1',
    artistName: 'The Artist',
    albumId: 'al-9',
    albumName: 'Some Album',
    duration: 150,
    starred: false,
    explicit: false,
    filePath: `/music/${id}.mp3`,
    mtime: 0,
    checksum: '',
  }) as Song;

const artistPayload = () => ({
  artist: {
    id: 'ar-1',
    name: 'The Artist',
    albums: [
      { id: 'al-9', name: 'Some Album', year: 2019, starred: false },
      { id: 'al-10', name: 'Other Album', year: 2022, starred: false },
    ],
    starred: false,
  },
  songs: [makeSong('s1'), makeSong('s2'), makeSong('s3')],
});

function renderArtist(path: string, queryClient = createTestQueryClient()) {
  const location = memoryLocation({ path });
  return {
    location,
    ...renderWithQueryClient(
      <Router hook={location.hook}>
        <NotificationProvider>
          <Route path="/artists/:id">{() => <Artist user={user} />}</Route>
        </NotificationProvider>
      </Router>,
      queryClient,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Artist detail (react-query, embedded songs, P5)', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/artists/')) return artistPayload();
      return {};
    });
  });

  it('makes exactly one aggregate request and renders the embedded songs', async () => {
    renderArtist('/artists/ar-1');

    await screen.findByText('The Artist');
    // Embedded songs render in the Tracks list — including every song, not a
    // 500-row client-filtered subset, and with no second /songs fetch.
    expect(screen.getByText('Track s1')).toBeTruthy();
    expect(screen.getByText('Track s2')).toBeTruthy();
    expect(screen.getByText('Track s3')).toBeTruthy();
    // Album cards render from the same aggregate response.
    expect(screen.getAllByText('Some Album').length).toBeGreaterThan(0);

    const calls = mockApi.mock.calls.map((call) => String(call[0]));
    expect(calls.filter((path) => path.startsWith('/artists/ar-1'))).toHaveLength(1);
    expect(calls.some((path) => path.startsWith('/songs'))).toBe(false);
  });

  it('serves a remount from the cache without refetching', async () => {
    const queryClient = createTestQueryClient();
    const first = renderArtist('/artists/ar-1', queryClient);
    await screen.findByText('Track s1');
    first.unmount();

    renderArtist('/artists/ar-1', queryClient);
    await screen.findByText('Track s1');

    expect(mockApi.mock.calls.filter((call) => String(call[0]).startsWith('/artists/'))).toHaveLength(1);
  });

  it('renders the error state with retry; retrying recovers', async () => {
    let fail = true;
    mockApi.mockImplementation(async (path: string) => {
      if (path.startsWith('/artists/')) {
        if (fail) throw new Error('gone');
        return artistPayload();
      }
      return {};
    });

    renderArtist('/artists/ar-1');

    expect((await screen.findByRole('alert')).textContent).toContain('gone');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByText('The Artist');
  });

  it('toggles an artist favorite in place and invalidates the artists lists', async () => {
    const queryClient = createTestQueryClient();
    const listKey = ['artists', 'list', { libraryId: null }] as const;
    queryClient.setQueryData(listKey, { artists: [{ id: 'ar-1', name: 'The Artist' }] });

    renderArtist('/artists/ar-1', queryClient);
    await screen.findByText('The Artist');

    // The header favorite is the first of several favorite buttons (album
    // cards and track rows carry their own).
    fireEvent.click(screen.getAllByRole('button', { name: 'Add favorite' })[0]);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove favorite' }).length).toBeGreaterThan(0));
    await waitFor(() => {
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    });
    expect(mockApi.mock.calls.some((call) => String(call[0]) === '/favorites')).toBe(true);
  });
});
