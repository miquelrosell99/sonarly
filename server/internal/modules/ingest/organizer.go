package ingest

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// Pattern tokens (old organizer.ts): {artist} {albumArtist} {album} {title}
// {track} {track:00} {disc} {disc:00} {year} {genre}. Unknown tokens expand
// to "" — the retired server deliberately lets custom patterns carry tokens a file's tags
// don't fill.
var patternTokenRe = regexp.MustCompile(`\{([a-zA-Z0-9:]+)\}`)

var forbiddenCharRe = regexp.MustCompile(`[\\/:*?"<>|]`)
var whitespaceRunRe = regexp.MustCompile(`\s+`)

// BuildTargetPath ports the old buildTargetPath: token replacement, per-segment
// sanitize, extension always taken from the source file (so patterns never
// need an {ext} token), rooted at libraryPath.
func BuildTargetPath(pattern, libraryPath string, meta *audio.Metadata, originalPath string) string {
	variables := buildVariables(meta)
	relativePath := patternTokenRe.ReplaceAllStringFunc(pattern, func(match string) string {
		token := strings.TrimSuffix(strings.TrimPrefix(match, "{"), "}")
		if value, ok := variables[token]; ok {
			return value
		}
		return ""
	})
	segments := strings.Split(relativePath, "/")
	for i, segment := range segments {
		segments[i] = Sanitize(segment)
	}
	return filepath.Join(libraryPath, strings.Join(segments, "/")+filepath.Ext(originalPath))
}

// buildVariables ports the old buildVariables. Text values are pre-sanitized
// there and the per-segment pass below sanitizes again (idempotent, wire
// parity); numeric tokens are formatted as numbers and never sanitized.
func buildVariables(meta *audio.Metadata) map[string]string {
	artist := firstNonEmpty(meta.Artists)
	if artist == "" {
		artist = meta.Artist
	}
	if artist == "" {
		artist = "Unknown Artist"
	}
	album := meta.Album
	if album == "" {
		album = "Unknown Album"
	}
	title := meta.Title
	if title == "" {
		title = "Unknown Title"
	}
	albumArtist := firstNonEmpty(meta.AlbumArtists)
	if albumArtist == "" {
		albumArtist = meta.AlbumArtist
	}
	if albumArtist == "" {
		albumArtist = artist
	}
	genre := firstNonEmpty(meta.Genres)

	track := ""
	if meta.TrackNo != 0 {
		track = strconv.Itoa(meta.TrackNo)
	}
	disc := ""
	if meta.DiscNo != 0 {
		disc = strconv.Itoa(meta.DiscNo)
	}
	year := ""
	if meta.Year != 0 {
		year = strconv.Itoa(meta.Year)
	}

	variables := map[string]string{
		"artist":      Sanitize(artist),
		"albumArtist": Sanitize(albumArtist),
		"album":       Sanitize(album),
		"title":       Sanitize(title),
		"track":       track,
		"disc":        disc,
		"year":        year,
		"genre":       Sanitize(genre),
	}
	if track != "" {
		variables["track:00"] = fmt.Sprintf("%02d", meta.TrackNo)
	} else {
		variables["track:00"] = ""
	}
	if disc != "" {
		variables["disc:00"] = fmt.Sprintf("%02d", meta.DiscNo)
	} else {
		variables["disc:00"] = ""
	}
	return variables
}

func firstNonEmpty(values []string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// Sanitize ports the old sanitize EXACTLY: forbidden characters become "_"
// (they are replaced, not stripped), whitespace runs collapse to one space,
// ends trim, and exactly ONE trailing dot is removed — so "..." collapses
// to "..". An empty result becomes "_".
func Sanitize(name string) string {
	sanitized := forbiddenCharRe.ReplaceAllString(name, "_")
	sanitized = whitespaceRunRe.ReplaceAllString(sanitized, " ")
	sanitized = strings.TrimSpace(sanitized)
	sanitized = strings.TrimSuffix(sanitized, ".")
	if sanitized == "" {
		return "_"
	}
	return sanitized
}

// MoveToLibrary ports the old organizer.moveToLibrary: create the target's
// parent, pick a collision-free " (n)" target, then rename — EXDEV falls
// back to copy + checksum-verified unlink. Returns the final path.
func MoveToLibrary(sourcePath, targetPath string) (string, error) {
	if sourcePath == targetPath {
		return sourcePath, nil
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return "", err
	}
	finalPath, err := ResolveDuplicateTarget(targetPath)
	if err != nil {
		return "", err
	}
	if err := moveFile(sourcePath, finalPath); err != nil {
		return "", err
	}
	return finalPath, nil
}

// ResolveDuplicateTarget ports the old resolveDuplicateTarget / resolveUniquePath:
// an occupied target gets " (1)", " (2)", ... suffixes before the extension.
func ResolveDuplicateTarget(targetPath string) (string, error) {
	if !fileExists(targetPath) {
		return targetPath, nil
	}
	dir := filepath.Dir(targetPath)
	ext := filepath.Ext(targetPath)
	name := strings.TrimSuffix(filepath.Base(targetPath), ext)
	for counter := 1; ; counter++ {
		candidate := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", name, counter, ext))
		if !fileExists(candidate) {
			return candidate, nil
		}
	}
}

// moveFile renames, falling back to a copy + checksum-verified unlink across
// filesystem boundaries (old organizer.ts EXDEV handling).
func moveFile(sourcePath, targetPath string) error {
	err := os.Rename(sourcePath, targetPath)
	if err == nil {
		return nil
	}
	if !isCrossDevice(err) {
		return err
	}
	return copyAndRemove(sourcePath, targetPath)
}

// copyAndRemove ports the old copyAndRemove: copy, verify both checksums match,
// only then unlink the source.
func copyAndRemove(sourcePath, targetPath string) error {
	if err := copyFile(sourcePath, targetPath); err != nil {
		return err
	}
	sourceChecksum, err := library.ChecksumFile(sourcePath)
	if err != nil {
		return err
	}
	targetChecksum, err := library.ChecksumFile(targetPath)
	if err != nil {
		return err
	}
	if sourceChecksum != targetChecksum {
		return fmt.Errorf("integrity check failed after copying %s to %s", sourcePath, targetPath)
	}
	return os.Remove(sourcePath)
}

func copyFile(sourcePath, targetPath string) error {
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(target, source)
	closeErr := target.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

// isCrossDevice reports whether err is an EXDEV rename failure (source and
// target on different filesystems).
func isCrossDevice(err error) bool {
	return errors.Is(err, syscall.EXDEV)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// cleanupEmptyDirs ports the old rmdir sweep: post-order remove every emptied
// directory except root and reviewDir (old never removed the review folder
// itself — parked files live there).
func cleanupEmptyDirs(dir, root, reviewDir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			cleanupEmptyDirs(filepath.Join(dir, entry.Name()), root, reviewDir)
		}
	}
	entries, err = os.ReadDir(dir)
	if err != nil {
		return
	}
	if len(entries) == 0 && dir != root && dir != reviewDir {
		_ = os.Remove(dir)
	}
}
