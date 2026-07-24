import type { SongTags } from '@sonarly/shared';

export interface CoverArtData {
  data: Buffer;
  format: string;
}

export interface TagWriter {
  supports(path: string): boolean;
  write(path: string, tags: SongTags): Promise<void>;
  writeCoverArt?(path: string, coverArt: CoverArtData): Promise<void>;
}

const writers: TagWriter[] = [];

export function registerWriter(writer: TagWriter): void {
  writers.push(writer);
}

export async function writeTags(path: string, tags: SongTags): Promise<void> {
  const writer = writers.find((w) => w.supports(path));
  if (!writer) throw new Error(`No tag writer for ${path}`);
  await writer.write(path, tags);
}

export async function writeCoverArt(path: string, coverArt: CoverArtData): Promise<void> {
  const writer = writers.find((w) => w.supports(path));
  if (!writer) throw new Error(`No tag writer for ${path}`);
  if (!writer.writeCoverArt) throw new Error(`Tag writer does not support cover art for ${path}`);
  await writer.writeCoverArt(path, coverArt);
}
