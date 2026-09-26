// Duplicate strategy tests: seed the catalog by ingesting the corpus spike,
// then re-ingest a retagged copy (same title/album/artists, different
// genre/year/comment-class tags) under each of the five strategies and
// assert the old semantics: who survives on disk, which mtime/checksum the row
// keeps, and how the metadata merge modes fold values together.
package ingest_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/miquelrosell99/sonarly/server/internal/modules/ingest"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// seedSpike ingests the corpus spike into the seeded library and returns
// the catalog row plus the ingest drop path for the second upload.
func seedSpike(t *testing.T, e *env) (spikeSongRow, string) {
	t.Helper()
	drop := filepath.Join(e.ingest, e.libraryID)
	corpusCopy(t, drop, "spike.mp3", "first.mp3")
	stats, err := e.svc.RunIngest(context.Background(), library.IngestPayload{
		SourcePath: drop,
		LibraryID:  e.libraryID,
	}, "seed", nil)
	if err != nil {
		t.Fatalf("seed ingest: %v", err)
	}
	if stats.Imported != 1 || stats.Duplicates != 0 {
		t.Fatalf("seed stats = %+v", *stats)
	}
	return loadSpikeSong(t, e.db), drop
}

// uploadRetagged drops a retagged copy into the library's ingest folder,
// bumps its mtime an hour into the future (so keep/replace mtime
// distinctions are observable), and runs the ingest with the strategy.
func uploadRetagged(t *testing.T, e *env, drop, name string, frames [][2]string, strategy ingest.Strategy) *ingest.Stats {
	t.Helper()
	path := retaggedFixture(t, filepath.Join(drop, name), frames...)
	future := time.Now().Add(time.Hour)
	if err := os.Chtimes(path, future, future); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
	stats, err := e.svc.RunIngest(context.Background(), library.IngestPayload{
		SourcePath:        drop,
		LibraryID:         e.libraryID,
		DuplicateStrategy: string(strategy),
	}, "dup-run", nil)
	if err != nil {
		t.Fatalf("duplicate ingest: %v", err)
	}
	if stats.Duplicates != 1 || stats.Failed != 0 {
		t.Fatalf("dup stats = %+v, want one duplicate and no failures", *stats)
	}
	return stats
}

func TestDuplicateReplaceFileAndMetadata(t *testing.T) {
	e := newEnv(t, true)
	seeded, drop := seedSpike(t, e)
	newFile := filepath.Join(drop, "second.mp3")

	uploadRetagged(t, e, drop, "second.mp3", retaggedFramesA(), ingest.StrategyReplaceFileAndMetadata)

	if fileExists(newFile) {
		t.Error("incoming file survived a replace strategy")
	}
	if fileExists(seeded.filePath) {
		t.Error("old file was not replaced")
	}
	row := loadSpikeSong(t, e.db)
	wantPath := filepath.Join(e.library, "Spike Album Artist", "(2022) Spike Album", "0103 - Spike Song (feat. Test).mp3")
	if row.filePath != wantPath {
		t.Errorf("row path = %s, want %s", row.filePath, wantPath)
	}
	if row.genre == nil || *row.genre != "Blues" {
		t.Errorf("genre = %v, want Blues (metadata replaced)", deref(row.genre))
	}
	if row.year == nil || *row.year != 2022 {
		t.Errorf("year = %v, want 2022", derefP(row.year))
	}
	if row.mtime == seeded.mtime {
		t.Error("mtime did not move to the new file's")
	}
	checksum, err := library.ChecksumFile(row.filePath)
	if err != nil || row.checksum != checksum {
		t.Errorf("row checksum does not match the new file's (%v)", err)
	}
	if !row.coverMissing {
		t.Error("cover_art_missing should be true: the retagged file carries no art")
	}
	assertDupJob(t, e, ingest.StatusImported, string(ingest.StrategyReplaceFileAndMetadata))
}

func TestDuplicateKeepFileReplaceMetadata(t *testing.T) {
	e := newEnv(t, true)
	seeded, drop := seedSpike(t, e)

	stats := uploadRetagged(t, e, drop, "second.mp3", retaggedFramesA(), ingest.StrategyKeepFileReplaceMetadata)

	if stats.Imported != 1 || stats.Updated != 1 {
		t.Errorf("stats = %+v, want imported=1 updated=1", *stats)
	}
	// The existing file survived untouched with its content.
	if !fileExists(seeded.filePath) {
		t.Error("keep-file strategy removed the existing file")
	}
	checksum, err := library.ChecksumFile(seeded.filePath)
	if err != nil || checksum != seeded.checksum {
		t.Errorf("existing file content changed (%v)", err)
	}
	row := loadSpikeSong(t, e.db)
	if row.filePath != seeded.filePath {
		t.Errorf("row path moved to %s under a keep-file strategy", row.filePath)
	}
	if row.mtime != seeded.mtime || row.checksum != seeded.checksum {
		t.Error("keep-file strategy did not preserve the row mtime/checksum")
	}
	// Metadata WAS replaced where the new tags carry a value...
	if row.genre == nil || *row.genre != "Blues" {
		t.Errorf("genre = %v, want Blues", deref(row.genre))
	}
	if row.year == nil || *row.year != 2022 {
		t.Errorf("year = %v, want 2022", derefP(row.year))
	}
	// ...and the cover link stays (KeepCoverArt pins it).
	if row.coverMissing {
		t.Error("cover_art_missing flipped on a keep-file strategy")
	}
	assertDupJob(t, e, ingest.StatusImported, string(ingest.StrategyKeepFileReplaceMetadata))
}

func TestDuplicateReplaceFileAggregateMetadata(t *testing.T) {
	e := newEnv(t, true)
	seeded, drop := seedSpike(t, e)

	// Variant C changes the artist set, so the match itself rides the
	// track/disc fallback; the aggregate mode must union junctions.
	uploadRetagged(t, e, drop, "second.mp3", retaggedFramesC(), ingest.StrategyReplaceFileAggregateMetadata)

	if fileExists(seeded.filePath) {
		t.Error("old file was not replaced")
	}
	row := loadSpikeSong(t, e.db)
	if row.checksum == seeded.checksum {
		t.Error("row checksum did not move to the new file's")
	}
	artists := junctionNames(t, e.db, "song_artists", "artist_id", "artists", row.id)
	if want := []string{"Spike Artist One", "Spike Artist Two", "Spike Artist Three"}; !equalStrings(artists, want) {
		t.Errorf("aggregate artists = %v, want %v", artists, want)
	}
	genres := junctionNames(t, e.db, "song_genres", "genre_id", "genres", row.id)
	if want := []string{"Jazz", "Fusion", "Blues"}; !equalStrings(genres, want) {
		t.Errorf("aggregate genres = %v, want %v", genres, want)
	}
	assertDupJob(t, e, ingest.StatusImported, string(ingest.StrategyReplaceFileAggregateMetadata))
}

func TestDuplicateKeepFileAggregateMetadata(t *testing.T) {
	e := newEnv(t, true)
	seeded, drop := seedSpike(t, e)

	uploadRetagged(t, e, drop, "second.mp3", retaggedFramesC(), ingest.StrategyKeepFileAggregateMetadata)

	if !fileExists(seeded.filePath) {
		t.Error("keep-file strategy removed the existing file")
	}
	row := loadSpikeSong(t, e.db)
	if row.mtime != seeded.mtime || row.checksum != seeded.checksum {
		t.Error("keep-file strategy did not preserve the row mtime/checksum")
	}
	artists := junctionNames(t, e.db, "song_artists", "artist_id", "artists", row.id)
	if want := []string{"Spike Artist One", "Spike Artist Two", "Spike Artist Three"}; !equalStrings(artists, want) {
		t.Errorf("aggregate artists = %v, want %v", artists, want)
	}
	assertDupJob(t, e, ingest.StatusImported, string(ingest.StrategyKeepFileAggregateMetadata))
}

// TestDuplicateReplacePresentOnlyReplacesLists pins the merge-mode
// distinction the aggregate union is usually confused with: under
// keep_file_replace_metadata a PRESENT new artist list replaces the
// junctions outright (no union with the old rows).
func TestDuplicateReplacePresentOnlyReplacesLists(t *testing.T) {
	e := newEnv(t, true)
	_, drop := seedSpike(t, e)

	uploadRetagged(t, e, drop, "second.mp3", retaggedFramesC(), ingest.StrategyKeepFileReplaceMetadata)

	row := loadSpikeSong(t, e.db)
	artists := junctionNames(t, e.db, "song_artists", "artist_id", "artists", row.id)
	if want := []string{"Spike Artist One", "Spike Artist Three"}; !equalStrings(artists, want) {
		t.Errorf("replace-present-only artists = %v, want %v (present list replaces)", artists, want)
	}
}

func TestDuplicateSkip(t *testing.T) {
	e := newEnv(t, true)
	seeded, drop := seedSpike(t, e)

	stats := uploadRetagged(t, e, drop, "second.mp3", retaggedFramesA(), ingest.StrategySkip)

	if stats.Imported != 0 || stats.Updated != 0 {
		t.Errorf("stats = %+v, want imported=0 updated=0", *stats)
	}
	if fileExists(filepath.Join(drop, "second.mp3")) {
		t.Error("skipped duplicate was not deleted from the drop folder")
	}
	if !fileExists(seeded.filePath) {
		t.Error("skip strategy removed the existing file")
	}
	row := loadSpikeSong(t, e.db)
	if row.genre != nil && *row.genre != "Jazz" {
		t.Errorf("genre = %v, want untouched Jazz", deref(row.genre))
	}
	if row.year == nil || *row.year != 2021 {
		t.Errorf("year = %v, want untouched 2021", derefP(row.year))
	}
	assertDupJob(t, e, ingest.StatusSkipped, string(ingest.StrategySkip))
}

// TestDuplicateStrategyFromSettings verifies the retired server precedence: an absent
// payload strategy defers to the settings table, and an invalid setting
// degrades to the retired server default (keep_file_replace_metadata).
func TestDuplicateStrategyFromSettings(t *testing.T) {
	e := newEnv(t, true)
	seeded, drop := seedSpike(t, e)

	if _, err := e.db.Exec(
		`INSERT INTO settings (key, value) VALUES ('duplicate_strategy', 'skip')`); err != nil {
		t.Fatalf("set strategy: %v", err)
	}
	uploadRetagged(t, e, drop, "second.mp3", retaggedFramesA(), "") // no payload override
	if !fileExists(seeded.filePath) {
		t.Error("settings-level skip strategy was not honored")
	}

	// Invalid setting value → the retired server default (keep file).
	seeded2 := seedSecondSong(t, e, drop)
	if _, err := e.db.Exec(
		`UPDATE settings SET value = 'not-a-strategy' WHERE key = 'duplicate_strategy'`); err != nil {
		t.Fatalf("update strategy: %v", err)
	}
	uploadRetagged(t, e, drop, "third.mp3", retaggedFramesA(), "")
	if !fileExists(seeded2.filePath) {
		t.Error("invalid setting did not fall back to keep_file_replace_metadata")
	}
	if row := loadSpikeSong(t, e.db); row.genre == nil || *row.genre != "Blues" {
		t.Errorf("default keep strategy should still replace metadata: genre=%v", deref(row.genre))
	}
}

// seedSecondSong re-ingests after the first upload was skipped, so the
// catalog holds the song again for a second duplicate round.
func seedSecondSong(t *testing.T, e *env, drop string) spikeSongRow {
	t.Helper()
	corpusCopy(t, drop, "spike.mp3", "again.mp3")
	stats, err := e.svc.RunIngest(context.Background(), library.IngestPayload{
		SourcePath:        drop,
		LibraryID:         e.libraryID,
		DuplicateStrategy: string(ingest.StrategyReplaceFileAndMetadata),
	}, "seed2", nil)
	if err != nil {
		t.Fatalf("reseed ingest: %v", err)
	}
	if stats.Imported != 1 {
		t.Fatalf("reseed stats = %+v", *stats)
	}
	return loadSpikeSong(t, e.db)
}

func assertDupJob(t *testing.T, e *env, wantStatus, wantStrategy string) {
	t.Helper()
	var status, strategy string
	var duplicate int
	err := e.db.QueryRow(
		`SELECT status, duplicate, COALESCE(duplicate_strategy, '') FROM ingest_jobs WHERE run_id = 'dup-run'`).
		Scan(&status, &duplicate, &strategy)
	if err != nil {
		t.Fatalf("load dup ingest job: %v", err)
	}
	if status != wantStatus || duplicate != 1 || strategy != wantStrategy {
		t.Errorf("dup ingest job = status %q duplicate %d strategy %q, want %q/1/%q",
			status, duplicate, strategy, wantStatus, wantStrategy)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func derefP(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}
