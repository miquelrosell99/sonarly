// Package taggenres is the bulk backfill CLI support (sonarly tag-genres):
// assign a genre to every genreless active song from a curated mapping and
// write it through the same path as the tag-edit API — the audio.TagWriter
// mutates the file, then library.PersistSong re-reads it (the ONE data path,
// so song rows, genre junctions, FTS, and the cached album genre all stay
// consistent; the album backfill lands via ensureAlbum's fill-from-tags).
//
// The mapping is deliberately operator-curated JSON ({"artists": {...},
// "albums": {...}}): in-library inference only covers artists that already
// have tagged songs, which is exactly the set that does not need backfilling.
// Lookup is case-insensitive at every cascade level.
package taggenres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// Mapping is the operator-curated genre assignment: artist name and album
// name -> genre. Both maps are optional; a missing level just falls through.
type Mapping struct {
	Artists map[string]string `json:"artists"`
	Albums  map[string]string `json:"albums"`
}

// LoadMapping reads and indexes a mapping file (case-insensitive keys).
func LoadMapping(path string) (*Mapping, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read mapping: %w", err)
	}
	var raw Mapping
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse mapping %s: %w", path, err)
	}
	return &Mapping{Artists: lowerKeys(raw.Artists), Albums: lowerKeys(raw.Albums)}, nil
}

func lowerKeys(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		if trimmed := strings.TrimSpace(k); trimmed != "" {
			out[strings.ToLower(trimmed)] = strings.TrimSpace(v)
		}
	}
	return out
}

// Cascade levels, highest first. Resolve returns the genre and the level it
// matched at (song artist, then album artist, then album name).
const (
	SourceArtist      = "artist"
	SourceAlbumArtist = "albumArtist"
	SourceAlbum       = "album"
)

// Resolve picks a genre for one song: song artist, then album artist, then
// album name. ok is false when no level matches.
func (m *Mapping) Resolve(artist, albumArtist, album string) (genre, source string, ok bool) {
	if g, hit := m.Artists[strings.ToLower(strings.TrimSpace(artist))]; hit {
		return g, SourceArtist, true
	}
	if g, hit := m.Artists[strings.ToLower(strings.TrimSpace(albumArtist))]; hit {
		return g, SourceAlbumArtist, true
	}
	if g, hit := m.Albums[strings.ToLower(strings.TrimSpace(album))]; hit {
		return g, SourceAlbum, true
	}
	return "", "", false
}

// Target is one genreless song and the genre the mapping assigns it.
type Target struct {
	SongID string
	Path   string
	Title  string
	Artist string
	Album  string
	Genre  string
	Source string
}

// Unresolved is a genreless song the mapping has no genre for.
type Unresolved struct {
	Path   string
	Title  string
	Artist string
	Album  string
}

// Plan is the full backfill work order.
type Plan struct {
	Targets    []Target
	Unresolved []Unresolved
}

// Build reads every active genreless song and resolves each against the
// mapping. Read-only.
func Build(ctx context.Context, db *sql.DB, m *Mapping) (*Plan, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT s.id, s.file_path, s.title,
		        COALESCE(ar.name, ''), COALESCE(al.name, ''), COALESCE(al.artist_name, '')
		 FROM songs s
		 LEFT JOIN artists ar ON ar.id = s.artist_id
		 LEFT JOIN albums al ON al.id = s.album_id
		 WHERE s.active = 1 AND (s.genre IS NULL OR s.genre = '')
		 ORDER BY s.file_path`)
	if err != nil {
		return nil, fmt.Errorf("list genreless songs: %w", err)
	}
	defer rows.Close()

	plan := &Plan{}
	for rows.Next() {
		var id, path, title, artist, album, albumArtist string
		if err := rows.Scan(&id, &path, &title, &artist, &album, &albumArtist); err != nil {
			return nil, fmt.Errorf("scan genreless song: %w", err)
		}
		genre, source, ok := m.Resolve(artist, albumArtist, album)
		if !ok {
			plan.Unresolved = append(plan.Unresolved, Unresolved{Path: path, Title: title, Artist: artist, Album: album})
			continue
		}
		plan.Targets = append(plan.Targets, Target{
			SongID: id, Path: path, Title: title, Artist: artist, Album: album,
			Genre: genre, Source: source,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list genreless songs: %w", err)
	}
	return plan, nil
}

// Failure is one target the writer or the persist step rejected.
type Failure struct {
	Target Target
	Err    error
}

func (f Failure) Error() string { return fmt.Sprintf("%s: %v", f.Target.Path, f.Err) }

// Apply writes each target's genre into its file through writer, then
// re-reads the file and persists it through library.PersistSong — the same
// write-then-persist contract as the tag-edit API (tags.applySongTags minus
// the re-organize step: backfilling a genre must not move files). Failures
// are collected per song; one bad file never aborts the run.
func Apply(ctx context.Context, db *sql.DB, writer audio.TagWriter, plan *Plan) (written []Target, failed []Failure) {
	for _, t := range plan.Targets {
		if err := ctx.Err(); err != nil {
			failed = append(failed, Failure{Target: t, Err: err})
			return written, failed
		}
		if !writer.Supports(t.Path) {
			failed = append(failed, Failure{Target: t, Err: errors.New("no tag writer for file")})
			continue
		}
		if err := writer.Write(ctx, t.Path, audio.SongTags{Genre: []string{t.Genre}}); err != nil {
			failed = append(failed, Failure{Target: t, Err: fmt.Errorf("write tags: %w", err)})
			continue
		}
		if err := persistFresh(ctx, db, t.SongID, t.Path); err != nil {
			failed = append(failed, Failure{Target: t, Err: fmt.Errorf("persist: %w", err)})
			continue
		}
		written = append(written, t)
	}
	return written, failed
}

// persistFresh re-reads the freshly tagged file and persists it through the
// one data path — the taggenres counterpart of tags.Service.persistFresh
// (that one is a method for its queue/organize surroundings; this one is
// standalone for the CLI).
func persistFresh(ctx context.Context, db *sql.DB, songID, path string) error {
	meta, err := audio.ReadMetadata(path)
	if err != nil {
		return fmt.Errorf("read metadata: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat: %w", err)
	}
	checksum, err := library.ChecksumFile(path)
	if err != nil {
		return err
	}
	libraryID, err := library.ResolveLibraryIDForPath(ctx, db, path)
	if err != nil {
		return err
	}
	_, err = library.PersistSong(ctx, db, library.PersistInput{
		ExistingID: &songID,
		Path:       path,
		Meta:       meta,
		Mtime:      info.ModTime().UnixMilli(),
		Checksum:   checksum,
		LibraryID:  libraryID,
	})
	return err
}

// SortedUniqueArtists is the report helper for the CLI's unresolved list:
// the distinct artist names the mapping does not cover yet.
func SortedUniqueArtists(unresolved []Unresolved) []string {
	set := map[string]bool{}
	for _, u := range unresolved {
		if u.Artist != "" {
			set[u.Artist] = true
		}
	}
	out := make([]string, 0, len(set))
	for name := range set {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}
