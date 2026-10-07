import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QueuePanel } from './QueuePanel.js';
import { usePlayer, resetPlayer } from '../../../stores/playerStore.js';
import { useAutoDjUi } from '../../../stores/autoDjStore.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';
import type { User } from '../../../types';

const mockSetLocation = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => [{}, mockSetLocation],
}));

const mockUpdatePreferencesMutate = vi.fn();
const mockPreferences = vi.hoisted(() => ({
  current: {
    autoDjEnabled: false,
    autoDjMode: 'smart' as const,
    autoDjTopUpThreshold: 5,
    autoDjBatchSize: 10,
  },
}));

vi.mock('../../../hooks/usePreferences.js', () => ({
  usePreferences: () => ({ data: mockPreferences.current }),
  useUpdatePreferences: () => ({ mutate: mockUpdatePreferencesMutate }),
}));

const mockUser = { id: 'u1', username: 'test', isAdmin: false } as User;

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>{children}</NotificationProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  resetPlayer();
  mockSetLocation.mockClear();
  mockUpdatePreferencesMutate.mockClear();
  mockPreferences.current = {
    autoDjEnabled: false,
    autoDjMode: 'smart',
    autoDjTopUpThreshold: 5,
    autoDjBatchSize: 10,
  };
  useAutoDjUi.setState({ refreshNonce: 0, isFetching: false });
});

afterEach(() => {
  cleanup();
});

describe('QueuePanel', () => {
  it('renders queue songs', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second' } as any,
    ], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
  });

  it('jumps to a song when its play button is clicked', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second' } as any,
    ], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    const playButtons = screen.getAllByRole('button', { name: /^play/i });
    expect(playButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(playButtons[1]);
    expect(usePlayer.getState().queueIndex).toBe(1);
    expect(usePlayer.getState().currentSong?.id).toBe('s2');
  });

  it('keeps the queue and shuffle order when jumping to a song', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second' } as any,
      { id: 's3', title: 'Third' } as any,
    ], 0);
    usePlayer.setState({ shuffle: true, shuffledIndices: [0, 2, 1] });

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    const playButtons = screen.getAllByRole('button', { name: /^play/i });
    fireEvent.click(playButtons[2]);

    const state = usePlayer.getState();
    expect(state.queue).toHaveLength(3);
    expect(state.shuffledIndices).toEqual([0, 2, 1]);
    expect(state.queueIndex).toBe(1);
    expect(state.currentSong?.id).toBe('s2');
  });

  it('removes a song from the queue via context menu', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second' } as any,
    ], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    fireEvent.contextMenu(screen.getByText('Second'));
    fireEvent.click(screen.getByRole('menuitem', { name: /remove from queue/i }));
    expect(usePlayer.getState().queue).toHaveLength(1);
    expect(usePlayer.getState().queue[0].id).toBe('s1');
  });

  it('shows a context menu with play and remove actions', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second' } as any,
    ], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    fireEvent.contextMenu(screen.getByText('First'));
    expect(screen.getByRole('menuitem', { name: /play now/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /remove from queue/i })).toBeTruthy();
  });

  it('shows an Auto DJ pill for Auto DJ-added queue items', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second', addedByAutoDj: true } as any,
    ], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    // The queue action row also has an Auto DJ toggle; assert the per-row pill specifically.
    const pills = screen.getAllByText('Auto DJ').filter((el) => el.closest('button') === null);
    expect(pills).toHaveLength(1);
  });

  it('renders drag handles for reordering queue items', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second' } as any,
    ], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    const dragHandles = screen.getAllByRole('button', { name: /drag to reorder/i });
    expect(dragHandles).toHaveLength(2);
  });

  it('windows very large queues instead of mounting every row', () => {
    // A whole-library shuffle produces a multi-thousand-row queue; mounting
    // all of it (required by drag-reorder) stalls the panel for seconds.
    const songs = Array.from({ length: 600 }, (_, i) => ({ id: `s${i}`, title: `Song ${i}` }));
    usePlayer.getState().playQueue(songs as any, 0);

    const { container } = render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    // Reorder is disabled at this scale: it needs every row mounted.
    expect(screen.queryByRole('button', { name: /drag to reorder/i })).toBeFalsy();
    const rows = container.querySelectorAll('tbody tr:not([aria-hidden="true"])');
    expect(rows.length).toBeLessThan(100);
    expect(screen.getByText('Song 0')).toBeTruthy();
    expect(screen.queryByText('Song 599')).toBeFalsy();
  });

  it('keeps the Auto-DJ controls reachable on windowed queues', () => {
    mockPreferences.current = { ...mockPreferences.current, autoDjEnabled: true };
    const songs = Array.from({ length: 600 }, (_, i) => ({
      id: `s${i}`,
      title: `Song ${i}`,
      addedByAutoDj: i >= 10,
      autoDjReason: 'More like this',
    }));
    usePlayer.getState().playQueue(songs as any, 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });

    // The grouped section header cannot survive windowing, so its label and
    // refresh/tune controls move to a bar above the list.
    expect(screen.getByText(/Up next — Auto-DJ/)).toBeTruthy();
    expect(screen.getByText(`· ${600 - 10}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: /refresh auto-dj suggestions/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /auto dj settings/i })).toBeTruthy();
    // Per-row badge replaces the section for individual picks.
    expect(screen.getAllByText('Auto DJ').length).toBeGreaterThan(0);
  });

  it('styles past, current, and future songs differently', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'Past' } as any,
      { id: 's2', title: 'Current' } as any,
      { id: 's3', title: 'Future' } as any,
    ], 1);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    const pastRow = screen.getByText('Past').closest('tr');
    const currentRow = screen.getByText('Current').closest('tr');
    const futureRow = screen.getByText('Future').closest('tr');

    expect(pastRow?.className).toContain('opacity-50');
    expect(currentRow?.className).toContain('bg-accent/10');
    expect(futureRow?.className).not.toContain('opacity-50');
    expect(futureRow?.className).not.toContain('bg-accent/10');
  });

  it('displays songs in shuffled order when shuffle is enabled', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second' } as any,
      { id: 's3', title: 'Third' } as any,
    ], 0);
    usePlayer.setState({ shuffle: true, shuffledIndices: [0, 2, 1] });

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    const rows = screen.getAllByRole('row');
    const titles = rows
      .map((row) => row.textContent)
      .filter((text) => text?.includes('First') || text?.includes('Second') || text?.includes('Third'))
      .map((text) => text?.replace(/^\d+/, '').replace(/Unknown artist\d+:\d+$/, '').trim());
    expect(titles).toEqual(['First', 'Third', 'Second']);
  });
});

describe('QueuePanel Auto-DJ section', () => {
  function djSong(id: string, reason: string) {
    return { id, title: `Title ${id}`, addedByAutoDj: true, autoDjReason: reason } as any;
  }

  function seedWithDjPicks(enabled: boolean) {
    mockPreferences.current = { ...mockPreferences.current, autoDjEnabled: enabled };
    usePlayer.getState().playQueue(
      [
        { id: 's1', title: 'First' } as any,
        djSong('dj1', 'More like Jazz Artist'),
        djSong('dj2', 'Hidden gem — you haven\'t played this'),
      ],
      0,
    );
  }

  it('renders upcoming suggestions as a distinct section with per-item reasons', () => {
    seedWithDjPicks(true);
    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });

    expect(screen.getByText('Up next — Auto-DJ')).toBeTruthy();
    expect(screen.getByText('More like Jazz Artist')).toBeTruthy();
    expect(screen.getByText('Hidden gem — you haven\'t played this')).toBeTruthy();
    // The per-row badge is redundant inside the section…
    const pills = screen.getAllByText('Auto DJ').filter((el) => el.closest('button') === null);
    expect(pills).toHaveLength(0);
    // …and the header carries the live indicator + actions.
    expect(screen.getByRole('button', { name: 'Refresh Auto-DJ suggestions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Auto DJ settings' })).toBeTruthy();
  });

  it('keeps the row badge when Auto DJ is off but DJ picks are still queued', () => {
    seedWithDjPicks(false);
    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });

    expect(screen.queryByText('Up next — Auto-DJ')).toBeFalsy();
    const pills = screen.getAllByText('Auto DJ').filter((el) => el.closest('button') === null);
    expect(pills).toHaveLength(2);
  });

  it('refresh action signals the engine through the Auto-DJ UI store', () => {
    seedWithDjPicks(true);
    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });

    const before = useAutoDjUi.getState().refreshNonce;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Auto-DJ suggestions' }));

    expect(useAutoDjUi.getState().refreshNonce).toBe(before + 1);
  });

  it('opens the tuning popover and applies changes immediately', () => {
    seedWithDjPicks(true);
    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole('button', { name: 'Auto DJ settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Auto DJ settings' });
    expect(dialog).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /random/i }));
    expect(mockUpdatePreferencesMutate).toHaveBeenCalledWith({ autoDjMode: 'random' });

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(mockUpdatePreferencesMutate).toHaveBeenCalledWith({ autoDjExcludeWindow: '7d' });

    fireEvent.click(screen.getByRole('button', { name: 'Close Auto DJ settings' }));
    expect(screen.queryByRole('dialog', { name: 'Auto DJ settings' })).toBeFalsy();
  });

  it('shows the keep-it-going CTA when the queue is drained and Auto DJ is on', () => {
    mockPreferences.current = { ...mockPreferences.current, autoDjEnabled: true };
    usePlayer.getState().playQueue([{ id: 's1', title: 'Only' } as any], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    expect(screen.getByText("Queue's end — Auto-DJ will keep it going")).toBeTruthy();
  });

  it('shows an enable CTA when the queue is drained and Auto DJ is off', () => {
    usePlayer.getState().playQueue([{ id: 's1', title: 'Only' } as any], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on Auto DJ' }));
    expect(mockUpdatePreferencesMutate).toHaveBeenCalledWith({ autoDjEnabled: true });
  });

  it('reflects the active state on the queue header toggle', () => {
    seedWithDjPicks(true);
    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    expect(screen.getByRole('button', { name: 'Auto DJ: on' }).getAttribute('aria-pressed')).toBe('true');

    cleanup();
    seedWithDjPicks(false);
    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    expect(screen.getByRole('button', { name: 'Auto DJ: off' }).getAttribute('aria-pressed')).toBe('false');
  });
});
