import { parseFile } from 'music-metadata';
import path from 'node:path';
import type { SongTags } from '@sonarly/shared';
export { computeChecksum } from './checksum.js';

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
  replayGain?: number;
  comment?: string;
  sortName?: string;
  mood?: string;
  originalReleaseDate?: string;
  releaseDate?: string;
  remixOf?: string;
  displayArtist?: string;
  displayAlbumArtist?: string;
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
      genre: common.genre?.[0],
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
    bpm: common.bpm ?? undefined,
    musicBrainzId: common.musicbrainz_recordingid ?? undefined,
    replayGain: typeof replayGain === 'number' ? replayGain : undefined,
    comment: common.comment?.[0] ?? undefined,
    sortName: common.titlesort ?? undefined,
    mood: common.mood ?? undefined,
    originalReleaseDate: common.originaldate ?? undefined,
    releaseDate: common.releasedate ?? undefined,
    remixOf: common.remixer?.join(', ') ?? undefined,
    displayArtist: common.artist ?? undefined,
    displayAlbumArtist: common.albumartist ?? undefined,
  };
}

/** Backward-compatible alias for {@link readMetadata}. */
export const readTags = readMetadata;

function getFilenameFallback(filePath: string): string {
  return path.basename(filePath).replace(/\.[^.]+$/, '');
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
