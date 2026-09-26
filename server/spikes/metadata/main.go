// S1 metadata spike: parse the corpus with github.com/dhowden/tag and dump
// everything it extracts, for comparison against the old gold dump
// (internal/audio/testdata/gold_legacy.json,
// produced by dump_v1.mjs with npm music-metadata@11.14.0).
//
// This is a throwaway spike program, not production code. It lives in its own
// Go module so the production module (github.com/miquelrosell99/sonarly/server)
// never depends on github.com/dhowden/tag.
//
// Usage: go run . <corpus-dir> > go_dhowden_dump.json
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/dhowden/tag"
)

// normalize converts arbitrary dhowden/tag Raw() values into JSON-safe data.
func normalize(v interface{}) interface{} {
	switch t := v.(type) {
	case nil, string, bool,
		int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64,
		float32, float64:
		return v
	case []string:
		return t
	case []byte:
		if len(t) == 0 {
			return ""
		}
		if isPrintableUTF8(t) {
			return string(t)
		}
		return map[string]interface{}{
			"hex":      fmt.Sprintf("%x", t),
			"numBytes": len(t),
		}
	case map[string]interface{}:
		out := make(map[string]interface{}, len(t))
		for k, val := range t {
			out[k] = normalize(val)
		}
		return out
	case []interface{}:
		out := make([]interface{}, len(t))
		for i, val := range t {
			out[i] = normalize(val)
		}
		return out
	default:
		return fmt.Sprintf("%#v", v)
	}
}

func isPrintableUTF8(b []byte) bool {
	s := string(b)
	for _, r := range s {
		if r < 0x20 && r != '\n' && r != '\t' && r != '\r' {
			return false
		}
		if r == 0xFFFD {
			return false
		}
	}
	return true
}

func parseFile(path string) (out map[string]interface{}, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("PANIC: %v", r)
		}
	}()

	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	m, err := tag.ReadFrom(f)
	if err != nil {
		return nil, err
	}

	track, trackTotal := m.Track()
	disc, discTotal := m.Disc()

	fields := map[string]interface{}{
		"fileType":    fmt.Sprintf("%v", m.FileType()),
		"format":      fmt.Sprintf("%v", m.Format()),
		"title":       m.Title(),
		"album":       m.Album(),
		"artist":      m.Artist(),
		"albumArtist": m.AlbumArtist(),
		"composer":    m.Composer(),
		"year":        m.Year(),
		"genre":       m.Genre(),
		"track":       track,
		"trackTotal":  trackTotal,
		"disc":        disc,
		"discTotal":   discTotal,
		"lyrics":      m.Lyrics(),
		"comment":     m.Comment(),
	}
	if p := m.Picture(); p != nil {
		fields["picture"] = map[string]interface{}{
			"mimeType":    p.MIMEType,
			"ext":         p.Ext,
			"type":        fmt.Sprintf("%v", p.Type),
			"description": p.Description,
			"numBytes":    len(p.Data),
		}
	} else {
		fields["picture"] = nil
	}

	raw := make(map[string]interface{}, len(m.Raw()))
	keys := make([]string, 0, len(m.Raw()))
	for k := range m.Raw() {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		raw[k] = normalize(m.Raw()[k])
	}

	return map[string]interface{}{
		"fields": fields,
		"raw":    raw,
	}, nil
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: spike <corpus-dir>")
		os.Exit(1)
	}
	dir := os.Args[1]
	entries, err := os.ReadDir(dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	out := map[string]interface{}{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".mp3") &&
			!strings.HasSuffix(e.Name(), ".flac") &&
			!strings.HasSuffix(e.Name(), ".ogg") &&
			!strings.HasSuffix(e.Name(), ".m4a") {
			continue
		}
		res, err := parseFile(filepath.Join(dir, e.Name()))
		if err != nil {
			out[e.Name()] = map[string]interface{}{"error": err.Error()}
			continue
		}
		out[e.Name()] = res
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(out)
}
