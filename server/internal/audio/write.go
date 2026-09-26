// Tag writing (P9c): the Go counterpart of the retired server's features/tags/
// mutagen-writer.ts + atomic.ts. It shelled out to python3 + mutagen (the
// only mature multi-format tag writer the fleet already ships); this package ports
// that approach verbatim behind a TagWriter interface so a pure-Go writer
// (e.g. an extended tagfork) can replace it without touching call sites.
//
// The writer runs python3 with an inline script (constant argv, no shell),
// passes the payload as stdin JSON, enforces a 60s timeout with SIGKILL, and
// rewrites the file atomically: copy to a hidden temp sibling, mutate the
// copy, fsync, rename over the original, unlink the temp on failure — a
// crashed write can never leave a half-tagged file at the song's path.
package audio

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// SongTags is the tag-edit payload (old shared SongTags). A nil field means
// "absent": the writer leaves that tag untouched, mirroring the old
// `tags.get(our_key)` skip. String-or-string[] old values are always
// normalized to a list by the validation layer before they reach the writer.
type SongTags struct {
	Title        *string           `json:"title,omitempty"`
	Artist       []string          `json:"artist,omitempty"`
	Album        *string           `json:"album,omitempty"`
	AlbumArtist  []string          `json:"albumArtist,omitempty"`
	TrackNumber  *int              `json:"trackNumber,omitempty"`
	DiscNumber   *int              `json:"discNumber,omitempty"`
	Genre        []string          `json:"genre,omitempty"`
	Year         *int              `json:"year,omitempty"`
	Explicit     *bool             `json:"explicit,omitempty"`
	Lyrics       *string           `json:"lyrics,omitempty"`
	SyncedLyrics []SyncedLyricLine `json:"syncedLyrics,omitempty"`
}

// TagWriter writes tags into an audio file. Implementations must be atomic
// per file: either the whole tag set lands or the file is untouched.
type TagWriter interface {
	// Supports reports whether the writer can tag a file at path.
	Supports(path string) bool
	// Write applies the non-nil fields of tags to the file at path.
	Write(ctx context.Context, path string, tags SongTags) error
}

// ErrNoTagWriter is returned by WriteTags when no registered writer supports
// the file's extension (old "No tag writer for ...").
var ErrNoTagWriter = errors.New("no tag writer for file")

// mutagenSupported mirrors the old MutagenWriter.SUPPORTED.
var mutagenSupported = map[string]bool{
	".mp3": true, ".flac": true, ".ogg": true, ".m4a": true, ".mp4": true,
}

const mutagenTimeout = 60 * time.Second

// MutagenWriter is the python3 + mutagen TagWriter (old MutagenWriter).
type MutagenWriter struct {
	// python is the interpreter path ("python3" resolves via PATH, as before).
	python string
	// now is replaceable in tests.
	now func() time.Time
}

// NewMutagenWriter constructs the writer with the old defaults.
func NewMutagenWriter() *MutagenWriter {
	return &MutagenWriter{python: "python3", now: time.Now}
}

func (w *MutagenWriter) Supports(path string) bool {
	return mutagenSupported[filepath.Ext(path)]
}

// Write applies tags through an atomic temp-sibling rewrite (old
// atomicTagRewrite): copy, tag the copy, fsync, rename over the original.
func (w *MutagenWriter) Write(ctx context.Context, path string, tags SongTags) error {
	return atomicTagRewrite(path, w.now, func(tmpPath string) error {
		return w.run(ctx, tmpPath, tags)
	})
}

// run spawns python3 with the inline script, feeding {"path": ..., "tags":
// ...} on stdin (old runMutagen). A hung interpreter is SIGKILLed after
// mutagenTimeout; stderr is captured for the error message.
func (w *MutagenWriter) run(ctx context.Context, path string, tags SongTags) error {
	payload, err := json.Marshal(map[string]any{"path": path, "tags": tags})
	if err != nil {
		return fmt.Errorf("marshal mutagen payload: %w", err)
	}
	ctx, cancel := context.WithTimeout(ctx, mutagenTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, w.python, "-c", mutagenScript)
	cmd.Stdin = bytes.NewReader(payload)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("mutagen timed out after %s", mutagenTimeout)
		}
		msg := stderr.String()
		if len(msg) > 500 {
			msg = msg[:500]
		}
		return fmt.Errorf("mutagen failed: %v: %s", err, msg)
	}
	return nil
}

// atomicTagRewrite ports the old atomicTagRewrite: copy originalPath to a
// hidden temp sibling, mutate the temp, fsync it, then rename over the
// original. The temp is removed on any failure, leaving the original intact.
func atomicTagRewrite(originalPath string, now func() time.Time, mutate func(tmpPath string) error) error {
	var random [4]byte
	if _, err := rand.Read(random[:]); err != nil {
		return err
	}
	tmpPath := filepath.Join(
		filepath.Dir(originalPath),
		fmt.Sprintf(".sonarly-tmp-%d-%s%s", now().UnixNano(), hex.EncodeToString(random[:]), filepath.Ext(originalPath)),
	)
	if err := copyFilePreserveMode(originalPath, tmpPath); err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(tmpPath)
		}
	}()
	if err := mutate(tmpPath); err != nil {
		return err
	}
	fh, err := os.OpenFile(tmpPath, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	if err := fh.Sync(); err != nil {
		_ = fh.Close()
		return err
	}
	if err := fh.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, originalPath); err != nil {
		return err
	}
	committed = true
	return nil
}

func copyFilePreserveMode(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, info.Mode().Perm())
}

// WriteTags writes tags with the first registered writer supporting path.
// It is the package-level convenience for callers that do not inject a
// writer (old writeTags).
func WriteTags(ctx context.Context, path string, tags SongTags) error {
	w := &MutagenWriter{python: "python3", now: time.Now}
	if !w.Supports(path) {
		return fmt.Errorf("%w: %s", ErrNoTagWriter, path)
	}
	return w.Write(ctx, path, tags)
}

// ---------------------------------------------------------------------------
// Inline python script (old MUTAGEN_SCRIPT, verbatim port)
// ---------------------------------------------------------------------------

const mutagenScript = `
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
    return '\n'.join([f'[{fmt(item["time"])}] {item["text"]}' for item in synced])

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
            audio['\xa9lyr'] = [lyrics]
        if synced_lyrics:
            audio['----:com.sonarl:y:syncedLyrics'] = serialize_lrc(synced_lyrics).encode('utf-8')
        audio.save()

    else:
        raise ValueError(f"Unsupported extension: {ext}")

if __name__ == '__main__':
    data = json.load(sys.stdin)
    if 'tags' not in data:
        raise ValueError('No tags provided')
    write_tags(data['path'], data['tags'])
`
