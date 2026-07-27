import { describe, it, expect } from 'vitest';
import { parseLrc, serializeLrc } from '../../../src/features/tags/lrc.js';

describe('lrc', () => {
  it('parses mm:ss.xx timestamps', () => {
    const text = '[00:12.34] First line\n[00:15.67] Second line';
    expect(parseLrc(text)).toEqual([
      { time: 12.34, text: 'First line' },
      { time: 15.67, text: 'Second line' },
    ]);
  });

  it('parses mm:ss.xxx timestamps', () => {
    const text = '[00:12.345] First line';
    expect(parseLrc(text)).toEqual([{ time: 12.345, text: 'First line' }]);
  });

  it('serializes with mm:ss.xx format', () => {
    const lines = [
      { time: 12.34, text: 'First line' },
      { time: 65.5, text: 'Second line' },
    ];
    expect(serializeLrc(lines)).toBe('[00:12.34] First line\n[01:05.50] Second line');
  });

  it('ignores malformed lines', () => {
    expect(parseLrc('not a line\n[00:01.00] ok')).toEqual([{ time: 1, text: 'ok' }]);
  });

  it('handles empty input', () => {
    expect(parseLrc('')).toEqual([]);
  });
});
