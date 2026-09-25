package library_test

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/library"
)

// A dropped file is detected by polling and enqueues exactly one coalesced
// resync, no matter how many changes arrive before the worker drains it.
func TestWatcherDetectsDropAndCoalesces(t *testing.T) {
	database := openDB(t)
	dir := libraryFixture(t, database, "lib-main")

	queue := library.NewQueue(database)
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	watcher := library.NewWatcher(database, queue, log, 20*time.Millisecond, "")

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { watcher.Run(ctx); close(done) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("watcher did not stop")
		}
	}()

	// Let the baseline snapshot settle (several polls at 20ms).
	time.Sleep(150 * time.Millisecond)

	corpusCopy(t, dir, "spike.flac", "dropped.flac")
	waitFor(t, 5*time.Second, "resync job after file drop", func() bool {
		return countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'resync'`) == 1
	})

	// More changes (adds + an mtime touch) must not pile up jobs: the
	// pending resync absorbs them.
	corpusCopy(t, dir, "spike.mp3", "more.mp3")
	corpusCopy(t, dir, "spike.ogg", "even-more.ogg")
	bumpMtime(t, dir+"/dropped.flac")
	time.Sleep(200 * time.Millisecond)
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'resync'`); got != 1 {
		t.Fatalf("want exactly 1 coalesced resync, got %d", got)
	}
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'scan'`); got != 0 {
		t.Fatalf("watcher must enqueue resync, not scan: %d", got)
	}

	// Removing a file is also a change.
	if err := os.Remove(dir + "/more.mp3"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(200 * time.Millisecond)
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs WHERE type = 'resync'`); got != 1 {
		t.Fatalf("removal must coalesce into the same resync, got %d", got)
	}
}

// An unreadable root (unmounted share) must not churn resyncs or crash the
// watcher; while unreadable it is left alone, and remounting is detected.
func TestWatcherToleratesUnreadableRoot(t *testing.T) {
	database := openDB(t)
	missing := t.TempDir() + "/not-mounted"
	addLibrary(t, database, "lib-main", missing)

	queue := library.NewQueue(database)
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	watcher := library.NewWatcher(database, queue, log, 20*time.Millisecond, "")

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { watcher.Run(ctx); close(done) }()
	defer func() {
		cancel()
		<-done
	}()

	// Several polls against the missing root: no jobs, no crash.
	time.Sleep(200 * time.Millisecond)
	if got := countRows(t, database, `SELECT COUNT(1) FROM scan_jobs`); got != 0 {
		t.Fatalf("unreadable root must not enqueue jobs: %d", got)
	}
}
