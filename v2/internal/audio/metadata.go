// Package audio is Sonarly v2's production audio metadata reader (P4a),
// fulfilling the S1 sign-off list in docs/v2-s1-metadata-findings.md:
//
//   - tagfork: owned fork of github.com/dhowden/tag with the S1-approved
//     patches W1 (multi-value tags) and W2 (m4a rtng/tmpo), vendored at
//     v2/internal/audio/tagfork/. P9c added W3: atoms carrying several
//     `data` children (mutagen's multi-value layout) read every child
//     instead of folding the trailing children into the value as garbage
//     bytes — the tag-edit round trip depends on it.
//   - id3v1.go: W4 Latin-1 → UTF-8 shim for ID3v1-sourced strings.
//   - properties.go: W5 hand-rolled duration/bitrate/sampleRate/channels
//     reader (dhowden/tag provides tags only).
//
// ReadMetadata is the v2 entry point replacing v1's
// packages/server/src/features/tags/reader.ts (readMetadata). It never
// panics: malformed files yield a wrapped error (the scanner recovers
// per-file on top of that).
package audio

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/miquelrosell99/sonarly/v2/internal/audio/tagfork"
)

// Picture is embedded cover art (v1 CoverArtPicture: data + mime).
type Picture struct {
	Data     []byte
	MIMEType string
}

// Metadata is the v1-equivalent audio metadata schema (reader.ts
// AudioMetadata). Numeric/string zero values mean "absent" (v1's
// `?? undefined`); Explicit and Compilation use pointers because false-vs-
// absent is observable in v1 (detectExplicit / common.compilation).
type Metadata struct {
	Title        string
	Artist       string   // display artist (first tag value)
	Artists      []string // multi-value artists, v1 splitArtists applied
	Album        string
	AlbumArtist  string
	AlbumArtists []string
	TrackNo      int
	TrackTotal   int
	DiscNo       int
	DiscTotal    int
	Year         int
	Date         string // raw date string (TDRC / DATE / ©day)
	Genres       []string
	Composers    []string
	Producers    []string
	Labels       []string
	ReleaseType  string // v1 primaryReleaseType: prefers "soundtrack"
	Comment      string
	BPM          int

	MBIDRecording    string
	MBIDRelease      string
	MBIDReleaseGroup string
	MBIDAlbumArtist  string
	MBIDArtistIDs    []string

	Barcode string
	ASIN    string
	ISRCs   []string

	ReplayGainTrack float64 // dB; 0 = absent
	ReplayGainAlbum float64

	Explicit    *bool
	Compilation *bool

	Lyrics       string
	SyncedLyrics []SyncedLyricLine

	HasCoverArt bool
	Picture     *Picture

	Properties Properties
}

// ReadMetadata reads tags and stream properties for the file at path.
// Tag parsing failures are not fatal when the file is still identifiable:
// v1 returns metadata with a filename-fallback title for untagged files, so
// this does too (properties are still read). Unidentifiable/unreadable files
// return an error.
func ReadMetadata(path string) (md *Metadata, err error) {
	defer func() {
		if r := recover(); r != nil {
			md = nil
			err = fmt.Errorf("audio: panic reading %s: %v", filepath.Base(path), r)
		}
	}()

	md = &Metadata{}

	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	tm, tagErr := tagfork.ReadFrom(f)
	f.Close()

	if tagErr == nil {
		if e := md.fillTags(tm, path); e != nil {
			return nil, e
		}
	} else {
		// Untagged/undetectable tag section: keep v1's filename-fallback
		// behavior; properties below still apply.
		md.Title = filenameStem(path)
	}

	md.Properties, err = readProperties(path)
	if err != nil && tagErr != nil {
		return nil, fmt.Errorf("audio: %s: tags: %v; properties: %w", filepath.Base(path), tagErr, err)
	}
	return md, nil
}

// fillTags maps the tagfork Metadata onto the v1 schema.
func (md *Metadata) fillTags(tm tagfork.Metadata, path string) error {
	raw := tm.Raw()

	md.Title = tm.Title()
	md.Album = tm.Album()
	md.AlbumArtist = tm.AlbumArtist()
	md.TrackNo, md.TrackTotal = tm.Track()
	md.DiscNo, md.DiscTotal = tm.Disc()
	md.Year = tm.Year()
	md.Comment = strings.TrimSpace(tm.Comment())
	// USLT payloads may carry a trailing NUL terminator; mm strips it.
	md.Lyrics = strings.Trim(strings.TrimSpace(tm.Lyrics()), "\x00")
	md.BPM = findBPM(tm, raw)
	md.Date = findDate(tm, raw)
	md.Picture, md.HasCoverArt = findPicture(tm)
	md.Explicit = detectExplicit(tm, raw)
	md.Compilation = findCompilation(tm, raw)

	if md.Title == "" {
		md.Title = filenameStem(path) // v1 getFilenameFallback
	}

	switch tm.Format() {
	case tagfork.ID3v1:
		fillID3v1(md, tm)
	case tagfork.ID3v2_2, tagfork.ID3v2_3, tagfork.ID3v2_4:
		fillID3v2(md, tm, raw)
	case tagfork.VORBIS:
		// FLAC and Ogg Vorbis share the vorbis-comment raw shape.
		fillVorbis(md, raw)
	case tagfork.MP4:
		fillMP4(md, tm, raw)
	}

	// v1 reader.ts: displayArtist/albumArtists go through splitArtists.
	md.Artists = splitArtists(flattenStrings(rawArtistValues(tm, raw)))
	md.Artist = firstString(rawArtistValues(tm, raw))
	md.AlbumArtists = splitArtists(flattenStrings(rawAlbumArtistValues(tm, raw)))

	return nil
}

// ------------------------------------------------------------------ helpers

// filenameStem mirrors v1 getFilenameFallback: basename minus the extension.
func filenameStem(path string) string {
	base := filepath.Base(path)
	if ext := filepath.Ext(base); ext != "" {
		base = strings.TrimSuffix(base, ext)
	}
	return base
}

// artistSplitRe mirrors v1 ARTIST_SPLIT_REGEX:
// /\s*[,;/]\s*|\s+&\s+|\s+feat\.\s+|\s+featuring\s+|\s+ft\.\s+/i
var artistSplitRe = regexp.MustCompile(`\s*[,;/]\s*|\s+&\s*|\s+(?i:feat\.|featuring|ft\.)\s*`)

// splitArtists ports v1 splitArtists.
func splitArtists(values []string) []string {
	var out []string
	for _, value := range values {
		parts := artistSplitRe.Split(value, -1)
		kept := parts[:0]
		for _, p := range parts {
			if p = strings.TrimSpace(p); p != "" {
				kept = append(kept, p)
			}
		}
		if len(kept) > 0 {
			out = append(out, kept...)
		} else if v := strings.TrimSpace(value); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// primaryReleaseType ports v1's 3-line preference fn: multi-value
// "album; soundtrack" prefers the specific "soundtrack" marker.
func primaryReleaseType(values []string) string {
	if len(values) == 0 {
		return ""
	}
	var types []string
	for _, t := range values {
		types = append(types, strings.Split(t, ";")...)
	}
	for _, t := range types {
		if strings.ToLower(strings.TrimSpace(t)) == "soundtrack" {
			return "soundtrack"
		}
	}
	return strings.TrimSpace(types[0])
}

// rawValues normalizes a Raw() value into a string slice: string, []string,
// *tagfork.Comm (TXXX/COMM/USLT frames), *tagfork.UFID, []byte, int, bool.
func rawValues(v interface{}) []string {
	switch x := v.(type) {
	case nil:
		return nil
	case string:
		if x == "" {
			return nil
		}
		return []string{x}
	case []string:
		return x
	case *tagfork.Comm:
		if x == nil {
			return nil
		}
		return rawValues(x.Text)
	case *tagfork.UFID:
		if x == nil || x.Provider == "" {
			return nil
		}
		return []string{string(x.Identifier)}
	case []byte:
		return []string{string(x)}
	case int:
		return []string{strconv.Itoa(x)}
	case bool:
		return []string{strconv.FormatBool(x)}
	default:
		return nil
	}
}

// flattenStrings appends the values of the given raw keys in order,
// lowercased-key lookup included (vorbis Raw() is already lowercase).
func flattenForKeys(raw map[string]interface{}, keys ...string) []string {
	var out []string
	for _, k := range keys {
		if v, ok := raw[k]; ok {
			out = append(out, rawValues(v)...)
		}
	}
	return out
}

// flattenStrings filters empty strings from a value list.
func flattenStrings(values []string) []string {
	out := values[:0]
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			out = append(out, v)
		}
	}
	return out
}

func firstString(values []string) string {
	if len(values) > 0 {
		return values[0]
	}
	return ""
}

// firstForKeys returns the first non-empty value among the given keys.
func firstForKeys(raw map[string]interface{}, keys ...string) string {
	return firstString(flattenForKeys(raw, keys...))
}

// parseIntLoose parses the leading integer of a tag value ("3/12" → 3).
func parseIntLoose(s string) (int, bool) {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, "/ "); i >= 0 {
		s = s[:i]
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, false
	}
	return n, true
}

// parseReplayGain parses v1's replaygain value into dB: "-7.03 dB" → -7.03.
// Falls back to treating the value as a plain number (v1 ratio fallback).
func parseReplayGain(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	s = strings.TrimSuffix(s, "dB")
	s = strings.TrimSuffix(s, "db")
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false
	}
	return f, true
}

// pictureFrom converts a tagfork picture.
func pictureFrom(p *tagfork.Picture) *Picture {
	if p == nil {
		return nil
	}
	return &Picture{Data: p.Data, MIMEType: p.MIMEType}
}

// findPicture extracts embedded cover art (all four formats: APIC,
// FLAC PICTURE, ogg METADATA_BLOCK_PICTURE, covr).
func findPicture(tm tagfork.Metadata) (*Picture, bool) {
	p := pictureFrom(tm.Picture())
	return p, p != nil && len(p.Data) > 0
}
