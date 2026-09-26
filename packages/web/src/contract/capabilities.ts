// Server capability detection for the v1 ⇄ v2 cutover.
//
// The client must keep working against v1 (production today) and v2 (cutover
// target) without a flag day. A few wire behaviors differ between the two and
// cannot be told apart from any single response the app already fetches, so
// this module probes once at boot and exposes the result as a cached,
// immutable `capabilities` object.
//
// Detection heuristic (deliberately simple and TOTAL — never throws):
//
//   1. GET /api/songs?limit=1 with the session cookie. This is the cheapest
//      authenticated endpoint whose payload differs between the servers:
//        - v1 Song DTOs carry `filePath` (required) and have no `genreId`;
//          `syncedLyrics` is always a SyncedLyricLine[].
//        - v2 Song DTOs dropped `filePath` and carry `genreId`;
//          `syncedLyrics` is `SyncedLyricLine[] | string`.
//      A sample with `genreId` and no `filePath` is therefore v2; a sample
//      with `filePath` is v1.
//   2. Any failure — network error, non-OK status (e.g. 401 while logged
//      out, 404 before setup), malformed body, or an EMPTY library with no
//      sample row to inspect — falls back to the v1 defaults, which are the
//      safe choice for the server in production today.
//
// Note: both v1 and v2 answer GET /healthz with {"status":"ok"}, so the
// health probe is useless as a discriminator and is intentionally not used.
import { useQuery, type QueryClient } from '@tanstack/react-query';

export interface ServerCapabilities {
  server: 'v1' | 'v2';
  /** Upload chunk PUTs use raw application/octet-stream (v2) vs multipart FormData (v1). */
  rawUpload: boolean;
  /** Song DTOs expose filePath (v1 only; v2 dropped it from the API surface). */
  hasFilePath: boolean;
  /** The probe never saw syncedLyrics delivered as a plain string. */
  syncedLyricsArray: boolean;
}

/** Safe fallback = v1 semantics (the production server today). */
export const DEFAULT_CAPABILITIES: ServerCapabilities = {
  server: 'v1',
  rawUpload: false,
  hasFilePath: true,
  syncedLyricsArray: true,
};

export async function detectCapabilities(): Promise<ServerCapabilities> {
  try {
    const res = await fetch('/api/songs?limit=1', { credentials: 'include' });
    if (!res.ok) return { ...DEFAULT_CAPABILITIES };
    const data = (await res.json()) as { songs?: unknown };
    const sample =
      Array.isArray(data.songs) && data.songs.length > 0
        ? (data.songs[0] as Record<string, unknown>)
        : null;
    if (!sample) return { ...DEFAULT_CAPABILITIES };

    const isV2 = !('filePath' in sample) && 'genreId' in sample;
    return {
      server: isV2 ? 'v2' : 'v1',
      rawUpload: isV2,
      hasFilePath: 'filePath' in sample,
      // v1 is always an array; v2 is array|string, so a string sample is the
      // only signal that the client must narrow defensively.
      syncedLyricsArray: typeof sample.syncedLyrics !== 'string',
    };
  } catch {
    return { ...DEFAULT_CAPABILITIES };
  }
}

const CAPABILITIES_QUERY_KEY = ['capabilities'] as const;

export function capabilitiesOptions() {
  return {
    queryKey: [...CAPABILITIES_QUERY_KEY],
    queryFn: detectCapabilities,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  };
}

/** Boot loader: prime the cache once; every consumer shares this single probe. */
export function loadCapabilities(queryClient: QueryClient): void {
  void queryClient.prefetchQuery(capabilitiesOptions());
}

/** Cached capabilities; the v1 default until the boot probe resolves. */
export function useCapabilities(): ServerCapabilities {
  const { data } = useQuery(capabilitiesOptions());
  return data ?? DEFAULT_CAPABILITIES;
}
