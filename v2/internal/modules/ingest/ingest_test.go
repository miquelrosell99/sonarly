// Full ingest pipeline test: a realistic drop folder (valid album with
// companion art, a corrupt file, a tagless file in its own folder with its
// own companion art) runs through RunIngest; the valid file lands in the
// library along the organize pattern with its cover image, the invalid
// files park in review/ with their reasons, ingest_jobs rows carry run_id +
// statuses, and emptied drop folders are pruned.
package ingest_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/ingest"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/library"
)

func TestValidateFile(t *testing.T) {
	dir := t.TempDir()

	if v := ingest.ValidateFile(filepath.Join(dir, "notes.txt")); v.Valid || v.Reason != ingest.ReasonUnsupportedFormat {
		t.Errorf("txt: got valid=%v reason=%q", v.Valid, v.Reason)
	}

	garbage := filepath.Join(dir, "broken.mp3")
	writeGarbage(t, garbage)
	if v := ingest.ValidateFile(garbage); v.Valid || v.Reason != ingest.ReasonUnreadable {
		t.Errorf("garbage mp3: got valid=%v reason=%q", v.Valid, v.Reason)
	}

	// Untagged MPEG stream: readable, properties parse, but no artist/album.
	data, err := os.ReadFile(filepath.Join(corpusDir, "spike.mp3"))
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}
	noTags := filepath.Join(dir, "mystery.mp3")
	if err := os.WriteFile(noTags, stripID3v2(t, data), 0o644); err != nil {
		t.Fatalf("write untagged: %v", err)
	}
	if v := ingest.ValidateFile(noTags); v.Valid || v.Reason != ingest.ReasonMissingRequiredTags {
		t.Errorf("untagged mp3: got valid=%v reason=%q", v.Valid, v.Reason)
	}

	valid := corpusCopy(t, dir, "spike.mp3", "spike.mp3")
	if v := ingest.ValidateFile(valid); !v.Valid {
		t.Errorf("corpus spike: got valid=%v reason=%q", v.Valid, v.Reason)
	}
}

func TestRunIngestFullPipeline(t *testing.T) {
	e := newEnv(t, true)
	ctx := context.Background()

	drop := filepath.Join(e.ingest, e.libraryID)
	good := filepath.Join(drop, "incoming")
	bad := filepath.Join(drop, "unsorted")

	// Valid album upload with a companion cover, a corrupt file, and a
	// tagless file in its own folder with its own companion art.
	corpusCopy(t, good, "spike.mp3", "spike.mp3")
	writeFile(t, filepath.Join(good, "cover.jpg"), "jpeg-bytes")
	writeGarbage(t, filepath.Join(drop, "broken.mp3"))
	untagged := filepath.Join(bad, "mystery.mp3")
	data, err := os.ReadFile(filepath.Join(corpusDir, "spike.mp3"))
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}
	if err := os.MkdirAll(bad, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(untagged, stripID3v2(t, data), 0o644); err != nil {
		t.Fatalf("write untagged: %v", err)
	}
	writeFile(t, filepath.Join(bad, "folder.jpg"), "folder-art")

	stats, err := e.svc.RunIngest(ctx, library.IngestPayload{
		SourcePath: drop,
		LibraryID:  e.libraryID,
	}, "run-1", nil)
	if err != nil {
		t.Fatalf("RunIngest: %v", err)
	}
	if stats.Processed != 3 || stats.Imported != 1 || stats.NeedsReview != 2 || stats.Failed != 0 || stats.Duplicates != 0 {
		t.Errorf("stats = %+v, want processed=3 imported=1 needsReview=2", *stats)
	}

	// The valid file landed along the default organize pattern.
	wantPath := filepath.Join(e.library, "Spike Album Artist", "(2021) Spike Album", "0103 - Spike Song (feat. Test).mp3")
	if !fileExists(wantPath) {
		t.Errorf("song not organized to %s", wantPath)
	}
	if fileExists(filepath.Join(good, "spike.mp3")) {
		t.Error("source file survived the ingest")
	}

	// The companion cover followed the album folder.
	assertContent(t, filepath.Join(e.library, "Spike Album Artist", "(2021) Spike Album", "cover.jpg"), "jpeg-bytes")

	// Invalid files are flat in review/ with " (n)"-free names; the
	// all-rejected folder's companion art joined them.
	reviewDir := filepath.Join(drop, "review")
	assertContent(t, filepath.Join(reviewDir, "broken.mp3"), "this is not audio, just garbage\x00\x01\x02")
	assertContent(t, filepath.Join(reviewDir, "mystery.mp3"), string(stripID3v2(t, data)))
	assertContent(t, filepath.Join(reviewDir, "folder.jpg"), "folder-art")
	if fileExists(filepath.Join(reviewDir, "cover.jpg")) {
		t.Error("the imported folder's cover also went to review")
	}

	// Emptied drop folders were pruned; root and review/ survive.
	if fileExists(good) || fileExists(bad) {
		t.Error("emptied drop folders were not pruned")
	}
	if !fileExists(drop) || !fileExists(reviewDir) {
		t.Error("ingest root or review dir was pruned")
	}

	// The song is in the catalog with junctions and cover-art dedup.
	if n := countRows(t, e.db, `SELECT COUNT(1) FROM songs WHERE file_path = ? AND active = 1`, wantPath); n != 1 {
		t.Errorf("songs row count = %d", n)
	}
	if n := countRows(t, e.db, `SELECT COUNT(1) FROM song_artists sa JOIN songs s ON s.id = sa.song_id WHERE s.file_path = ?`, wantPath); n != 2 {
		t.Errorf("song_artists junctions = %d, want 2", n)
	}
	if n := countRows(t, e.db, `SELECT COUNT(1) FROM song_genres sg JOIN songs s ON s.id = sg.song_id WHERE s.file_path = ?`, wantPath); n != 2 {
		t.Errorf("song_genres junctions = %d, want 2", n)
	}
	if n := countRows(t, e.db, `SELECT COUNT(1) FROM albums WHERE name = 'Spike Album' AND year = 2021`); n != 1 {
		t.Errorf("album row missing")
	}
	if n := countRows(t, e.db, `SELECT COUNT(1) FROM cover_arts`); n != 1 {
		t.Errorf("embedded cover art not hash-deduped into cover_arts (count=%d)", n)
	}

	// ingest_jobs bookkeeping: run_id, statuses, review reasons.
	type job struct {
		source, status, target, reason *string
	}
	rows, err := e.db.Query(
		`SELECT source_path, status, target_path, error FROM ingest_jobs WHERE run_id = 'run-1' ORDER BY created_at, rowid`)
	if err != nil {
		t.Fatalf("query ingest jobs: %v", err)
	}
	defer rows.Close()
	var jobs []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.source, &j.status, &j.target, &j.reason); err != nil {
			t.Fatalf("scan ingest job: %v", err)
		}
		jobs = append(jobs, j)
	}
	if len(jobs) != 3 {
		t.Fatalf("ingest_jobs rows = %d, want 3", len(jobs))
	}
	statusBySource := map[string]struct {
		status string
		reason string
		target string
	}{}
	for _, j := range jobs {
		entry := struct {
			status string
			reason string
			target string
		}{status: deref(j.status), reason: deref(j.reason), target: deref(j.target)}
		statusBySource[filepath.Base(deref(j.source))] = entry
	}
	if got := statusBySource["spike.mp3"]; got.status != ingest.StatusImported || got.target != wantPath || got.reason != "" {
		t.Errorf("spike job = %+v", got)
	}
	if got := statusBySource["broken.mp3"]; got.status != ingest.StatusNeedsReview || got.reason != string(ingest.ReasonUnreadable) {
		t.Errorf("broken job = %+v", got)
	}
	if got := statusBySource["mystery.mp3"]; got.status != ingest.StatusNeedsReview || got.reason != string(ingest.ReasonMissingRequiredTags) {
		t.Errorf("mystery job = %+v", got)
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// TestRunIngestSkipsReviewSubfolder guards the sweep's one carve-out: files
// parked in the top-level review/ directory are never re-ingested, while a
// folder NESTED deeper named review is legitimate user content (v1 parity).
func TestRunIngestSkipsReviewSubfolder(t *testing.T) {
	e := newEnv(t, true)
	ctx := context.Background()

	drop := filepath.Join(e.ingest, e.libraryID)
	corpusCopy(t, filepath.Join(drop, "review"), "spike.mp3", "parked.mp3")
	corpusCopy(t, filepath.Join(drop, "nested", "review"), "spike.mp3", "real.mp3")

	stats, err := e.svc.RunIngest(ctx, library.IngestPayload{SourcePath: drop, LibraryID: e.libraryID}, "run-2", nil)
	if err != nil {
		t.Fatalf("RunIngest: %v", err)
	}
	if stats.Processed != 1 || stats.Imported != 1 {
		t.Errorf("stats = %+v, want only the nested-review file processed", *stats)
	}
	if !fileExists(filepath.Join(drop, "review", "parked.mp3")) {
		t.Error("top-level review/ file was re-ingested")
	}
	if fileExists(filepath.Join(drop, "nested", "review", "real.mp3")) {
		t.Error("nested review/ file was not ingested")
	}
}

// TestRunIngestUnknownLibrary fails the run instead of importing into a
// guessed location (the typed-payload guarantee).
func TestRunIngestUnknownLibrary(t *testing.T) {
	e := newEnv(t, false)
	_, err := e.svc.RunIngest(context.Background(), library.IngestPayload{
		SourcePath: e.ingest,
		LibraryID:  "does-not-exist",
	}, "run-x", nil)
	if err == nil {
		t.Fatal("expected an error for an unknown library")
	}
}
