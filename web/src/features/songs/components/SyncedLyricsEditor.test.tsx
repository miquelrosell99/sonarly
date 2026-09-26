import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { SyncedLyricsEditor } from './SyncedLyricsEditor.js';
import { api } from '../../../lib/api.js';

afterEach(() => cleanup());

vi.mock('../../../lib/api.js', () => ({
  api: vi.fn((path: string, opts?: unknown) => {
    if (path === '/songs/1/lyrics' && !opts) {
      return Promise.resolve({ lyrics: '', syncedLyrics: [{ time: 1, text: 'hello' }] });
    }
    if (path.startsWith('/lrclib/search')) {
      return Promise.resolve({
        matches: [
          {
            id: 42,
            title: 'Song',
            artistName: 'Artist',
            lyrics: 'fetched line',
            syncedLyrics: [{ time: 2, text: 'fetched line' }],
          },
        ],
      });
    }
    return Promise.resolve({ ok: true });
  }),
}));

const mockedApi = vi.mocked(api);

function renderEditor(onClose = () => {}) {
  return render(<SyncedLyricsEditor songId="1" title="Song" artistName="Artist" duration={120} onClose={onClose} />);
}

describe('SyncedLyricsEditor', () => {
  it('renders a loaded lyric line as a pill', async () => {
    renderEditor();
    expect(await screen.findByRole('button', { name: /edit line: hello at 0:01\.00/i })).toBeTruthy();
  });

  it('calls onClose when cancel is clicked', async () => {
    const onClose = vi.fn();
    renderEditor(onClose);
    await screen.findByRole('button', { name: /edit line: hello/i });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves lyrics and syncedLyrics via PUT', async () => {
    const onClose = vi.fn();
    renderEditor(onClose);
    await screen.findByRole('button', { name: /edit line: hello/i });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockedApi).toHaveBeenCalledWith('/songs/1/lyrics', {
      method: 'PUT',
      body: JSON.stringify({ lyrics: '', syncedLyrics: [{ time: 1, text: 'hello' }] }),
    });
  });

  it('adds a line at the current position and opens its text editor', async () => {
    renderEditor();
    await screen.findByRole('button', { name: /edit line: hello/i });
    fireEvent.click(screen.getByRole('button', { name: /add line at current position/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit line at 0:00\.00/i });
    fireEvent.change(within(dialog).getByLabelText(/line text/i), { target: { value: 'brand new' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('button', { name: /edit line: brand new at 0:00\.00/i })).toBeTruthy();
  });

  it('edits a line through the pill text modal', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /edit line: hello/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit line at 0:01\.00/i });
    fireEvent.change(within(dialog).getByLabelText(/line text/i), { target: { value: 'updated' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('button', { name: /edit line: updated at 0:01\.00/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /edit line: hello/i })).toBeNull();
  });

  it('deletes a line from the pill text modal', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /edit line: hello/i }));
    const dialog = await screen.findByRole('dialog', { name: /edit line at 0:01\.00/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /edit line: hello/i })).toBeNull(),
    );
  });

  it('nudges a line with arrow keys (±0.1s, Shift ±0.5s)', async () => {
    renderEditor();
    const pill = await screen.findByRole('button', { name: /edit line: hello at 0:01\.00/i });
    fireEvent.keyDown(pill, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /edit line: hello at 0:01\.10/i })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('button', { name: /edit line: hello/i }), {
      key: 'ArrowUp',
      shiftKey: true,
    });
    expect(screen.getByRole('button', { name: /edit line: hello at 0:00\.60/i })).toBeTruthy();
  });

  it('fetches from LRCLIB and applies after confirmation', async () => {
    renderEditor();
    await screen.findByRole('button', { name: /edit line: hello/i });
    fireEvent.click(screen.getByRole('button', { name: /fetch lyrics from lrclib/i }));
    await screen.findByRole('dialog', { name: /replace current lyrics/i });
    // Not applied before confirming.
    expect(screen.getByRole('button', { name: /edit line: hello/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(await screen.findByRole('button', { name: /edit line: fetched line at 0:02\.00/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /edit line: hello/i })).toBeNull();
  });
});
