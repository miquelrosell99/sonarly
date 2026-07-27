const MB_BASE_URL = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'Sonarly/0.1.0 (https://github.com/miquelrosell99/sonarly)';
const FETCH_TIMEOUT_MS = 10_000;
const RATE_LIMIT_DELAY_MS = 1_200; // MusicBrainz requests 1 req/sec for anonymous users.

interface MbUrlRelation {
  type: string;
  'type-id': string;
  direction: string;
  url: {
    id: string;
    resource: string;
  };
}

interface MbArtist {
  id: string;
  name: string;
  disambiguation?: string;
  relations?: MbUrlRelation[];
  annotation?: string;
}

interface MbArtistSearchResult {
  artists?: Array<{
    id: string;
    name: string;
    disambiguation?: string;
  }>;
}

export interface ArtistMetadataResult {
  musicBrainzId: string;
  bio?: string;
  externalUrls: Record<string, string>;
}

let lastRequestAt = 0;

async function fetchWithTimeout(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < RATE_LIMIT_DELAY_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS - elapsed));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    lastRequestAt = Date.now();
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRelationType(type: string): string {
  return type.toLowerCase().replace(/\s+/g, '_');
}

function extractExternalUrls(relations: MbUrlRelation[] | undefined): Record<string, string> {
  const urls: Record<string, string> = {};
  if (!relations) return urls;
  for (const rel of relations) {
    const key = normalizeRelationType(rel.type);
    if (!urls[key]) {
      urls[key] = rel.url.resource;
    }
  }
  return urls;
}

function extractBio(artist: MbArtist): string | undefined {
  if (artist.annotation) return artist.annotation.trim();
  if (artist.disambiguation) return artist.disambiguation.trim();
  return undefined;
}

export async function searchMusicBrainzArtist(artistName: string): Promise<ArtistMetadataResult | undefined> {
  const url = `${MB_BASE_URL}/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json&limit=1`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`MusicBrainz search returned ${response.status}`);
  }
  const json = (await response.json()) as MbArtistSearchResult;
  const hit = json.artists?.[0];
  if (!hit) return undefined;
  return fetchMusicBrainzArtist(hit.id);
}

export async function fetchMusicBrainzArtist(mbid: string): Promise<ArtistMetadataResult | undefined> {
  const url = `${MB_BASE_URL}/artist/${encodeURIComponent(mbid)}?inc=url-rels+annotation&fmt=json`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`MusicBrainz artist fetch returned ${response.status}`);
  }
  const artist = (await response.json()) as MbArtist;
  const externalUrls = extractExternalUrls(artist.relations);
  const bio = extractBio(artist);
  return {
    musicBrainzId: artist.id,
    bio,
    externalUrls,
  };
}

export async function fetchArtistMetadata(artistName: string, existingIds?: string[]): Promise<ArtistMetadataResult | undefined> {
  if (existingIds && existingIds.length > 0) {
    const result = await fetchMusicBrainzArtist(existingIds[0]);
    if (result) return result;
  }
  return searchMusicBrainzArtist(artistName);
}
