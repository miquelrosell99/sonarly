import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { SearchBox } from './SearchBox.js';
import * as apiModule from '../lib/api.js';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderSearchBox() {
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <SearchBox />
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('renders at most 5 items per category and a More link when more exist', async () => {
  vi.spyOn(apiModule, 'api').mockResolvedValue({
    songs: Array.from({ length: 6 }, (_, i) => ({
      id: `song-${i}`,
      title: `Song ${i}`,
      filePath: `/song${i}.mp3`,
      mtime: 0,
      checksum: '',
    })),
    albums: [],
    artists: [],
    playlists: [],
  });

  renderSearchBox();
  const input = screen.getByLabelText('Search');
  fireEvent.change(input, { target: { value: 'test' } });
  fireEvent.focus(input);

  await waitFor(() => {
    expect(screen.getByText('Song 0')).toBeTruthy();
  });

  expect(screen.queryAllByText(/Song \d/).length).toBe(5);
  expect(screen.getByText('More songs')).toBeTruthy();
});
