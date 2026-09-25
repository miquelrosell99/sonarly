// Library rows: the admin CRUD v1's features/libraries/repository.ts
// provided, with the is_default invariant enforced inside transactions.
// v1 ran clearDefaultExcept as a separate autocommit statement (a crash
// between the UPDATE and the clear could flip two defaults); here every
// write that can change the default flag is one transaction.
package libraries

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"modernc.org/sqlite"
)

// DefaultOrganizePattern is v1's DEFAULT_ORGANIZE_PATTERN, used when a
// create omits the pattern (the global settings key is the ingest module's
// domain; v1's createLibrary read the settings table — v2 keeps that read
// in the handler, which owns both dependencies).
const DefaultOrganizePattern = "{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}"

// Library is one libraries row, v1's Library DTO shape.
type Library struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Path            string `json:"path"`
	OrganizePattern string `json:"organizePattern"`
	IsDefault       bool   `json:"isDefault"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}

// LibraryPicker is the trimmed DTO v1's GET /api/libraries returns — what
// library pickers need, never host paths or organize patterns.
type LibraryPicker struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	IsDefault bool   `json:"isDefault"`
}

const libraryColumns = `id, name, path, organize_pattern, is_default, created_at, updated_at`

func scanLibrary(row interface{ Scan(...any) error }) (*Library, error) {
	var lib Library
	var isDefault int
	if err := row.Scan(&lib.ID, &lib.Name, &lib.Path, &lib.OrganizePattern,
		&isDefault, &lib.CreatedAt, &lib.UpdatedAt); err != nil {
		return nil, err
	}
	lib.IsDefault = isDefault == 1
	return &lib, nil
}

// List returns every library ordered by name (v1 listLibraries).
func List(ctx context.Context, q auth.Queries) ([]Library, error) {
	rows, err := q.QueryContext(ctx, `SELECT `+libraryColumns+` FROM libraries ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list libraries: %w", err)
	}
	defer rows.Close()
	var libs []Library
	for rows.Next() {
		lib, err := scanLibrary(rows)
		if err != nil {
			return nil, fmt.Errorf("list libraries: %w", err)
		}
		libs = append(libs, *lib)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list libraries: %w", err)
	}
	return libs, nil
}

// GetByID loads one library (v1 getLibraryById).
func GetByID(ctx context.Context, q auth.Queries, id string) (*Library, error) {
	lib, err := scanLibrary(q.QueryRowContext(ctx,
		`SELECT `+libraryColumns+` FROM libraries WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load library %s: %w", id, err)
	}
	return lib, nil
}

// CreateInput is v1's CreateLibraryInput.
type CreateInput struct {
	Name            string
	Path            string
	OrganizePattern string
	IsDefault       bool
}

// Create inserts a library (v1 createLibrary): the first library ever
// created is forced default, and setting the default clears every other
// flag in the same transaction.
func Create(ctx context.Context, db *sql.DB, in CreateInput) (*Library, error) {
	var count int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM libraries`).Scan(&count); err != nil {
		return nil, fmt.Errorf("count libraries: %w", err)
	}
	isDefault := count == 0 || in.IsDefault
	now := time.Now().UTC().Format(time.RFC3339)
	lib := &Library{
		ID:              uuid.NewString(),
		Name:            in.Name,
		Path:            in.Path,
		OrganizePattern: in.OrganizePattern,
		IsDefault:       isDefault,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			tx.Rollback()
		}
	}()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO libraries (id, name, path, organize_pattern, is_default, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		lib.ID, lib.Name, lib.Path, lib.OrganizePattern, boolToInt(isDefault), lib.CreatedAt, lib.UpdatedAt); err != nil {
		return nil, err
	}
	if isDefault {
		if err := clearDefaultExcept(ctx, tx, lib.ID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true
	return lib, nil
}

// UpdateInput is v1's UpdateLibraryInput: every field optional, absent
// fields keep their value.
type UpdateInput struct {
	Name            *string
	Path            *string
	OrganizePattern *string
	IsDefault       *bool
}

// Update applies a partial update (v1 updateLibrary). A resulting default
// clears the other flags in the same transaction.
func Update(ctx context.Context, db *sql.DB, id string, in UpdateInput) (*Library, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			tx.Rollback()
		}
	}()
	lib, err := scanLibrary(tx.QueryRowContext(ctx,
		`SELECT `+libraryColumns+` FROM libraries WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load library %s: %w", id, err)
	}
	if in.Name != nil {
		lib.Name = *in.Name
	}
	if in.Path != nil {
		lib.Path = *in.Path
	}
	if in.OrganizePattern != nil {
		lib.OrganizePattern = *in.OrganizePattern
	}
	if in.IsDefault != nil {
		lib.IsDefault = *in.IsDefault
	}
	lib.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if _, err := tx.ExecContext(ctx,
		`UPDATE libraries SET name = ?, path = ?, organize_pattern = ?, is_default = ?, updated_at = ? WHERE id = ?`,
		lib.Name, lib.Path, lib.OrganizePattern, boolToInt(lib.IsDefault), lib.UpdatedAt, id); err != nil {
		return nil, err
	}
	if lib.IsDefault {
		if err := clearDefaultExcept(ctx, tx, id); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	committed = true
	return lib, nil
}

// Delete removes a library; when the deleted row was the default, the first
// remaining library (by name, v1's listLibraries()[0]) is promoted — in the
// same transaction so the invariant cannot be observed half-applied.
func Delete(ctx context.Context, db *sql.DB, id string) (bool, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	committed := false
	defer func() {
		if !committed {
			tx.Rollback()
		}
	}()
	var isDefault int
	err = tx.QueryRowContext(ctx, `SELECT is_default FROM libraries WHERE id = ?`, id).Scan(&isDefault)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("load library %s: %w", id, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM libraries WHERE id = ?`, id); err != nil {
		return false, err
	}
	if isDefault == 1 {
		var next string
		err := tx.QueryRowContext(ctx,
			`SELECT id FROM libraries ORDER BY name LIMIT 1`).Scan(&next)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return false, fmt.Errorf("pick next default: %w", err)
		}
		if err == nil {
			if _, err := tx.ExecContext(ctx,
				`UPDATE libraries SET is_default = 1, updated_at = ? WHERE id = ?`,
				time.Now().UTC().Format(time.RFC3339), next); err != nil {
				return false, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	committed = true
	return true, nil
}

// clearDefaultExcept unsets every is_default flag but keep's (v1
// clearDefaultExclude).
func clearDefaultExcept(ctx context.Context, ex auth.Queries, keep string) error {
	_, err := ex.ExecContext(ctx, `UPDATE libraries SET is_default = 0 WHERE id != ?`, keep)
	return err
}

// AssignedUserIDs lists a library's assigned user ids (v1 getLibraryUsers).
func AssignedUserIDs(ctx context.Context, q auth.Queries, libraryID string) ([]string, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT user_id FROM user_libraries WHERE library_id = ? ORDER BY user_id`, libraryID)
	if err != nil {
		return nil, fmt.Errorf("list library users: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("list library users: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list library users: %w", err)
	}
	return ids, nil
}

// AssignUsers adds user assignments, ignoring duplicates (v1
// assignUsersToLibrary, INSERT OR IGNORE).
func AssignUsers(ctx context.Context, q auth.Queries, libraryID string, userIDs []string) error {
	stmt := `INSERT OR IGNORE INTO user_libraries (user_id, library_id) VALUES (?, ?)`
	for _, userID := range userIDs {
		if _, err := q.ExecContext(ctx, stmt, userID, libraryID); err != nil {
			return fmt.Errorf("assign user %s to library %s: %w", userID, libraryID, err)
		}
	}
	return nil
}

// RemoveUser drops one assignment (v1 removeUserFromLibrary).
func RemoveUser(ctx context.Context, q auth.Queries, libraryID, userID string) error {
	_, err := q.ExecContext(ctx,
		`DELETE FROM user_libraries WHERE library_id = ? AND user_id = ?`, libraryID, userID)
	return err
}

// UserLibraryIDs lists a user's assigned library ids (v1 getUserLibraries).
func UserLibraryIDs(ctx context.Context, q auth.Queries, userID string) ([]string, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT library_id FROM user_libraries WHERE user_id = ? ORDER BY library_id`, userID)
	if err != nil {
		return nil, fmt.Errorf("list user libraries: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("list user libraries: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list user libraries: %w", err)
	}
	return ids, nil
}

// AssignToUser adds library assignments for a user, ignoring duplicates
// (v1 assignLibrariesToUser).
func AssignToUser(ctx context.Context, q auth.Queries, userID string, libraryIDs []string) error {
	stmt := `INSERT OR IGNORE INTO user_libraries (user_id, library_id) VALUES (?, ?)`
	for _, libraryID := range libraryIDs {
		if _, err := q.ExecContext(ctx, stmt, userID, libraryID); err != nil {
			return fmt.Errorf("assign library %s to user %s: %w", libraryID, userID, err)
		}
	}
	return nil
}

// RemoveFromUser drops one of a user's assignments (v1
// removeLibraryFromUser).
func RemoveFromUser(ctx context.Context, q auth.Queries, userID, libraryID string) error {
	_, err := q.ExecContext(ctx,
		`DELETE FROM user_libraries WHERE user_id = ? AND library_id = ?`, userID, libraryID)
	return err
}

// IsUniqueViolation reports a SQLite UNIQUE failure — the libraries.path
// collision the admin routes map to 409 (same check as the users package).
func IsUniqueViolation(err error) bool {
	var sqliteErr *sqlite.Error
	if errors.As(err, &sqliteErr) {
		// SQLITE_CONSTRAINT_UNIQUE (extended result code 2067).
		return sqliteErr.Code() == 2067
	}
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
