import { describe, it, expect } from 'vitest';
import { validateLyrics } from '../../../src/features/songs/lyrics-routes.js';

describe('validateLyrics', () => {
  it('accepts valid lyrics and synced lyrics', () => {
    expect(validateLyrics({ lyrics: 'hello', syncedLyrics: [{ time: 1, text: 'hello' }] })).toEqual({
      lyrics: 'hello',
      syncedLyrics: [{ time: 1, text: 'hello' }],
    });
  });

  it('rejects invalid time', () => {
    expect(() => validateLyrics({ syncedLyrics: [{ time: 'bad', text: 'x' }] })).toThrow('syncedLyrics item time must be a finite number');
  });

  it('rejects invalid text', () => {
    expect(() => validateLyrics({ syncedLyrics: [{ time: 1, text: 2 }] })).toThrow('syncedLyrics item text must be a string');
  });

  it('sorts synced lyrics by time', () => {
    expect(validateLyrics({ syncedLyrics: [{ time: 5, text: 'b' }, { time: 1, text: 'a' }] }).syncedLyrics).toEqual([
      { time: 1, text: 'a' },
      { time: 5, text: 'b' },
    ]);
  });

  it('accepts empty body', () => {
    expect(validateLyrics({})).toEqual({});
  });
});
