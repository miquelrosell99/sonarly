import { join } from 'node:path';

export interface OrganizedTags {
  title: string;
  artist?: string;
  album?: string;
  extension?: string;
}

/**
 * Builds a canonical library path from metadata.
 * Example: `<libraryPath>/<Artist>/<Album>/<Title>.<ext>`.
 */
export function buildOrganizedPath(libraryPath: string, tags: OrganizedTags): string {
  const artist = sanitizeFileName(tags.artist || 'Unknown Artist');
  const album = sanitizeFileName(tags.album || 'Unknown Album');
  const title = sanitizeFileName(tags.title || 'Unknown Title');
  const ext = tags.extension ? `.${tags.extension.replace(/^\./, '')}` : '';
  return join(libraryPath, artist, album, `${title}${ext}`);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}
