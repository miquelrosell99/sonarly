// LRC synced-lyrics parsing, ported from v1's
// packages/server/src/features/tags/lrc.ts (parseLrc) per
// docs/v2-s1-metadata-findings.md §5 W-column (row 26: synced lyrics parity
// is the LRC-in-tag path; v1's native SYLT branch is dead code against
// music-metadata@11.14.0 and intentionally not replicated).

package audio

import (
	"regexp"
	"strconv"
	"strings"
)

// SyncedLyricLine is one timestamped lyrics line. Time is in seconds, matching
// v1's SyncedLyricLine ({time, text} with time in seconds).
type SyncedLyricLine struct {
	Time float64 `json:"time"`
	Text string  `json:"text"`
}

// lrcLineRe mirrors v1's LRC_LINE_REGEX:
// ^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$
var lrcLineRe = regexp.MustCompile(`^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$`)

// parseLrc parses LRC text into synced lyric lines (v1 parseLrc port).
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
