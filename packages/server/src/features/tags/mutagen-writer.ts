import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import type { TagWriter, CoverArtData } from './writer.js';
import type { SongTags } from '@sonarly/shared';
import { atomicTagRewrite } from './atomic.js';

const SUPPORTED = new Set(['.mp3', '.flac', '.ogg', '.m4a', '.mp4']);

const MUTAGEN_SCRIPT = `
import sys, json, base64

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

def serialize_lrc(synced):
    def fmt(t):
        m = int(t // 60)
        s = int(t % 60)
        cs = int(round((t % 1) * 100))
        return f'{m:02d}:{s:02d}.{cs:02d}'
    return '\\n'.join([f'[{fmt(item["time"])}] {item["text"]}' for item in synced])

def normalize_values(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if v is not None and str(v).strip() != '']
    s = str(value).strip()
    return [s] if s != '' else []

def write_tags(path, tags):
    ext = path.lower().rsplit('.', 1)[-1] if '.' in path else ''
    explicit = tags.get('explicit')
    lyrics = tags.get('lyrics')
    synced_lyrics = tags.get('syncedLyrics')

    if ext == 'mp3':
        from mutagen.mp3 import MP3
        from mutagen.easyid3 import EasyID3
        from mutagen.id3 import ID3, TXXX, USLT, SYLT
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
            values = normalize_values(tags.get(our_key))
            if not values:
                continue
            if mutagen_key in ('tracknumber', 'discnumber'):
                pair = parse_num_pair(values[0])
                if pair is None:
                    continue
                audio.tags[mutagen_key] = f'{pair[0]}/{pair[1]}' if pair[1] else str(pair[0])
            else:
                audio.tags[mutagen_key] = values if len(values) > 1 else values[0]
        audio.save()

        # EasyID3 does not support custom TXXX frames or lyrics; write via raw ID3.
        id3 = ID3(path)
        if explicit is not None:
            id3['TXXX:ITUNESADVISORY'] = TXXX(encoding=0, desc='ITUNESADVISORY', text='1' if explicit else '0')
        if lyrics:
            id3['USLT:eng:'] = USLT(encoding=3, lang='eng', desc='', text=lyrics)
        if synced_lyrics:
            items = [(int(item['time'] * 1000), item['text']) for item in synced_lyrics]
            id3['SYLT'] = SYLT(encoding=3, lang='eng', format=2, type=1, text=items)
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
            values = normalize_values(tags.get(our_key))
            if not values:
                continue
            if mutagen_key in ('TRACKNUMBER', 'DISCNUMBER'):
                pair = parse_num_pair(values[0])
                if pair is None:
                    continue
                audio.tags[mutagen_key] = f'{pair[0]}/{pair[1]}' if pair[1] else str(pair[0])
            else:
                audio.tags[mutagen_key] = values
        if explicit is not None:
            audio.tags['ITUNESADVISORY'] = '1' if explicit else '0'
        if lyrics:
            audio.tags['LYRICS'] = lyrics
        if synced_lyrics:
            audio.tags['SYNCEDLYRICS'] = serialize_lrc(synced_lyrics)
        audio.save()

    elif ext in ('m4a', 'mp4'):
        from mutagen.mp4 import MP4
        audio = MP4(path)
        key_map = {
            'title': '\\xa9nam',
            'artist': '\\xa9ART',
            'album': '\\xa9alb',
            'albumArtist': 'aART',
            'trackNumber': 'trkn',
            'discNumber': 'disk',
            'genre': '\\xa9gen',
            'year': '\\xa9day',
        }
        for our_key, mutagen_key in key_map.items():
            values = normalize_values(tags.get(our_key))
            if not values:
                continue
            if mutagen_key in ('trkn', 'disk'):
                pair = parse_num_pair(values[0])
                if pair is None:
                    continue
                audio[mutagen_key] = [pair]
            else:
                audio[mutagen_key] = values
        if explicit is not None:
            audio['rtng'] = [(1 if explicit else 0)]
        if lyrics:
            audio['\\xa9lyr'] = [lyrics]
        if synced_lyrics:
            audio['----:com.sonarl:y:syncedLyrics'] = serialize_lrc(synced_lyrics).encode('utf-8')
        audio.save()

    else:
        raise ValueError(f"Unsupported extension: {ext}")

def write_cover_art(path, data_b64, format):
    data = base64.b64decode(data_b64)
    ext = path.lower().rsplit('.', 1)[-1] if '.' in path else ''

    if ext == 'mp3':
        from mutagen.mp3 import MP3
        from mutagen.id3 import ID3, APIC
        audio = MP3(path)
        if audio.tags is None:
            audio.add_tags()
        # Replace any existing APIC frames.
        audio.tags['APIC'] = APIC(encoding=3, mime=format, type=3, desc='Cover', data=data)
        audio.save()

    elif ext == 'flac':
        from mutagen.flac import FLAC, Picture
        audio = FLAC(path)
        audio.clear_pictures()
        pic = Picture()
        pic.type = 3
        pic.mime = format
        pic.desc = 'Cover'
        pic.data = data
        audio.add_picture(pic)
        audio.save()

    elif ext == 'ogg':
        from mutagen.oggvorbis import OggVorbis
        from mutagen.flac import Picture
        audio = OggVorbis(path)
        audio['METADATA_BLOCK_PICTURE'] = []
        pic = Picture()
        pic.type = 3
        pic.mime = format
        pic.desc = 'Cover'
        pic.data = data
        audio['METADATA_BLOCK_PICTURE'] = [pic.write()]
        audio.save()

    elif ext in ('m4a', 'mp4'):
        from mutagen.mp4 import MP4
        audio = MP4(path)
        audio['covr'] = [data]
        audio.save()

    else:
        raise ValueError(f"Unsupported extension: {ext}")

if __name__ == '__main__':
    data = json.load(sys.stdin)
    path = data['path']
    if 'tags' in data:
        write_tags(path, data['tags'])
    elif 'coverArt' in data:
        write_cover_art(path, data['coverArt']['data'], data['coverArt']['format'])
    else:
        raise ValueError('No tags or coverArt provided')
`;

export class MutagenWriter implements TagWriter {
  supports(path: string): boolean {
    return SUPPORTED.has(extname(path).toLowerCase());
  }

  async write(path: string, tags: SongTags): Promise<void> {
    await atomicTagRewrite(path, async (tmpPath) => {
      await runMutagen(tmpPath, { tags });
    });
  }

  async writeCoverArt(path: string, coverArt: CoverArtData): Promise<void> {
    await atomicTagRewrite(path, async (tmpPath) => {
      await runMutagen(tmpPath, {
        coverArt: {
          data: coverArt.data.toString('base64'),
          format: coverArt.format,
        },
      });
    });
  }
}

interface MutagenPayload {
  tags?: SongTags;
  coverArt?: { data: string; format: string };
}

function runMutagen(path: string, payload: MutagenPayload): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-c', MUTAGEN_SCRIPT]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Mutagen failed (${code}): ${stderr.trim()}`));
    });
    proc.stdin.write(JSON.stringify({ path, ...payload }));
    proc.stdin.end();
  });
}
