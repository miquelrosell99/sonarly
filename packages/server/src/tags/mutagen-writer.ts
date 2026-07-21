import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import type { TagWriter } from './writer.js';
import type { SongTags } from '@sonarly/shared';
import { atomicTagRewrite } from './atomic.js';

const SUPPORTED = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.mp4']);

const MUTAGEN_SCRIPT = `
import sys, json
from mutagen import File

data = json.load(sys.stdin)
path = data['path']
tags = data['tags']

f = File(path)
if f is None:
    raise ValueError(f"Mutagen cannot open {path}")

key_map = {
    'title': 'title',
    'artist': 'artist',
    'album': 'album',
    'albumArtist': 'albumartist',
    'trackNumber': 'tracknumber',
    'discNumber': 'discnumber',
    'genre': 'genre',
    'year': 'date',
}

for our_key, mutagen_key in key_map.items():
    value = tags.get(our_key)
    if value is not None and value != '':
        f[mutagen_key] = str(value)

f.save()
`;

export class MutagenWriter implements TagWriter {
  supports(path: string): boolean {
    return SUPPORTED.has(extname(path).toLowerCase());
  }

  async write(path: string, tags: SongTags): Promise<void> {
    await atomicTagRewrite(path, async (tmpPath) => {
      await runMutagen(tmpPath, tags);
    });
  }
}

function runMutagen(path: string, tags: SongTags): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-c', MUTAGEN_SCRIPT]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Mutagen failed (${code}): ${stderr.trim()}`));
    });
    proc.stdin.write(JSON.stringify({ path, tags }));
    proc.stdin.end();
  });
}
