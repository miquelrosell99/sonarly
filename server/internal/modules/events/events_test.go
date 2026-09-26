package events

import (
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/server/internal/db"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

const testSecret = "0123456789abcdef0123456789abcdef"

// ---------------------------------------------------------------------------
// shouldBroadcast decision
// ---------------------------------------------------------------------------

func TestShouldBroadcast(t *testing.T) {
	cases := []struct {
		name    string
		jobType library.JobType
		stats   string
		want    bool
	}{
		{"scan added", library.JobTypeScan, `{"added": 1}`, true},
		{"scan updated", library.JobTypeResync, `{"updated": 2}`, true},
		{"scan moved", library.JobTypeScan, `{"moved": 1}`, true},
		{"scan removed", library.JobTypeOrganize, `{"removed": 1}`, true},
		{"scan nothing changed", library.JobTypeScan, `{"scanned": 50, "added": 0, "updated": 0, "moved": 0, "removed": 0}`, false},
		{"ingest imported", library.JobTypeIngest, `{"imported": 3}`, true},
		{"ingest updated", library.JobTypeIngest, `{"updated": 1}`, true},
		{"ingest nothing", library.JobTypeIngest, `{"processed": 9, "imported": 0, "updated": 0}`, false},
		{"cleanup review never broadcasts", library.JobTypeCleanupReview, `{"removed": 5}`, false},
		{"artist images never broadcasts", library.JobTypeArtistImages, `{"updated": 5}`, false},
		{"malformed stats", library.JobTypeScan, `{oops`, false},
		{"no stats", library.JobTypeScan, ``, false},
	}
	for _, tc := range cases {
		if got := shouldBroadcast(tc.jobType, json.RawMessage(tc.stats)); got != tc.want {
			t.Errorf("%s: want %v, got %v", tc.name, tc.want, got)
		}
	}
}

func TestBrokerSkipsFailedJobs(t *testing.T) {
	incoming := make(chan library.Event, 4)
	broker := NewBroker(incoming, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go broker.Run(ctx)

	incoming <- library.Event{JobID: "j1", Type: library.JobTypeScan, Stats: json.RawMessage(`{"added": 1}`), Error: "boom"}
	incoming <- library.Event{JobID: "j2", Type: library.JobTypeScan, Stats: json.RawMessage(`{"added": 1}`)}
	incoming <- library.Event{JobID: "j3", Type: library.JobTypeScan, Stats: json.RawMessage(`{"added": 0}`)}

	ch, unsubscribe := broker.Subscribe()
	defer unsubscribe()

	select {
	case ev := <-ch:
		if ev.JobID != "j2" || ev.Type != "library:changed" || ev.Source != "scan" {
			t.Fatalf("only the successful changed job broadcasts: %+v", ev)
		}
		if ev.Stats["added"] != float64(1) {
			t.Fatalf("stats ride along: %+v", ev.Stats)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for the broadcast")
	}
}

// ---------------------------------------------------------------------------
// SSE over a real server
// ---------------------------------------------------------------------------

type fixture struct {
	db       *sql.DB
	store    *auth.Store
	incoming chan library.Event
	broker   *Broker
	handler  *Handler
	router   http.Handler
}

func (f *fixture) mustExec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.db.Exec(query, args...); err != nil {
		t.Fatalf("fixture exec: %v", err)
	}
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	database.Exec(`INSERT INTO users (id, username, password_hash) VALUES ('user-alice', 'alice', 'x')`)

	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	incoming := make(chan library.Event, 8)
	broker := NewBroker(incoming, nil)
	handler := NewHandler(broker, mw)
	// Short heartbeat so the test observes one without waiting 30s.
	handler.heartbeat = 50 * time.Millisecond
	r := chi.NewRouter()
	handler.Routes(r)
	return &fixture{db: database, store: store, incoming: incoming, broker: broker, handler: handler, router: r}
}

func (f *fixture) cookie(t *testing.T, userID string) *http.Cookie {
	t.Helper()
	sid := auth.NewSID()
	if err := f.store.Create(context.Background(), sid, auth.Session{UserID: userID, Username: "alice"}); err != nil {
		t.Fatalf("create session: %v", err)
	}
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, testSecret, false, sid)
	return rec.Result().Cookies()[0]
}

// waitForClientCount polls the broker's subscriber count until it reaches
// want. The SSE subscribe/unsubscribe path runs on server goroutines that
// share the CPU with every other package's test binary under `go test
// ./...`; a fixed no-wait assertion races under that load.
func waitForClientCount(t *testing.T, b *Broker, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if b.ClientCount() == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("subscriber count never reached %d (now %d)", want, b.ClientCount())
}

// readEvent parses one SSE event (event: + data: lines) from the stream.
func readEvent(t *testing.T, scanner *bufio.Scanner) Event {
	t.Helper()
	var ev Event
	var data string
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			ev.Type = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = strings.TrimPrefix(line, "data: ")
		case line == "" && (ev.Type != "" || data != ""):
			if data != "" {
				if err := json.Unmarshal([]byte(data), &ev); err != nil {
					t.Fatalf("decode event data: %v", err)
				}
				if ev.Type == "" {
					ev.Type = "message"
				}
			}
			return ev
		}
	}
	t.Fatalf("stream ended while reading an event")
	return ev
}

func TestStreamSendsConnectedJobEventAndHeartbeat(t *testing.T) {
	f := newFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	srv := httptest.NewServer(f.router)
	// LIFO: cancel the broker before closing the server, so a failed
	// assertion can never leave Close waiting on a live SSE connection.
	defer srv.Close()
	defer cancel()
	go f.broker.Run(ctx)

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(f.cookie(t, "user-alice"))
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type: %q", ct)
	}
	waitForClientCount(t, f.broker, 1)

	scanner := bufio.NewScanner(resp.Body)
	connected := readEvent(t, scanner)
	if connected.Type != "connected" {
		t.Fatalf("first event must be connected: %+v", connected)
	}

	// A completed, content-changing job lands on the wire.
	f.incoming <- library.Event{JobID: "job-1", Type: library.JobTypeScan, Stats: json.RawMessage(`{"added": 2, "scanned": 10}`)}
	changed := readEvent(t, scanner)
	if changed.Type != "library:changed" || changed.Source != "scan" || changed.JobID != "job-1" {
		t.Fatalf("library:changed shape: %+v", changed)
	}
	if changed.Stats["added"] != float64(2) {
		t.Fatalf("stats payload: %+v", changed.Stats)
	}

	// Heartbeats arrive as comments: the scanner sees a blank line where a
	// comment was consumed. Feed another job and confirm the stream is
	// still alive after the heartbeat interval.
	f.incoming <- library.Event{JobID: "job-2", Type: library.JobTypeIngest, Stats: json.RawMessage(`{"imported": 1}`)}
	changed = readEvent(t, scanner)
	if changed.Type != "library:changed" || changed.Source != "ingest" {
		t.Fatalf("post-heartbeat event: %+v", changed)
	}
}

func TestStreamDisconnectCleansUp(t *testing.T) {
	f := newFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	srv := httptest.NewServer(f.router)
	defer srv.Close()
	defer cancel() // runs before Close: never let Close wait on the SSE conn
	go f.broker.Run(ctx)

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.AddCookie(f.cookie(t, "user-alice"))
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	waitForClientCount(t, f.broker, 1)

	// Client disconnect: the handler's context ends and the deferred
	// unsubscribe runs.
	resp.Body.Close()
	waitForClientCount(t, f.broker, 0)
}

func TestStreamSessionOnlyAuth(t *testing.T) {
	f := newFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go f.broker.Run(ctx)
	srv := httptest.NewServer(f.router)
	defer srv.Close()

	// Anonymous: rejected.
	resp, err := srv.Client().Get(srv.URL + "/api/events")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anon: want 401, got %d", resp.StatusCode)
	}

	// API key (valid for every other native route): rejected here — the
	// SSE feed is session-only by design. Keys are SHA-256 digests at rest,
	// mirroring auth.VerifyAPIKey's storage scheme.
	rawKey := "test-api-key-material"
	sum := sha256.Sum256([]byte(rawKey))
	f.mustExec(t, `INSERT INTO api_keys (id, user_id, key_hash) VALUES ('key-1', 'user-alice', ?)`,
		hex.EncodeToString(sum[:]))
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set(auth.APIKeyHeader, rawKey)
	resp, err = srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("api key must NOT authenticate the SSE feed: want 401, got %d", resp.StatusCode)
	}
}

func TestStreamFanoutToMultipleClients(t *testing.T) {
	f := newFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	srv := httptest.NewServer(f.router)
	defer srv.Close()
	defer cancel()
	go f.broker.Run(ctx)

	open := func() (*http.Response, *bufio.Scanner) {
		t.Helper()
		req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/events", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(f.cookie(t, "user-alice"))
		resp, err := srv.Client().Do(req)
		if err != nil {
			t.Fatalf("open stream: %v", err)
		}
		return resp, bufio.NewScanner(resp.Body)
	}

	respA, scannerA := open()
	defer respA.Body.Close()
	respB, scannerB := open()
	defer respB.Body.Close()
	waitForClientCount(t, f.broker, 2)

	readEvent(t, scannerA)
	readEvent(t, scannerB)

	f.incoming <- library.Event{JobID: "job-x", Type: library.JobTypeScan, Stats: json.RawMessage(`{"added": 1}`)}
	evA := readEvent(t, scannerA)
	evB := readEvent(t, scannerB)
	if evA.JobID != "job-x" || evB.JobID != "job-x" {
		t.Fatalf("fanout: %+v / %+v", evA, evB)
	}
}

// TestStreamEventOnCompletedScanJob drives a REAL scan through the library
// worker and asserts the completion lands on the SSE wire: worker.Events()
// → broker → client, the actual production wiring from main.go.
func TestStreamEventOnCompletedScanJob(t *testing.T) {
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	// A one-song library: copy a corpus file into the library's directory.
	dir := t.TempDir()
	data, err := os.ReadFile("../../audio/testdata/corpus/spike.mp3")
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "spike.mp3"), data, 0o644); err != nil {
		t.Fatal(err)
	}
	database.Exec(`INSERT INTO libraries (id, name, path, created_at, updated_at)
		VALUES ('lib-live', 'Live', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, dir)

	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	queue := library.NewQueue(database)
	worker := library.NewWorker(queue, library.NewScanner(database, log, ""), log)
	broker := NewBroker(worker.Events(), nil)
	handler := NewHandler(broker, mw)

	workerCtx, stopWorker := context.WithCancel(context.Background())
	defer stopWorker()
	go worker.Start(workerCtx)
	go broker.Run(workerCtx)

	r := chi.NewRouter()
	handler.Routes(r)
	srv := httptest.NewServer(r)
	defer srv.Close()

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	sid := auth.NewSID()
	if err := store.Create(context.Background(), sid, auth.Session{UserID: "user-alice", Username: "alice"}); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, testSecret, false, sid)
	req.AddCookie(rec.Result().Cookies()[0])
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer resp.Body.Close()
	scanner := bufio.NewScanner(resp.Body)
	if ev := readEvent(t, scanner); ev.Type != "connected" {
		t.Fatalf("connected: %+v", ev)
	}

	if _, err := queue.Push(context.Background(), library.JobTypeScan, library.ScanPayload{}); err != nil {
		t.Fatalf("push scan: %v", err)
	}
	changed := readEvent(t, scanner)
	if changed.Type != "library:changed" || changed.Source != "scan" {
		t.Fatalf("scan completion must broadcast library:changed: %+v", changed)
	}
	if changed.JobID == "" || changed.Stats["added"] != float64(1) {
		t.Fatalf("scan stats ride along: %+v", changed)
	}

	stopWorker()
}
