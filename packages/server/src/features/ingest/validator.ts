import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { readTags } from '../tags/index.js';
import type { SongTags } from '@sonarly/shared';
import type { AudioMetadata } from '../tags/index.js';

const SUPPORTED_EXTS = new Set(['.mp3', '.flac', '.ogg', '.m4a']);

export interface ValidationResult {
  valid: boolean;
  reason?: 'unsupported_format' | 'unreadable' | 'missing_required_tags';
  tags?: SongTags;
  meta?: AudioMetadata;
  duration?: number;
}

export async function validateIngestFile(filePath: string): Promise<ValidationResult> {
  if (!SUPPORTED_EXTS.has(extname(filePath).toLowerCase())) {
    return { valid: false, reason: 'unsupported_format' };
  }
  try {
    await stat(filePath);
    const meta = await readTags(filePath);
    const tags = meta.tags;
    if (!tags.title || !tags.artist || !tags.album) {
      return { valid: false, reason: 'missing_required_tags', tags, meta };
    }
    return { valid: true, tags, meta, duration: meta.duration };
  } catch {
    return { valid: false, reason: 'unreadable' };
  }
}
