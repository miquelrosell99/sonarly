import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueuePanel } from './QueuePanel.js';
import { usePlayer, resetPlayer } from '../../../stores/playerStore.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';
import type { User } from '@sonarly/shared';

const mockSetLocation = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => [{}, mockSetLocation],
}));

const mockUser = { id: 'u1', username: 'test', isAdmin: false } as User;

function Wrapper({ children }: { children: React.ReactNode }) {
  return <NotificationProvider>{children}</NotificationProvider>;
}

beforeEach(() => {
  resetPlayer();
  mockSetLocation.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('QueuePanel', () => {
  it('renders queue songs and highlights current song', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second' } as any,
    ], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
  });

  it('jumps to a song when clicked', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second' } as any,
    ], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('Second'));
    expect(usePlayer.getState().queueIndex).toBe(1);
    expect(usePlayer.getState().currentSong?.id).toBe('s2');
  });

  it('removes a song from the queue', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second' } as any,
    ], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    const removeButtons = screen.getAllByRole('button', { name: /remove from queue/i });
    fireEvent.click(removeButtons[1]);
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

  it('renders a drag handle for reordering each queue item', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second' } as any,
    ], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    const dragHandles = screen.getAllByRole('button', { name: /drag to reorder/i });
    expect(dragHandles).toHaveLength(2);
  });

  it('shows an Auto DJ pill for Auto DJ-added queue items', () => {
    usePlayer.getState().playQueue([
      { id: 's1', title: 'First' } as any,
      { id: 's2', title: 'Second', addedByAutoDj: true } as any,
    ], 0);

    render(<QueuePanel user={mockUser} />, { wrapper: Wrapper });
    expect(screen.getByText('Auto DJ')).toBeTruthy();
  });
});
