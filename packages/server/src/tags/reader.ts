import { parseFile } from 'music-metadata';
import type { SongTags } from '@sonarly/shared';
import { computeChecksum } from './checksum.js';

export interface AudioMetadata {
  tags: SongTags;
  duration?: number;
}

export async function readTags(filePath: string): Promise<AudioMetadata> {
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

function getFilenameFallback(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1].replace(/\.[^.]+$/, '');
}

export { computeChecksum };
