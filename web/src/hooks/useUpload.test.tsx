import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useUpload, UploadAbortedError, type UploadFile } from './useUpload.js';

const mockApi = vi.hoisted(() => vi.fn());

vi.mock('../lib/api.js', () => ({
  api: (...args: unknown[]) => mockApi(...args),
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

  /** Simulate the server accepting the chunk. */
  succeed() {
    this.onload?.();
  }
}

function makeUploadFile(size = 10): UploadFile {
  return { file: new File([new Uint8Array(size)], 'track.mp3'), relativePath: 'track.mp3' };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  MockXMLHttpRequest.instances = [];
});

describe('useUpload', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/upload/sessions') return { sessionId: 'session-1' };
      return {};
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends each chunk as raw application/octet-stream via PUT', async () => {
    const { result } = renderHook(() => useUpload());

    let done: Promise<void>;
    await act(async () => {
      done = result.current.uploadFiles([makeUploadFile()], 'library-1');
    });

    expect(MockXMLHttpRequest.instances).toHaveLength(1);
    const xhr = MockXMLHttpRequest.instances[0];
    const [method, url] = xhr.open.mock.calls[0];
    expect(method).toBe('PUT');
    expect(String(url)).toMatch(/^\/api\/upload\/sessions\/session-1\/files\/.+\/chunks\/0$/);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
    expect(xhr.send).toHaveBeenCalledTimes(1);
    const body = xhr.send.mock.calls[0][0];
    expect(body).toBeInstanceOf(Blob);
    expect(body).not.toBeInstanceOf(FormData);

    await act(async () => {
      xhr.succeed();
      await done!;
    });

    // File complete + session complete still go through the JSON api.
    const paths = mockApi.mock.calls.map((call) => String(call[0]));
    expect(paths.some((p) => /^\/upload\/sessions\/session-1\/files\/.+\/complete$/.test(p))).toBe(true);
    expect(mockApi).toHaveBeenCalledWith('/upload/sessions/session-1/complete', { method: 'POST' });
  });

  it('surfaces chunk failures as the upload error', async () => {
    const { result } = renderHook(() => useUpload());

    let done: Promise<void>;
    await act(async () => {
      done = result.current.uploadFiles([makeUploadFile()], 'library-1');
    });

    const xhr = MockXMLHttpRequest.instances[0];
    xhr.status = 500;
    xhr.statusText = 'Internal Server Error';
    await act(async () => {
      xhr.succeed();
      await expect(done!).rejects.toThrow('Internal Server Error');
    });
    expect(result.current.error).toBe('Internal Server Error');
  });

  it('parses the server {error} envelope from a non-2xx chunk response', async () => {
    const { result } = renderHook(() => useUpload());

    let done: Promise<void>;
    await act(async () => {
      done = result.current.uploadFiles([makeUploadFile()], 'library-1');
    });

    const xhr = MockXMLHttpRequest.instances[0];
    xhr.status = 422;
    xhr.statusText = 'Unprocessable Entity';
    xhr.responseText = JSON.stringify({ error: 'Chunk exceeds the size limit' });
    await act(async () => {
      xhr.succeed();
      await expect(done!).rejects.toThrow('Chunk exceeds the size limit');
    });
    expect(result.current.error).toBe('Chunk exceeds the size limit');
  });

  it('dispatches sonarly:unauthorized when a chunk returns 401', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const { result } = renderHook(() => useUpload());

    let done: Promise<void>;
    await act(async () => {
      done = result.current.uploadFiles([makeUploadFile()], 'library-1');
    });

    const xhr = MockXMLHttpRequest.instances[0];
    xhr.status = 401;
    xhr.statusText = 'Unauthorized';
    xhr.responseText = JSON.stringify({ error: 'Session expired' });
    await act(async () => {
      xhr.succeed();
      await expect(done!).rejects.toThrow('Session expired');
    });
    expect(result.current.error).toBe('Session expired');

    const unauthorizedEvents = dispatchSpy.mock.calls
      .map(([event]) => event)
      .filter((event) => event.type === 'sonarly:unauthorized');
    expect(unauthorizedEvents).toHaveLength(1);
    dispatchSpy.mockRestore();
  });

  it('abort mid-batch stops subsequent chunks and leaves no error state', async () => {
    const { result } = renderHook(() => useUpload());

    let done: Promise<void>;
    await act(async () => {
      done = result.current.uploadFiles([makeUploadFile(), makeUploadFile()], 'library-1');
    });

    expect(MockXMLHttpRequest.instances).toHaveLength(1);
    const xhr = MockXMLHttpRequest.instances[0];

    await act(async () => {
      result.current.abort();
      await expect(done!).rejects.toBeInstanceOf(UploadAbortedError);
    });

    expect(xhr.abort).toHaveBeenCalledTimes(1);
    // No further chunks (or the second file) were started after the abort.
    expect(MockXMLHttpRequest.instances).toHaveLength(1);
    // No file-complete call for the interrupted file.
    const paths = mockApi.mock.calls.map((call) => String(call[0]));
    expect(paths.some((p) => p.includes('/files/'))).toBe(false);
    expect(result.current.isUploading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('honours an externally aborted signal without starting a chunk', async () => {
    const { result } = renderHook(() => useUpload());
    const controller = new AbortController();
    controller.abort();

    await act(async () => {
      await expect(
        result.current.uploadFiles([makeUploadFile()], 'library-1', undefined, { signal: controller.signal }),
      ).rejects.toBeInstanceOf(UploadAbortedError);
    });

    expect(MockXMLHttpRequest.instances).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });
});
