// Package auth implements session authentication: the SQLite-backed session
// store, the signed session cookie, the auth middleware chain, API-key
// verification, and the secret-box helpers used for at-rest credentials.
//
// It mirrors the old features/auth (session.ts, api-keys.ts, encryption.ts,
// password.ts) with the same wire shapes so a retired server client works unchanged.
package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// SessionTTL is the absolute session lifetime: 7 days, no rolling renewal
// (old: cookie maxAge 7d, store expire = now + maxAge).
const SessionTTL = 7 * 24 * time.Hour

// Session is the payload stored in the sessions table's sess column.
// IsAdmin is a snapshot taken at login; authorization that must be immediate
// (RequireAdmin) re-reads it from the users table instead.
type Session struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"isAdmin"`
}

// ErrNotFound is returned when a session does not exist or has expired.
var ErrNotFound = errors.New("session not found")

// Queries is the slice of database/sql the store needs. *sql.DB and *sql.Tx
// both satisfy it, so callers can compose store operations into their own
// transactions.
type Queries interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// Store persists sessions in the sessions table: sess holds the JSON-encoded
// Session, expire an ISO-8601 timestamp compared lexicographically.
type Store struct {
	db Queries
	// now is replaceable in tests.
	now func() time.Time
}

func NewStore(db Queries) *Store {
	return &Store{db: db, now: time.Now}
}

// iso renders t the way the retired server did (toISOString): UTC with millisecond precision,
// so expire strings written by either implementation compare consistently.
func iso(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

// Create inserts (or refreshes) the session for sid with the absolute
// expiry now + SessionTTL.
func (s *Store) Create(ctx context.Context, sid string, sess Session) error {
	expire := iso(s.now().Add(SessionTTL))
	payload, err := json.Marshal(sess)
	if err != nil {
		return fmt.Errorf("encode session: %w", err)
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
		 ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
		sid, string(payload), expire)
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	return nil
}

// Get loads the session for sid. An expired or missing session is reported as
// ErrNotFound, matching the store contract the old get() had.
func (s *Store) Get(ctx context.Context, sid string) (*Session, error) {
	var payload string
	err := s.db.QueryRowContext(ctx,
		`SELECT sess FROM sessions WHERE sid = ? AND expire > ?`, sid, iso(s.now())).
		Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load session: %w", err)
	}
	var sess Session
	if err := json.Unmarshal([]byte(payload), &sess); err != nil {
		return nil, fmt.Errorf("decode session: %w", err)
	}
	return &sess, nil
}

// Delete removes the session for sid. Deleting a missing session is not an
// error, so logout stays idempotent.
func (s *Store) Delete(ctx context.Context, sid string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE sid = ?`, sid)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

// DeleteAllForUser removes every session belonging to userID. The sessions
// table has no user_id column (the payload is an opaque JSON blob), so this
// scans and filters in Go, ignoring malformed payloads — exactly what the old
// deleteSessionsForUser did.
func (s *Store) DeleteAllForUser(ctx context.Context, userID string) error {
	return deleteAllForUser(ctx, s.db, userID)
}

// DeleteAllForUserTx is DeleteAllForUser bound to an explicit transaction, so
// callers can atomically combine it with their own writes (e.g. user delete).
func (s *Store) DeleteAllForUserTx(ctx context.Context, tx *sql.Tx, userID string) error {
	return deleteAllForUser(ctx, tx, userID)
}

func deleteAllForUser(ctx context.Context, q Queries, userID string) error {
	rows, err := q.QueryContext(ctx, `SELECT sid, sess FROM sessions`)
	if err != nil {
		return fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	var sids []string
	for rows.Next() {
		var sid, payload string
		if err := rows.Scan(&sid, &payload); err != nil {
			return fmt.Errorf("scan session: %w", err)
		}
		var sess Session
		if err := json.Unmarshal([]byte(payload), &sess); err != nil {
			continue // malformed payload, nothing to match
		}
		if sess.UserID == userID {
			sids = append(sids, sid)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list sessions: %w", err)
	}
	for _, sid := range sids {
		if _, err := q.ExecContext(ctx, `DELETE FROM sessions WHERE sid = ?`, sid); err != nil {
			return fmt.Errorf("delete session: %w", err)
		}
	}
	return nil
}

// SweepExpired deletes every expired session. the retired server ran it once at startup and
// then hourly; the sweeper goroutine in cmd/sonarly keeps that cadence.
func (s *Store) SweepExpired(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expire <= ?`, iso(s.now()))
	if err != nil {
		return 0, fmt.Errorf("sweep sessions: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, nil
	}
	return n, nil
}
