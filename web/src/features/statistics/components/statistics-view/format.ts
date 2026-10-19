import type { CSSProperties } from 'react';

export function staggerStyle(index: number): CSSProperties {
  return { '--stagger': index } as CSSProperties;
}

export function formatListenDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
  } else if (hours > 0) {
    parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
  } else if (minutes > 0) {
    parts.push(`${minutes}m`);
  } else {
    parts.push(`${Math.floor(seconds)}s`);
  }
  return parts.join(' ');
}

export function formatListenDurationLong(seconds: number): string {
  if (seconds <= 0) return 'no listening time yet';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (days === 0 && hours === 0 && minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  }
  if (parts.length === 0) parts.push(`${Math.floor(seconds)} seconds`);
  return parts.join(' ');
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatRating(value: number): string {
  const formatted = value.toFixed(1);
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
}
