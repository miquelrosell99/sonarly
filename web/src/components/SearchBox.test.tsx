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

it('wires the combobox to its listbox and keeps options out of the tab order (audit F27d)', async () => {
  vi.spyOn(apiModule, 'api').mockResolvedValue({
    songs: [{ id: 'song-1', title: 'Song 1', filePath: '/song1.mp3', mtime: 0, checksum: '' }],
    albums: [],
    artists: [],
    playlists: [],
  });

  renderSearchBox();
  const input = screen.getByLabelText('Search');
  expect(input.getAttribute('aria-controls')).toBeNull();

  fireEvent.change(input, { target: { value: 'unique-f27d' } });

  const listbox = await screen.findByRole('listbox');
  expect(input.getAttribute('aria-controls')).toBe(listbox.id);
  expect(input.getAttribute('aria-expanded')).toBe('true');

  // li wrappers are presentational; aria-activedescendant is the single
  // focus path, so options must not be tabbable.
  expect(listbox.querySelectorAll('li[role="presentation"]').length).toBe(1);
  const option = screen.getByRole('option', { name: 'Song 1' });
  expect(option.getAttribute('tabindex')).toBe('-1');
});
