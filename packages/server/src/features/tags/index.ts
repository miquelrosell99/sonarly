import { registerWriter } from './writer.js';
import { MutagenWriter } from './mutagen-writer.js';

export function registerDefaultWriters(): void {
  registerWriter(new MutagenWriter());
}

export * from './writer.js';
export * from './reader.js';
export { computeChecksum } from './checksum.js';
