// Typed fetch wrapper over the generated contract (schema.ts).
//
// Semantics deliberately mirror lib/api.ts: same-origin relative paths,
// session-cookie credentials, the uniform `{error}` envelope on every
// non-2xx, 401 -> the global `sonarly:unauthorized` event, and `undefined`
// for bodyless (204/empty) responses.
import type { components, paths } from './schema.js';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export type { components, paths };

// --- type-level extraction from the generated paths table ------------------
// (openapi-typescript emits response keys as numeric literals, so the 2xx
// filter stringifies the key before matching — same trick as the S3 spike.)

type Path = keyof paths;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head';

type Operation<P extends Path, M extends Method> = paths[P][M];

type SuccessBody<P extends Path, M extends Method> =
  Operation<P, M> extends { responses: infer R }
    ? {
        [K in keyof R]: K extends number
          ? `${K}` extends `2${string}`
            ? R[K] extends { content: { 'application/json': infer B } }
              ? B
              : never
            : never
          : never;
      }[keyof R]
    : never;

export type QueryOf<P extends Path, M extends Method> =
  Operation<P, M> extends { parameters: { query?: infer Q } } ? Q : never;

export type PathParamsOf<P extends Path, M extends Method> =
  Operation<P, M> extends { parameters: { path?: infer PP } } ? PP : never;

export type BodyOf<P extends Path, M extends Method> =
  Operation<P, M> extends {
    requestBody?: { content: { 'application/json': infer B } };
  }
    ? B
    : never;

export interface RequestOptions<P extends Path, M extends Method> {
  method?: M;
  pathParams?: PathParamsOf<P, M>;
  query?: QueryOf<P, M>;
  body?: BodyOf<P, M>;
}

export async function request<P extends Path, M extends Method = 'get'>(
  path: P,
  options: RequestOptions<P, M> = {},
): Promise<SuccessBody<P, M>> {
  const { method = 'get' as M, pathParams, query, body } = options;

  let url = path as string;
  for (const [key, value] of Object.entries(pathParams ?? {})) {
    url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const qs = params.toString();
  if (qs) url += `?${qs}`;

  const init: RequestInit = { method: method as string, credentials: 'include' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      // Not a JSON body; surface the raw text.
    }
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('sonarly:unauthorized'));
    }
    throw new ApiError(res.status, message || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as SuccessBody<P, M>;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as SuccessBody<P, M>;
}

// --- domain call-sites -----------------------------------------------------
// Thin typed helpers, one object per domain. This is intentionally NOT a
// framework: each helper is a single request() call with fixed path+method.

export const songs = {
  list: (query?: QueryOf<'/api/songs', 'get'>) => request('/api/songs', { query }),
  get: (id: string) => request('/api/songs/{id}', { pathParams: { id } }),
};

export const albums = {
  list: (query?: QueryOf<'/api/albums', 'get'>) => request('/api/albums', { query }),
  get: (id: string) => request('/api/albums/{id}', { pathParams: { id } }),
};

export const artists = {
  list: (query?: QueryOf<'/api/artists', 'get'>) => request('/api/artists', { query }),
  get: (id: string) => request('/api/artists/{id}', { pathParams: { id } }),
  songs: (id: string) => request('/api/artists/{id}/songs', { pathParams: { id } }),
};

export const genres = {
  list: (query?: QueryOf<'/api/genres', 'get'>) => request('/api/genres', { query }),
  tree: () => request('/api/genres/tree'),
};

export const playlists = {
  list: () => request('/api/playlists'),
  get: (id: string) => request('/api/playlists/{id}', { pathParams: { id } }),
  create: (body: BodyOf<'/api/playlists', 'post'>) =>
    request('/api/playlists', { method: 'post', body }),
  remove: (id: string) =>
    request('/api/playlists/{id}', { method: 'delete', pathParams: { id } }),
};

export const players = {
  list: () => request('/api/players'),
};

export const search = {
  run: (query?: QueryOf<'/api/search', 'get'>) => request('/api/search', { query }),
};
