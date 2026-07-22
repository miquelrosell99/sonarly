import { parseFile } from 'music-metadata';
import path from 'node:path';
import type { SongTags } from '@sonarly/shared';
import { computeChecksum } from './checksum.js';

/** Audio tags plus optional duration and cover-art hint, as returned by {@link readMetadata}. */
export interface AudioMetadata {
  tags: SongTags;
  duration?: number;
  hasCoverArt: boolean;
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
    hasCoverArt: (common.picture?.length ?? 0) > 0,
  };
}

/** Backward-compatible alias for {@link readMetadata}. */
export const readTags = readMetadata;

function getFilenameFallback(filePath: string): string {
  return path.basename(filePath).replace(/\.[^.]+$/, '');
}

export { computeChecksum };
