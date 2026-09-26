import { describe, it, expect } from 'vitest';
import { normalizeSyncedLyrics, parseLrcString } from './syncedLyrics.js';

describe('normalizeSyncedLyrics', () => {
  it('passes through the v1 array shape unchanged', () => {
    const lines = [
      { time: 10, text: 'first' },
      { time: 20.5, text: 'second' },
    ];
    expect(normalizeSyncedLyrics(lines)).toEqual(lines);
  });

  it('drops malformed array entries defensively', () => {
    expect(
      normalizeSyncedLyrics([
        { time: 1, text: 'ok' },
        { time: 'nope', text: 'bad time' },
        { text: 'no time' },
        null,
        'string entry',
        { time: 2, text: 3 },
      ]),
    ).toEqual([{ time: 1, text: 'ok' }]);
  });

  it('parses a v2 raw LRC string into timed lines', () => {
    const lrc = '[ti:Title]\n[ar:Artist]\n[00:01.00]First line\n[00:02.50]Second line\n[00:04.00][00:08.00]Repeated';
    expect(normalizeSyncedLyrics(lrc)).toEqual([
      { time: 1, text: 'First line' },
      { time: 2.5, text: 'Second line' },
      { time: 4, text: 'Repeated' },
      { time: 8, text: 'Repeated' },
    ]);
  });

  it('treats a millisecond-fraction LRC stamp as milliseconds', () => {
    expect(normalizeSyncedLyrics('[00:01.234]ms')).toEqual([{ time: 1.234, text: 'ms' }]);
    expect(normalizeSyncedLyrics('[00:01:50]cs')).toEqual([{ time: 1.5, text: 'cs' }]);
  });

  it('keeps untimed plain-text lines at time 0', () => {
    expect(normalizeSyncedLyrics('just lyrics\nno timestamps here')).toEqual([
      { time: 0, text: 'just lyrics' },
      { time: 0, text: 'no timestamps here' },
    ]);
  });

  it('returns [] for null/undefined/numbers', () => {
    expect(normalizeSyncedLyrics(undefined)).toEqual([]);
    expect(normalizeSyncedLyrics(null)).toEqual([]);
    expect(normalizeSyncedLyrics(42)).toEqual([]);
    expect(normalizeSyncedLyrics({ time: 1, text: 'x' })).toEqual([]);
  });
});

describe('parseLrcString', () => {
  it('sorts out-of-order stamps', () => {
    expect(parseLrcString('[00:05.00]later\n[00:01.00]earlier')).toEqual([
      { time: 1, text: 'earlier' },
      { time: 5, text: 'later' },
    ]);
  });
});
