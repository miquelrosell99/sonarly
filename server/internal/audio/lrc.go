// LRC synced-lyrics parsing, ported from the retired server's
// packages/server/src/features/tags/lrc.ts (parseLrc) per
// ../../../.audits/s1-metadata-findings.md §5 W-column (row 26: synced lyrics parity
// is the LRC-in-tag path; the retired native SYLT branch is dead code against
// music-metadata@11.14.0 and intentionally not replicated).

package audio

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// SyncedLyricLine is one timestamped lyrics line. Time is in seconds, matching
// the retired SyncedLyricLine shape ({time, text} with time in seconds).
type SyncedLyricLine struct {
	Time float64 `json:"time"`
	Text string  `json:"text"`
}

// lrcLineRe mirrors the retired LRC_LINE_REGEX:
// ^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$
var lrcLineRe = regexp.MustCompile(`^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$`)

// parseLrc parses LRC text into synced lyric lines (port of the old parseLrc).
func parseLrc(text string) []SyncedLyricLine {
	var lines []SyncedLyricLine
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		m := lrcLineRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		minutes, _ := strconv.Atoi(m[1])
		seconds, _ := strconv.Atoi(m[2])
		frac := m[3]
		textPart := strings.TrimSpace(m[4])
		var fracSeconds float64
		if len(frac) == 2 {
			f, _ := strconv.Atoi(frac)
			fracSeconds = float64(f) / 100
		} else {
			f, _ := strconv.Atoi(frac)
			fracSeconds = float64(f) / 1000
		}
		lines = append(lines, SyncedLyricLine{
			Time: float64(minutes*60+seconds) + fracSeconds,
			Text: textPart,
		})
	}
	return lines
}

// ParseLRC is the exported LRC parser for non-audio consumers (the LRCLIB
// lyrics proxy parses provider responses with the same semantics).
func ParseLRC(text string) []SyncedLyricLine {
	return parseLrc(text)
}

// FormatLRC renders lines back to LRC text (the inverse of ParseLRC,
// mirroring serialize_lrc in the mutagen writer script). Used by the lyrics
// endpoints, which carry synced lyrics as LRC text on the wire. Rounding a
// line's centisecond fraction up to the next second mirrors the python
// f'{cs:02d}' carry (e.g. 59.995 -> "[01:00.00]"), keeping the round trip
// stable for values the parser produced.
func FormatLRC(lines []SyncedLyricLine) string {
	var b strings.Builder
	for i, line := range lines {
		if i > 0 {
			b.WriteByte('\n')
		}
		totalCentis := int64(line.Time*100 + 0.5)
		minutes := totalCentis / 6000
		rem := totalCentis % 6000
		seconds := rem / 100
		centis := rem % 100
		fmt.Fprintf(&b, "[%02d:%02d.%02d] %s", minutes, seconds, centis, line.Text)
	}
	return b.String()
}
