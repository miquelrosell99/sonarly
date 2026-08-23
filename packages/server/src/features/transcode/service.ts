import { spawn, type ChildProcess } from 'node:child_process';
import { lookup } from 'mime-types';
import type { Song } from '@sonarly/shared';

export type TranscodeFormat = 'mp3' | 'aac' | 'opus';

const FORMAT_TO_CODEC: Record<TranscodeFormat, string> = {
  mp3: 'libmp3lame',
  aac: 'aac',
  opus: 'libopus',
};

const FORMAT_TO_MIME: Record<TranscodeFormat, string> = {
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  opus: 'audio/opus',
};

export interface TranscodeOptions {
  filePath: string;
  format?: TranscodeFormat;
  maxBitrateKbps?: number;
}

export interface TranscodeDecision {
  shouldTranscode: boolean;
  format?: TranscodeFormat;
  maxBitrateKbps?: number;
}

function sourceSuffix(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ?? '';
}

// The songs.bit_rate column stores bits per second (e.g. 320000); the
// transcode decision works in kbps. Conversion happens here at the use site —
// the stored column intentionally keeps its raw unit.
function sourceBitrateKbps(song: Song): number | undefined {
  if (typeof song.bitRate === 'number') return Math.round(song.bitRate / 1000);
  return undefined;
}

export function decideTranscode(song: Song, user: { maxBitrateKbps?: number; transcodeFormat?: TranscodeFormat } | undefined, requestedMaxBitRate?: number): TranscodeDecision {
  const effectiveMaxBitrate = requestedMaxBitRate ?? user?.maxBitrateKbps;
  const targetFormat = user?.transcodeFormat;

  if (!effectiveMaxBitrate && !targetFormat) {
    return { shouldTranscode: false };
  }

  if (targetFormat) {
    const sourceFormat = sourceSuffix(song.filePath);
    const formatMismatch = sourceFormat !== targetFormat;
    if (formatMismatch) {
      return { shouldTranscode: true, format: targetFormat, maxBitrateKbps: effectiveMaxBitrate };
    }
  }

  if (effectiveMaxBitrate) {
    const sourceKbps = sourceBitrateKbps(song);
    if (sourceKbps === undefined || sourceKbps > effectiveMaxBitrate) {
      return { shouldTranscode: true, format: targetFormat ?? inferFormat(song.filePath), maxBitrateKbps: effectiveMaxBitrate };
    }
  }

  return { shouldTranscode: false };
}

function inferFormat(filePath: string): TranscodeFormat {
  const mime = lookup(filePath) || 'audio/mpeg';
  if (mime === 'audio/aac' || mime === 'audio/mp4') return 'aac';
  if (mime === 'audio/opus') return 'opus';
  return 'mp3';
}

export function spawnFfmpegTranscode(options: TranscodeOptions): ChildProcess {
  const { filePath, format = 'mp3', maxBitrateKbps } = options;
  const codec = FORMAT_TO_CODEC[format];
  const outputMime = FORMAT_TO_MIME[format];

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', filePath,
    '-map', '0:a:0',
    '-c:a', codec,
  ];

  if (maxBitrateKbps) {
    args.push('-b:a', `${maxBitrateKbps}k`);
  } else {
    args.push('-q:a', '2');
  }

  args.push('-f', containerFormat(format), 'pipe:1');

  return spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function containerFormat(format: TranscodeFormat): string {
  switch (format) {
    case 'aac':
      return 'adts';
    case 'opus':
      return 'opus';
    default:
      return 'mp3';
  }
}

export function transcodeContentType(format: TranscodeFormat): string {
  return FORMAT_TO_MIME[format];
}
