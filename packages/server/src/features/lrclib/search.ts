import type { LrcLibMatch, SyncedLyricLine } from '@sonarly/shared';

const LRCLIB_BASE_URL = 'https://lrclib.net/api';
const USER_AGENT = 'Sonarly/0.1.0 (https://github.com/miquelrosell99/sonarly)';
const FETCH_TIMEOUT_MS = 10_000;

interface LrcLibApiRecord {
  id: number;
  name?: string;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
}

function parseLrcTimestamp(value: string): number | undefined {
  const match = /^(\d+):(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return undefined;
  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  if (Number.isNaN(minutes) || Number.isNaN(seconds)) return undefined;
  if (seconds >= 60) return undefined;

  let fraction = 0;
  if (match[3]) {
    const fractionStr = match[3];
    const fractionValue = parseFloat(`0.${fractionStr}`);
    if (!Number.isNaN(fractionValue)) {
      fraction = fractionValue;
    }
  }

  return minutes * 60 + seconds + fraction;
}

export function parseLrc(input: string | undefined): SyncedLyricLine[] {
  if (!input) return [];
  const lines: SyncedLyricLine[] = [];

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const timestamps: number[] = [];
    let text = line;
    let parsed = false;

    while (true) {
      const bracketMatch = /^\[(\d+:\d+(?:\.\d+)?)\]\s*/.exec(text);
      if (!bracketMatch) break;
      const time = parseLrcTimestamp(bracketMatch[1]);
      if (time === undefined) break;
      timestamps.push(time);
      text = text.slice(bracketMatch[0].length);
      parsed = true;
    }

    if (!parsed) continue;

    if (timestamps.length === 0) {
      // Malformed line with brackets but no valid timestamp; ignore.
      continue;
    }

    for (const time of timestamps) {
      lines.push({ time, text: text.trim() });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

function apiRecordToMatch(record: LrcLibApiRecord): LrcLibMatch {
  const title = record.trackName ?? record.name ?? 'Unknown title';
  const syncedLyrics = record.syncedLyrics ? parseLrc(record.syncedLyrics) : undefined;

  return {
    id: record.id,
    title,
    artistName: record.artistName,
    albumName: record.albumName,
    duration: record.duration,
    instrumental: record.instrumental,
    lyrics: record.plainLyrics,
    syncedLyrics: syncedLyrics && syncedLyrics.length > 0 ? syncedLyrics : undefined,
  };
}

function buildSearchUrl(query: {
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
}): string {
  const params = new URLSearchParams();
  params.set('track_name', query.title);
  if (query.artist) params.set('artist_name', query.artist);
  if (query.album) params.set('album_name', query.album);
  return `${LRCLIB_BASE_URL}/search?${params.toString()}`;
}

export async function searchLrcLib(query: {
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
}): Promise<LrcLibMatch[]> {
  const url = buildSearchUrl(query);
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`LRCLIB search returned ${response.status}`);
  }
  const json = (await response.json()) as LrcLibApiRecord[] | { error?: string };
  if (!Array.isArray(json)) {
    throw new Error((json as { error?: string }).error ?? 'Unexpected LRCLIB response');
  }
  return json.map(apiRecordToMatch);
}
