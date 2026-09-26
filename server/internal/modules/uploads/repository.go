// Package uploads hosts the chunked-upload domain: upload_sessions CRUD, the
// chunk store and streaming reassembly (old features/uploads + ingest
// trigger), and the stale-session sweeper the retired server never had. It deliberately
// fixes the defects the 2026-09-24 backend architecture audit called out
// (§6 F10, B11): the retired server buffered up to 1 GiB of chunks in the main-process heap
// during reassembly, answered a missing chunk at complete with a 500, and
// never GC'd abandoned upload_sessions rows or their chunk dirs.
package uploads

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// DuplicateStrategies is the retired server shared-package enum. An explicit but unknown
// strategy is a client bug (old silently dropped it), so the route rejects
// it with 400 instead of guessing.
var DuplicateStrategies = []string{
	"replace_file_and_metadata",
	"keep_file_replace_metadata",
	"replace_file_aggregate_metadata",
	"keep_file_aggregate_metadata",
	"skip",
}

// IsDuplicateStrategy reports whether s is a valid duplicate strategy value.
func IsDuplicateStrategy(s string) bool {
	for _, v := range DuplicateStrategies {
		if v == s {
			return true
		}
	}
	return false
}

// Session is one upload_sessions row. DuplicateStrategy is empty when the
// client did not pick one.
type Session struct {
	ID                string
	LibraryID         string
	DuplicateStrategy string
	CreatedAt         time.Time
}

// Repository persists upload_sessions. Session ids are server-minted UUIDs
// (old rule: the id in the chunk route is validated against this table before
// any disk write, so an arbitrary id can never create directories).
type Repository struct {
	db *sql.DB
}

func NewRepository(db *sql.DB) *Repository { return &Repository{db: db} }

// Create mints a UUID session row for libraryID and returns it. strategy may
// be empty (unset).
func (r *Repository) Create(ctx context.Context, libraryID, strategy string) (*Session, error) {
	s := &Session{
		ID:                uuid.NewString(),
		LibraryID:         libraryID,
		DuplicateStrategy: strategy,
		CreatedAt:         time.Now().UTC(),
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO upload_sessions (id, library_id, duplicate_strategy, created_at) VALUES (?, ?, ?, ?)`,
		s.ID, s.LibraryID, nullIfEmpty(s.DuplicateStrategy), s.CreatedAt.Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("create upload session: %w", err)
	}
	return s, nil
}

// Get loads one session. It returns (nil, nil) when no row matches — the
// route answers 404 from that, before touching disk.
func (r *Repository) Get(ctx context.Context, id string) (*Session, error) {
	var s Session
	var strategy sql.NullString
	var createdAt string
	err := r.db.QueryRowContext(ctx,
		`SELECT id, library_id, COALESCE(duplicate_strategy, ''), created_at FROM upload_sessions WHERE id = ?`, id).
		Scan(&s.ID, &s.LibraryID, &strategy, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load upload session %s: %w", id, err)
	}
	if strategy.Valid {
		s.DuplicateStrategy = strategy.String
	}
	s.CreatedAt, err = parseCreatedAt(createdAt)
	if err != nil {
		return nil, fmt.Errorf("load upload session %s: %w", id, err)
	}
	return &s, nil
}

// Delete removes the session row. It does not touch the chunk directory —
// RemoveSessionDirectory owns the disk side, and the sweeper reconciles the
// two when a crash separates them.
func (r *Repository) Delete(ctx context.Context, id string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM upload_sessions WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete upload session %s: %w", id, err)
	}
	return nil
}

// List loads every session, oldest first. The sweeper ages rows by
// CreatedAt, parsed here so the comparison happens on values, not on
// lexicographic string ordering.
func (r *Repository) List(ctx context.Context) ([]Session, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, library_id, COALESCE(duplicate_strategy, ''), created_at FROM upload_sessions ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list upload sessions: %w", err)
	}
	defer rows.Close()
	var sessions []Session
	for rows.Next() {
		var s Session
		var strategy sql.NullString
		var createdAt string
		if err := rows.Scan(&s.ID, &s.LibraryID, &strategy, &createdAt); err != nil {
			return nil, fmt.Errorf("list upload sessions: %w", err)
		}
		if strategy.Valid {
			s.DuplicateStrategy = strategy.String
		}
		s.CreatedAt, err = parseCreatedAt(createdAt)
		if err != nil {
			return nil, fmt.Errorf("list upload sessions: %w", err)
		}
		sessions = append(sessions, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list upload sessions: %w", err)
	}
	return sessions, nil
}

// parseCreatedAt accepts the RFC3339 strings this package writes. The
// millisecond variant covers rows written by the Go auth store's formatter,
// which tests and tooling sometimes reuse.
func parseCreatedAt(raw string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05.000Z07:00"} {
		if t, err := time.Parse(layout, raw); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unparseable created_at %q", raw)
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
