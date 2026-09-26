// Test harness for the ingest module: migrated in-memory DB, temp library
// and ingest trees, corpus copies, and a hand-built ID3v2.4 retagging helper
// that produces "the same file content with different tags" for duplicate
// tests without a tag writer dependency.
package ingest_test

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/ingest"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

const corpusDir = "../../audio/testdata/corpus"

// env is one test environment: db, service, library tree, ingest tree.
type env struct {
	db        *sql.DB
	svc       *ingest.Service
	queue     *library.Queue
	libraryID string
	library   string // library root on disk
	ingest    string // ingest root on disk
}

// newEnv builds a service over a temp library + temp ingest root. When
// withLibraryRow is false no libraries row is created (fallback-path tests).
func newEnv(t *testing.T, withLibraryRow bool) *env {
	t.Helper()
	ctx := context.Background()
	database, err := db.OpenInMemory(ctx)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	e := &env{db: database}
	e.library = t.TempDir()
	e.ingest = t.TempDir()
	e.queue = library.NewQueue(database)
	e.svc = ingest.NewService(database, discardLogger(), e.queue, ingest.Options{
		IngestPath:          e.ingest,
		LibraryPath:         e.library,
		ReviewRetentionDays: 30,
	})

	if withLibraryRow {
		e.libraryID = uuid.NewString()
		addLibrary(t, database, e.libraryID, e.library, library.DefaultOrganizePattern)
	}
	return e
}

func addLibrary(t *testing.T, database *sql.DB, id, path, pattern string) {
	t.Helper()
	if _, err := database.Exec(
		`INSERT INTO libraries (id, name, path, created_at, updated_at, organize_pattern, is_default)
		 VALUES (?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', ?, 1)`,
		id, id, path, pattern); err != nil {
		t.Fatalf("insert library: %v", err)
	}
}

// corpusCopy copies a corpus audio file into dir under dst and returns the
// new path.
func corpusCopy(t *testing.T, dir, src, dst string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(corpusDir, src))
	if err != nil {
		t.Fatalf("read corpus file %s: %v", src, err)
	}
	path := filepath.Join(dir, dst)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

// stripID3v2 returns data without a leading ID3v2 tag, i.e. the bare audio
// stream. Fails the test when the corpus file has no ID3v2 tag.
func stripID3v2(t *testing.T, data []byte) []byte {
	t.Helper()
	if len(data) < 10 || string(data[:3]) != "ID3" {
		t.Fatalf("corpus file has no ID3v2 tag to strip")
	}
	size := unsynchsafe(data[6:10])
	return data[10+size:]
}

// buildID3v24Tag builds a minimal ID3v2.4 tag. Frames are [id, value] pairs;
// each value becomes one UTF-8 text frame (encoding byte 3), so a value may
// carry NUL-separated multi-values (v2.4 convention, what mutagen writes —
// see gen_corpus.py).
func buildID3v24Tag(frames ...[2]string) []byte {
	var body []byte
	for _, frame := range frames {
		payload := append([]byte{3}, []byte(frame[1])...)
		body = append(body, []byte(frame[0])...)
		body = append(body, synchsafe(len(payload))...)
		body = append(body, 0, 0) // frame flags
		body = append(body, payload...)
	}
	header := []byte{'I', 'D', '3', 4, 0, 0}
	header = append(header, synchsafe(len(body))...)
	return append(header, body...)
}

func synchsafe(n int) []byte {
	return []byte{byte(n >> 21 & 0x7f), byte(n >> 14 & 0x7f), byte(n >> 7 & 0x7f), byte(n & 0x7f)}
}

func unsynchsafe(b []byte) int {
	return int(b[0])<<21 | int(b[1])<<14 | int(b[2])<<7 | int(b[3])
}

// retaggedFixture writes a copy of the spike.mp3 audio stream tagged with
// the given frames to dst, then verifies the tag parses back as intended —
// the hand-built tag format is pinned here, not assumed.
func retaggedFixture(t *testing.T, dst string, frames ...[2]string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(corpusDir, "spike.mp3"))
	if err != nil {
		t.Fatalf("read spike.mp3: %v", err)
	}
	audioStream := stripID3v2(t, data)
	tagged := append(buildID3v24Tag(frames...), audioStream...)
	if err := os.WriteFile(dst, tagged, 0o644); err != nil {
		t.Fatalf("write %s: %v", dst, err)
	}

	meta, err := audio.ReadMetadata(dst)
	if err != nil {
		t.Fatalf("retagged fixture unreadable: %v", err)
	}
	if meta.Title == "" || meta.Album == "" || len(meta.Artists) == 0 {
		t.Fatalf("retagged fixture lost its identity: title=%q album=%q artists=%v", meta.Title, meta.Album, meta.Artists)
	}
	return dst
}

// retaggedFramesA returns frames for a full re-tag: same identity
// (title/album/artists) as the corpus spike, different genre/year — enough
// to observe a metadata replacement, and the same artist set to exercise
// the primary identity match.
func retaggedFramesA() [][2]string {
	return [][2]string{
		{"TIT2", "Spike Song (feat. Test)"},
		{"TPE1", "Spike Artist One\x00Spike Artist Two"},
		{"TPE2", "Spike Album Artist"},
		{"TALB", "Spike Album"},
		{"TRCK", "3/12"},
		{"TPOS", "1/2"},
		{"TCON", "Blues"},
		{"TDRC", "2022"},
	}
}

// retaggedFramesC changes the artist SET ({One, Three}) so the duplicate
// match must fall back to track/disc, and merges under the aggregate
// strategies show up in the junction tables.
func retaggedFramesC() [][2]string {
	return [][2]string{
		{"TIT2", "Spike Song (feat. Test)"},
		{"TPE1", "Spike Artist One\x00Spike Artist Three"},
		{"TPE2", "Spike Album Artist"},
		{"TALB", "Spike Album"},
		{"TRCK", "3/12"},
		{"TPOS", "1/2"},
		{"TCON", "Blues"},
		{"TDRC", "2022"},
	}
}

// spikeSongRow is the seeded catalog row for the corpus spike song.
type spikeSongRow struct {
	id           string
	filePath     string
	mtime        int64
	checksum     string
	coverMissing bool
	genre        *string
	year         *int
}

func loadSpikeSong(t *testing.T, database *sql.DB) spikeSongRow {
	t.Helper()
	var row spikeSongRow
	var coverMissing int
	err := database.QueryRow(
		`SELECT id, file_path, mtime, checksum, cover_art_missing, genre, year
		 FROM songs WHERE title = 'Spike Song (feat. Test)'`).
		Scan(&row.id, &row.filePath, &row.mtime, &row.checksum, &coverMissing, &row.genre, &row.year)
	if err != nil {
		t.Fatalf("load seeded spike song: %v", err)
	}
	row.coverMissing = coverMissing == 1
	return row
}

func countRows(t *testing.T, database *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := database.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("count rows: %v\n%s", err, query)
	}
	return n
}

// junctionNames loads the joined names of one song junction in position
// order, e.g. table=song_artists, column=artist_id, join=artists.
func junctionNames(t *testing.T, database *sql.DB, table, column, join, songID string) []string {
	t.Helper()
	rows, err := database.Query(
		`SELECT j.`+column+`, x.name FROM `+table+` j JOIN `+join+` x ON x.id = j.`+column+`
		 WHERE j.song_id = ? ORDER BY j.position`, songID)
	if err != nil {
		t.Fatalf("load junction %s: %v", table, err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			t.Fatalf("load junction %s: %v", table, err)
		}
		names = append(names, name)
	}
	return names
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func writeGarbage(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("this is not audio, just garbage\x00\x01\x02"), 0o644); err != nil {
		t.Fatalf("write garbage %s: %v", path, err)
	}
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
