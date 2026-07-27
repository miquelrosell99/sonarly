import { describe, it, expect } from 'vitest';
import { readTags, computeChecksum } from '../../../src/features/tags/reader.js';
import { writeTags, registerDefaultWriters } from '../../../src/features/tags/index.js';
import { copyFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

registerDefaultWriters();

function createMinimalFlacWithComments(comments: string[]): Buffer {
  const streaminfo = createMetadataBlock(0, false, buildStreaminfo());
  const vorbisComment = createMetadataBlock(4, true, buildVorbisComment(comments));
  return Buffer.concat([Buffer.from('fLaC'), streaminfo, vorbisComment]);
}

function buildStreaminfo(): Buffer {
  const buf = Buffer.alloc(34);
  buf.writeUInt16BE(4096, 0);
  buf.writeUInt16BE(4096, 2);
  buf.writeUInt8(0, 4);
  buf.writeUInt8(0, 5);
  buf.writeUInt8(1, 6);
  buf.writeUInt8(0, 7);
  buf.writeUInt8(0, 8);
  buf.writeUInt8(1, 9);
  const packed = (44100n << 44n) | (1n << 41n) | (15n << 36n) | 0n;
  buf.writeBigUInt64BE(packed, 10);
  return buf;
}

function buildVorbisComment(comments: string[]): Buffer {
  const vendor = Buffer.from('sonarly-test');
  const commentBuffers = comments.map((c) => {
    const b = Buffer.from(c);
    const h = Buffer.alloc(4);
    h.writeUInt32LE(b.length, 0);
    return Buffer.concat([h, b]);
  });
  const buf = Buffer.alloc(4 + vendor.length + 4);
  let offset = 0;
  buf.writeUInt32LE(vendor.length, offset);
  offset += 4;
  vendor.copy(buf, offset);
  offset += vendor.length;
  buf.writeUInt32LE(comments.length, offset);
  return Buffer.concat([buf, ...commentBuffers]);
}

function createMetadataBlock(typeId: number, lastBlock: boolean, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt8((lastBlock ? 0x80 : 0x00) | (typeId & 0x7f), 0);
  header.writeUInt8((data.length >> 16) & 0xff, 1);
  header.writeUInt8((data.length >> 8) & 0xff, 2);
  header.writeUInt8(data.length & 0xff, 3);
  return Buffer.concat([header, data]);
}

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

  it('reads multiple genres from a FLAC file', async () => {
    const path = join(tmpdir(), `reader-multi-genre-${Date.now()}.flac`);
    writeFileSync(path, createMinimalFlacWithComments([
      'TITLE=Multi Genre Song',
      'GENRE=Rock',
      'GENRE=Alternative',
    ]));

    const meta = await readTags(path);
    expect(meta.genres).toEqual(['Rock', 'Alternative']);
    expect(meta.tags.genre).toBe('Rock');
  });

  it('splits semicolon-separated artists in a FLAC file', async () => {
    const path = join(tmpdir(), `reader-split-artists-${Date.now()}.flac`);
    writeFileSync(path, createMinimalFlacWithComments([
      'TITLE=Collab',
      'ARTIST=Akon; Stat Quo; Bobby Creekwater',
    ]));

    const meta = await readTags(path);
    expect(meta.artists).toEqual(['Akon', 'Stat Quo', 'Bobby Creekwater']);
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
