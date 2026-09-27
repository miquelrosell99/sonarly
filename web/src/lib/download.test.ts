import { describe, it, expect, vi, afterEach } from 'vitest';
import { downloadSongs, downloadTrackUrl, saveUrl } from './download.js';
import { notify } from '../contexts/NotificationContext.js';

vi.mock('../contexts/NotificationContext.js', () => ({
  notify: vi.fn(),
}));

const mockedNotify = vi.mocked(notify);

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function okZipResponse(filename: string): Response {
  // jsdom's Blob lacks the stream() undici's Response wants, so stub the
  // consumed surface (ok/status/headers/blob) instead of real bodies.
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-disposition'
          ? `attachment; filename="${filename}"`
          : null,
    },
    blob: () => Promise.resolve({ type: 'application/zip' }),
  } as unknown as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: () =>
      body === undefined ? Promise.reject(new Error('not json')) : Promise.resolve(body),
  } as unknown as Response;
}

describe('downloadTrackUrl', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('points at the download stream variant without a token', () => {
    expect(downloadTrackUrl('song-1')).toBe('/api/stream/song-1?download=1');
  });

  it('carries an explicit share token', () => {
    expect(downloadTrackUrl('song-1', 'tok')).toBe('/api/stream/song-1?download=1&share=tok');
  });

  it('picks the shareToken up from the URL when not passed', () => {
    window.history.pushState({}, '', '/playlists/pl-1?shareToken=tok-url');
    expect(downloadTrackUrl('song-1')).toBe('/api/stream/song-1?download=1&share=tok-url');
  });
});

describe('saveUrl', () => {
  it('clicks a transient anchor so the browser saves the target', () => {
    const clicks: string[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      clicks.push(this.href);
    };
    const appended: string[] = [];
    const originalAppend = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, 'appendChild').mockImplementation(((node: Node) => {
      appended.push(node.nodeName);
      return originalAppend(node);
    }) as typeof document.body.appendChild);

    saveUrl('/api/stream/song-1?download=1');

    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toContain('/api/stream/song-1?download=1');
    expect(appended).toContain('A');
    HTMLAnchorElement.prototype.click = originalClick;
  });
});

describe('downloadSongs', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    delete (URL as { createObjectURL?: unknown }).createObjectURL;
    delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
    window.history.pushState({}, '', '/');
  });

  function stubObjectUrls(objectUrls: string[]): void {
    (URL as { createObjectURL?: unknown }).createObjectURL = (blob: Blob) => {
      objectUrls.push(blob.type);
      return 'blob:mock';
    };
    (URL as { revokeObjectURL?: unknown }).revokeObjectURL = vi.fn();
  }

  it('POSTs the ids and saves the blob with the server filename', async () => {
    fetchMock.mockResolvedValueOnce(okZipResponse('sonarly-20260927-120000.zip'));
    const objectUrls: string[] = [];
    stubObjectUrls(objectUrls);
    const clicks: string[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click() {
      clicks.push(this.download);
    };

    await downloadSongs(['song-1', 'song-2']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/download');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(String(init.body))).toEqual({ songIds: ['song-1', 'song-2'] });
    expect(objectUrls).toEqual(['application/zip']);
    expect(clicks).toEqual(['sonarly-20260927-120000.zip']);
    HTMLAnchorElement.prototype.click = originalClick;
  });

  it('appends shareToken for anonymous viewers', async () => {
    fetchMock.mockResolvedValueOnce(okZipResponse('sonarly.zip'));
    window.history.pushState({}, '', '/playlists/pl-1?shareToken=tok-url');
    stubObjectUrls([]);
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = vi.fn();
    await downloadSongs(['song-1']);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/download?shareToken=tok-url');
    HTMLAnchorElement.prototype.click = originalClick;
  });

  it('notifies the server error message on failure', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(400, { error: 'no downloadable songs' }));
    await downloadSongs(['gone']);
    expect(mockedNotify).toHaveBeenCalledWith('no downloadable songs', 'error');
  });

  it('notifies a status message for non-JSON error bodies', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500, undefined));
    await downloadSongs(['song-1']);
    expect(mockedNotify).toHaveBeenCalledWith('Download failed (500)', 'error');
  });

  it('notifies when the request itself fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await downloadSongs(['song-1']);
    expect(mockedNotify).toHaveBeenCalledWith('network down', 'error');
  });

  it('is a no-op for an empty id list', async () => {
    await downloadSongs([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
