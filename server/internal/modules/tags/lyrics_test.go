// PUT /api/songs/{id}/lyrics: the writer is faked (the route flow — writer
// call shape plus the row update — is what these tests exercise); song rows
// are inserted directly because the flow never touches the file on disk.
package tags_test

import (
	"errors"
	"net/http"
	"testing"

	"github.com/miquelrosell99/sonarly/server/internal/audio"
)

func (s *server) seedLyricsSong(t *testing.T, id string) {
	t.Helper()
	if _, err := s.db.Exec(
		`INSERT INTO songs (id, file_path, title, mtime, checksum) VALUES (?, ?, 'T', 0, 'k')`,
		id, "/lib/"+id+".mp3"); err != nil {
		t.Fatalf("insert song: %v", err)
	}
}

func (s *server) lyricsRow(t *testing.T, id string) (lyrics, synced *string) {
	t.Helper()
	if err := s.db.QueryRow(
		`SELECT lyrics, synced_lyrics FROM songs WHERE id = ?`, id).Scan(&lyrics, &synced); err != nil {
		t.Fatalf("load row: %v", err)
	}
	return lyrics, synced
}

func TestPutSongLyricsWritesFileAndRow(t *testing.T) {
	s := newServer(t)
	s.seedLyricsSong(t, "s-1")
	admin := s.session(t, "u-admin", "admin", true)

	rec := s.do(t, http.MethodPut, "/api/songs/s-1/lyrics", map[string]any{
		"lyrics":       "line one\nline two",
		"syncedLyrics": "[00:01.00] line one\n[00:02.50] line two",
	}, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if decode(t, rec)["ok"] != true {
		t.Fatalf("want {ok:true}: %v", decode(t, rec))
	}

	if len(s.writer.calls) != 1 {
		t.Fatalf("writer calls: %d", len(s.writer.calls))
	}
	call := s.writer.calls[0]
	if call.path != "/lib/s-1.mp3" {
		t.Fatalf("writer path: %s", call.path)
	}
	if call.tags.Lyrics == nil || *call.tags.Lyrics != "line one\nline two" {
		t.Fatalf("writer lyrics: %+v", call.tags.Lyrics)
	}
	want := []audio.SyncedLyricLine{{Time: 1, Text: "line one"}, {Time: 2.5, Text: "line two"}}
	if len(call.tags.SyncedLyrics) != 2 || call.tags.SyncedLyrics[0] != want[0] || call.tags.SyncedLyrics[1] != want[1] {
		t.Fatalf("writer synced: %+v", call.tags.SyncedLyrics)
	}

	lyrics, synced := s.lyricsRow(t, "s-1")
	if lyrics == nil || *lyrics != "line one\nline two" {
		t.Fatalf("row lyrics: %v", lyrics)
	}
	// The row keeps the wire LRC text verbatim.
	if synced == nil || *synced != "[00:01.00] line one\n[00:02.50] line two" {
		t.Fatalf("row synced: %v", synced)
	}
}

func TestPutSongLyricsNullClearsRowWithoutWriter(t *testing.T) {
	s := newServer(t)
	s.seedLyricsSong(t, "s-1")
	admin := s.session(t, "u-admin", "admin", true)
	if _, err := s.db.Exec(
		`UPDATE songs SET lyrics = 'old', synced_lyrics = '[00:01.00] old' WHERE id = 's-1'`); err != nil {
		t.Fatal(err)
	}

	rec := s.do(t, http.MethodPut, "/api/songs/s-1/lyrics", map[string]any{
		"lyrics":       nil,
		"syncedLyrics": nil,
	}, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if len(s.writer.calls) != 0 {
		t.Fatal("clears are row-only — the mutagen writer cannot erase tags")
	}
	lyrics, synced := s.lyricsRow(t, "s-1")
	if lyrics != nil || synced != nil {
		t.Fatalf("null must clear: lyrics=%v synced=%v", lyrics, synced)
	}
}

func TestPutSongLyricsAbsentKeysUntouched(t *testing.T) {
	s := newServer(t)
	s.seedLyricsSong(t, "s-1")
	admin := s.session(t, "u-admin", "admin", true)
	if _, err := s.db.Exec(
		`UPDATE songs SET lyrics = 'old', synced_lyrics = '[00:01.00] old' WHERE id = 's-1'`); err != nil {
		t.Fatal(err)
	}

	rec := s.do(t, http.MethodPut, "/api/songs/s-1/lyrics", map[string]any{}, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if len(s.writer.calls) != 0 {
		t.Fatal("empty body must not touch the file")
	}
	lyrics, synced := s.lyricsRow(t, "s-1")
	if lyrics == nil || *lyrics != "old" || synced == nil {
		t.Fatalf("absent keys must leave the row alone: lyrics=%v synced=%v", lyrics, synced)
	}
}

func TestPutSongLyricsPartialUpdate(t *testing.T) {
	s := newServer(t)
	s.seedLyricsSong(t, "s-1")
	admin := s.session(t, "u-admin", "admin", true)
	if _, err := s.db.Exec(
		`UPDATE songs SET lyrics = 'old', synced_lyrics = '[00:01.00] old' WHERE id = 's-1'`); err != nil {
		t.Fatal(err)
	}

	rec := s.do(t, http.MethodPut, "/api/songs/s-1/lyrics", map[string]any{"lyrics": "new"}, nil, admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if len(s.writer.calls) != 1 || s.writer.calls[0].tags.Lyrics == nil || *s.writer.calls[0].tags.Lyrics != "new" {
		t.Fatalf("writer must see only the lyrics: %+v", s.writer.calls)
	}
	lyrics, synced := s.lyricsRow(t, "s-1")
	if lyrics == nil || *lyrics != "new" {
		t.Fatalf("lyrics must update: %v", lyrics)
	}
	if synced == nil || *synced != "[00:01.00] old" {
		t.Fatalf("absent syncedLyrics must survive: %v", synced)
	}
}

func TestPutSongLyricsValidation(t *testing.T) {
	s := newServer(t)
	admin := s.session(t, "u-admin", "admin", true)
	cases := []struct {
		name string
		body map[string]any
		want string
	}{
		{"unknown field", map[string]any{"mood": "dark"}, "Unknown lyrics field: mood"},
		{"lyrics type", map[string]any{"lyrics": 42}, "lyrics must be a string or null"},
		{"syncedLyrics type", map[string]any{"syncedLyrics": []any{}}, "syncedLyrics must be a string or null"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := s.do(t, http.MethodPut, "/api/songs/whatever/lyrics", tc.body, nil, admin)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d", rec.Code)
			}
			if got := decode(t, rec)["error"]; got != tc.want {
				t.Fatalf("error = %v, want %q", got, tc.want)
			}
		})
	}
}

func TestPutSongLyricsAuthzAndNotFound(t *testing.T) {
	s := newServer(t)
	songID, _ := s.seedSong(t, "spike.mp3", "plain.mp3")
	admin := s.session(t, "u-admin", "admin", true)
	user := s.session(t, "u-user", "user", false)

	if rec := s.do(t, http.MethodPut, "/api/songs/"+songID+"/lyrics", map[string]any{"lyrics": "x"}, nil, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPut, "/api/songs/"+songID+"/lyrics", map[string]any{"lyrics": "x"}, nil, user); rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
	if rec := s.do(t, http.MethodPut, "/api/songs/nope/lyrics", map[string]any{"lyrics": "x"}, nil, admin); rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestPutSongLyricsWriterFailure(t *testing.T) {
	s := newServer(t)
	s.seedLyricsSong(t, "s-1")
	admin := s.session(t, "u-admin", "admin", true)
	s.writer.err = errors.New("boom")

	rec := s.do(t, http.MethodPut, "/api/songs/s-1/lyrics", map[string]any{"lyrics": "x"}, nil, admin)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", rec.Code)
	}
	lyrics, _ := s.lyricsRow(t, "s-1")
	if lyrics != nil {
		t.Fatal("a failed write must not update the row")
	}
}
