// W4 shim per docs/s1-metadata-findings.md §5: ID3v1 text fields are
// Latin-1, and tagfork (like upstream dhowden/tag) returns the raw bytes as a
// Go string without re-encoding. The retired music-metadata reader decodes
// ID3v1 as Latin-1, so old rips showed matching text there and mojibake in the unshimmed
// fork. Apply this only to ID3v1-sourced strings.

package audio

import "unicode/utf8"

// decodeID3v1Latin1 converts a raw ID3v1 string to UTF-8. Strings that are
// already valid UTF-8 (non-conformant but common in the wild) pass through
// untouched; every other byte is mapped to its Latin-1 code point
// (bytes < 0x80 map to themselves).
func decodeID3v1Latin1(s string) string {
	if utf8.ValidString(s) {
		return s
	}
	r := make([]rune, len(s))
	for i := 0; i < len(s); i++ {
		b := s[i]
		if b < 0x80 {
			r[i] = rune(b)
		} else {
			r[i] = rune(b) // Latin-1 high byte → same code point
		}
	}
	return string(r)
}
