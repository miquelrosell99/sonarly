// ID3v1/v2 extraction for the ReadMetadata facade: maps tagfork raw frames
// onto the native schema, plus the detectExplicit port (reader.ts). mp3
// producers are intentionally NOT extracted: the retired reader dropped v2.4
// TIPL producers too (music-metadata maps only v2.3 IPLS), so doing nothing
// is parity (docs/s1-metadata-findings.md §5 W3).

package audio

import (
	"sort"
	"strconv"
	"strings"

	"github.com/miquelrosell99/sonarly/server/internal/audio/tagfork"
)

// txxxFrames returns the TXXX (v2.3/4) / TXX (v2.2) frames in file order.
// tagfork renames repeated frames TXXX, TXXX_0, TXXX_1, ... (upstream
// behavior, kept).
func txxxFrames(raw map[string]interface{}) []*tagfork.Comm {
	type indexed struct {
		idx int
		c   *tagfork.Comm
	}
	var frames []indexed
	for k, v := range raw {
		var idx int
		switch {
		case k == "TXXX" || k == "TXX":
			idx = -1
		case strings.HasPrefix(k, "TXXX_"):
			idx = atoiDefault(k[len("TXXX_"):], -2)
		case strings.HasPrefix(k, "TXX_"):
			idx = atoiDefault(k[len("TXX_"):], -2)
		default:
			continue
		}
		c, ok := v.(*tagfork.Comm)
		if !ok {
			continue
		}
		frames = append(frames, indexed{idx, c})
	}
	sort.Slice(frames, func(i, j int) bool { return frames[i].idx < frames[j].idx })
	out := make([]*tagfork.Comm, len(frames))
	for i, f := range frames {
		out[i] = f.c
	}
	return out
}

func atoiDefault(s string, def int) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return def
}

// txxxValues collects the values of every TXXX frame with the given
// description, in file order. Multi-value frames are NUL-separated, and
// music-metadata additionally splits a single value on ';' — both splits
// are applied so MBID lists match the retired reader (P10: it stored
// ["id1,id2"] from one "id1;id2" TXXX while the Go port kept the joined string).
func txxxValues(raw map[string]interface{}, desc string) []string {
	var out []string
	seen := map[string]bool{}
	add := func(v string) {
		v = strings.TrimSpace(v)
		if v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	for _, c := range txxxFrames(raw) {
		if !strings.EqualFold(c.Description, desc) {
			continue
		}
		for _, p := range strings.Split(c.Text, "\x00") {
			for _, q := range strings.Split(p, ";") {
				add(q)
			}
		}
	}
	return out
}

// fillID3v2 maps ID3v2 raw frames onto md.
func fillID3v2(md *Metadata, tm tagfork.Metadata, raw map[string]interface{}) {
	md.Genres = flattenForKeys(raw, "TCON", "TCO")
	md.Composers = flattenForKeys(raw, "TCOM", "TCM")
	md.Labels = flattenForKeys(raw, "TPUB", "TPB")
	md.ISRCs = flattenForKeys(raw, "TSRC", "TRC")

	// Recording MBID from the MusicBrainz UFID frame.
	if u, ok := raw["UFID"].(*tagfork.UFID); ok && u != nil &&
		strings.Contains(u.Provider, "musicbrainz.org") {
		md.MBIDRecording = string(u.Identifier)
	}
	md.MBIDRelease = firstString(txxxValues(raw, "MusicBrainz Album Id"))
	md.MBIDReleaseGroup = firstString(txxxValues(raw, "MusicBrainz Release Group Id"))
	md.MBIDAlbumArtist = firstString(txxxValues(raw, "MusicBrainz Album Artist Id"))
	md.MBIDArtistIDs = txxxValues(raw, "MusicBrainz Artist Id")

	md.Barcode = firstString(txxxValues(raw, "BARCODE"))
	md.ASIN = firstString(txxxValues(raw, "ASIN"))
	md.ReleaseType = primaryReleaseType(txxxValues(raw, "MusicBrainz Album Type"))

	if v, ok := parseReplayGain(firstString(txxxValues(raw, "replaygain_track_gain"))); ok {
		md.ReplayGainTrack = v
	}
	if v, ok := parseReplayGain(firstString(txxxValues(raw, "replaygain_album_gain"))); ok {
		md.ReplayGainAlbum = v
	}

	// Synced lyrics via LRC-in-TXXX (S1 row 26; the native SYLT branch in the
// retired reader
	// is dead code and intentionally not replicated).
	for _, c := range txxxFrames(raw) {
		desc := strings.ToUpper(c.Description)
		if strings.Contains(desc, "SYNCEDLYRICS") || strings.Contains(desc, "SYNCED_LYRICS") {
			if lines := parseLrc(c.Text); len(lines) > 0 {
				md.SyncedLyrics = lines
				break
			}
		}
	}
}

// fillID3v1 maps ID3v1 fields, applying the W4 Latin-1 shim to every
// ID3v1-sourced string.
func fillID3v1(md *Metadata, tm tagfork.Metadata) {
	raw := tm.Raw()
	decode := decodeID3v1Latin1

	md.Title = decode(tm.Title())
	md.Album = decode(tm.Album())
	md.Comment = strings.TrimSpace(decode(tm.Comment()))
	for _, g := range flattenForKeys(raw, "genre") {
		if d := decode(g); d != "" {
			md.Genres = append(md.Genres, d)
		}
	}
}

// detectExplicit ports reader.ts detectExplicit (per-format rules):
//   - ID3v2: TXXX:ITUNESADVISORY / TXXX:ITUNES_ADVISORY value "1"
//   - vorbis: ITUNESADVISORY / ADVISORY comment value "1"
//   - MP4: rtng atom (iTunes rating) value 1 (W2 patch exposes it)
//
// A present-but-clean marker yields *false; absence yields nil (the retired
// reader's
// boolean | undefined).
func detectExplicit(tm tagfork.Metadata, raw map[string]interface{}) *bool {
	explicit := func(on bool) *bool { return &on }

	switch tm.Format() {
	case tagfork.ID3v2_2, tagfork.ID3v2_3, tagfork.ID3v2_4:
		for _, c := range txxxFrames(raw) {
			desc := strings.ToUpper(c.Description)
			if desc == "ITUNESADVISORY" || desc == "ITUNES_ADVISORY" {
				return explicit(strings.TrimSpace(strings.Split(c.Text, "\x00")[0]) == "1")
			}
		}
	case tagfork.VORBIS:
		for _, k := range []string{"itunesadvisory", "advisory"} {
			if v, ok := raw[k]; ok {
				vals := rawValues(v)
				if len(vals) > 0 {
					return explicit(strings.TrimSpace(vals[0]) == "1")
				}
			}
		}
	case tagfork.MP4:
		// mp4 Raw() keys are atom names; rtng is exposed by the W2 patch.
		if v, ok := raw["rtng"]; ok {
			vals := rawValues(v)
			if len(vals) > 0 {
				return explicit(strings.TrimSpace(vals[0]) == "1")
			}
		}
	}
	return nil
}

// rawArtistValues returns the raw (pre-splitArtists) artist values.
func rawArtistValues(tm tagfork.Metadata, raw map[string]interface{}) []string {
	switch tm.Format() {
	case tagfork.ID3v1:
		// W4: ID3v1 strings are Latin-1.
		if v := decodeID3v1Latin1(tm.Artist()); v != "" {
			return []string{v}
		}
		return nil
	case tagfork.VORBIS:
		return flattenForKeys(raw, "artist")
	case tagfork.MP4:
		// Raw() keys are atom names (©art/©ART both map to artist).
		return flattenForKeys(raw, "\xa9ART", "\xa9art")
	default:
		return flattenForKeys(raw, "TPE1", "TP1")
	}
}

// rawAlbumArtistValues returns the raw album-artist values.
func rawAlbumArtistValues(tm tagfork.Metadata, raw map[string]interface{}) []string {
	switch tm.Format() {
	case tagfork.VORBIS:
		return flattenForKeys(raw, "albumartist")
	case tagfork.MP4:
		return flattenForKeys(raw, "aART")
	default:
		return flattenForKeys(raw, "TPE2", "TP2")
	}
}

// findBPM extracts bpm per format: TBPM (id3), bpm (vorbis), tmpo (mp4, W2).
// mp4 Raw() keys are atom names.
func findBPM(tm tagfork.Metadata, raw map[string]interface{}) int {
	var v string
	switch tm.Format() {
	case tagfork.VORBIS:
		v = firstForKeys(raw, "bpm")
	case tagfork.MP4:
		if n, ok := raw["tmpo"].(int); ok {
			return n
		}
		return 0
	default:
		v = firstForKeys(raw, "TBPM", "TBP")
	}
	n, _ := parseIntLoose(v)
	return n
}

// findDate extracts the raw date string per format (©day/mp4, TDRC/id3,
// date/vorbis, year/id3v1). mp4 Raw() keys are atom names.
func findDate(tm tagfork.Metadata, raw map[string]interface{}) string {
	switch tm.Format() {
	case tagfork.ID3v1:
		return firstForKeys(raw, "year")
	case tagfork.VORBIS:
		return firstForKeys(raw, "date", "year")
	case tagfork.MP4:
		return firstForKeys(raw, "\xa9day")
	default:
		if v := firstForKeys(raw, "TDRC"); v != "" {
			return v
		}
		return firstForKeys(raw, "TYER", "TYE")
	}
}

// findCompilation extracts the compilation flag: cpil (mp4) or TCMP (id3).
func findCompilation(tm tagfork.Metadata, raw map[string]interface{}) *bool {
	truthy := func(s string) *bool {
		b := s == "1" || strings.EqualFold(s, "true")
		return &b
	}
	switch tm.Format() {
	case tagfork.MP4:
		if v, ok := raw["cpil"]; ok {
			if vals := rawValues(v); len(vals) > 0 {
				return truthy(vals[0])
			}
		}
	case tagfork.ID3v2_2, tagfork.ID3v2_3, tagfork.ID3v2_4:
		if v := firstForKeys(raw, "TCMP"); v != "" {
			return truthy(strings.TrimSpace(v))
		}
	}
	return nil
}
