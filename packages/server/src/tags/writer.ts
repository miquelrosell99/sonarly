import type { SongTags } from '@sonarly/shared';

export interface TagWriter {
  supports(path: string): boolean;
  write(path: string, tags: SongTags): Promise<void>;
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
