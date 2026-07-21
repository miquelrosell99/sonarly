import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile } from 'music-metadata';
import { registerDefaultWriters, writeTags } from '../../src/tags/index.js';

registerDefaultWriters();

describe('MutagenWriter', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sonarly-mutagen-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = await mkdtemp(join(tmpdir(), 'sonarly-mutagen-'));
  });

  it('writes tags to an MP3 file and music-metadata can read them back', async () => {
    const src = new URL('../fixtures/sample.mp3', import.meta.url).pathname;
    const copy = join(tempDir, 'test.mp3');
    await copyFile(src, copy);

    await writeTags(copy, {
      title: 'New Title',
      artist: 'New Artist',
      album: 'New Album',
      trackNumber: 5,
      year: 2024,
    });

    const meta = await parseFile(copy);
    expect(meta.common.title).toBe('New Title');
    expect(meta.common.artist).toBe('New Artist');
    expect(meta.common.album).toBe('New Album');
    expect(meta.common.track?.no).toBe(5);
    expect(meta.common.year).toBe(2024);
  });

  it('writes tags to a synthetic FLAC file and music-metadata can read them back', async () => {
    const path = join(tempDir, 'test.flac');
    await writeFile(path, createMinimalFlac());

    await writeTags(path, {
      title: 'Flac Title',
      artist: 'Flac Artist',
      album: 'Flac Album',
      trackNumber: 3,
      year: 2023,
    });

    const meta = await parseFile(path);
    expect(meta.common.title).toBe('Flac Title');
    expect(meta.common.artist).toBe('Flac Artist');
    expect(meta.common.album).toBe('Flac Album');
    expect(meta.common.track?.no).toBe(3);
    expect(meta.common.year).toBe(2023);
  });

  it('writes tags to a synthetic M4A file without error and preserves them', async () => {
    const path = join(tempDir, 'test.m4a');
    await writeFile(path, createMinimalM4a());

    await expect(
      writeTags(path, {
        title: 'M4A Title',
        artist: 'M4A Artist',
        album: 'M4A Album',
        trackNumber: 2,
        year: 2022,
      })
    ).resolves.toBeUndefined();

    // music-metadata cannot parse our minimal container, so verify via Mutagen.
    const { execSync } = await import('node:child_process');
    const out = execSync(
      `python3 -c "from mutagen.mp4 import MP4; f = MP4('${path}'); print(repr(dict(f)))"`,
      { encoding: 'utf-8' }
    );
    expect(out).toContain('©nam');
    expect(out).toContain('M4A Title');
    expect(out).toContain('©ART');
    expect(out).toContain('M4A Artist');
  });
});

function createMinimalFlac(): Buffer {
  // Minimal FLAC file with a STREAMINFO block and an empty VORBIS_COMMENT block.
  // No audio frames are included; mutagen only needs the metadata blocks to write tags,
  // and music-metadata can still read the Vorbis comments back.
  const streaminfo = createMetadataBlock(0, false, buildStreaminfo());
  const vorbisComment = createMetadataBlock(4, true, buildVorbisComment());
  return Buffer.concat([Buffer.from('fLaC'), streaminfo, vorbisComment]);
}

function buildStreaminfo(): Buffer {
  const buf = Buffer.alloc(34);
  buf.writeUInt16BE(4096, 0); // min block size
  buf.writeUInt16BE(4096, 2); // max block size
  buf.writeUInt8(0, 4);
  buf.writeUInt8(0, 5);
  buf.writeUInt8(1, 6); // min frame size
  buf.writeUInt8(0, 7);
  buf.writeUInt8(0, 8);
  buf.writeUInt8(1, 9); // max frame size
  // sample rate (20) + channels-1 (3) + bps-1 (5) + total samples (36) = 64 bits
  // sample rate = 44100, channels = 2, bps = 16, total samples = 0
  const packed = (44100n << 44n) | (1n << 41n) | (15n << 36n) | 0n;
  buf.writeBigUInt64BE(packed, 10);
  // MD5 signature (16 zero bytes) already zeroed
  return buf;
}

function buildVorbisComment(): Buffer {
  const vendor = Buffer.from('sonarly-test');
  const comment = Buffer.from('TITLE=Placeholder');
  const buf = Buffer.alloc(4 + vendor.length + 4 + 4 + comment.length);
  let offset = 0;
  buf.writeUInt32LE(vendor.length, offset);
  offset += 4;
  vendor.copy(buf, offset);
  offset += vendor.length;
  buf.writeUInt32LE(1, offset); // comment count
  offset += 4;
  buf.writeUInt32LE(comment.length, offset);
  offset += 4;
  comment.copy(buf, offset);
  return buf;
}

function createMetadataBlock(typeId: number, lastBlock: boolean, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt8((lastBlock ? 0x80 : 0x00) | (typeId & 0x7f), 0);
  header.writeUInt8((data.length >> 16) & 0xff, 1);
  header.writeUInt8((data.length >> 8) & 0xff, 2);
  header.writeUInt8(data.length & 0xff, 3);
  return Buffer.concat([header, data]);
}

function createMinimalM4a(): Buffer {
  // Minimal MP4 container with a sound track. Mutagen can load and save tags;
  // music-metadata cannot parse this skeleton, so we only assert the write succeeds.
  const ftyp = makeAtom(Buffer.from('ftyp'), Buffer.concat([
    Buffer.from('isom'),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from('isom'),
    Buffer.from('mp41'),
  ]));

  const mvhd = makeAtom(Buffer.from('mvhd'), concatBuffers([
    u32(0), u32(0), u32(0), u32(1000), u32(1000), u32(0x00010000),
    u16(0x0100), u16(0), u32(0), u32(0),
    Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x40, 0x00, 0x00, 0x00]),
    Buffer.alloc(24, 0),
    u32(2),
  ]));

  const tkhd = makeAtom(Buffer.from('tkhd'), concatBuffers([
    u32(0x00000007), u32(0), u32(0), u32(1), u32(0), u32(1000),
    u32(0), u32(0), u16(0), u16(0), u16(0x0100), u16(0),
    Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x40, 0x00, 0x00, 0x00]),
    u32(320 << 16), u32(240 << 16),
  ]));

  const mdhd = makeFullAtom(Buffer.from('mdhd'), 0, 0, concatBuffers([
    u32(0), u32(0), u32(44100), u32(44100), u16(0x55c4), u16(0),
  ]));

  const hdlr = makeFullAtom(Buffer.from('hdlr'), 0, 0, concatBuffers([
    Buffer.from('mhlr'), Buffer.from('soun'), u32(0), u32(0), u32(0), Buffer.from([0x00]),
  ]));

  const mdia = makeAtom(Buffer.from('mdia'), Buffer.concat([mdhd, hdlr]));
  const trak = makeAtom(Buffer.from('trak'), Buffer.concat([tkhd, mdia]));
  const moov = makeAtom(Buffer.from('moov'), Buffer.concat([mvhd, trak]));
  return Buffer.concat([ftyp, moov]);
}

function makeAtom(type: Buffer, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + data.length, 0);
  return Buffer.concat([size, type, data]);
}

function makeFullAtom(type: Buffer, version: number, flags: number, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE((version << 24) | (flags & 0xffffff), 0);
  return makeAtom(type, Buffer.concat([header, data]));
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}

function concatBuffers(buffers: (Buffer | Uint8Array)[]): Buffer {
  return Buffer.concat(buffers as Buffer[]);
}
