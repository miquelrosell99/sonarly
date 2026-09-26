import { describe, it, expect } from 'vitest';
import { buildSongTagsPatch, type SongPatchField } from './songEditPatch.js';
import { DEFAULT_CAPABILITIES, type ServerCapabilities } from '../contract/capabilities.js';

const v1: ServerCapabilities = { ...DEFAULT_CAPABILITIES };
const v2: ServerCapabilities = {
  server: 'v2',
  rawUpload: true,
  hasFilePath: false,
  syncedLyricsArray: false,
};

const SONG_FIELDS: SongPatchField[] = [
  { key: 'title' },
  { key: 'album' },
  { key: 'trackNumber', type: 'number' },
  { key: 'discNumber', type: 'number' },
  { key: 'artist', multi: true },
  { key: 'genre', multi: true },
  { key: 'year', type: 'number' },
];

function baseInput(overrides: Partial<Parameters<typeof buildSongTagsPatch>[0]> = {}) {
  return {
    values: {
      title: 'Track',
      album: 'Album',
      trackNumber: '3',
      discNumber: '',
      artist: ['Artist A'],
      genre: ['Rock', 'Indie'],
      year: '2020',
      lyrics: 'la la la',
    },
    fields: SONG_FIELDS,
    isMulti: false,
    touchedFields: new Set<string>(),
    explicit: false,
    ...overrides,
  };
}

describe('buildSongTagsPatch', () => {
  it('v1: sends genre names under `genre` as a string array', () => {
    const patch = buildSongTagsPatch(baseInput(), v1);
    expect(patch.genre).toEqual(['Rock', 'Indie']);
    expect(patch.title).toBe('Track');
    expect(patch.trackNumber).toBe(3);
    expect(patch.discNumber).toBeUndefined();
    expect(patch.explicit).toBe(false);
    expect(patch.lyrics).toBe('la la la');
  });

  it('v2: sends the same body — both validators share the SongTags allowlist', () => {
    // Verified against v2/api/openapi.yaml (SongTags) and
    // v2/internal/modules/tags/tags.go (validateSongTags): `genre` is
    // string|string[] resolved by path-or-name; `genreId` is NOT a
    // writable key (unknown keys 400 on both servers).
    const v1Patch = buildSongTagsPatch(baseInput(), v1);
    const v2Patch = buildSongTagsPatch(baseInput(), v2);
    expect(v2Patch).toEqual(v1Patch);
    expect(v2Patch.genre).toEqual(['Rock', 'Indie']);
  });

  it('never lets id-shaped DTO fields leak into the body, even if seeded in values', () => {
    const input = baseInput();
    (input.values as Record<string, unknown>).genreId = 'genre-uuid';
    (input.values as Record<string, unknown>).filePath = '/music/track.mp3';
    (input.values as Record<string, unknown>).id = 'song-1';
    const patch = buildSongTagsPatch(input, v2);
    expect(patch).not.toHaveProperty('genreId');
    expect(patch).not.toHaveProperty('filePath');
    expect(patch).not.toHaveProperty('id');
  });

  it('multi-edit only includes touched fields', () => {
    const patch = buildSongTagsPatch(
      baseInput({ isMulti: true, touchedFields: new Set(['genre']) }),
      v1,
    );
    expect(patch.genre).toEqual(['Rock', 'Indie']);
    expect(patch).not.toHaveProperty('title');
    expect(patch).not.toHaveProperty('artist');
    expect(patch).not.toHaveProperty('lyrics');
    expect(patch).not.toHaveProperty('explicit');
  });

  it('multi-edit untouched genre leaves the key out of the wire payload', () => {
    const patch = buildSongTagsPatch(
      baseInput({ isMulti: true, touchedFields: new Set(['title']) }),
      v1,
    );
    expect(patch.title).toBe('Track');
    expect(JSON.parse(JSON.stringify(patch))).not.toHaveProperty('genre');
  });

  it('empty pill lists serialize to nothing (leave-untouched semantics)', () => {
    const input = baseInput();
    input.values.genre = [];
    input.values.artist = [];
    const wire = JSON.parse(JSON.stringify(buildSongTagsPatch(input, v1)));
    expect(wire).not.toHaveProperty('genre');
    expect(wire).not.toHaveProperty('artist');
  });
});
