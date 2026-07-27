import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Song } from '@sonarly/shared';
import { decideTranscode, spawnFfmpegTranscode, transcodeContentType } from '../../../src/features/transcode/service.js';

describe('transcode service', () => {
  it('decides no transcode when no settings or query', () => {
    const song = { filePath: '/music/song.flac', bitRate: 900 } as Song;
    expect(decideTranscode(song, undefined)).toEqual({ shouldTranscode: false });
  });

  it('decides transcode when source bitrate exceeds user max', () => {
    const song = { filePath: '/music/song.flac', bitRate: 900 } as Song;
    expect(decideTranscode(song, { maxBitrateKbps: 320 })).toEqual({
      shouldTranscode: true,
      format: 'mp3',
      maxBitrateKbps: 320,
    });
  });

  it('decides no transcode when source bitrate is within limit', () => {
    const song = { filePath: '/music/song.mp3', bitRate: 256 } as Song;
    expect(decideTranscode(song, { maxBitrateKbps: 320 })).toEqual({ shouldTranscode: false });
  });

  it('decides transcode when format differs', () => {
    const song = { filePath: '/music/song.flac', bitRate: 900 } as Song;
    expect(decideTranscode(song, { transcodeFormat: 'aac' })).toEqual({
      shouldTranscode: true,
      format: 'aac',
      maxBitrateKbps: undefined,
    });
  });

  it('prefers requested max bitrate over user setting', () => {
    const song = { filePath: '/music/song.flac', bitRate: 900 } as Song;
    expect(decideTranscode(song, { maxBitrateKbps: 320 }, 128)).toEqual({
      shouldTranscode: true,
      format: 'mp3',
      maxBitrateKbps: 128,
    });
  });

  it('returns correct content types', () => {
    expect(transcodeContentType('mp3')).toBe('audio/mpeg');
    expect(transcodeContentType('aac')).toBe('audio/aac');
    expect(transcodeContentType('opus')).toBe('audio/opus');
  });
});
