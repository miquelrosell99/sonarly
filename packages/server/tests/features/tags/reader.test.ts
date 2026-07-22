import { describe, it, expect } from 'vitest';
import { readTags, computeChecksum } from '../../../src/features/tags/reader.js';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('readTags', () => {
  it('reads tags from a real MP3 fixture', async () => {
    const fixture = new URL('../../fixtures/sample.mp3', import.meta.url).pathname;
    const meta = await readTags(fixture);
    expect(meta.tags.title).toBeDefined();
    expect(meta.duration).toBeGreaterThan(0);
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
