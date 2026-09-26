import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { Labels } from './Labels.js';
import { renderWithQueryClient } from '../../../lib/testing.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Labels', () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/albums') {
        return {
          albums: [
            { id: 'album-1', name: 'Album One', labelEntries: [{ id: 'label-b', name: 'Label B' }] },
            { id: 'album-2', name: 'Album Two', labelEntries: [{ id: 'label-a', name: 'Label A' }] },
          ],
        };
      }
      return {};
    });
  });

  it('derives the sorted label list from albums (loading → success)', async () => {
    renderWithQueryClient(
      <Router>
        <Labels />
      </Router>,
    );

    await waitFor(() => {
      expect(screen.getByText('Label A')).toBeTruthy();
    });
    expect(screen.getByText('Label B')).toBeTruthy();
    const a = screen.getByText('Label A');
    const b = screen.getByText('Label B');
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith('/albums');
  });
});
