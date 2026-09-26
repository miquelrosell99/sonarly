package playback

import (
	"math"
	"path/filepath"
	"strconv"
	"strings"
)

// ---------------------------------------------------------------------------
// Transcode decision (port of the retired server features/transcode/service.ts, post-ff4a1ec
// min(requested, userCap) clamp; semantics frozen by the S2 spike, see
// ../../../.audits/s2-streaming-findings.md §2/§8)
// ---------------------------------------------------------------------------

// TranscodeDecision is the outcome of DecideTranscode: either direct serving
// (zero value) or a transcode to Format at MaxBitrateKbps (0 = codec default,
// ffmpeg gets -q:a 2 instead of -b:a, wire parity).
type TranscodeDecision struct {
	ShouldTranscode bool
	Format          string // "mp3" | "aac" | "opus"; "" when ShouldTranscode is false
	MaxBitrateKbps  int    // 0 = codec default (old passes -q:a 2 instead of -b:a)
}

var formatToCodec = map[string]string{"mp3": "libmp3lame", "aac": "aac", "opus": "libopus"}
var formatToMime = map[string]string{"mp3": "audio/mpeg", "aac": "audio/aac", "opus": "audio/opus"}

// SongInfo is the slice of the songs row the decision needs. BitRate is the
// raw bits-per-second stored in songs.bit_rate; 0 (NULL) means unknown.
type SongInfo struct {
	FilePath string
	BitRate  int
}

// UserTranscodePrefs is the slice of the users row the decision needs:
// zero values mean unset.
type UserTranscodePrefs struct {
	MaxBitrateKbps  int
	TranscodeFormat string
}

// ParseMaxBitRate parses the maxBitRate query parameter exactly like old:
// an integer in [64, 10000], anything else ignored. the retired server used Number(): leading
// whitespace is trimmed and exponents are honored ("1e2" = 100); hex ("0x40"
// = 64) is honored by the old server but rejected here — the one intentional nano-delta, no
// Subsonic client sends hex (S2 findings §6, delta 11).
func ParseMaxBitRate(value string) (int, bool) {
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

// DecideTranscode ports old: the requested bitrate is a preference, the user
// cap a hard ceiling — effective = min(requested, userCap), never
// requested ?? cap. Transcoding happens when the target format differs from
// the raw file suffix, or when the source bitrate is unknown or exceeds the
// effective cap.
func DecideTranscode(song SongInfo, user *UserTranscodePrefs, requested int, hasRequested bool) TranscodeDecision {
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
		// the retired server compares the raw file SUFFIX to the target format — preserved
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

// inferFormat ports the old mime-based inference by extension outcome:
// m4a/aac/mp4 → aac; "opus" extension → mp3 (the old mime-types maps .opus to
// audio/ogg, so the retired server infers mp3 for .opus files too — preserved verbatim);
// everything else (incl. ogg, flac, wav) → mp3.
func inferFormat(filePath string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
	switch ext {
	case "aac", "m4a", "mp4":
		return "aac"
	case "opus":
		// the retired server quirk, see above.
		return "mp3"
	default:
		return "mp3"
	}
}

func transcodeContentType(format string) string { return formatToMime[format] }

// ffmpegArgs builds the exact argv the old spawnFfmpegTranscode produced
// (exec.Command-style, no shell). A 0 maxKbps selects -q:a 2 (wire parity).
func ffmpegArgs(filePath, format string, maxKbps int) []string {
	codec := formatToCodec[format]
	args := []string{
		"-hide_banner", "-loglevel", "error",
		"-i", filePath,
		"-map", "0:a:0",
		"-c:a", codec,
	}
	if maxKbps > 0 {
		args = append(args, "-b:a", strconv.Itoa(maxKbps)+"k")
	} else {
		args = append(args, "-q:a", "2")
	}
	container := "mp3"
	switch format {
	case "aac":
		container = "adts"
	case "opus":
		container = "opus"
	}
	return append(args, "-f", container, "pipe:1")
}

// ---------------------------------------------------------------------------
// Range parsing (port of the retired server retrieval.ts parseRange — single-range only)
// ---------------------------------------------------------------------------

type byteRange struct{ start, end int64 }

// parseRangeLegacy ports the old semantics exactly: multi-range → invalid (old answers
// 416), suffix "bytes=-N", open-ended "bytes=N-", end clamped to size-1.
func parseRangeLegacy(header string, size int64) (byteRange, bool) {
	var r byteRange
	if !strings.HasPrefix(header, "bytes=") {
		return r, false
	}
	spec := strings.TrimPrefix(header, "bytes=")
	if strings.Contains(spec, ",") {
		return r, false // multi-range unsupported by the old server
	}
	if strings.HasPrefix(spec, "-") {
		// old parseInt trims whitespace; strconv.ParseInt does not → trim.
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
