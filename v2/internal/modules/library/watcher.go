// Watcher polls the library roots for mtime/size changes and enqueues a
// coalesced resync when the on-disk set drifts from its snapshot.
//
// v1 used chokidar (native fsevents/inotify, optional polling). v2 polls
// unconditionally, for three reasons: (1) pure Go, zero CGO/dependencies;
// (2) the target deployment is a self-hosted NAS/SMB share, where inotify is
// unreliable or absent and every robust setup ends up on polling anyway;
// (3) polling gives an atomic root snapshot per cycle, which is exactly the
// input resync coalescing wants. Dotfiles are skipped, so our own temp and
// atomic-write leftovers (.sonarly-tmp-*) never trigger scans. An
// unmounted root reads as empty: the drift enqueues one (coalesced) resync,
// and the scanner's root readability probe keeps it from mass-deactivating.
package library

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DefaultWatchInterval is the poll cadence when the config leaves it unset.
const DefaultWatchInterval = 5 * time.Second

type fileState struct {
	mtime int64
	size  int64
}

// Watcher is a polling filesystem watcher over the configured library roots.
type Watcher struct {
	db           *sql.DB
	queue        *Queue
	log          *slog.Logger
	interval     time.Duration
	fallbackRoot string
	// snapshot is the last observed state of every audio file under every
	// root, keyed by absolute path.
	snapshot map[string]fileState
	// rootsSeen lets us log root set changes once.
	rootsSeen map[string]bool
}

func NewWatcher(db *sql.DB, queue *Queue, log *slog.Logger, interval time.Duration, fallbackRoot string) *Watcher {
	if interval <= 0 {
		interval = DefaultWatchInterval
	}
	return &Watcher{
		db:           db,
		queue:        queue,
		log:          log,
		interval:     interval,
		fallbackRoot: fallbackRoot,
		snapshot:     map[string]fileState{},
		rootsSeen:    map[string]bool{},
	}
}

// Run polls until ctx is cancelled. The first poll only records the
// baseline: files that existed before startup are not "changes" (boot
// already enqueues an initial scan; v1's chokidar add-events at watch start
// just queued a duplicate resync behind it).
func (w *Watcher) Run(ctx context.Context) {
	w.log.InfoContext(ctx, "library watcher started", "interval", w.interval.String())
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	first := true
	for {
		if err := w.poll(ctx, first); err != nil && !errors.Is(err, context.Canceled) {
			w.log.WarnContext(ctx, "watch poll failed", "err", err)
		}
		if err := ctx.Err(); err != nil {
			w.log.InfoContext(ctx, "library watcher stopped")
			return
		}
		first = false
		select {
		case <-ctx.Done():
			w.log.InfoContext(ctx, "library watcher stopped")
			return
		case <-ticker.C:
		}
	}
}

// poll takes one snapshot of all roots and enqueues a resync on drift.
func (w *Watcher) poll(ctx context.Context, initial bool) error {
	roots, err := w.roots(ctx)
	if err != nil {
		return err
	}

	seenRoots := map[string]bool{}
	for _, root := range roots {
		seenRoots[root] = true
		if !w.rootsSeen[root] {
			w.log.InfoContext(ctx, "watching library root", "root", root)
		}
	}
	w.rootsSeen = seenRoots

	current := map[string]fileState{}
	for _, root := range roots {
		if err := w.scanRoot(ctx, root, current); err != nil {
			// Unreadable root: leave its previous state untouched so a
			// transient error does not fire removal storms; the scanner
			// probes readability again at resync time.
			w.log.WarnContext(ctx, "watch poll: root unreadable", "root", root, "err", err)
			for path := range w.snapshot {
				if pathWithinRoot(path, root) {
					current[path] = w.snapshot[path]
				}
			}
		}
	}

	added, changed, removed := diffSnapshots(w.snapshot, current)
	w.snapshot = current
	if initial || (added == 0 && changed == 0 && removed == 0) {
		return nil
	}

	w.log.InfoContext(ctx, "library change detected, enqueueing resync",
		"added", added, "changed", changed, "removed", removed)
	if _, err := w.queue.Push(ctx, JobTypeResync, ScanPayload{}); err != nil {
		return err
	}
	return nil
}

// roots lists the current library roots (falling back to the configured
// library path, as the scanner does).
func (w *Watcher) roots(ctx context.Context) ([]string, error) {
	rows, err := w.db.QueryContext(ctx, `SELECT path FROM libraries ORDER BY path`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var roots []string
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			return nil, err
		}
		roots = append(roots, path)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(roots) == 0 && w.fallbackRoot != "" {
		roots = append(roots, w.fallbackRoot)
	}
	return roots, nil
}

// scanRoot stats every audio file under root into out. Dotfiles are skipped,
// including crashed atomic-tag-rewrite leftovers.
func (w *Watcher) scanRoot(ctx context.Context, root string, out map[string]fileState) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		full := filepath.Join(root, entry.Name())
		if entry.IsDir() {
			if err := w.scanRoot(ctx, full, out); err != nil {
				w.log.WarnContext(ctx, "watch poll: cannot read directory", "dir", full, "err", err)
			}
			continue
		}
		if !AUDIO_EXTS[strings.ToLower(filepath.Ext(entry.Name()))] {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		out[full] = fileState{mtime: info.ModTime().UnixMilli(), size: info.Size()}
	}
	return nil
}

func diffSnapshots(prev, current map[string]fileState) (added, changed, removed int) {
	for path, state := range current {
		old, ok := prev[path]
		switch {
		case !ok:
			added++
		case old != state:
			changed++
		}
	}
	for path := range prev {
		if _, ok := current[path]; !ok {
			removed++
		}
	}
	return added, changed, removed
}
