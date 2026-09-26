// Defensive normalizer for the syncedLyrics wire shape (FF4 v2 delta).
//
// v1 always serializes syncedLyrics as SyncedLyricLine[] (the DB column is
// JSON-parsed before sending). v2 passes the raw JSON column through as
// `any`, so a string can reach the client on DTOs that did not validate the
// column — notably raw LRC text. Every read path funnels through
// normalizeSyncedLyrics so the render code only ever sees SyncedLyricLine[].
import type { SyncedLyricLine } from '@sonarly/shared';

const LRC_TIMESTAMP = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const LRC_META = /^\[[a-zA-Z]+:/;

function parseLrcTimestamp(minutes: string, seconds: string, fraction: string | undefined): number {
  // LRC fractions are centiseconds ("00:12.34"); a 3-digit fraction is
  // milliseconds. Treat anything else as centiseconds.
  const fracDigits = fraction?.length ?? 0;
  const frac = fraction ? Number(fraction) : 0;
  const millis = fracDigits === 3 ? frac : frac * 10;
  return Number(minutes) * 60 + Number(seconds) + millis / 1000;
}

export function parseLrcString(raw: string): SyncedLyricLine[] {
  const lines: SyncedLyricLine[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || LRC_META.test(line)) continue;
    const timestamps: number[] = [];
    let text = line;
    for (const match of line.matchAll(LRC_TIMESTAMP)) {
      timestamps.push(parseLrcTimestamp(match[1], match[2], match[3]));
      text = text.replace(match[0], '');
    }
    text = text.trim();
    if (timestamps.length === 0) {
      if (text !== '') lines.push({ time: 0, text });
      continue;
    }
    for (const time of timestamps) {
      lines.push({ time, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function isSyncedLyricLine(value: unknown): value is SyncedLyricLine {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { time?: unknown }).time === 'number' &&
    Number.isFinite((value as { time: number }).time) &&
    typeof (value as { text?: unknown }).text === 'string'
  );
}

/** Accept string | SyncedLyricLine[] (or garbage) and return safe lines. */
export function normalizeSyncedLyrics(value: unknown): SyncedLyricLine[] {
  if (typeof value === 'string') {
    return parseLrcString(value);
  }
  if (Array.isArray(value)) {
    const lines = value.filter(isSyncedLyricLine);
    return lines.map((line) => ({ time: line.time, text: line.text }));
  }
  return [];
}
