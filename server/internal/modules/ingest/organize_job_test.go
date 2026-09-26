// Organize-existing tests: a flat dump is reorganized along the library's
// pattern with two-phase stats, per-file progress callbacks fire, failed
// paths are collected (unreadable metadata), the /music vs /music2 prefix
// trap resolves to the longest matching library, and a second run skips
// everything already in place.
package ingest_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/modules/ingest"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

func TestRunOrganizeFlatLibrary(t *testing.T) {
	e := newEnv(t, true)
	ctx := context.Background()

	// Flat dump: tagged file at the root, one in a wrong subfolder.
	dumpPath := corpusCopy(t, e.library, "spike.mp3", "flat-spike.mp3")
	corpusCopy(t, filepath.Join(e.library, "misc"), "spike.mp3", "deep-spike.mp3")

	progressCalls := 0
	stats, err := e.svc.RunOrganize(ctx, library.OrganizePayload{LibraryID: e.libraryID},
		func(*ingest.OrganizeStats) { progressCalls++ })
	if err != nil {
		t.Fatalf("RunOrganize: %v", err)
	}

	wantPath := filepath.Join(e.library, "Spike Album Artist", "(2021) Spike Album", "0103 - Spike Song (feat. Test).mp3")
	if stats.Scanned != 2 || stats.Total != 2 || stats.Moved != 2 || stats.Skipped != 0 || stats.Failed != 0 {
		t.Errorf("stats = %+v, want scanned=2 total=2 moved=2", *stats)
	}
	if stats.Done != 2 {
		t.Errorf("done = %d, want 2", stats.Done)
	}
	if progressCalls == 0 {
		t.Error("progress callback never fired")
	}
	if len(stats.FailedPaths) != 0 {
		t.Errorf("failedPaths = %v", stats.FailedPaths)
	}
	if fileExists(dumpPath) {
		t.Error("flat file survived organizing")
	}
	// Both copies of the same content/song: the first move lands on the
	// pattern path, the second on the " (1)" collision path.
	if !fileExists(wantPath) {
		t.Errorf("song not organized to %s", wantPath)
	}
	if !fileExists(filepath.Join(e.library, "Spike Album Artist", "(2021) Spike Album", "0103 - Spike Song (feat. Test) (1).mp3")) {
		t.Error("second copy did not get a collision suffix")
	}

	// The emptied dump folders were pruned.
	if fileExists(filepath.Join(e.library, "misc")) {
		t.Error("emptied folder was not pruned")
	}

	// Second run: the retired server behavior, pinned — the preview compares each file
	// against its PATTERN target without accounting for occupancy, so the
	// collision-suffixed copy ("... (1).mp3") still previews as "not in
	// place" and moves again (suffix churn, one per run). Files unique to
	// their target are skipped. Fixing the churn is a known follow-up; the
	// parity port keeps the old semantics.
	second, err := e.svc.RunOrganize(ctx, library.OrganizePayload{LibraryID: e.libraryID}, nil)
	if err != nil {
		t.Fatalf("second RunOrganize: %v", err)
	}
	if second.Moved != 1 || second.Failed != 0 {
		t.Errorf("second run stats = %+v, want moved=1 (collision churn) failed=0", *second)
	}
	if !fileExists(filepath.Join(e.library, "Spike Album Artist", "(2021) Spike Album", "0103 - Spike Song (feat. Test) (2).mp3")) {
		t.Error("collision copy did not re-suffix to (2)")
	}
}

// TestRunOrganizeLibraryPrefixBoundary is the /music vs /music2 trap from
// the retired server organize-existing.ts: a file under /music2 must resolve to the music2
// library (its own pattern), not to the /music library whose path is a
// non-boundary prefix.
func TestRunOrganizeLibraryPrefixBoundary(t *testing.T) {
	e := newEnv(t, false)
	ctx := context.Background()

	base := t.TempDir()
	musicOne := filepath.Join(base, "music")
	musicTwo := filepath.Join(base, "music2")
	for _, dir := range []string{musicOne, musicTwo} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
	}
	oneID, twoID := "lib-music-one", "lib-music-two"
	addLibrary(t, e.db, oneID, musicOne, "{title}") // flat pattern
	addLibrary(t, e.db, twoID, musicTwo, "{album}/{title}")

	// Only one default library is allowed to exist for the trigger route,
	// but organize scopes by payload — no defaults involved here.
	dumpPath := corpusCopy(t, musicTwo, "spike.mp3", "dump.mp3")

	stats, err := e.svc.RunOrganize(ctx, library.OrganizePayload{LibraryID: twoID}, nil)
	if err != nil {
		t.Fatalf("RunOrganize: %v", err)
	}
	if stats.Moved != 1 || stats.Failed != 0 {
		t.Fatalf("stats = %+v, want moved=1", *stats)
	}
	if fileExists(dumpPath) {
		t.Error("file survived organizing")
	}
	// music2's pattern ({album}/{title}) placed it — proof the file did not
	// resolve to the /music library (whose {title} pattern would have put it
	// at musicOne's root).
	want := filepath.Join(musicTwo, "Spike Album", "Spike Song (feat. Test).mp3")
	if !fileExists(want) {
		t.Errorf("file not at %s (library prefix misresolved)", want)
	}
	if fileExists(filepath.Join(musicOne, "Spike Song (feat. Test).mp3")) {
		t.Error("/music claimed a /music2 file")
	}
}

// TestRunOrganizeAllLibraries scopes by every libraries row when the payload
// carries no library id (wire parity).
func TestRunOrganizeAllLibraries(t *testing.T) {
	e := newEnv(t, true)
	ctx := context.Background()

	otherRoot := t.TempDir()
	otherID := "lib-other"
	addLibrary(t, e.db, otherID, otherRoot, "{title}")
	corpusCopy(t, otherRoot, "spike.flac", "flat.flac")

	stats, err := e.svc.RunOrganize(ctx, library.OrganizePayload{}, nil)
	if err != nil {
		t.Fatalf("RunOrganize: %v", err)
	}
	if stats.Scanned != 1 || stats.Moved != 1 {
		t.Errorf("stats = %+v, want the other library's file organized", *stats)
	}
	if !fileExists(filepath.Join(otherRoot, "Spike Song (feat. Test).flac")) {
		t.Error("all-libraries run missed the second library")
	}
}

// TestRunOrganizeFailedPaths collects per-file failures without aborting
// the run. A dangling symlink yields a path that walks as an audio file but
// fails metadata reading (running as root, chmod-based unreadability does
// not work, so the symlink is the portable broken file).
func TestRunOrganizeFailedPaths(t *testing.T) {
	e := newEnv(t, true)
	ctx := context.Background()

	ghost := filepath.Join(e.library, "ghost.mp3")
	if err := os.Symlink(filepath.Join(e.library, "no-such-target.mp3"), ghost); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	good := corpusCopy(t, e.library, "spike.mp3", "flat.mp3")

	stats, err := e.svc.RunOrganize(ctx, library.OrganizePayload{LibraryID: e.libraryID}, nil)
	if err != nil {
		t.Fatalf("RunOrganize: %v", err)
	}
	if stats.Failed != 1 || len(stats.FailedPaths) != 1 || stats.FailedPaths[0] != ghost {
		t.Errorf("failedPaths = %v, want [%s]", stats.FailedPaths, ghost)
	}
	if stats.Moved != 1 {
		t.Errorf("moved = %d, want 1 (good file still organized)", stats.Moved)
	}
	_ = good
}
