package catalog_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
	"modernc.org/sqlite"
	_ "modernc.org/sqlite"

	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/catalog"
)

const testSecret = "0123456789abcdef0123456789abcdef"

// server is a catalog test server with real session auth.
type server struct {
	db     *sql.DB
	store  *auth.Store
	router http.Handler
}

func newServer(t *testing.T, database *sql.DB) *server {
	t.Helper()
	store := auth.NewStore(database)
	mw := auth.NewMiddleware(store, database, testSecret, false)
	r := chi.NewRouter()
	catalog.NewHandler(catalog.NewService(database), mw).Routes(r)
	return &server{db: database, store: store, router: r}
}

func (s *server) do(t *testing.T, method, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	s.router.ServeHTTP(rec, req)
	return rec
}

// session mints a real session row and returns the signed cookie.
func (s *server) session(t *testing.T, userID, username string, isAdmin bool) *http.Cookie {
	t.Helper()
	sid := auth.NewSID()
	if err := s.store.Create(context.Background(), sid, auth.Session{
		UserID: userID, Username: username, IsAdmin: isAdmin,
	}); err != nil {
		t.Fatalf("create session: %v", err)
	}
	rec := httptest.NewRecorder()
	auth.WriteSessionCookie(rec, testSecret, false, sid)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one session cookie, got %d", len(cookies))
	}
	return cookies[0]
}

func (s *server) mustExec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := s.db.Exec(query, args...); err != nil {
		t.Fatalf("fixture exec: %v\n%s", err, query)
	}
}

// ---------------------------------------------------------------------------
// Fixture: two libraries, five users, genres with a parent/child chain,
// cover art blobs, and songs covering every scope edge.
//
//	users:   admin (all), alice → lib-a, carol → lib-b, bob → nothing
//	songs:   lib-a:  s-a1..s-a5 (s-a2 explicit; s-a5 loose: no album/artist)
//	         lib-b:  s-b1, s-b2 (both explicit), s-b3 (non-explicit)
//	         inactive: s-ia (lib-a), s-ib (lib-b)
//	         null-library: s-na (admin-only)
//	genres:  Electronic > Ambient > Drift (chain), Electronic > Techno, Jazz
//	         alice reaches Jazz/Techno/Drift; Ambient+Electronic are
//	         out-of-scope carriers; Ambient's child Drift keeps both alive
//	covers:  ca-a1 (album art), ca-s1 (song art), ca-b1 (lib-b), ca-orphan
// ---------------------------------------------------------------------------

func (s *server) seed(t *testing.T) {
	t.Helper()
	exec := s.mustExec

	exec(t, `INSERT INTO users (id, username, password_hash, is_admin) VALUES
		('user-admin', 'root',  'x', 1),
		('user-alice', 'alice', 'x', 0),
		('user-bob',   'bob',   'x', 0),
		('user-carol', 'carol', 'x', 0)`)
	exec(t, `INSERT INTO libraries (id, name, path, created_at, updated_at) VALUES
		('lib-a', 'Library A', '/music/a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
		('lib-b', 'Library B', '/music/b', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
	exec(t, `INSERT INTO user_libraries (user_id, library_id) VALUES
		('user-alice', 'lib-a'), ('user-carol', 'lib-b')`)

	exec(t, `INSERT INTO artists (id, name, active, artist_image_local_path, musicbrainz_artist_ids, bio, external_urls) VALUES
		('ar-alpha', 'Alpha',   1, '/img/alpha.jpg', '["mb-alpha"]', 'Alpha bio', '{"spotify":"https://example.test/alpha"}'),
		('ar-beta',  'Beta',    1, NULL, NULL, NULL, NULL),
		('ar-gamma', 'Gamma',   1, NULL, NULL, NULL, NULL),
		('ar-delta', 'Delta',   1, NULL, NULL, NULL, NULL),
		('ar-feat',  'Feat',    1, NULL, NULL, NULL, NULL),
		('ar-comp',  'Composer',1, NULL, NULL, NULL, NULL),
		('ar-zombie','Zombie',  0, NULL, NULL, NULL, NULL)`)

	exec(t, `INSERT INTO genres (id, name, parent_id, active) VALUES
		('g-elect',   'Electronic', NULL,      1),
		('g-ambient', 'Ambient',    'g-elect', 1),
		('g-drift',   'Drift',      'g-ambient', 1),
		('g-techno',  'Techno',     'g-elect', 1),
		('g-jazz',    'Jazz',       NULL,      1)`)

	exec(t, `INSERT INTO labels (id, name, active) VALUES ('l-one', 'Label One', 1)`)

	exec(t, `INSERT INTO cover_arts (id, format, data, hash) VALUES
		('ca-a1',     'image/jpeg', x'ffd8ffe0', 'h-a1'),
		('ca-s1',     'image/png',  x'89504e47', 'h-s1'),
		('ca-b1',     'image/jpeg', x'ffd8ffe1', 'h-b1'),
		('ca-orphan', 'image/webp', x'52494646', 'h-orphan')`)

	exec(t, `INSERT INTO albums (id, name, artist_id, artist_name, year, genre, genre_id, cover_art_id, active,
			catalog_numbers, barcode, asin, musicbrainz_album_id, musicbrainz_release_group_id,
			musicbrainz_album_artist_ids, original_year, compilation, total_tracks, total_discs, release_type) VALUES
		('al-a1', 'A1', 'ar-alpha', 'Alpha', 2020, 'Jazz',   'g-jazz',    'ca-a1', 1,
			'["CAT-1"]', '111', 'B0001', 'mb-al-a1', 'mb-rg-a1', '["mb-alpha"]', 2019, 0, '10', '1', 'album'),
		('al-a2', 'A2', 'ar-alpha', 'Alpha', 2021, 'Techno', 'g-techno',  NULL,    1,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL),
		('al-b1', 'B1', 'ar-beta',  'Beta',  2019, 'Ambient','g-ambient', 'ca-b1', 1,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL),
		('al-b2', 'B2', 'ar-beta',  'Beta',  2019, 'Ambient','g-ambient', NULL,    1,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL),
		('al-c1', 'C1', 'ar-gamma', 'Gamma', 2018, NULL,     NULL,        NULL,    1,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL),
		('al-d1', 'D1', 'ar-delta', 'Delta', 2017, NULL,     NULL,        NULL,    1,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL),
		('al-empty', 'Empty', 'ar-alpha', 'Alpha', 2022, NULL, NULL,      NULL,    1,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL)`)

	exec(t, `INSERT INTO songs (id, file_path, title, track_number, disc_number, duration, artist_id, album_id,
			genre, genre_id, year, mtime, checksum, explicit, active, cover_art_id, cover_art_missing,
			bit_rate, bits_per_sample, sample_rate, channels, bpm, music_brainz_id, replay_gain, average_rating,
			comment, sort_name, mood, media_type, original_release_date, release_date, remix_of,
			display_artist, display_album_artist, lyrics, synced_lyrics, producers, isrcs,
			musicbrainz_track_id, musicbrainz_work_id, musicbrainz_disc_id, original_year, original_artist,
			gapless, total_tracks, total_discs, library_id) VALUES
		('s-a1', '/music/a/01.flac', 'One', 1, 1, 200, 'ar-alpha', 'al-a1',
			'Jazz', 'g-jazz', 2020, 100, 'k-a1', 0, 1, 'ca-s1', 0,
			320, 16, 44100, 2, 128, 'mb-song-a1', -3.5, 4.5,
			'c', 'one', 'mellow', 'audio/flac', '2019-01-01', '2020-01-01', 'rmx',
			'Alpha', 'Alpha', 'la la', '[{"t":0,"x":"hey"}]', '["P1","P2"]', '["ISRC-A1"]',
			'mb-trk-1', 'mb-wrk-1', 'mb-disc-1', 2019, 'Orig',
			1, '10', '1', 'lib-a'),
		('s-a2', '/music/a/02.flac', 'Two', 2, 1, 180, 'ar-alpha', 'al-a1',
			'Jazz', 'g-jazz', 2020, 101, 'k-a2', 1, 1, NULL, 1,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL,
			0, NULL, NULL, 'lib-a'),
		('s-a3', '/music/a/03.flac', 'Three', 1, 1, 240, 'ar-alpha', 'al-a2',
			'Techno', 'g-techno', 2021, 102, 'k-a3', 0, 1, NULL, 0,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, '["P3"]', NULL,
			NULL, NULL, NULL, NULL, NULL,
			0, NULL, NULL, 'lib-a'),
		('s-a4', '/music/a/04.flac', 'Four', 2, 1, 220, 'ar-alpha', 'al-a2',
			'Drift', 'g-drift', 2021, 103, 'k-a4', 0, 1, NULL, 0,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL,
			0, NULL, NULL, 'lib-a'),
		('s-a5', '/music/a/05.flac', 'Loose', NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, 1999, 104, 'k-a5', 0, 1, NULL, 0,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL,
			0, NULL, NULL, 'lib-a'),
		('s-b1', '/music/b/01.flac', 'Beta One', 1, 1, 300, 'ar-beta', 'al-b1',
			'Ambient', 'g-ambient', 2019, 105, 'k-b1', 1, 1, NULL, 0,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL,
			0, NULL, NULL, 'lib-b'),
		('s-b2', '/music/b/02.flac', 'Beta Two', 2, 1, 310, 'ar-beta', 'al-b1',
			'Ambient', 'g-ambient', 2019, 106, 'k-b2', 1, 1, NULL, 0,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL,
			0, NULL, NULL, 'lib-b'),
		('s-b3', '/music/b/03.flac', 'Beta Three', 1, 1, 290, 'ar-beta', 'al-b2',
			'Ambient', 'g-ambient', 2019, 109, 'k-b3', 0, 1, NULL, 0,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL,
			0, NULL, NULL, 'lib-b'),
		('s-ia', '/music/a/ghost.flac', 'Ghost', NULL, NULL, NULL, 'ar-gamma', 'al-c1',
			NULL, NULL, 2018, 107, 'k-ia', 0, 0, NULL, 0,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL,
			0, NULL, NULL, 'lib-a'),
		('s-ib', '/music/b/ghost.flac', 'Ghost Beta', NULL, NULL, NULL, 'ar-beta', 'al-b1',
			NULL, NULL, 2019, 108, 'k-ib', 0, 0, NULL, 0,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL,
			0, NULL, NULL, 'lib-b'),
		('s-na', '/music/x/nolib.flac', 'NoLib', NULL, NULL, NULL, 'ar-delta', 'al-d1',
			NULL, NULL, 2017, 110, 'k-na', 0, 1, NULL, 0,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL, NULL,
			NULL, NULL, NULL, NULL, NULL,
			0, NULL, NULL, NULL)`)

	exec(t, `INSERT INTO song_artists (song_id, artist_id, position) VALUES
		('s-a1', 'ar-alpha', 0), ('s-a2', 'ar-alpha', 0), ('s-a2', 'ar-feat', 1),
		('s-a3', 'ar-alpha', 0), ('s-a4', 'ar-alpha', 0),
		('s-b1', 'ar-beta', 0), ('s-b2', 'ar-beta', 0),
		('s-ia', 'ar-gamma', 0), ('s-na', 'ar-delta', 0)`)
	exec(t, `INSERT INTO song_composers (song_id, artist_id, position) VALUES
		('s-a1', 'ar-comp', 0), ('s-a3', 'ar-comp', 0)`)
	exec(t, `INSERT INTO song_genres (song_id, genre_id, position) VALUES
		('s-a1', 'g-jazz', 0),
		('s-a2', 'g-jazz', 0), ('s-a2', 'g-techno', 1),
		('s-a3', 'g-techno', 0), ('s-a4', 'g-drift', 0),
		('s-b1', 'g-ambient', 0), ('s-b2', 'g-ambient', 0), ('s-b3', 'g-ambient', 0)`)
	exec(t, `INSERT INTO album_artists (album_id, artist_id, position) VALUES
		('al-a1', 'ar-alpha', 0), ('al-a2', 'ar-alpha', 0), ('al-b1', 'ar-beta', 0)`)
	exec(t, `INSERT INTO album_genres (album_id, genre_id, position) VALUES
		('al-a1', 'g-jazz', 0), ('al-a2', 'g-techno', 0),
		('al-b1', 'g-ambient', 0), ('al-b2', 'g-ambient', 0)`)
	exec(t, `INSERT INTO album_labels (album_id, label_id, position) VALUES
		('al-a1', 'l-one', 0)`)

	exec(t, `INSERT INTO user_songs (user_id, song_id, starred, rating) VALUES
		('user-alice', 's-a1', 1, 4.5)`)
	exec(t, `INSERT INTO user_albums (user_id, album_id, starred) VALUES
		('user-alice', 'al-a1', 1)`)
	exec(t, `INSERT INTO user_artists (user_id, artist_id, starred) VALUES
		('user-alice', 'ar-alpha', 1)`)
}

func newSeededServer(t *testing.T) *server {
	t.Helper()
	database, err := db.OpenInMemory(context.Background())
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	s := newServer(t, database)
	s.seed(t)
	return s
}

// ---------------------------------------------------------------------------
// Counting driver: wraps the modernc sqlite driver and counts every
// statement database/sql executes (Prepare, or QueryContext/ExecContext when
// the connection implements them). Used by the N+1 guard tests.
// ---------------------------------------------------------------------------

var (
	countingOnce    sync.Once
	countingCounter atomic.Int64
)

type countingDriver struct{ base driver.Driver }

func (d *countingDriver) Open(name string) (driver.Conn, error) {
	c, err := d.base.Open(name)
	if err != nil {
		return nil, err
	}
	return &countingConn{Conn: c}, nil
}

type countingConn struct{ driver.Conn }

func (c *countingConn) Prepare(query string) (driver.Stmt, error) {
	countingCounter.Add(1)
	return c.Conn.Prepare(query)
}

func (c *countingConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if q, ok := c.Conn.(driver.QueryerContext); ok {
		countingCounter.Add(1)
		return q.QueryContext(ctx, query, args)
	}
	return nil, driver.ErrSkip
}

func (c *countingConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if e, ok := c.Conn.(driver.ExecerContext); ok {
		countingCounter.Add(1)
		return e.ExecContext(ctx, query, args)
	}
	return nil, driver.ErrSkip
}

// queryCounter counts statements executed through the counting driver.
type queryCounter struct{ n *atomic.Int64 }

func (c queryCounter) Reset()      { c.n.Store(0) }
func (c queryCounter) Load() int64 { return c.n.Load() }

// openCountingDB opens a migrated in-memory database through the counting
// driver and returns it with a statement counter. Tests in one package run
// sequentially, so the shared counter is safe to reset per measurement.
func openCountingDB(t *testing.T) (*sql.DB, queryCounter) {
	t.Helper()
	countingOnce.Do(func() {
		sql.Register("sqlite-counting", &countingDriver{base: &sqlite.Driver{}})
	})
	countingCounter.Store(0)
	// Same pragmas as db.Open; the counting driver needs its own DSN.
	dsn := "file::memory:?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)&_pragma=mmap_size(268435456)"
	database, err := sql.Open("sqlite-counting", dsn)
	if err != nil {
		t.Fatalf("open counting db: %v", err)
	}
	database.SetMaxOpenConns(1)
	database.SetMaxIdleConns(1)
	if err := database.Ping(); err != nil {
		t.Fatalf("ping counting db: %v", err)
	}
	if err := db.Migrate(context.Background(), database); err != nil {
		database.Close()
		t.Fatalf("migrate counting db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database, queryCounter{n: &countingCounter}
}
