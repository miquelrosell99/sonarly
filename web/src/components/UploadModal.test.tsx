import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { UploadModal } from './UploadModal.js';
import type { Library } from '../types';

const mockApi = vi.hoisted(() => vi.fn());
const mockNotify = vi.hoisted(() => vi.fn());

vi.mock('../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

vi.mock('../contexts/NotificationContext.js', () => ({
  useNotification: () => ({ notify: mockNotify }),
}));

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];

  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => {
    this.onabort?.();
  });
  withCredentials = false;
  status = 200;
  statusText = 'OK';
  responseText = '';
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    MockXMLHttpRequest.instances.push(this);
  }
}

const libraries: Library[] = [
  {
    id: 'lib-1',
    name: 'Music',
    path: '/music',
    organizePattern: '',
    isDefault: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

function renderModal(overrides: Partial<Parameters<typeof UploadModal>[0]> = {}) {
  return render(
    <UploadModal
      open
      onClose={vi.fn()}
      libraries={libraries}
      currentLibraryId={null}
      {...overrides}
    />,
  );
}

function addFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], 'track.mp3')] } });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  MockXMLHttpRequest.instances = [];
});

describe('UploadModal', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/settings/media') return { duplicateStrategy: 'skip' };
      if (path === '/upload/sessions') return { sessionId: 'session-1' };
      return {};
    });
  });

  it('renders the drop zone and the library/strategy fields', async () => {
    renderModal();

    expect(screen.getByText('Drop files or folders here')).toBeTruthy();
    expect(screen.getByLabelText(/library/i)).toBeTruthy();
    expect(screen.getByLabelText(/duplicate strategy/i)).toBeTruthy();

    await waitFor(() => {
      expect((screen.getByLabelText(/duplicate strategy/i) as HTMLSelectElement).value).toBe('skip');
    });
  });

  it('explains the disabled gate and notifies when upload settings fail to load', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/settings/media') throw new Error('boom');
      return {};
    });

    renderModal();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/upload settings could not be loaded/i);
    });
    expect(mockNotify).toHaveBeenCalledWith('Could not load upload settings', 'error');
    expect(screen.getByRole('button', { name: 'Upload' })).toHaveProperty('disabled', true);
  });

  it('Cancel aborts an in-flight upload and keeps the file list', async () => {
    renderModal();
    await waitFor(() => {
      expect((screen.getByLabelText(/duplicate strategy/i) as HTMLSelectElement).value).toBe('skip');
    });

    addFile();
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(MockXMLHttpRequest.instances).toHaveLength(1));
    const xhr = MockXMLHttpRequest.instances[0];

    // Close hint is visible while uploading.
    expect(screen.getByText(/closing is disabled while an upload is in progress/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.getByText('Files to upload')).toBeTruthy();
    });
    expect(xhr.abort).toHaveBeenCalledTimes(1);
    // Back to the file list: no error alert, files retained.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('track.mp3')).toBeTruthy();
  });

  it('keeps the dialog open when Close is clicked mid-upload', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await waitFor(() => {
      expect((screen.getByLabelText(/duplicate strategy/i) as HTMLSelectElement).value).toBe('skip');
    });

    addFile();
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(MockXMLHttpRequest.instances).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/closing is disabled while an upload is in progress/i)).toBeTruthy();
  });
});
