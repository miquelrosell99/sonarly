import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import * as React from 'react';
import { ConflictsModal } from './ConflictsModal.js';
import { AdminRefreshProvider } from '../contexts/AdminRefreshContext.js';
import { NotificationProvider } from '../../../contexts/NotificationContext.js';
import { api } from '../../../lib/api.js';

vi.mock('../../../lib/api.js', () => ({
  api: vi.fn(),
}));

const apiMock = vi.mocked(api);

function renderModal(open = true) {
  return render(
    React.createElement(
      NotificationProvider,
      null,
      React.createElement(
        AdminRefreshProvider,
        null,
        React.createElement(ConflictsModal, { open, onClose: () => {} }),
      ),
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConflictsModal', () => {
  it('renders an empty state when the server returns conflicts: null', async () => {
    // Older servers encode an empty result as JSON null (Go nil slice); the
    // modal must tolerate it instead of crashing on conflicts.length.
    apiMock.mockResolvedValue({ conflicts: null } as never);
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('No conflicts found.')).toBeTruthy();
    });
  });

  it('lists conflicts when present', async () => {
    apiMock.mockResolvedValue({
      conflicts: [
        { id: 's1', filePath: '/music/Song (1).flac', title: 'Song', artistName: null, albumName: null },
      ],
    } as never);
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('/music/Song (1).flac')).toBeTruthy();
    });
  });
});
