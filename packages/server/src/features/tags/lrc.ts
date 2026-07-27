import type { SyncedLyricLine } from '@sonarly/shared';

const LRC_LINE_REGEX = /^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/;

export function parseLrc(text: string): SyncedLyricLine[] {
  const lines: SyncedLyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = LRC_LINE_REGEX.exec(line);
    if (!match) continue;
    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const frac = match[3];
    const textPart = match[4].trim();
    const fracSeconds = frac.length === 2 ? parseInt(frac, 10) / 100 : parseInt(frac, 10) / 1000;
    const time = minutes * 60 + seconds + fracSeconds;
    lines.push({ time, text: textPart });
  }
  return lines;
}

function formatTime(seconds: number): string {
  const totalCs = Math.round(seconds * 100);
  const mins = Math.floor(totalCs / 6000);
  const secs = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

export function serializeLrc(lines: SyncedLyricLine[]): string {
  return lines.map((line) => `[${formatTime(line.time)}] ${line.text}`).join('\n');
}
