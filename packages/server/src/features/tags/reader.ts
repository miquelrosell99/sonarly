import { parseFile } from 'music-metadata';
import type { IAudioMetadata } from 'music-metadata';
import path from 'node:path';
import type { SongTags, SyncedLyricLine } from '@sonarly/shared';
import { parseLrc } from './lrc.js';
export { computeChecksum } from './checksum.js';

type CommentLike = { text?: string } | string | undefined;

function commentText(value: CommentLike): string | undefined {
  if (value == null) return undefined;
  const text = typeof value === 'string' ? value : value.text;
  return text && text.trim() ? text.trim() : undefined;
}

export interface CoverArtPicture {
  data: Buffer;
  format: string;
}

/** Audio format details extracted by {@link readMetadata}. */
export interface AudioFormatMetadata {
  bitRate?: number;
  bitsPerSample?: number;
  sampleRate?: number;
  channels?: number;
}

/** Audio tags plus optional duration and cover-art hint, as returned by {@link readMetadata}. */
export interface AudioMetadata {
  tags: SongTags;
  duration?: number;
  format?: AudioFormatMetadata;
  hasCoverArt: boolean;
  coverArt?: CoverArtPicture;
  bpm?: number;
  musicBrainzId?: string;
  musicBrainzTrackId?: string;
  musicBrainzWorkId?: string;
  musicBrainzDiscId?: string;
  musicBrainzAlbumId?: string;
  musicBrainzReleaseGroupId?: string;
  musicBrainzArtistIds?: string[];
  musicBrainzAlbumArtistIds?: string[];
  replayGain?: number;
  comment?: string;
  sortName?: string;
  mood?: string;
  originalReleaseDate?: string;
  releaseDate?: string;
  remixOf?: string;
  displayArtist?: string;
  displayAlbumArtist?: string;
  lyrics?: string;
  syncedLyrics?: SyncedLyricLine[];
  genres?: string[];
  artists?: string[];
  albumArtists?: string[];
  composers?: string[];
  producers?: string[];
  labels?: string[];
  catalogNumbers?: string[];
  isrcs?: string[];
  barcode?: string;
  asin?: string;
  originalYear?: number;
  originalArtist?: string;
  compilation?: boolean;
  gapless?: boolean;
  totalTracks?: string;
  totalDiscs?: string;
}

/**
 * Reads audio tags and duration.
 * Use `computeChecksum(path)` separately to get a SHA256 checksum.
 */
export async function readMetadata(filePath: string): Promise<AudioMetadata> {
  const metadata = await parseFile(filePath, { duration: true });
  const common = metadata.common;
  const picture = common.picture?.[0];
  const replayGain = common.replaygain_track_gain?.dB ?? common.replaygain_track_gain_ratio ?? undefined;

  return {
    tags: {
      title: common.title || getFilenameFallback(filePath),
      artist: common.artist,
      album: common.album,
      albumArtist: common.albumartist,
      trackNumber: common.track.no ?? undefined,
      discNumber: common.disk.no ?? undefined,
      genre: common.genre?.filter(Boolean)[0] ?? common.genre?.filter(Boolean).join(' / '),
      year: common.year,
      explicit: detectExplicit(metadata.native),
    },
    duration: metadata.format.duration,
    format: {
      bitRate: metadata.format.bitrate,
      bitsPerSample: metadata.format.bitsPerSample,
      sampleRate: metadata.format.sampleRate,
      channels: metadata.format.numberOfChannels,
    },
    hasCoverArt: picture !== undefined,
    coverArt: picture ? { data: Buffer.from(picture.data), format: picture.format } : undefined,
    genres: common.genre?.filter(Boolean).length ? common.genre.filter(Boolean) : undefined,
    bpm: common.bpm ?? undefined,
    musicBrainzId: common.musicbrainz_recordingid ?? undefined,
    musicBrainzTrackId: common.musicbrainz_trackid ?? undefined,
    musicBrainzWorkId: common.musicbrainz_workid ?? undefined,
    musicBrainzDiscId: common.musicbrainz_discid ?? undefined,
    musicBrainzAlbumId: common.musicbrainz_albumid ?? undefined,
    musicBrainzReleaseGroupId: common.musicbrainz_releasegroupid ?? undefined,
    musicBrainzArtistIds: common.musicbrainz_artistid?.length ? common.musicbrainz_artistid : undefined,
    musicBrainzAlbumArtistIds: common.musicbrainz_albumartistid?.length ? common.musicbrainz_albumartistid : undefined,
    replayGain: typeof replayGain === 'number' ? replayGain : undefined,
    comment: commentText(common.comment?.[0]) ?? undefined,
    sortName: common.titlesort ?? undefined,
    mood: common.mood ?? undefined,
    originalReleaseDate: common.originaldate ?? undefined,
    releaseDate: common.releasedate ?? undefined,
    remixOf: common.remixer?.join(', ') ?? undefined,
    displayArtist: common.artist ?? undefined,
    displayAlbumArtist: common.albumartist ?? undefined,
    lyrics: extractPlainLyrics(metadata),
    syncedLyrics: extractSyncedLyrics(metadata),
    artists: common.artists?.length
      ? common.artists.flatMap(splitArtists)
      : (common.artist ? splitArtists(common.artist) : undefined),
    albumArtists: common.albumartist ? splitArtists(common.albumartist) : undefined,
    composers: common.composer?.length ? common.composer : undefined,
    producers: common.producer?.length ? common.producer : undefined,
    labels: common.label?.length ? common.label : undefined,
    catalogNumbers: common.catalognumber?.length ? common.catalognumber : undefined,
    isrcs: common.isrc?.length ? common.isrc : undefined,
    barcode: common.barcode ?? undefined,
    asin: common.asin ?? undefined,
    originalYear: common.originalyear ?? undefined,
    originalArtist: common.originalartist ?? undefined,
    compilation: common.compilation ?? undefined,
    gapless: common.gapless ?? undefined,
    totalTracks: common.track.of?.toString() ?? common.totaltracks ?? undefined,
    totalDiscs: common.disk.of?.toString() ?? common.totaldiscs ?? undefined,
  };
}

function extractPlainLyrics(metadata: IAudioMetadata): string | undefined {
  return commentText(metadata.common.lyrics?.[0]);
}

function extractSyncedLyrics(metadata: IAudioMetadata): SyncedLyricLine[] | undefined {
  const native = metadata.native;
  if (!native) return undefined;

  for (const [tagType, tags] of Object.entries(native)) {
    for (const tag of tags) {
      const id = tag.id.toUpperCase();
      const raw = Array.isArray(tag.value) ? tag.value[0] : tag.value;

      if ((tagType === 'ID3v2.3' || tagType === 'ID3v2.4') && id === 'SYLT') {
        if (Array.isArray(tag.value)) {
          const parsed = tag.value
            .filter((item): item is [number, string] =>
              Array.isArray(item) && item.length === 2 && typeof item[0] === 'number' && typeof item[1] === 'string'
            )
            .map(([time, text]) => ({ time: time / 1000, text }));
          if (parsed.length) return parsed;
        }
      }

      const value = String(raw);
      if (id.includes('SYNCEDLYRICS') || id.includes('SYNCED_LYRICS') || (id.includes('LYRICS') && /\[\d{2}:\d{2}/.test(value))) {
        const parsed = parseLrc(value);
        if (parsed.length) return parsed;
      }
    }
  }

  return undefined;
}

/** Backward-compatible alias for {@link readMetadata}. */
export const readTags = readMetadata;

function getFilenameFallback(filePath: string): string {
  return path.basename(filePath).replace(/\.[^.]+$/, '');
}

const ARTIST_SPLIT_REGEX = /\s*[,;\/]\s*|\s+&\s+|\s+feat\.\s+|\s+featuring\s+|\s+ft\.\s+/i;

function splitArtists(value: string): string[] {
  const parts = value.split(ARTIST_SPLIT_REGEX).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [value.trim()];
}

function detectExplicit(native: Record<string, { id: string; value: unknown }[]> | undefined): boolean | undefined {
  if (!native) return undefined;

  for (const [tagType, tags] of Object.entries(native)) {
    for (const tag of tags) {
      const id = tag.id.toUpperCase();
      const value = String(Array.isArray(tag.value) ? tag.value[0] : tag.value).trim();

      if (tagType === 'iTunes' || tagType.startsWith('ID3')) {
        if (id === 'ITUNESADVISORY' || id === 'TXXX:ITUNESADVISORY' || id === 'TXXX:ITUNES_ADVISORY') {
          return value === '1';
        }
      }

      if (tagType === 'vorbis') {
        if (id === 'ITUNESADVISORY' || id === 'ADVISORY') {
          return value === '1';
        }
      }

      if (tagType === 'iTunes' || tagType === 'mp4') {
        if (id === 'RTNG') {
          return value === '1';
        }
      }
    }
  }

  return undefined;
}
