import { mkdir, rename, copyFile, stat, unlink } from 'node:fs/promises';
import { dirname, join, extname, parse } from 'node:path';
import type { SongTags } from '@sonarly/shared';
import { computeChecksum } from '../tags/reader.js';

export function buildTargetPath(pattern: string, libraryPath: string, tags: SongTags, originalPath: string): string {
  const ext = extname(originalPath);
  const variables = buildVariables(tags, ext);
  const relativePath = pattern.replace(/\{([a-zA-Z0-9:]+)\}/g, (_, token) => {
    return variables[token] ?? '';
  });
  const sanitized = relativePath.split('/').map(sanitize).join('/');
  return join(libraryPath, sanitized);
}

function buildVariables(tags: SongTags, ext: string): Record<string, string> {
  const artist = tags.artist || 'Unknown Artist';
  const album = tags.album || 'Unknown Album';
  const title = tags.title || 'Unknown Title';
  const albumArtist = tags.albumArtist || artist;
  const track = tags.trackNumber ?? '';
  const disc = tags.discNumber ?? '';
  const year = tags.year ?? '';
  const genre = tags.genre ?? '';

  return {
    artist: sanitize(artist),
    albumArtist: sanitize(albumArtist),
    album: sanitize(album),
    title: sanitize(title),
    track: String(track),
    'track:00': track !== '' ? String(track).padStart(2, '0') : '',
    disc: String(disc),
    year: String(year),
    genre: sanitize(genre),
    ext,
  };
}

export function sanitize(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '') || '_';
}

export async function moveToLibrary(sourcePath: string, targetPath: string): Promise<string> {
  if (sourcePath === targetPath) return sourcePath;
  await mkdir(dirname(targetPath), { recursive: true });
  const finalPath = await resolveDuplicateTarget(targetPath);
  try {
    await rename(sourcePath, finalPath);
    return finalPath;
  } catch (err) {
    if (isExdev(err)) {
      return await copyAndRemove(sourcePath, finalPath);
    }
    throw err;
  }
}

export async function copyWithIntegrity(sourcePath: string, targetPath: string): Promise<string> {
  await mkdir(dirname(targetPath), { recursive: true });
  const finalPath = await resolveDuplicateTarget(targetPath);
  await copyFile(sourcePath, finalPath);
  return finalPath;
}

async function copyAndRemove(sourcePath: string, targetPath: string): Promise<string> {
  await copyFile(sourcePath, targetPath);
  const [sourceChecksum, targetChecksum] = await Promise.all([
    computeChecksum(sourcePath),
    computeChecksum(targetPath),
  ]);
  if (sourceChecksum !== targetChecksum) {
    throw new Error(`Integrity check failed after copying ${sourcePath} to ${targetPath}`);
  }
  await unlink(sourcePath);
  return targetPath;
}

function isExdev(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'EXDEV';
}

async function resolveDuplicateTarget(targetPath: string): Promise<string> {
  if (!(await fileExists(targetPath))) return targetPath;
  const { dir, name, ext } = parse(targetPath);
  let counter = 1;
  let candidate = targetPath;
  while (await fileExists(candidate)) {
    candidate = join(dir, `${name} (${counter})${ext}`);
    counter++;
  }
  return candidate;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
