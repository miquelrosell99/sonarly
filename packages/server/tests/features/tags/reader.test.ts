import { describe, it, expect } from 'vitest';
import { readTags, computeChecksum } from '../../../src/features/tags/reader.js';
import { writeTags, registerDefaultWriters } from '../../../src/features/tags/index.js';
import { copyFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

registerDefaultWriters();

describe('readTags', () => {
  it('reads tags from a real MP3 fixture', async () => {
    const fixture = new URL('../../fixtures/sample.mp3', import.meta.url).pathname;
    const meta = await readTags(fixture);
    expect(meta.tags.title).toBeDefined();
    expect(meta.duration).toBeGreaterThan(0);
  });

  it('detects explicit flag from an MP3 with iTunes advisory', async () => {
    const fixture = new URL('../../fixtures/sample.mp3', import.meta.url).pathname;
    const copy = join(tmpdir(), `reader-explicit-${Date.now()}.mp3`);
    await copyFile(fixture, copy);
    await writeTags(copy, { title: 'Explicit', explicit: true });

    const meta = await readTags(copy);
    expect(meta.tags.explicit).toBe(true);
  });
});

describe('computeChecksum', () => {
  it('returns stable sha256', async () => {
    const path = join(tmpdir(), 'sonarly-checksum-test.txt');
    writeFileSync(path, 'hello');
    const sum = await computeChecksum(path);
    expect(sum).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});
