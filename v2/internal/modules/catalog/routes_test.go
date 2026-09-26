package catalog_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
)

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

func decodeMap(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.NewDecoder(rec.Result().Body).Decode(&out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return out
}

func songIDList(t *testing.T, rec *httptest.ResponseRecorder) []string {
	t.Helper()
	body := decodeMap(t, rec)
	raw, ok := body["songs"].([]any)
	if !ok {
		t.Fatalf("response has no songs array: %v", body)
	}
	ids := make([]string, 0, len(raw))
	for _, item := range raw {
		song, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("song is not an object: %v", item)
		}
		ids = append(ids, song["id"].(string))
	}
	return ids
}

func sorted(ids []string) []string {
	out := append([]string{}, ids...)
	sort.Strings(out)
	return out
}

func expectIDs(t *testing.T, got []string, want ...string) {
	t.Helper()
	if fmt.Sprint(sorted(got)) != fmt.Sprint(sorted(want)) {
		t.Fatalf("ids: want %v, got %v", want, got)
	}
}

// f64 reads a JSON number decoded into an any.
func f64(v any) float64 {
	n, ok := v.(float64)
	if !ok {
		return -1
	}
	return n
}

// users covers the scope matrix: unrestricted admin, single-library users,
// and a user with no library assignment (empty scope matches nothing).
type testUser struct {
	label    string
	userID   string
	username string
	admin    bool
}

func userMatrix() []testUser {
	return []testUser{
		{"admin", "user-admin", "root", true},
		{"alice(lib-a)", "user-alice", "alice", false},
		{"carol(lib-b)", "user-carol", "carol", false},
		{"bob(none)", "user-bob", "bob", false},
	}
}

// ---------------------------------------------------------------------------
// Scope enforcement
// ---------------------------------------------------------------------------

func TestListSongsScopeMatrix(t *testing.T) {
	s := newSeededServer(t)
	want := map[string][]string{
		"admin":        {"s-a1", "s-a2", "s-a3", "s-a4", "s-a5", "s-b1", "s-b2", "s-b3", "s-na"},
		"alice(lib-a)": {"s-a1", "s-a2", "s-a3", "s-a4", "s-a5"},
		"carol(lib-b)": {"s-b1", "s-b2", "s-b3"},
		"bob(none)":    {},
	}
	for _, u := range userMatrix() {
		t.Run(u.label, func(t *testing.T) {
			rec := s.do(t, http.MethodGet, "/api/songs", s.session(t, u.userID, u.username, u.admin))
			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
			}
			expectIDs(t, songIDList(t, rec), want[u.label]...)
		})
	}
}

func TestListSongsRequiresAuth(t *testing.T) {
	s := newSeededServer(t)
	for _, path := range []string{
		"/api/songs", "/api/songs/s-a1", "/api/albums", "/api/albums/al-a1",
		"/api/artists", "/api/artists/ar-alpha", "/api/artists/ar-alpha/songs",
		"/api/genres", "/api/genres/tree", "/api/genres/g-jazz/albums",
		"/api/years", "/api/cover-art/ca-a1",
	} {
		rec := s.do(t, http.MethodGet, path, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: want 401, got %d", path, rec.Code)
		}
	}
}

func TestListSongsFilters(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	alice := s.session(t, "user-alice", "alice", false)

	cases := []struct {
		name   string
		cookie *http.Cookie
		query  string
		want   []string
	}{
		{"by album", alice, "?albumId=al-a1", []string{"s-a1", "s-a2"}},
		{"by album out of scope", alice, "?albumId=al-b1", nil},
		{"by artist", alice, "?artistId=ar-alpha", []string{"s-a1", "s-a2", "s-a3", "s-a4"}},
		{"by genre", alice, "?genreId=g-techno", []string{"s-a2", "s-a3"}},
		{"by genre out of scope", alice, "?genreId=g-ambient", nil},
		{"by library", alice, "?libraryId=lib-b", nil},
		{"by library admin", admin, "?libraryId=lib-b", []string{"s-b1", "s-b2", "s-b3"}},
		{"hide explicit", alice, "?hideExplicit=true", []string{"s-a1", "s-a3", "s-a4", "s-a5"}},
		{"hide explicit admin", admin, "?hideExplicit=1", []string{"s-a1", "s-a3", "s-a4", "s-a5", "s-b3", "s-na"}},
		{"limit", admin, "?limit=2", []string{"s-b1", "s-b3"}},
		{"limit above max clamps", admin, "?limit=99999", []string{"s-a1", "s-a2", "s-a3", "s-a4", "s-a5", "s-b1", "s-b2", "s-b3", "s-na"}},
		{"combined album+hide", alice, "?albumId=al-a1&hideExplicit=true", []string{"s-a1"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := s.do(t, http.MethodGet, "/api/songs"+tc.query, tc.cookie)
			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
			}
			expectIDs(t, songIDList(t, rec), tc.want...)
		})
	}
}

func TestGetSongScopeMatrix(t *testing.T) {
	s := newSeededServer(t)
	cases := []struct {
		name   string
		user   testUser
		songID string
		want   int
	}{
		{"admin in lib-a", testUser{"", "user-admin", "root", true}, "s-a1", 200},
		{"admin in lib-b", testUser{"", "user-admin", "root", true}, "s-b1", 200},
		{"admin null library", testUser{"", "user-admin", "root", true}, "s-na", 200},
		{"alice own library", testUser{"", "user-alice", "alice", false}, "s-a1", 200},
		{"alice other library is 404", testUser{"", "user-alice", "alice", false}, "s-b1", 404},
		{"alice null library is 404", testUser{"", "user-alice", "alice", false}, "s-na", 404},
		{"carol own library", testUser{"", "user-carol", "carol", false}, "s-b1", 200},
		{"carol other library is 404", testUser{"", "user-carol", "carol", false}, "s-a1", 404},
		{"bob sees nothing", testUser{"", "user-bob", "bob", false}, "s-a1", 404},
		{"unknown id is 404", testUser{"", "user-admin", "root", true}, "nope", 404},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := s.do(t, http.MethodGet, "/api/songs/"+tc.songID, s.session(t, tc.user.userID, tc.user.username, tc.user.admin))
			if rec.Code != tc.want {
				t.Fatalf("want %d, got %d: %s", tc.want, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestGetSongShape(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)

	rec := s.do(t, http.MethodGet, "/api/songs/s-a1", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := decodeMap(t, rec)
	song, ok := body["song"].(map[string]any)
	if !ok {
		t.Fatalf("response has no song object: %v", body)
	}

	// v1-parity field mapping.
	want := map[string]any{
		"id": "s-a1", "title": "One", "trackNumber": 1, "discNumber": 1,
		"duration": 200, "artistId": "ar-alpha", "albumId": "al-a1",
		"genre": "Jazz", "genreId": "g-jazz", "libraryId": "lib-a", "year": 2020,
		"explicit": false, "coverArt": "ca-s1", "albumCoverArt": "ca-a1",
		"coverArtMissing": false, "mtime": 100, "active": true,
		"bitRate": 320, "bitsPerSample": 16, "sampleRate": 44100, "channels": 2,
		"bpm": 128, "musicBrainzId": "mb-song-a1", "replayGain": -3.5,
		"averageRating": 4.5, "comment": "c", "sortName": "one", "mood": "mellow",
		"mediaType": "audio/flac", "originalReleaseDate": "2019-01-01",
		"releaseDate": "2020-01-01", "remixOf": "rmx", "displayArtist": "Alpha",
		"displayAlbumArtist": "Alpha", "lyrics": "la la", "originalYear": 2019,
		"originalArtist": "Orig", "gapless": true, "totalTracks": "10",
		"totalDiscs": "1", "artistName": "Alpha", "albumName": "A1",
		"albumArtistName": "Alpha", "starred": true, "rating": 4.5,
		"musicBrainzTrackId": "mb-trk-1", "musicBrainzWorkId": "mb-wrk-1",
		"musicBrainzDiscId": "mb-disc-1",
	}
	for key, wantVal := range want {
		got, ok := song[key]
		if !ok {
			t.Errorf("song missing key %q", key)
			continue
		}
		if fmt.Sprint(got) != fmt.Sprint(wantVal) {
			t.Errorf("song[%q]: want %v (%T), got %v (%T)", key, wantVal, wantVal, got, got)
		}
	}

	// Batch-attached relations.
	if got := song["artists"]; fmt.Sprint(got) != "[Alpha]" {
		t.Errorf("artists: %v", got)
	}
	entries, ok := song["artistEntries"].([]any)
	if !ok || len(entries) != 1 {
		t.Fatalf("artistEntries: %v", song["artistEntries"])
	}
	if e := entries[0].(map[string]any); e["id"] != "ar-alpha" || e["name"] != "Alpha" {
		t.Errorf("artistEntries[0]: %v", e)
	}
	composers, ok := song["composerEntries"].([]any)
	if !ok || len(composers) != 1 || composers[0].(map[string]any)["id"] != "ar-comp" {
		t.Errorf("composerEntries: %v", song["composerEntries"])
	}
	if _, ok := song["syncedLyrics"]; !ok {
		t.Error("syncedLyrics must be present and parsed")
	}
	if got := song["producers"]; fmt.Sprint(got) != "[P1 P2]" {
		t.Errorf("producers: %v", got)
	}
	if got := song["isrcs"]; fmt.Sprint(got) != "[ISRC-A1]" {
		t.Errorf("isrcs: %v", got)
	}

	// DTO contract: no server paths or content hashes leak.
	for _, banned := range []string{"filePath", "checksum"} {
		if _, present := song[banned]; present {
			t.Errorf("song DTO must not include %q", banned)
		}
	}
}

func TestGetSongMultiArtistEntries(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	rec := s.do(t, http.MethodGet, "/api/songs/s-a2", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	song := decodeMap(t, rec)["song"].(map[string]any)
	if got := song["artists"]; fmt.Sprint(got) != "[Alpha Feat]" {
		t.Errorf("artists order: %v", got)
	}
}

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------

func albumIDList(t *testing.T, rec *httptest.ResponseRecorder) []string {
	t.Helper()
	body := decodeMap(t, rec)
	raw, ok := body["albums"].([]any)
	if !ok {
		t.Fatalf("response has no albums array: %v", body)
	}
	ids := make([]string, 0, len(raw))
	for _, item := range raw {
		ids = append(ids, item.(map[string]any)["id"].(string))
	}
	return ids
}

func TestListAlbumsScopeMatrix(t *testing.T) {
	s := newSeededServer(t)
	want := map[string][]string{
		"admin":        {"al-a1", "al-a2", "al-b1", "al-b2", "al-c1", "al-d1", "al-empty"},
		"alice(lib-a)": {"al-a1", "al-a2"},
		"carol(lib-b)": {"al-b1", "al-b2"},
		"bob(none)":    {},
	}
	for _, u := range userMatrix() {
		t.Run(u.label, func(t *testing.T) {
			rec := s.do(t, http.MethodGet, "/api/albums", s.session(t, u.userID, u.username, u.admin))
			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
			}
			expectIDs(t, albumIDList(t, rec), want[u.label]...)
		})
	}
}

func TestListAlbumsFiltersAndCounts(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	alice := s.session(t, "user-alice", "alice", false)

	t.Run("by artist", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums?artistId=ar-alpha", admin)
		expectIDs(t, albumIDList(t, rec), "al-a1", "al-a2", "al-empty")
	})
	t.Run("by year", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums?year=2019", admin)
		expectIDs(t, albumIDList(t, rec), "al-b1", "al-b2")
	})
	t.Run("by genre", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums?genreId=g-ambient", admin)
		expectIDs(t, albumIDList(t, rec), "al-b1", "al-b2")
	})
	t.Run("by library", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums?libraryId=lib-a", alice)
		expectIDs(t, albumIDList(t, rec), "al-a1", "al-a2")
	})
	t.Run("hide explicit drops all-explicit albums", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums?hideExplicit=true", admin)
		expectIDs(t, albumIDList(t, rec), "al-a1", "al-a2", "al-b2", "al-c1", "al-d1", "al-empty")
	})
	t.Run("hide explicit alice keeps partial albums", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums?hideExplicit=true", alice)
		body := decodeMap(t, rec)
		ids := make([]string, 0)
		for _, item := range body["albums"].([]any) {
			ids = append(ids, item.(map[string]any)["id"].(string))
		}
		expectIDs(t, ids, "al-a1", "al-a2")
		for _, item := range body["albums"].([]any) {
			album := item.(map[string]any)
			if album["id"] != "al-a1" {
				continue
			}
			if f64(album["totalSongCount"]) != 2 || f64(album["shownSongCount"]) != 1 {
				t.Errorf("al-a1 counts: want total 2 shown 1, got %v/%v",
					album["totalSongCount"], album["shownSongCount"])
			}
			if album["explicit"] != true {
				t.Errorf("al-a1 explicit flag must reflect in-scope songs")
			}
		}
	})
	t.Run("list attaches relations", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums?artistId=ar-alpha", admin)
		body := decodeMap(t, rec)
		for _, item := range body["albums"].([]any) {
			album := item.(map[string]any)
			if album["id"] != "al-a1" {
				continue
			}
			if got := album["artists"]; fmt.Sprint(got) != "[Alpha]" {
				t.Errorf("artists: %v", got)
			}
			if got := album["genres"]; fmt.Sprint(got) != "[Jazz]" {
				t.Errorf("genres: %v", got)
			}
			labels, ok := album["labelEntries"].([]any)
			if !ok || len(labels) != 1 || labels[0].(map[string]any)["id"] != "l-one" {
				t.Errorf("labelEntries: %v", album["labelEntries"])
			}
			if got := album["catalogNumbers"]; fmt.Sprint(got) != "[CAT-1]" {
				t.Errorf("catalogNumbers: %v", got)
			}
			if album["musicBrainzAlbumId"] != "mb-al-a1" {
				t.Errorf("musicBrainzAlbumId: %v", album["musicBrainzAlbumId"])
			}
			if got := album["musicBrainzAlbumArtistIds"]; fmt.Sprint(got) != "[mb-alpha]" {
				t.Errorf("musicBrainzAlbumArtistIds: %v", got)
			}
		}
	})
	t.Run("starred from user_albums", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums", alice)
		body := decodeMap(t, rec)
		for _, item := range body["albums"].([]any) {
			album := item.(map[string]any)
			if album["id"] == "al-a1" && album["starred"] != true {
				t.Errorf("al-a1 must be starred for alice")
			}
		}
	})
}

func TestGetAlbumScopeAndShape(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	admin := s.session(t, "user-admin", "root", true)

	t.Run("out of scope is 404", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums/al-b1", alice)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d", rec.Code)
		}
	})
	t.Run("unknown is 404", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums/nope", admin)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d", rec.Code)
		}
	})
	t.Run("detail with songs", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums/al-a1", alice)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		body := decodeMap(t, rec)
		album := body["album"].(map[string]any)
		if album["id"] != "al-a1" || album["name"] != "A1" || f64(album["year"]) != 2020 {
			t.Errorf("album: %v", album)
		}
		if got := album["artists"]; fmt.Sprint(got) != "[Alpha]" {
			t.Errorf("artists: %v", got)
		}
		if got := album["genres"]; fmt.Sprint(got) != "[Jazz]" {
			t.Errorf("genres: %v", got)
		}
		if f64(album["totalSongCount"]) != 2 || f64(album["shownSongCount"]) != 2 {
			t.Errorf("counts: %v/%v", album["totalSongCount"], album["shownSongCount"])
		}
		// Songs come back in playing order with batch-attached credits.
		songs := body["songs"].([]any)
		if len(songs) != 2 || songs[0].(map[string]any)["id"] != "s-a1" {
			t.Fatalf("songs order: %v", songs)
		}
		song0 := songs[0].(map[string]any)
		if song0["artistName"] != "Alpha" || song0["albumName"] != "A1" {
			t.Errorf("song display names: %v", song0)
		}
		if _, banned := song0["filePath"]; banned {
			t.Error("album-embedded songs must not leak filePath")
		}
	})
	t.Run("hide explicit filters detail songs", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums/al-a1?hideExplicit=true", alice)
		body := decodeMap(t, rec)
		album := body["album"].(map[string]any)
		if f64(album["totalSongCount"]) != 2 || f64(album["shownSongCount"]) != 1 {
			t.Errorf("counts: want 2/1, got %v/%v", album["totalSongCount"], album["shownSongCount"])
		}
		songs := body["songs"].([]any)
		if len(songs) != 1 || songs[0].(map[string]any)["id"] != "s-a1" {
			t.Fatalf("songs: %v", songs)
		}
	})
	t.Run("all-explicit album shows empty song list", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/albums/al-b1?hideExplicit=true", admin)
		body := decodeMap(t, rec)
		album := body["album"].(map[string]any)
		if f64(album["totalSongCount"]) != 2 || f64(album["shownSongCount"]) != 0 {
			t.Errorf("counts: want 2/0, got %v/%v", album["totalSongCount"], album["shownSongCount"])
		}
		if songs := body["songs"].([]any); len(songs) != 0 {
			t.Errorf("songs must be empty: %v", songs)
		}
	})
	t.Run("empty album has zero counts", func(t *testing.T) {
		// v1's LEFT JOIN reported shownSongCount 1 for songless albums;
		// v2 counts only real songs.
		rec := s.do(t, http.MethodGet, "/api/albums/al-empty", admin)
		body := decodeMap(t, rec)
		album := body["album"].(map[string]any)
		if f64(album["totalSongCount"]) != 0 || f64(album["shownSongCount"]) != 0 {
			t.Errorf("counts: want 0/0, got %v/%v", album["totalSongCount"], album["shownSongCount"])
		}
	})
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

func TestListArtistsScopeMatrix(t *testing.T) {
	s := newSeededServer(t)
	// Admin (no library filter) sees every active artist — including ones
	// with no reachable songs (v1 parity). Scoped users see only artists
	// with an in-scope active song via songs.artist_id.
	want := map[string][]string{
		"admin":        {"ar-alpha", "ar-beta", "ar-gamma", "ar-delta", "ar-feat", "ar-comp"},
		"alice(lib-a)": {"ar-alpha"},
		"carol(lib-b)": {"ar-beta"},
		"bob(none)":    {},
	}
	for _, u := range userMatrix() {
		t.Run(u.label, func(t *testing.T) {
			rec := s.do(t, http.MethodGet, "/api/artists", s.session(t, u.userID, u.username, u.admin))
			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
			}
			body := decodeMap(t, rec)
			raw, ok := body["artists"].([]any)
			if !ok {
				t.Fatalf("no artists array: %v", body)
			}
			ids := make([]string, 0, len(raw))
			for _, item := range raw {
				ids = append(ids, item.(map[string]any)["id"].(string))
			}
			expectIDs(t, ids, want[u.label]...)
		})
	}
}

func TestListArtistsLibraryFilter(t *testing.T) {
	s := newSeededServer(t)
	admin := s.session(t, "user-admin", "root", true)
	rec := s.do(t, http.MethodGet, "/api/artists?libraryId=lib-b", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	body := decodeMap(t, rec)
	raw := body["artists"].([]any)
	ids := make([]string, 0, len(raw))
	for _, item := range raw {
		ids = append(ids, item.(map[string]any)["id"].(string))
	}
	expectIDs(t, ids, "ar-beta")
}

func TestGetArtistScopeAndShape(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	admin := s.session(t, "user-admin", "root", true)

	t.Run("out of scope is 404", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/artists/ar-beta", alice)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d", rec.Code)
		}
	})
	t.Run("inactive-only artist is 404 for scoped user", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/artists/ar-gamma", alice)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d", rec.Code)
		}
	})
	t.Run("junction-only artist reachable for admin only", func(t *testing.T) {
		// ar-feat appears in song_artists but never as songs.artist_id:
		// scoped users cannot reach it (the policy probes songs), while an
		// admin's unrestricted scope admits any active artist — v1 parity.
		rec := s.do(t, http.MethodGet, "/api/artists/ar-feat", alice)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("alice: want 404, got %d", rec.Code)
		}
		rec = s.do(t, http.MethodGet, "/api/artists/ar-feat", admin)
		if rec.Code != http.StatusOK {
			t.Fatalf("admin: want 200, got %d", rec.Code)
		}
	})
	t.Run("admin reaches inactive-song artist", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/artists/ar-gamma", admin)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d", rec.Code)
		}
	})
	t.Run("detail shape", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/artists/ar-alpha", alice)
		if rec.Code != http.StatusOK {
			t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
		}
		body := decodeMap(t, rec)
		artist := body["artist"].(map[string]any)
		if artist["id"] != "ar-alpha" || artist["name"] != "Alpha" {
			t.Errorf("artist: %v", artist)
		}
		if artist["artistImageUrl"] != "/api/artist-images/ar-alpha" {
			t.Errorf("artistImageUrl: %v", artist["artistImageUrl"])
		}
		if got := artist["musicBrainzArtistIds"]; fmt.Sprint(got) != "[mb-alpha]" {
			t.Errorf("musicBrainzArtistIds: %v", got)
		}
		if artist["bio"] != "Alpha bio" {
			t.Errorf("bio: %v", artist["bio"])
		}
		if artist["starred"] != true {
			t.Errorf("starred: %v", artist["starred"])
		}
		albums, ok := artist["albums"].([]any)
		if !ok || len(albums) != 2 {
			t.Fatalf("albums: %v", artist["albums"])
		}
		a0 := albums[0].(map[string]any)
		if a0["id"] != "al-a1" || f64(a0["totalSongCount"]) != 2 || f64(a0["shownSongCount"]) != 2 {
			t.Errorf("album card: %v", a0)
		}
		songs := body["songs"].([]any)
		if len(songs) != 4 {
			t.Fatalf("artist detail songs: %v", songs)
		}
	})
	t.Run("hide explicit on detail", func(t *testing.T) {
		rec := s.do(t, http.MethodGet, "/api/artists/ar-alpha?hideExplicit=true", alice)
		body := decodeMap(t, rec)
		songs := body["songs"].([]any)
		if len(songs) != 3 {
			t.Fatalf("songs: want 3, got %v", songs)
		}
		albums := body["artist"].(map[string]any)["albums"].([]any)
		for _, item := range albums {
			album := item.(map[string]any)
			if album["id"] == "al-a1" && (f64(album["totalSongCount"]) != 2 || f64(album["shownSongCount"]) != 1) {
				t.Errorf("al-a1 counts: %v", album)
			}
		}
	})
}

func TestListArtistSongs(t *testing.T) {
	s := newSeededServer(t)
	alice := s.session(t, "user-alice", "alice", false)
	admin := s.session(t, "user-admin", "root", true)

	rec := s.do(t, http.MethodGet, "/api/artists/ar-alpha/songs", alice)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	expectIDs(t, songIDList(t, rec), "s-a1", "s-a2", "s-a3", "s-a4")

	rec = s.do(t, http.MethodGet, "/api/artists/ar-alpha/songs?hideExplicit=true", alice)
	expectIDs(t, songIDList(t, rec), "s-a1", "s-a3", "s-a4")

	rec = s.do(t, http.MethodGet, "/api/artists/ar-beta/songs", alice)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}

	rec = s.do(t, http.MethodGet, "/api/artists/ar-delta/songs", admin)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	expectIDs(t, songIDList(t, rec), "s-na")
}

// ---------------------------------------------------------------------------
// Years
// ---------------------------------------------------------------------------

func TestListYearsScopeMatrix(t *testing.T) {
	s := newSeededServer(t)
	want := map[string][]int{
		"admin":        {2022, 2021, 2020, 2019, 2018, 2017, 1999},
		"alice(lib-a)": {2021, 2020, 1999},
		"carol(lib-b)": {2019},
		"bob(none)":    {},
	}
	for _, u := range userMatrix() {
		t.Run(u.label, func(t *testing.T) {
			rec := s.do(t, http.MethodGet, "/api/years", s.session(t, u.userID, u.username, u.admin))
			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
			}
			body := decodeMap(t, rec)
			raw, ok := body["years"].([]any)
			if !ok {
				t.Fatalf("no years array: %v", body)
			}
			got := make([]int, 0, len(raw))
			for _, item := range raw {
				got = append(got, int(item.(float64)))
			}
			if fmt.Sprint(got) != fmt.Sprint(want[u.label]) {
				t.Errorf("years: want %v, got %v", want[u.label], got)
			}
		})
	}
}
