// Proof-of-use for the generated contract types (v2/api/client/index.ts).
// Compile-only: tsc --noEmit proves the TS side of the pipeline end to end
// without touching packages/web. Nothing here runs.

import type { components, paths } from './index.js';

// --- the fetch wrapper, typed against the generated paths table ------------

type Path = keyof paths;
type Method = 'get' | 'post' | 'put' | 'delete' | 'head';
type Operation<P extends Path, M extends Method> = paths[P][M];

type OkStatus = `2${string}`;

// openapi-typescript emits response keys as NUMERIC literals (200, not
// "200"), so the 2xx filter stringifies the key before matching.
type SuccessBody<P extends Path, M extends Method> =
  Operation<P, M> extends { responses: infer R }
    ? {
        [K in keyof R]: K extends number
          ? `${K}` extends OkStatus
            ? R[K] extends { content: { 'application/json': infer B } }
              ? B
              : never
            : never
          : never;
      }[keyof R]
    : never;

type QueryOf<P extends Path, M extends Method> =
  Operation<P, M> extends { parameters: { query?: infer Q } } ? Q : never;

type PathParamsOf<P extends Path, M extends Method> =
  Operation<P, M> extends { parameters: { path?: infer PP } } ? PP : never;

type BodyOf<P extends Path, M extends Method> =
  Operation<P, M> extends { requestBody?: { content: { 'application/json': infer B } } }
    ? B
    : never;

async function api<P extends Path, M extends Method>(
  path: P,
  method: M,
  args: {
    pathParams?: PathParamsOf<P, M>;
    query?: QueryOf<P, M>;
    body?: BodyOf<P, M>;
  },
): Promise<SuccessBody<P, M>> {
  let url = path as string;
  for (const [key, value] of Object.entries(args.pathParams ?? {})) {
    url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  if (args.query) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(args.query)) {
      if (value !== undefined) q.set(key, String(value));
    }
    const qs = q.toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method: method.toUpperCase(),
    headers: args.body ? { 'Content-Type': 'application/json' } : undefined,
    body: args.body ? JSON.stringify(args.body) : undefined,
    credentials: 'same-origin', // the sessionId cookie
  });
  if (!res.ok) {
    // The v2 error contract: every non-2xx is {error: string}.
    const err = (await res.json()) as components['schemas']['Error'];
    throw new Error(`${res.status}: ${err.error}`);
  }
  return (await res.json()) as SuccessBody<P, M>;
}

// --- typed call shapes ------------------------------------------------------

// GET /api/songs with query params: the filter surface is fully typed, and
// the response carries components['schemas']['Song'].
export async function listSongs(albumId: string) {
  const { songs } = await api('/api/songs', 'get', {
    query: { albumId, hideExplicit: true, limit: 10 },
  });
  const first: components['schemas']['Song'] | undefined = songs[0];
  return first?.albumName ?? first?.title ?? null;
}

// Path params + nested envelope.
export async function getPlaylistName(id: string) {
  const { playlist } = await api('/api/playlists/{id}', 'get', {
    pathParams: { id },
    query: { shareToken: 'token-for-link-share-viewers' },
  });
  const item: components['schemas']['PlaylistDetail'] = playlist;
  return item.name;
}

// POST body typing, including the smart-playlist union value and enums.
export async function createSmartPlaylist() {
  const { playlist } = await api('/api/playlists', 'post', {
    body: {
      name: 'Evening drive',
      visibility: 'private',
      resolveMode: 'tracks',
      rules: {
        rules: {
          all: [{ field: 'year', operator: 'inTheRange', value: [1990, 1999] }],
        },
        sort: [{ field: 'albumName', direction: 'asc' }],
        limit: 25,
      },
    },
  });
  return playlist.isSmart; // boolean, straight off the Detail DTO
}

// Enums come through as unions.
export async function latestScanStatus() {
  const { job } = await api('/api/scans/status', 'get', {});
  if (job === null) return 'never';
  const status: components['schemas']['JobStatusName'] = job.status;
  return status;
}
