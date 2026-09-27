import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime, formatDateShortMonth } from './formatDate.js';

// Pin a moment (2026-09-27T20:45:00 local) through the Date constructor so the
// test is timezone-stable: the assertions only depend on the locale ordering.
const TIMESTAMP = new Date(2026, 8, 27, 20, 45, 0).getTime();

describe('formatDate', () => {
  it('renders day-first DD/MM/YYYY regardless of runtime locale', () => {
    expect(formatDate(TIMESTAMP)).toBe('27/09/2026');
  });

  it('flags invalid input', () => {
    expect(formatDate('not a date')).toBe('Invalid date');
  });
});

describe('formatDateTime', () => {
  it('renders day-first with a 24h clock', () => {
    expect(formatDateTime(TIMESTAMP)).toBe('27/09/2026, 20:45:00');
  });

  it('flags invalid input', () => {
    expect(formatDateTime(NaN)).toBe('Invalid date');
  });
});

describe('formatDateShortMonth', () => {
  it('renders day-first with a short month name', () => {
    expect(formatDateShortMonth(TIMESTAMP)).toBe('27 Sept 2026');
  });
});
