import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicTagRewrite } from '../../../src/features/tags/atomic.js';

describe('atomicTagRewrite', () => {
  it('replaces original only on success', async () => {
    const original = join(tmpdir(), 'atomic-test.txt');
    writeFileSync(original, 'original');
    await atomicTagRewrite(original, async (tmp) => {
      writeFileSync(tmp, 'modified');
    });
    expect(readFileSync(original, 'utf-8')).toBe('modified');
  });

  it('does not replace original on failure', async () => {
    const original = join(tmpdir(), 'atomic-fail.txt');
    writeFileSync(original, 'original');
    await expect(
      atomicTagRewrite(original, async () => {
        throw new Error('mutate failed');
      })
    ).rejects.toThrow('mutate failed');
    expect(readFileSync(original, 'utf-8')).toBe('original');
  });
});
