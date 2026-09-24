import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Song } from '@sonarly/shared';
import { decideTranscode, parseMaxBitRate, spawnFfmpegTranscode, transcodeContentType } from '../../../src/features/transcode/service.js';

describe('transcode service', () => {
  it('decides no transcode when no settings or query', () => {
    const song = { filePath: '/music/song.flac', bitRate: 900000 } as Song;
    expect(decideTranscode(song, undefined)).toEqual({ shouldTranscode: false });
  });

  it('decides transcode when source bitrate exceeds user max', () => {
    const song = { filePath: '/music/song.flac', bitRate: 900000 } as Song;
    expect(decideTranscode(song, { maxBitrateKbps: 320 })).toEqual({
      shouldTranscode: true,
      format: 'mp3',
      maxBitrateKbps: 320,
    });
  });

  it('decides no transcode when source bitrate is within limit', () => {
    const song = { filePath: '/music/song.mp3', bitRate: 256000 } as Song;
    expect(decideTranscode(song, { maxBitrateKbps: 320 })).toEqual({ shouldTranscode: false });
  });

  it('decides transcode when format differs', () => {
    const song = { filePath: '/music/song.flac', bitRate: 900000 } as Song;
    expect(decideTranscode(song, { transcodeFormat: 'aac' })).toEqual({
      shouldTranscode: true,
      format: 'aac',
      maxBitrateKbps: undefined,
    });
  });

  it('prefers requested max bitrate over user setting', () => {
    const song = { filePath: '/music/song.flac', bitRate: 900000 } as Song;
    expect(decideTranscode(song, { maxBitrateKbps: 320 }, 128)).toEqual({
      shouldTranscode: true,
      format: 'mp3',
      maxBitrateKbps: 128,
    });
  });

  it('clamps the requested max bitrate to the user cap', () => {
    const song = { filePath: '/music/song.flac', bitRate: 900000 } as Song;
    expect(decideTranscode(song, { maxBitrateKbps: 128 }, 320)).toEqual({
      shouldTranscode: true,
      format: 'mp3',
      maxBitrateKbps: 128,
    });
  });

  it('falls back to the user cap when the request is out of range', () => {
    // parseMaxBitRate drops absurd values like 999999 before they reach here.
    const song = { filePath: '/music/song.flac', bitRate: 900000 } as Song;
    expect(decideTranscode(song, { maxBitrateKbps: 320 }, parseMaxBitRate('999999'))).toEqual({
      shouldTranscode: true,
      format: 'mp3',
      maxBitrateKbps: 320,
    });
  });

  it('parses maxBitRate strictly', () => {
    expect(parseMaxBitRate(undefined)).toBeUndefined();
    expect(parseMaxBitRate('128')).toBe(128);
    expect(parseMaxBitRate('64')).toBe(64);
    expect(parseMaxBitRate('10000')).toBe(10000);
    expect(parseMaxBitRate('abc')).toBeUndefined();
    expect(parseMaxBitRate('128.5')).toBeUndefined();
    expect(parseMaxBitRate('32')).toBeUndefined();
    expect(parseMaxBitRate('999999')).toBeUndefined();
    expect(parseMaxBitRate('')).toBeUndefined();
  });

  it('returns correct content types', () => {
    expect(transcodeContentType('mp3')).toBe('audio/mpeg');
    expect(transcodeContentType('aac')).toBe('audio/aac');
    expect(transcodeContentType('opus')).toBe('audio/opus');
  });
});
