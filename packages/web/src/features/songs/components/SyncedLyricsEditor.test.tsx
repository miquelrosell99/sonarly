import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SyncedLyricsEditor } from './SyncedLyricsEditor.js';

afterEach(() => cleanup());

vi.mock('../../../lib/api.js', () => ({
  api: vi.fn((path: string, opts?: unknown) => {
    if (path === '/songs/1/lyrics' && !opts) {
      return Promise.resolve({ lyrics: '', syncedLyrics: [{ time: 1, text: 'hello' }] });
    }
    return Promise.resolve({ ok: true });
  }),
}));

describe('SyncedLyricsEditor', () => {
  it('renders loaded lyric line', async () => {
    render(<SyncedLyricsEditor songId="1" title="Song" duration={120} onClose={() => {}} />);
    expect(await screen.findByDisplayValue('hello')).toBeTruthy();
  });

  it('calls onClose when cancel is clicked', async () => {
    const onClose = vi.fn();
    render(<SyncedLyricsEditor songId="1" title="Song" duration={120} onClose={onClose} />);
    await screen.findByDisplayValue('hello');
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
