// S2 streaming spike — NOT part of the production build (own go module).
// Ports v1 semantics from packages/server/src/features/transcode/service.ts
// (main checkout, post ff4a1ec clamp) and .../opensubsonic/routes/retrieval.ts.
package main

import (
	"math"
	"path/filepath"
	"strconv"
	"strings"
)

// ---------------------------------------------------------------------------
// Transcode decision (port of v1 transcode/service.ts)
// ---------------------------------------------------------------------------

type TranscodeDecision struct {
	ShouldTranscode bool
	Format          string // "mp3" | "aac" | "opus"; "" when ShouldTranscode is false
	MaxBitrateKbps  int    // 0 = codec default (v1 passes -q:a 2 instead of -b:a)
}

var formatToCodec = map[string]string{"mp3": "libmp3lame", "aac": "aac", "opus": "libopus"}
var formatToMime = map[string]string{"mp3": "audio/mpeg", "aac": "audio/aac", "opus": "audio/opus"}

type SongInfo struct {
	FilePath string
	BitRate  int // bits per second as stored in songs.bit_rate; 0 = unknown
}

type UserTranscodePrefs struct {
	MaxBitrateKbps  int    // 0 = unset
	TranscodeFormat string // "" = unset
}

// parseMaxBitRate ports v1: integer 64..10000, anything else ignored.
// v1 uses Number(): whitespace is trimmed, "1e2" is honored (100), hex
// ("0x40" = 64) is honored. This port trims and accepts exponents but rejects
// hex — the one intentional nano-delta (no Subsonic client sends hex).
func parseMaxBitRate(value string) (int, bool) {
	f, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || f != math.Trunc(f) || f < 64 || f > 10000 {
		return 0, false
	}
	return int(f), true
}

func sourceBitrateKbps(s SongInfo) (int, bool) {
	if s.BitRate > 0 {
		return int(math.Round(float64(s.BitRate) / 1000)), true
	}
	return 0, false
}

// decideTranscode ports v1 (post-clamp): the requested bitrate is a
// preference, the user cap a hard ceiling — effective = min(requested, userCap).
func decideTranscode(song SongInfo, user *UserTranscodePrefs, requested int, hasRequested bool) TranscodeDecision {
	var userCap int
	targetFormat := ""
	if user != nil {
		userCap = user.MaxBitrateKbps
		targetFormat = user.TranscodeFormat
	}

	effective := userCap
	switch {
	case hasRequested && userCap != 0 && requested < userCap:
		effective = requested
	case hasRequested && userCap == 0:
		effective = requested
	}

	if effective == 0 && targetFormat == "" {
		return TranscodeDecision{}
	}

	if targetFormat != "" {
		// v1 compares the raw file SUFFIX to the target format — preserved
		// verbatim, including the m4a-vs-aac "mismatch" quirk.
		sourceSuffix := strings.ToLower(filepath.Base(song.FilePath))
		if i := strings.LastIndex(sourceSuffix, "."); i >= 0 {
			sourceSuffix = sourceSuffix[i+1:]
		}
		if sourceSuffix != targetFormat {
			return TranscodeDecision{ShouldTranscode: true, Format: targetFormat, MaxBitrateKbps: effective}
		}
	}

	if effective != 0 {
		sourceKbps, ok := sourceBitrateKbps(song)
		if !ok || sourceKbps > effective {
			format := targetFormat
			if format == "" {
				format = inferFormat(song.FilePath)
			}
			return TranscodeDecision{ShouldTranscode: true, Format: format, MaxBitrateKbps: effective}
		}
	}

	return TranscodeDecision{}
}

// inferFormat ports v1's mime-based inference by extension outcome:
// m4a/aac/mp4 → aac; "opus" extension → opus (v1 mime-types maps .opus to
// audio/ogg! so .opus infers opus ONLY via the lookup chain... see findings);
// everything else (incl. ogg, flac, wav) → mp3.
func inferFormat(filePath string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	switch ext {
	case "aac", "m4a", "mp4":
		return "aac"
	case "opus":
		// v1: mime-types maps .opus → audio/ogg, NOT audio/opus, so v1 infers
		// mp3 for .opus files too. Preserved verbatim (quirk).
		return "mp3"
	default:
		return "mp3"
	}
}

func transcodeContentType(format string) string { return formatToMime[format] }

// ---------------------------------------------------------------------------
// Range parsing (port of v1 retrieval.ts parseRange — single-range only)
// ---------------------------------------------------------------------------

type byteRange struct{ start, end int64 }

// parseRangeV1 ports v1 semantics exactly: multi-range → invalid (v1 answers
// 416), suffix "bytes=-N", open-ended "bytes=N-", end clamped to size-1.
func parseRangeV1(header string, size int64) (byteRange, bool) {
	var r byteRange
	if !strings.HasPrefix(header, "bytes=") {
		return r, false
	}
	spec := strings.TrimPrefix(header, "bytes=")
	if strings.Contains(spec, ",") {
		return r, false // multi-range unsupported in v1
	}
	if strings.HasPrefix(spec, "-") {
		// v1 parseInt trims whitespace; strconv.ParseInt does not → trim.
		suffix, err := strconv.ParseInt(strings.TrimSpace(spec[1:]), 10, 64)
		if err != nil || suffix <= 0 {
			return r, false
		}
		start := size - suffix
		if start < 0 {
			start = 0
		}
		return byteRange{start, size - 1}, true
	}
	parts := strings.Split(spec, "-")
	if len(parts) != 2 {
		return r, false
	}
	start, err := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 64)
	if err != nil || start < 0 || start >= size {
		return r, false
	}
	var end int64
	if parts[1] == "" {
		end = size - 1
	} else {
		end, err = strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
		if err != nil || end < start {
			return r, false
		}
	}
	if end > size-1 {
		end = size - 1
	}
	return byteRange{start, end}, true
}
