import { describe, it, expect } from 'vitest';
import { buildSongTagsPatch, type SongPatchField } from './songEditPatch.js';

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
  it('sends genre names under `genre` as a string array', () => {
    const patch = buildSongTagsPatch(baseInput());
    expect(patch.genre).toEqual(['Rock', 'Indie']);
    expect(patch.title).toBe('Track');
    expect(patch.trackNumber).toBe(3);
    expect(patch.discNumber).toBeUndefined();
    expect(patch.explicit).toBe(false);
    expect(patch.lyrics).toBe('la la la');
  });

  it('never lets id-shaped DTO fields leak into the body, even if seeded in values', () => {
    const input = baseInput();
    (input.values as Record<string, unknown>).genreId = 'genre-uuid';
    (input.values as Record<string, unknown>).filePath = '/music/track.mp3';
    (input.values as Record<string, unknown>).id = 'song-1';
    const patch = buildSongTagsPatch(input);
    expect(patch).not.toHaveProperty('genreId');
    expect(patch).not.toHaveProperty('filePath');
    expect(patch).not.toHaveProperty('id');
  });

  it('multi-edit only includes touched fields', () => {
    const patch = buildSongTagsPatch(
      baseInput({ isMulti: true, touchedFields: new Set(['genre']) }),
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
    );
    expect(patch.title).toBe('Track');
    expect(JSON.parse(JSON.stringify(patch))).not.toHaveProperty('genre');
  });

  it('empty pill lists serialize to nothing (leave-untouched semantics)', () => {
    const input = baseInput();
    input.values.genre = [];
    input.values.artist = [];
    const wire = JSON.parse(JSON.stringify(buildSongTagsPatch(input)));
    expect(wire).not.toHaveProperty('genre');
    expect(wire).not.toHaveProperty('artist');
  });
});
