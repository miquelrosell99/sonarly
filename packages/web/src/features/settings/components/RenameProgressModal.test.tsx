import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { RenameProgressModal } from './RenameProgressModal.js';

const apiMock = vi.fn();
vi.mock('../../../api.js', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('RenameProgressModal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it('shows scanning then progress and auto-closes on clean completion', async () => {
    apiMock
      .mockResolvedValueOnce({ job: { id: '1', type: 'organize', status: 'running', stats: { total: 0, done: 0 } } })
      .mockResolvedValueOnce({ job: { id: '1', type: 'organize', status: 'running', stats: { total: 2, done: 1, moved: 1, skipped: 0, failed: 0, currentPath: '/a.mp3' } } })
      .mockResolvedValueOnce({ job: { id: '1', type: 'organize', status: 'completed', stats: { total: 2, done: 2, moved: 2, skipped: 0, failed: 0 } } });

    const onComplete = vi.fn();
    const onClose = vi.fn();
    render(<RenameProgressModal jobId="1" onClose={onClose} onComplete={onComplete} />);

    expect(screen.getByText('Scanning…')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('1 of 2 files renamed (50%)')).toBeTruthy());
    expect(screen.getByText('/a.mp3')).toBeTruthy();

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ moved: 2, skipped: 0, failed: 0 }), { timeout: 2000 });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows failed paths and stays open when completed with failures', async () => {
    apiMock.mockResolvedValue({
      job: {
        id: '1',
        type: 'organize',
        status: 'completed',
        stats: { total: 2, done: 2, moved: 1, skipped: 0, failed: 1, failedPaths: ['/bad.mp3'] },
      },
    });

    const onComplete = vi.fn();
    const onClose = vi.fn();
    render(<RenameProgressModal jobId="1" onClose={onClose} onComplete={onComplete} />);

    await waitFor(() => expect(screen.getByText('1 file failed')).toBeTruthy());
    expect(screen.getByText('/bad.mp3')).toBeTruthy();

    vi.advanceTimersByTime(2000);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
