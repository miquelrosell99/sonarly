package auth_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func TestStoreCreateGetRoundTrip(t *testing.T) {
	store := auth.NewStore(openDB(t))
	sess := auth.Session{UserID: "u1", Username: "alice", IsAdmin: true}

	if err := store.Create(context.Background(), "sid-1", sess); err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := store.Get(context.Background(), "sid-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.UserID != "u1" || got.Username != "alice" || !got.IsAdmin {
		t.Fatalf("round trip mismatch: %+v", got)
	}
}

func TestStoreGetMissing(t *testing.T) {
	store := auth.NewStore(openDB(t))
	_, err := store.Get(context.Background(), "nope")
	if err != auth.ErrNotFound {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestStoreGetExpired(t *testing.T) {
	database := openDB(t)
	store := auth.NewStore(database)
	if err := store.Create(context.Background(), "live", auth.Session{UserID: "u"}); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-time.Hour).UTC().Format("2006-01-02T15:04:05.000Z07:00")
	if _, err := database.Exec(
		`INSERT INTO sessions (sid, sess, expire) VALUES ('dead', '{"userId":"u"}', ?)`, past); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(context.Background(), "dead"); err != auth.ErrNotFound {
		t.Fatalf("expired session: want ErrNotFound, got %v", err)
	}
	if _, err := store.Get(context.Background(), "live"); err != nil {
		t.Fatalf("live session must survive: %v", err)
	}
}

func TestStoreCreateUpserts(t *testing.T) {
	store := auth.NewStore(openDB(t))
	if err := store.Create(context.Background(), "sid", auth.Session{UserID: "u1"}); err != nil {
		t.Fatal(err)
	}
	if err := store.Create(context.Background(), "sid", auth.Session{UserID: "u2", IsAdmin: true}); err != nil {
		t.Fatal(err)
	}
	got, err := store.Get(context.Background(), "sid")
	if err != nil {
		t.Fatal(err)
	}
	if got.UserID != "u2" || !got.IsAdmin {
		t.Fatalf("upsert mismatch: %+v", got)
	}
}

func TestStoreDelete(t *testing.T) {
	store := auth.NewStore(openDB(t))
	if err := store.Create(context.Background(), "sid", auth.Session{UserID: "u"}); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(context.Background(), "sid"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := store.Get(context.Background(), "sid"); err != auth.ErrNotFound {
		t.Fatalf("want ErrNotFound after delete, got %v", err)
	}
	// Deleting a missing sid must stay a no-op (logout idempotency).
	if err := store.Delete(context.Background(), "sid"); err != nil {
		t.Fatalf("delete missing: %v", err)
	}
}

func TestStoreDeleteAllForUser(t *testing.T) {
	database := openDB(t)
	store := auth.NewStore(database)
	ctx := context.Background()
	for _, row := range []struct{ sid, user string }{
		{"a1", "user-a"}, {"a2", "user-a"}, {"b1", "user-b"},
	} {
		if err := store.Create(ctx, row.sid, auth.Session{UserID: row.user}); err != nil {
			t.Fatal(err)
		}
	}
	// A malformed payload must be ignored, not fatal.
	if _, err := database.Exec(`INSERT INTO sessions (sid, sess, expire) VALUES ('bad', '{not json', '2999-01-01T00:00:00.000Z')`); err != nil {
		t.Fatal(err)
	}

	if err := store.DeleteAllForUser(ctx, "user-a"); err != nil {
		t.Fatalf("delete all for user: %v", err)
	}
	for _, sid := range []string{"a1", "a2"} {
		if _, err := store.Get(ctx, sid); err != auth.ErrNotFound {
			t.Fatalf("session %s must be gone, got %v", sid, err)
		}
	}
	if _, err := store.Get(ctx, "b1"); err != nil {
		t.Fatalf("other user's session must survive: %v", err)
	}
	var bad int
	if err := database.QueryRow(`SELECT COUNT(*) FROM sessions WHERE sid = 'bad'`).Scan(&bad); err != nil || bad != 1 {
		t.Fatalf("malformed session must be untouched: count=%d err=%v", bad, err)
	}
}

func TestStoreSweepExpired(t *testing.T) {
	database := openDB(t)
	store := auth.NewStore(database)
	ctx := context.Background()
	past := time.Now().Add(-time.Minute).UTC().Format("2006-01-02T15:04:05.000Z07:00")
	future := time.Now().Add(time.Hour).UTC().Format("2006-01-02T15:04:05.000Z07:00")
	for _, row := range []struct{ sid, expire string }{
		{"old-1", past}, {"old-2", past}, {"fresh", future},
	} {
		if _, err := database.Exec(
			`INSERT INTO sessions (sid, sess, expire) VALUES (?, '{"userId":"u"}', ?)`, row.sid, row.expire); err != nil {
			t.Fatal(err)
		}
	}
	n, err := store.SweepExpired(ctx)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if n != 2 {
		t.Fatalf("swept %d sessions, want 2", n)
	}
	if _, err := store.Get(ctx, "fresh"); err != nil {
		t.Fatalf("future session must survive sweep: %v", err)
	}
	var remaining int
	if err := database.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&remaining); err != nil || remaining != 1 {
		t.Fatalf("remaining=%d, want 1 (err=%v)", remaining, err)
	}
}
