package ingest

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// Reason is the typed validation failure, mirroring the old ValidationResult
// reason literals (the review UI keys on these strings).
type Reason string

const (
	ReasonUnsupportedFormat   Reason = "unsupported_format"
	ReasonUnreadable          Reason = "unreadable"
	ReasonMissingRequiredTags Reason = "missing_required_tags"
)

// Validation is the per-file verdict the old validateIngestFile returned.
type Validation struct {
	Valid  bool
	Reason Reason
	Meta   *audio.Metadata
}

// ValidateFile ports the old validateIngestFile: extension allowlist, stat,
// audio.ReadMetadata, then the retired server required-tag rule (title + artist +
// album). Title falls back to the filename stem inside ReadMetadata (wire
// parity), so a tagless file fails on the missing artist/album, exactly as
// the old rule played out.
func ValidateFile(filePath string) Validation {
	if !library.AUDIO_EXTS[strings.ToLower(filepath.Ext(filePath))] {
		return Validation{Valid: false, Reason: ReasonUnsupportedFormat}
	}
	if _, err := os.Stat(filePath); err != nil {
		return Validation{Valid: false, Reason: ReasonUnreadable}
	}
	meta, err := audio.ReadMetadata(filePath)
	if err != nil {
		return Validation{Valid: false, Reason: ReasonUnreadable}
	}
	if meta.Title == "" || displayArtist(meta) == "" || meta.Album == "" {
		return Validation{Valid: false, Reason: ReasonMissingRequiredTags, Meta: meta}
	}
	return Validation{Valid: true, Meta: meta}
}

// displayArtist mirrors the retired server tags.artist check: the raw display artist,
// with the split multi-value list as the fallback source.
func displayArtist(meta *audio.Metadata) string {
	if meta.Artist != "" {
		return meta.Artist
	}
	for _, name := range meta.Artists {
		if strings.TrimSpace(name) != "" {
			return name
		}
	}
	return ""
}
