// Stale-session GC. v1 had no sweeper at all: an upload abandoned
// mid-session (client crashed, tab closed, token expired) leaked its
// upload_sessions row and every chunk on disk forever. This sweeper deletes
// rows older than MaxSessionAge along with their chunk directories, and
// also removes directories that have no row anymore — the residue of a
// crash between "delete the row" and "remove the dir" at session complete.

package uploads

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// Sweeper cadence and retention (v1 lesson: unbounded accumulation).
const (
	// DefaultSweepInterval is how often RunSweeper scans for garbage.
	DefaultSweepInterval = time.Hour
	// DefaultMaxSessionAge is how old a session must be to count as
	// abandoned. 24h mirrors the session-auth TTL window: if the creator
	// could still resume with the same credentials, the chunks stay.
	DefaultMaxSessionAge = 24 * time.Hour
)

// RunSweeper sweeps once, then on DefaultSweepInterval until ctx is
// cancelled, mirroring auth.RunSweeper's shape. It only logs: a stuck sweep
// must never take the server down.
func RunSweeper(ctx context.Context, repo *Repository, dataDir string, log *slog.Logger) {
	sweep := func() {
		rows, dirs, err := SweepOnce(ctx, repo, dataDir, time.Now(), DefaultMaxSessionAge)
		if err != nil {
			log.ErrorContext(ctx, "upload session sweep failed", "err", err)
		}
		if rows > 0 || dirs > 0 {
			log.InfoContext(ctx, "swept stale upload sessions",
				"sessions_removed", rows, "dirs_removed", dirs)
		}
	}
	sweep()
	ticker := time.NewTicker(DefaultSweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweep()
		}
	}
}

// SweepOnce deletes abandoned sessions and orphaned directories, returning
// the counts. now and maxAge are parameters so tests can drive it with a
// fake clock; RunSweeper passes the wall clock and DefaultMaxSessionAge.
func SweepOnce(ctx context.Context, repo *Repository, dataDir string, now time.Time, maxAge time.Duration) (sessionsRemoved, dirsRemoved int, err error) {
	sessions, err := repo.List(ctx)
	if err != nil {
		return 0, 0, err
	}

	var errs []error
	alive := make(map[string]bool, len(sessions))
	for _, s := range sessions {
		alive[s.ID] = true
		if now.Sub(s.CreatedAt) < maxAge {
			continue
		}
		if err := repo.Delete(ctx, s.ID); err != nil {
			errs = append(errs, err)
			continue
		}
		sessionsRemoved++
		if err := RemoveSessionDirectory(filepath.Join(dataDir, "uploads", s.ID)); err != nil {
			errs = append(errs, err)
			continue
		}
		dirsRemoved++
	}

	// Orphans: directories whose session row is gone (crash between the
	// row delete and the dir remove at complete, or a failed remove).
	upDir := filepath.Join(dataDir, "uploads")
	entries, err := os.ReadDir(upDir)
	if errors.Is(err, os.ErrNotExist) {
		return sessionsRemoved, dirsRemoved, errors.Join(errs...)
	}
	if err != nil {
		return sessionsRemoved, dirsRemoved, errors.Join(append(errs, fmt.Errorf("list uploads dir: %w", err))...)
	}
	for _, e := range entries {
		if !e.IsDir() || alive[e.Name()] {
			continue
		}
		if err := RemoveSessionDirectory(filepath.Join(upDir, e.Name())); err != nil {
			errs = append(errs, err)
			continue
		}
		dirsRemoved++
	}
	return sessionsRemoved, dirsRemoved, errors.Join(errs...)
}
