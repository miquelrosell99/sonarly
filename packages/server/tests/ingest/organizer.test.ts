import { describe, it, expect } from 'vitest';
import { buildTargetPath, sanitize } from '../../src/ingest/organizer.js';
import type { SongTags } from '@sonarly/shared';

describe('buildTargetPath', () => {
  const tags: SongTags = {
    title: 'Song Title',
    artist: 'The Artist',
    album: 'The Album',
    albumArtist: 'Album Artist',
    trackNumber: 5,
    discNumber: 1,
    year: 2024,
    genre: 'Rock',
  };

  it('builds default pattern', () => {
    const path = buildTargetPath('{artist}/{album}/{track:00} - {title}{ext}', '/lib', tags, '/tmp/song.mp3');
    expect(path).toBe('/lib/The Artist/The Album/05 - Song Title.mp3');
  });

  it('sanitizes unsafe characters', () => {
    const dirty: SongTags = { title: 'A/B:C', artist: 'X<Y>', album: 'Z' };
    const path = buildTargetPath('{artist}/{album}/{title}{ext}', '/lib', dirty, '/tmp/x.mp3');
    expect(path).toBe('/lib/X_Y_/Z/A_B_C.mp3');
  });

  it('zero-pads track numbers', () => {
    const path = buildTargetPath('{track:00}{ext}', '/lib', { title: 'x', trackNumber: 3 }, '/tmp/x.mp3');
    expect(path).toBe('/lib/03.mp3');
  });
});

describe('sanitize', () => {
  it('replaces filesystem-unsafe characters with underscores', () => {
    expect(sanitize('a\\b/c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('trims whitespace and collapses multiple spaces', () => {
    expect(sanitize('  hello   world  ')).toBe('hello world');
  });

  it('falls back to underscore for empty or sanitized-away strings', () => {
    expect(sanitize('')).toBe('_');
    expect(sanitize('   ')).toBe('_');
    expect(sanitize('.')).toBe('_');
  });
});
