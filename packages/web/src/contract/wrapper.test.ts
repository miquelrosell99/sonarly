import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, request, songs, playlists } from './wrapper.js';

function mockResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contract request wrapper', () => {
  it('unwraps a JSON envelope on success', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { songs: [{ id: 's1' }] }));
    const data = await request('/api/songs', { query: { limit: 1 } });
    expect(data).toEqual({ songs: [{ id: 's1' }] });
    expect(fetchMock).toHaveBeenCalledWith('/api/songs?limit=1', {
      method: 'get',
      credentials: 'include',
    });
  });

  it('builds query strings and skips undefined values', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { albums: [] }));
    await request('/api/albums', {
      query: { libraryId: 'lib 1', genreId: undefined } as never,
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    // URLSearchParams form-encodes the space as '+'.
    expect(url).toBe('/api/albums?libraryId=lib+1');
  });

  it('substitutes and encodes path params', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { id: 'a/b' }));
    await request('/api/albums/{id}', { pathParams: { id: 'a/b' } });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/albums/a%2Fb');
  });

  it('serializes a JSON body with the content type header', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, {}));
    await request('/api/playlists', {
      method: 'post',
      body: { name: 'Mix' },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('post');
    expect(init.body).toBe(JSON.stringify({ name: 'Mix' }));
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('throws ApiError with the {error} message on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(422, { error: 'name is required' }));
    const err = await request('/api/playlists', { method: 'post', body: { name: '' } }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).message).toBe('name is required');
  });

  it('falls back to the raw body text for non-JSON errors', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(500, 'boom'));
    const err = await request('/api/songs').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).message).toBe('boom');
  });

  it('uses a generic message when the error body is empty', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(502, ''));
    const err = await request('/api/songs').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Request failed (502)');
  });

  it('dispatches sonarly:unauthorized on 401', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(401, { error: 'unauthorized' }));
    const listener = vi.fn();
    window.addEventListener('sonarly:unauthorized', listener);
    await expect(request('/api/me')).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('sonarly:unauthorized', listener);
  });

  it('resolves undefined for bodyless 204 responses', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(204, ''));
    await expect(
      request('/api/songs/{id}/bookmark', { method: 'delete', pathParams: { id: 's1' } }),
    ).resolves.toBeUndefined();
  });

  it('domain helpers hit the right paths', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(200, { songs: [] }));
    await songs.list({ limit: 5 });
    expect((fetchMock.mock.calls[0] as [string][])[0]).toBe('/api/songs?limit=5');

    fetchMock.mockResolvedValueOnce(mockResponse(200, { playlist: { id: 'p1' } }));
    await playlists.get('p1');
    expect((fetchMock.mock.calls[1] as [string][])[0]).toBe('/api/playlists/p1');
  });
});
