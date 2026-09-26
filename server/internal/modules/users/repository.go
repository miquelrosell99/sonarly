// Package users owns the users domain: repository (raw SQL), service
// (validation, password policy, last-admin protections, setup transaction),
// and HTTP routes. Layering is routes → service → repository, the Go
// replacement for the old fastify route closures calling repositories directly.
package users

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"modernc.org/sqlite"
)

// dbUser is a users table row; secrets stay out of the JSON-facing types.
type dbUser struct {
	ID                        string
	Username                  string
	PasswordHash              string
	SubsonicPasswordEncrypted *string
	IsAdmin                   bool
	CreatedAt                 string
	Name                      *string
	Surname                   *string
	Email                     *string
	AvatarPath                *string
	MaxBitrateKbps            *int
	TranscodeFormat           *string
	HideExplicit              bool
	BlurExplicitTitles        bool
	BlurExplicitCovers        bool
}

const userColumns = `id, username, password_hash, subsonic_password_encrypted, is_admin,
	created_at, name, surname, email, avatar_path, max_bitrate_kbps, transcode_format,
	hide_explicit, blur_explicit_titles, blur_explicit_covers`

func scanUser(row interface{ Scan(...any) error }) (*dbUser, error) {
	var u dbUser
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.SubsonicPasswordEncrypted,
		&u.IsAdmin, &u.CreatedAt, &u.Name, &u.Surname, &u.Email, &u.AvatarPath,
		&u.MaxBitrateKbps, &u.TranscodeFormat, &u.HideExplicit, &u.BlurExplicitTitles,
		&u.BlurExplicitCovers)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetByID loads a user by primary key.
func GetByID(ctx context.Context, q auth.Queries, id string) (*dbUser, error) {
	return scanUser(q.QueryRowContext(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = ?`, id))
}

// GetByUsernameWithSecrets loads a user by username, including the password
// material login needs. Callers must never serialize this row.
func GetByUsernameWithSecrets(ctx context.Context, q auth.Queries, username string) (*dbUser, error) {
	return scanUser(q.QueryRowContext(ctx,
		`SELECT `+userColumns+` FROM users WHERE username = ?`, username))
}

// List returns every user, newest first, hashes excluded by column selection.
func List(ctx context.Context, q auth.Queries) ([]dbUser, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT `+userColumns+` FROM users ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()
	var users []dbUser
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, fmt.Errorf("list users: %w", err)
		}
		users = append(users, *u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	return users, nil
}

// Count returns the total number of users (the setup gate).
func Count(ctx context.Context, q auth.Queries) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// CountAdmins returns the number of admin users (last-admin protections).
func CountAdmins(ctx context.Context, q auth.Queries) (int, error) {
	var n int
	err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE is_admin = 1`).Scan(&n)
	return n, err
}

// InsertParams is the column set Insert writes; createdAt is ISO-8601 text.
type InsertParams struct {
	ID                        string
	Username                  string
	PasswordHash              string
	SubsonicPasswordEncrypted string
	IsAdmin                   bool
	CreatedAt                 string
	Name                      *string
	Surname                   *string
	Email                     *string
	MaxBitrateKbps            *int
	TranscodeFormat           *string
}

// Insert creates a user row.
func Insert(ctx context.Context, q auth.Queries, p InsertParams) error {
	_, err := q.ExecContext(ctx,
		`INSERT INTO users (id, username, password_hash, subsonic_password_encrypted,
			is_admin, created_at, name, surname, email, max_bitrate_kbps, transcode_format)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Username, p.PasswordHash, p.SubsonicPasswordEncrypted, p.IsAdmin, p.CreatedAt,
		p.Name, p.Surname, p.Email, p.MaxBitrateKbps, p.TranscodeFormat)
	if err != nil {
		return err
	}
	return nil
}

// SetIsAdmin flips the admin flag.
func SetIsAdmin(ctx context.Context, q auth.Queries, id string, isAdmin bool) error {
	_, err := q.ExecContext(ctx, `UPDATE users SET is_admin = ? WHERE id = ?`, isAdmin, id)
	return err
}

// OptionalString distinguishes an absent key (untouched) from an explicit
// null (set NULL) from a value — the old undefined|null|string semantics.
type OptionalString struct {
	Set   bool
	Null  bool
	Value string
}

func (o *OptionalString) UnmarshalJSON(data []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		o.Null = true
		return nil
	}
	return json.Unmarshal(data, &o.Value)
}

// OptionalInt is the int variant of OptionalString.
type OptionalInt struct {
	Set   bool
	Null  bool
	Value int
}

func (o *OptionalInt) UnmarshalJSON(data []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		o.Null = true
		return nil
	}
	return json.Unmarshal(data, &o.Value)
}

// OptionalBool is the bool variant of OptionalString.
type OptionalBool struct {
	Set   bool
	Null  bool
	Value bool
}

func (o *OptionalBool) UnmarshalJSON(data []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		o.Null = true
		return nil
	}
	return json.Unmarshal(data, &o.Value)
}

// UpdateTranscoding applies max-bitrate/transcode-format changes; unset
// fields are left alone, explicit nulls clear the column.
func UpdateTranscoding(ctx context.Context, q auth.Queries, id string, maxBitrate OptionalInt, format OptionalString) error {
	sets, args := make([]string, 0, 2), make([]any, 0, 3)
	if maxBitrate.Set {
		sets = append(sets, "max_bitrate_kbps = ?")
		if maxBitrate.Null {
			args = append(args, nil)
		} else {
			args = append(args, maxBitrate.Value)
		}
	}
	if format.Set {
		sets = append(sets, "transcode_format = ?")
		if format.Null {
			args = append(args, nil)
		} else {
			args = append(args, format.Value)
		}
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id)
	_, err := q.ExecContext(ctx, `UPDATE users SET `+joinSets(sets)+` WHERE id = ?`, args...)
	return err
}

// UpdateContentFilters applies the explicit-content filter flags.
func UpdateContentFilters(ctx context.Context, q auth.Queries, id string, hide, blurTitles, blurCovers OptionalBool) error {
	sets, args := make([]string, 0, 3), make([]any, 0, 4)
	for _, f := range []struct {
		col string
		v   OptionalBool
	}{
		{"hide_explicit", hide},
		{"blur_explicit_titles", blurTitles},
		{"blur_explicit_covers", blurCovers},
	} {
		if !f.v.Set {
			continue
		}
		// the retired server mapped an explicit null to false via a truthiness coercion.
		sets = append(sets, f.col+" = ?")
		args = append(args, !f.v.Null && f.v.Value)
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id)
	_, err := q.ExecContext(ctx, `UPDATE users SET `+joinSets(sets)+` WHERE id = ?`, args...)
	return err
}

// UpdateProfile applies name/surname/email plus, when passwordHash is
// non-nil, the rotated password material.
func UpdateProfile(ctx context.Context, q auth.Queries, id string,
	name, surname, email OptionalString, passwordHash, subsonicEncrypted *string,
) error {
	sets, args := make([]string, 0, 5), make([]any, 0, 6)
	for _, f := range []struct {
		col string
		v   OptionalString
	}{
		{"name", name},
		{"surname", surname},
		{"email", email},
	} {
		if !f.v.Set {
			continue
		}
		sets = append(sets, f.col+" = ?")
		if f.v.Null {
			args = append(args, nil)
		} else {
			args = append(args, f.v.Value)
		}
	}
	if passwordHash != nil {
		sets = append(sets, "password_hash = ?")
		args = append(args, *passwordHash)
		sets = append(sets, "subsonic_password_encrypted = ?")
		args = append(args, *subsonicEncrypted)
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, id)
	_, err := q.ExecContext(ctx, `UPDATE users SET `+joinSets(sets)+` WHERE id = ?`, args...)
	return err
}

func joinSets(sets []string) string {
	out := sets[0]
	for _, s := range sets[1:] {
		out += ", " + s
	}
	return out
}

// Delete removes the user row. Session invalidation happens before this call,
// composed into the same transaction by the service.
func Delete(ctx context.Context, q auth.Queries, id string) error {
	_, err := q.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	return err
}

// SetAvatarPath records the avatar filename (relative to the avatars dir);
// nil clears it (old updateAvatar).
func SetAvatarPath(ctx context.Context, q auth.Queries, id string, filename *string) error {
	var value any
	if filename != nil {
		value = *filename
	}
	_, err := q.ExecContext(ctx, `UPDATE users SET avatar_path = ? WHERE id = ?`, value, id)
	return err
}

// LookupUsers searches users by username for the playlist-share picker (old
// lookup-routes.ts): the caller is excluded, the pattern is LIKE-escaped,
// results are capped. name rides along so the client can display a full
// name when there is one.
func LookupUsers(ctx context.Context, q auth.Queries, excludeID, query string, limit int) ([]LookupUser, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT id, username, name FROM users
		 WHERE id != ? AND username LIKE ? ESCAPE '\'
		 ORDER BY username LIMIT ?`,
		excludeID, "%"+escapeLike(query)+"%", limit)
	if err != nil {
		return nil, fmt.Errorf("lookup users: %w", err)
	}
	defer rows.Close()
	var users []LookupUser
	for rows.Next() {
		var u LookupUser
		if err := rows.Scan(&u.ID, &u.Username, &u.Name); err != nil {
			return nil, fmt.Errorf("lookup users: %w", err)
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("lookup users: %w", err)
	}
	return users, nil
}

// escapeLike escapes the LIKE wildcards (%, _) and the escape character
// itself; the ESCAPE '\' clause at the call site interprets them.
func escapeLike(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
}

// IsUniqueViolation reports whether err is a SQLite UNIQUE-constraint failure,
// i.e. the username collision on INSERT.
func IsUniqueViolation(err error) bool {
	var sqliteErr *sqlite.Error
	if errors.As(err, &sqliteErr) {
		// SQLITE_CONSTRAINT_UNIQUE (extended result code 2067).
		return sqliteErr.Code() == 2067
	}
	return err != nil && bytes.Contains([]byte(err.Error()), []byte("UNIQUE constraint failed"))
}

// IsNoRows reports whether err is a missing-row scan.
func IsNoRows(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}
