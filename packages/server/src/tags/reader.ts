import { parseFile } from 'music-metadata';
import type { SongTags } from '@sonarly/shared';
import { computeChecksum } from './checksum.js';

/** Audio tags plus optional duration, as returned by {@link readMetadata}. */
export interface AudioMetadata {
  tags: SongTags;
  duration?: number;
}

/**
 * Reads audio tags and duration.
 * Use `computeChecksum(path)` separately to get a SHA256 checksum.
 */
export async function readMetadata(filePath: string): Promise<AudioMetadata> {
  const metadata = await parseFile(filePath, { duration: true });
  const common = metadata.common;
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
    },
    duration: metadata.format.duration,
  };
}

/** Backward-compatible alias for {@link readMetadata}. */
export const readTags = readMetadata;

function getFilenameFallback(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1].replace(/\.[^.]+$/, '');
}

export { computeChecksum };
