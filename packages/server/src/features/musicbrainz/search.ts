import type { MusicBrainzMatch } from '@sonarly/shared';
import { fetchWithTimeout } from '../artists/musicbrainz.js';

const MB_BASE_URL = 'https://musicbrainz.org/ws/2';

interface MbArtistCredit {
  name: string;
  artist?: {
    id: string;
    name: string;
  };
}

interface MbRelease {
  id: string;
  title: string;
  date?: string;
  'artist-credit'?: MbArtistCredit[];
  'release-group'?: {
    id: string;
    'primary-type'?: string;
  };
}

interface MbRecording {
  id: string;
  title: string;
  disambiguation?: string;
  'artist-credit'?: MbArtistCredit[];
  releases?: MbRelease[];
}

interface MbRecordingSearchResult {
  recordings?: MbRecording[];
}

interface MbReleaseSearchResult {
  releases?: MbRelease[];
}

interface MbArtist {
  id: string;
  name: string;
  disambiguation?: string;
}

interface MbArtistSearchResult {
  artists?: MbArtist[];
}

function extractYear(date?: string): number | undefined {
  if (!date) return undefined;
  const match = /^\d{4}/.exec(date);
  if (!match) return undefined;
  const year = parseInt(match[0], 10);
  return Number.isNaN(year) ? undefined : year;
}

function extractArtistName(credits: MbArtistCredit[] | undefined): string | undefined {
  if (!credits || credits.length === 0) return undefined;
  return credits.map((c) => c.name).join(', ');
}

function buildCoverArtUrl(mbid: string, isReleaseGroup: boolean): string | undefined {
  if (isReleaseGroup) {
    return `https://coverartarchive.org/release-group/${mbid}/front`;
  }
  return `https://coverartarchive.org/release/${mbid}/front`;
}

function recordingToMatch(recording: MbRecording): MusicBrainzMatch {
  const release = recording.releases?.[0];
  const releaseMbid = release?.id;
  const releaseGroupMbid = release?.['release-group']?.id;
  const coverArtMbid = releaseMbid ?? releaseGroupMbid;
  const isReleaseGroup = !releaseMbid && releaseGroupMbid !== undefined;

  return {
    id: recording.id,
    title: recording.title,
    artist: extractArtistName(recording['artist-credit']),
    album: release?.title,
    albumArtist: extractArtistName(release?.['artist-credit']),
    year: extractYear(release?.date),
    coverArt: coverArtMbid ? buildCoverArtUrl(coverArtMbid, isReleaseGroup) : undefined,
    disambiguation: recording.disambiguation,
  };
}

function releaseToMatch(release: MbRelease): MusicBrainzMatch {
  const releaseGroupMbid = release['release-group']?.id;
  const coverArtMbid = release.id ?? releaseGroupMbid;
  const isReleaseGroup = !release.id && releaseGroupMbid !== undefined;

  return {
    id: release.id,
    title: release.title,
    albumArtist: extractArtistName(release['artist-credit']),
    year: extractYear(release.date),
    coverArt: coverArtMbid ? buildCoverArtUrl(coverArtMbid, isReleaseGroup) : undefined,
  };
}

function artistToMatch(artist: MbArtist): MusicBrainzMatch {
  return {
    id: artist.id,
    title: artist.name,
    disambiguation: artist.disambiguation,
  };
}

function buildRecordingQuery(title: string, artist?: string, album?: string): string {
  const parts: string[] = [`recording:${escapeLucene(title)}`];
  if (artist && artist.trim().length > 0) {
    parts.push(`artist:${escapeLucene(artist)}`);
  }
  if (album && album.trim().length > 0) {
    parts.push(`release:${escapeLucene(album)}`);
  }
  return parts.join(' AND ');
}

function buildReleaseQuery(title: string, artist?: string): string {
  const parts: string[] = [`release:${escapeLucene(title)}`];
  if (artist && artist.trim().length > 0) {
    parts.push(`artist:${escapeLucene(artist)}`);
  }
  return parts.join(' AND ');
}

function buildArtistQuery(name: string): string {
  return `artist:${escapeLucene(name)}`;
}

function escapeLucene(value: string): string {
  // Escape Lucene special characters and wrap in quotes when the value contains spaces.
  const escaped = value.replace(/([+\-!(){}\[\]^"~*?:\\/])/g, '\\$1');
  return escaped.includes(' ') ? `"${escaped}"` : escaped;
}

export async function searchMusicBrainzRecordings(
  title: string,
  artist?: string,
  album?: string,
  limit = 5,
): Promise<MusicBrainzMatch[]> {
  const query = buildRecordingQuery(title, artist, album);
  const url = `${MB_BASE_URL}/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`MusicBrainz recording search returned ${response.status}`);
  }
  const json = (await response.json()) as MbRecordingSearchResult;
  return (json.recordings ?? []).map(recordingToMatch);
}

export async function searchMusicBrainzReleases(
  title: string,
  artist?: string,
  limit = 5,
): Promise<MusicBrainzMatch[]> {
  const query = buildReleaseQuery(title, artist);
  const url = `${MB_BASE_URL}/release/?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`MusicBrainz release search returned ${response.status}`);
  }
  const json = (await response.json()) as MbReleaseSearchResult;
  return (json.releases ?? []).map(releaseToMatch);
}

export async function searchMusicBrainzArtists(name: string, limit = 5): Promise<MusicBrainzMatch[]> {
  const query = buildArtistQuery(name);
  const url = `${MB_BASE_URL}/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`MusicBrainz artist search returned ${response.status}`);
  }
  const json = (await response.json()) as MbArtistSearchResult;
  return (json.artists ?? []).map(artistToMatch);
}

export async function fetchMusicBrainzRecording(mbid: string): Promise<MusicBrainzMatch | undefined> {
  const url = `${MB_BASE_URL}/recording/${encodeURIComponent(mbid)}?inc=releases&fmt=json`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    if (response.status === 404) return undefined;
    throw new Error(`MusicBrainz recording fetch returned ${response.status}`);
  }
  const recording = (await response.json()) as MbRecording;
  return recordingToMatch(recording);
}

export async function fetchMusicBrainzRelease(mbid: string): Promise<MusicBrainzMatch | undefined> {
  const url = `${MB_BASE_URL}/release/${encodeURIComponent(mbid)}?fmt=json`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    if (response.status === 404) return undefined;
    throw new Error(`MusicBrainz release fetch returned ${response.status}`);
  }
  const release = (await response.json()) as MbRelease;
  return releaseToMatch(release);
}

export async function fetchMusicBrainzArtistMatch(mbid: string): Promise<MusicBrainzMatch | undefined> {
  const url = `${MB_BASE_URL}/artist/${encodeURIComponent(mbid)}?fmt=json`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    if (response.status === 404) return undefined;
    throw new Error(`MusicBrainz artist fetch returned ${response.status}`);
  }
  const artist = (await response.json()) as MbArtist;
  return artistToMatch(artist);
}
