import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import type { TagWriter } from './writer.js';
import type { SongTags } from '@sonarly/shared';
import { atomicTagRewrite } from './atomic.js';

const SUPPORTED = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.mp4']);

const MUTAGEN_SCRIPT = `
import sys, json

def parse_num_pair(value):
    if value is None or value == '':
        return None
    s = str(value).strip()
    if '/' in s:
        parts = s.split('/')
        try:
            return (int(parts[0]), int(parts[1]))
        except (ValueError, IndexError):
            return None
    try:
        return (int(s), 0)
    except ValueError:
        return None

def write_tags(path, tags):
    ext = path.lower().rsplit('.', 1)[-1] if '.' in path else ''
    explicit = tags.get('explicit')

    if ext == 'mp3':
        from mutagen.mp3 import MP3
        from mutagen.easyid3 import EasyID3
        from mutagen.id3 import ID3, TXXX
        audio = MP3(path, ID3=EasyID3)
        if audio.tags is None:
            audio.add_tags(EasyID3)
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
            if value is None or value == '':
                continue
            if mutagen_key in ('tracknumber', 'discnumber'):
                pair = parse_num_pair(value)
                if pair is None:
                    continue
                audio.tags[mutagen_key] = f'{pair[0]}/{pair[1]}' if pair[1] else str(pair[0])
            else:
                audio.tags[mutagen_key] = str(value)
        audio.save()

        # EasyID3 does not support custom TXXX frames; write explicit via raw ID3.
        if explicit is not None:
            id3 = ID3(path)
            id3['TXXX:ITUNESADVISORY'] = TXXX(encoding=0, desc='ITUNESADVISORY', text='1' if explicit else '0')
            id3.save()

    elif ext in ('flac', 'ogg'):
        from mutagen.flac import FLAC
        from mutagen.oggvorbis import OggVorbis
        cls = FLAC if ext == 'flac' else OggVorbis
        audio = cls(path)
        if audio.tags is None:
            audio.add_tags()
        key_map = {
            'title': 'TITLE',
            'artist': 'ARTIST',
            'album': 'ALBUM',
            'albumArtist': 'ALBUMARTIST',
            'trackNumber': 'TRACKNUMBER',
            'discNumber': 'DISCNUMBER',
            'genre': 'GENRE',
            'year': 'DATE',
        }
        for our_key, mutagen_key in key_map.items():
            value = tags.get(our_key)
            if value is None or value == '':
                continue
            if mutagen_key in ('TRACKNUMBER', 'DISCNUMBER'):
                pair = parse_num_pair(value)
                if pair is None:
                    continue
                audio.tags[mutagen_key] = f'{pair[0]}/{pair[1]}' if pair[1] else str(pair[0])
            else:
                audio.tags[mutagen_key] = str(value)
        if explicit is not None:
            audio.tags['ITUNESADVISORY'] = '1' if explicit else '0'
        audio.save()

    elif ext in ('m4a', 'mp4'):
        from mutagen.mp4 import MP4
        audio = MP4(path)
        key_map = {
            'title': '\xa9nam',
            'artist': '\xa9ART',
            'album': '\xa9alb',
            'albumArtist': 'aART',
            'trackNumber': 'trkn',
            'discNumber': 'disk',
            'genre': '\xa9gen',
            'year': '\xa9day',
        }
        for our_key, mutagen_key in key_map.items():
            value = tags.get(our_key)
            if value is None or value == '':
                continue
            if mutagen_key in ('trkn', 'disk'):
                pair = parse_num_pair(value)
                if pair is None:
                    continue
                audio[mutagen_key] = [pair]
            else:
                audio[mutagen_key] = [str(value)]
        if explicit is not None:
            audio['rtng'] = [(1 if explicit else 0)]
        audio.save()

    else:
        raise ValueError(f"Unsupported extension: {ext}")

if __name__ == '__main__':
    data = json.load(sys.stdin)
    write_tags(data['path'], data['tags'])
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
