package opensubsonic

import (
	"database/sql"
	"encoding/xml"
	"fmt"
	"regexp"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// xmlNorm strips the buildinfo-dependent serverVersion attribute so golden
// snapshots stay stable across release builds.
func xmlNorm(s string) string {
	return regexp.MustCompile(`serverVersion="[^"]*"`).ReplaceAllString(s, `serverVersion="X"`)
}

// getEnvelope issues an authed GET and asserts the OK envelope, returning the
// decoded payload map.
func getOK(t *testing.T, app *testApp, path, query string) map[string]any {
	t.Helper()
	rec := app.get(t, authedURL(path, query), nil)
	return assertOK(t, rec)
}

// ---------------------------------------------------------------------------
// getMusicFolders (B1)
// ---------------------------------------------------------------------------

func TestGetMusicFoldersAdminSeesAllRealIDs(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getMusicFolders.view", "")
	folders := env["musicFolders"].(map[string]any)["musicFolder"].([]any)
	if len(folders) != 2 {
		t.Fatalf("folders = %v", folders)
	}
	// B1 fix: real library ids, name order — not the old positional indexes.
	if folders[0].(map[string]any)["id"] != "lib-a" || folders[0].(map[string]any)["name"] != "Alpha" {
		t.Fatalf("folder[0] = %v", folders[0])
	}
	if folders[1].(map[string]any)["id"] != "lib-b" || folders[1].(map[string]any)["name"] != "Beta" {
		t.Fatalf("folder[1] = %v", folders[1])
	}
}

func TestGetMusicFoldersScopedToAssignments(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	_ = c

	env := getOK(t, app, "/rest/getMusicFolders.view", "")
	folders := env["musicFolders"].(map[string]any)["musicFolder"].([]any)
	if len(folders) != 1 || folders[0].(map[string]any)["id"] != "lib-a" {
		t.Fatalf("scoped folders = %v", folders)
	}
}

func TestGetMusicFoldersEmptyScopeEmptyList(t *testing.T) {
	app := newTestApp(t)
	// No assignments for alice.
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedLibrary(t, "lib-a", "Alpha")

	env := getOK(t, app, "/rest/getMusicFolders.view", "")
	folders := env["musicFolders"].(map[string]any)["musicFolder"].([]any)
	if len(folders) != 0 {
		t.Fatalf("empty scope must render [], got %v", folders)
	}
}

func TestGetMusicFoldersAdminEmptyLibrariesBasenameFallback(t *testing.T) {
	app := newTestApp(t)
	// libraryPath "/music" → basename "music" (B1's the retired server fallback).
	app.seedUser(t, testUserID, testUser, testPass, true)

	env := getOK(t, app, "/rest/getMusicFolders.view", "")
	folders := env["musicFolders"].(map[string]any)["musicFolder"].([]any)
	if len(folders) != 1 {
		t.Fatalf("fallback folders = %v", folders)
	}
	f := folders[0].(map[string]any)
	if f["id"] != "0" || f["name"] != "music" {
		t.Fatalf("fallback folder = %v", f)
	}
}

func TestGetMusicFoldersXML(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getMusicFolders.view", "&f=xml"), nil)
	body := xmlNorm(rec.Body.String())
	want := `<musicFolders>
    <musicFolder id="lib-a" name="Alpha"></musicFolder>
  </musicFolders>`
	if !strings.Contains(body, want) {
		t.Fatalf("getMusicFolders XML missing %q:\n%s", want, body)
	}
}

// ---------------------------------------------------------------------------
// getIndexes (B2/B3)
// ---------------------------------------------------------------------------

func TestGetIndexesLastModifiedFromContent(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getIndexes.view", "")
	indexes := env["indexes"].(map[string]any)
	// B2 fix: max active in-scope song mtime, not Date.now().
	if indexes["lastModified"] != float64(1700000003000) {
		t.Fatalf("lastModified = %v, want 1700000003000", indexes["lastModified"])
	}
	// B3: child/shortcut render as empty JSON arrays.
	if child := indexes["child"].([]any); len(child) != 0 {
		t.Fatalf("child = %v", child)
	}
	if sc := indexes["shortcut"].([]any); len(sc) != 0 {
		t.Fatalf("shortcut = %v", sc)
	}
	index := indexes["index"].([]any)
	if len(index) != 3 {
		t.Fatalf("index buckets = %v", index)
	}
	// Buckets: 1 (10cc), D (Bowie), T (Beatles) — admin is unscoped so the
	// songless 10cc still appears.
	names := []string{}
	for _, b := range index {
		names = append(names, b.(map[string]any)["name"].(string))
	}
	if strings.Join(names, ",") != "1,D,T" {
		t.Fatalf("bucket names = %v", names)
	}
	_ = c
}

func TestGetIndexesLastModifiedZeroWhenEmpty(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	// Alice has an assignment but the library has no songs.
	app.seedLibrary(t, "lib-a", "Alpha")
	app.assignLibrary(t, testUserID, "lib-a")

	env := getOK(t, app, "/rest/getIndexes.view", "")
	indexes := env["indexes"].(map[string]any)
	if indexes["lastModified"] != float64(0) {
		t.Fatalf("lastModified = %v, want 0", indexes["lastModified"])
	}
}

func TestGetIndexesScoped(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getIndexes.view", "")
	index := env["indexes"].(map[string]any)["index"].([]any)
	if len(index) != 1 || index[0].(map[string]any)["name"] != "T" {
		t.Fatalf("scoped index = %v", index)
	}
	artists := index[0].(map[string]any)["artist"].([]any)
	if len(artists) != 1 || artists[0].(map[string]any)["id"] != "ar-beatles" {
		t.Fatalf("scoped artists = %v", artists)
	}
}

// ---------------------------------------------------------------------------
// getArtists (B3/B7) — including the XML snapshot
// ---------------------------------------------------------------------------

func TestGetArtistsXMLSnapshot(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getArtists.view", "&f=xml"), nil)
	got := xmlNorm(rec.Body.String())
	want := `<subsonic-response status="ok" version="1.16.1" type="sonarly" serverVersion="X" openSubsonic="true">
  <artists ignoredArticles="">
    <index name="1">
      <artist id="ar-10cc" name="10cc" coverArt="ar-10cc" albumCount="0"></artist>
    </index>
    <index name="D">
      <artist id="ar-bowie" name="David Bowie" coverArt="ar-bowie" albumCount="2"></artist>
    </index>
    <index name="T">
      <artist id="ar-beatles" name="The Beatles" coverArt="ar-beatles" albumCount="1"></artist>
    </index>
  </artists>
</subsonic-response>`
	if got != want {
		t.Fatalf("getArtists XML mismatch:\n%s", got)
	}
}

func TestGetArtistsStarredEpoch(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	app.seedUserArtist(t, testUserID, c.ArBeatles, 1)

	env := getOK(t, app, "/rest/getArtists.view", "")
	index := env["artists"].(map[string]any)["index"].([]any)
	artists := index[0].(map[string]any)["artist"].([]any)
	a := artists[0].(map[string]any)
	// X6: the fabricated epoch star timestamp.
	if a["starred"] != epochStarred {
		t.Fatalf("starred = %v", a)
	}
}

func TestGetArtistsIncludesMusicBrainzIds(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")
	app.exec(t, `UPDATE artists SET musicbrainz_artist_ids = '["mbid-beatles"]' WHERE id = 'ar-beatles'`)

	env := getOK(t, app, "/rest/getArtists.view", "")
	index := env["artists"].(map[string]any)["index"].([]any)
	a := index[0].(map[string]any)["artist"].([]any)[0].(map[string]any)
	ids, ok := a["musicBrainzIds"].([]any)
	if !ok || len(ids) != 1 || ids[0] != "mbid-beatles" {
		t.Fatalf("musicBrainzIds = %v", a)
	}
}

func TestGetArtistsMalformedMBIDsColumnDropped(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")
	// X12 fix: a malformed JSON column must not 500 the response.
	app.exec(t, `UPDATE artists SET musicbrainz_artist_ids = '{broken' WHERE id = 'ar-beatles'`)

	env := getOK(t, app, "/rest/getArtists.view", "")
	index := env["artists"].(map[string]any)["index"].([]any)
	a := index[0].(map[string]any)["artist"].([]any)[0].(map[string]any)
	if _, present := a["musicBrainzIds"]; present {
		t.Fatalf("malformed column must drop the field: %v", a)
	}
}

// ---------------------------------------------------------------------------
// getArtist (B4/X15/X6)
// ---------------------------------------------------------------------------

func TestGetArtistShapeAndScopedAlbumCount(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")
	// Bowie's albums live in lib-b; alice only has lib-a — out of scope.
	rec := app.get(t, authedURL("/rest/getArtist.view", "&id=ar-bowie"), nil)
	assertFailed(t, rec, CodeForbidden)

	env := getOK(t, app, "/rest/getArtist.view", "&id=ar-beatles")
	artist := env["artist"].(map[string]any)
	if artist["id"] != "ar-beatles" || artist["coverArt"] != "ar-beatles" {
		t.Fatalf("artist = %v", artist)
	}
	if artist["albumCount"] != float64(1) {
		t.Fatalf("albumCount = %v", artist)
	}
}

func TestGetArtistAlbumsList(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getArtist.view", "&id=ar-bowie")
	artist := env["artist"].(map[string]any)
	if artist["albumCount"] != float64(2) {
		t.Fatalf("albumCount = %v", artist)
	}
	albums, ok := artist["album"].([]any)
	if !ok || len(albums) != 2 {
		t.Fatalf("album = %v", artist["album"])
	}
	// ORDER BY year, name: Low (1977) before Ziggy (1972)? No — 1972 first.
	if albums[0].(map[string]any)["id"] != "al-ziggy" {
		t.Fatalf("album order = %v", albums[0])
	}
}

func TestGetArtistMissingIs70(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getArtist.view", "&id=nope"), nil)
	assertFailed(t, rec, CodeForbidden)
}

func TestGetArtistInactiveIs70(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")
	app.exec(t, `UPDATE artists SET active = 0 WHERE id = 'ar-beatles'`)

	rec := app.get(t, authedURL("/rest/getArtist.view", "&id=ar-beatles"), nil)
	assertFailed(t, rec, CodeForbidden)
}

// ---------------------------------------------------------------------------
// getAlbum (B4/X13) — including the XML snapshot
// ---------------------------------------------------------------------------

func TestGetAlbumXMLSnapshot(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getAlbum.view", "&id=al-abbey&f=xml"), nil)
	got := xmlNorm(rec.Body.String())
	want := `<subsonic-response status="ok" version="1.16.1" type="sonarly" serverVersion="X" openSubsonic="true">
  <album id="al-abbey" name="Abbey Road" title="Abbey Road" album="Abbey Road" artist="The Beatles" artistId="ar-beatles" coverArt="ca-abbey" isDir="true" isVideo="false" parent="ar-beatles" songCount="2" duration="441" created="2023-11-14T22:13:21.000Z" year="1969" genre="Rock">
    <artists id="ar-beatles" name="The Beatles"></artists>
    <genres name="Rock"></genres>
    <song id="s-abbey-1" parent="al-abbey" title="Come Together" album="Abbey Road" albumId="al-abbey" artist="The Beatles" artistId="ar-beatles" displayArtist="The Beatles" displayAlbumArtist="The Beatles" displayTitle="Come Together" duration="259" isDir="false" isVideo="false" coverArt="al-abbey" created="2023-11-14T22:13:20.000Z" path="01-ComeTogether.mp3" size="0" suffix="mp3" contentType="audio/mpeg" type="music" track="1" discNumber="1" year="1969" genre="Rock" bitRate="320" mediaType="audio/mpeg">
      <artists id="ar-beatles" name="The Beatles"></artists>
      <albumArtists id="ar-beatles" name="The Beatles"></albumArtists>
      <genres name="Rock"></genres>
    </song>
    <song id="s-abbey-2" parent="al-abbey" title="Something" album="Abbey Road" albumId="al-abbey" artist="The Beatles" artistId="ar-beatles" displayArtist="The Beatles" displayAlbumArtist="The Beatles" displayTitle="Something" duration="182" isDir="false" isVideo="false" coverArt="al-abbey" created="2023-11-14T22:13:21.000Z" path="02-Something.mp3" size="0" suffix="mp3" contentType="audio/mpeg" type="music" track="2" discNumber="1" year="1969" genre="Rock" bitRate="320">
      <artists id="ar-beatles" name="The Beatles"></artists>
      <albumArtists id="ar-beatles" name="The Beatles"></albumArtists>
      <genres name="Rock"></genres>
    </song>
  </album>
</subsonic-response>`
	if got != want {
		t.Fatalf("getAlbum XML mismatch:\n%s", got)
	}
}

func TestGetAlbumJSONShape(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getAlbum.view", "&id=al-abbey")
	album := env["album"].(map[string]any)
	checks := map[string]any{
		"id": "al-abbey", "name": "Abbey Road", "title": "Abbey Road", "album": "Abbey Road",
		"artist": "The Beatles", "artistId": "ar-beatles", "coverArt": "ca-abbey",
		"parent": "ar-beatles", "songCount": float64(2), "duration": float64(441),
		"created": "2023-11-14T22:13:21.000Z", "year": float64(1969), "genre": "Rock",
	}
	for k, want := range checks {
		if album[k] != want {
			t.Fatalf("album[%q] = %v, want %v", k, album[k], want)
		}
	}
	if album["isDir"] != true || album["isVideo"] != false {
		t.Fatalf("album flags = %v", album)
	}
	// X13: genres array alongside the scalar genre.
	genres := album["genres"].([]any)
	if len(genres) != 1 || genres[0].(map[string]any)["name"] != "Rock" {
		t.Fatalf("genres = %v", genres)
	}
	songs := album["song"].([]any)
	if len(songs) != 2 || songs[0].(map[string]any)["id"] != "s-abbey-1" {
		t.Fatalf("songs = %v", songs)
	}
	// X2: bit_rate stored bits/sec → kbps.
	if songs[0].(map[string]any)["bitRate"] != float64(320) {
		t.Fatalf("bitRate = %v", songs[0])
	}
	// X7: albumArtists mirrors the song artists.
	if aa := songs[0].(map[string]any)["albumArtists"].([]any); len(aa) != 1 || aa[0].(map[string]any)["id"] != "ar-beatles" {
		t.Fatalf("albumArtists = %v", aa)
	}
}

func TestGetAlbumCreatedFallbackEpoch(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")
	// An album whose songs all vanished: created falls back to the epoch.
	app.seedAlbum(t, "al-empty", "Empty", "ar-beatles", 2001)

	env := getOK(t, app, "/rest/getAlbum.view", "&id=al-empty")
	album := env["album"].(map[string]any)
	if album["created"] != "1970-01-01T00:00:00.000Z" {
		t.Fatalf("created fallback = %v", album["created"])
	}
}

func TestGetAlbumOutOfScopeIs70(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getAlbum.view", "&id=al-low"), nil)
	assertFailed(t, rec, CodeForbidden)
}

func TestGetAlbumMissingIs70(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getAlbum.view", "&id=nope"), nil)
	assertFailed(t, rec, CodeForbidden)
}

func TestGetAlbumAverageRating(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")
	app.seedUserAlbum(t, testUserID, "al-abbey", 0, nullableRating(4))
	app.seedUserAlbum(t, "user-admin", "al-abbey", 0, nullableRating(2))

	env := getOK(t, app, "/rest/getAlbum.view", "&id=al-abbey")
	album := env["album"].(map[string]any)
	// the retired server average_rating = AVG over ALL user_albums rows (not just the caller).
	if album["averageRating"] != float64(3) {
		t.Fatalf("averageRating = %v", album)
	}
}

// ---------------------------------------------------------------------------
// getSong (B4, X-quirks)
// ---------------------------------------------------------------------------

func TestGetSongShapeAndInteractions(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	app.seedUserSong(t, testUserID, c.SAbbey1, 1, nullableRating(4.5), 7)

	env := getOK(t, app, "/rest/getSong.view", "&id=s-abbey-1")
	song := env["song"].(map[string]any)
	if song["id"] != "s-abbey-1" || song["title"] != "Come Together" {
		t.Fatalf("song = %v", song)
	}
	// X14: interactions only for authenticated callers (always true through
	// the hook, but the values come from the per-user row).
	if song["starred"] != epochStarred {
		t.Fatalf("starred = %v", song)
	}
	if song["userRating"] != float64(4.5) || song["playCount"] != float64(7) {
		t.Fatalf("interactions = %v", song)
	}
}

func TestGetSongXQuirks(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")
	// X4: replayGain is an object; X5: isrc + isrcs dual alias; X3: duration
	// floors at 1; X8: displayTitle from sort_name.
	app.seedSong(t, songSeed{
		ID: "s-quirk", Title: "Quirk", AlbumID: "al-abbey", ArtistID: "ar-beatles",
		LibraryID: "lib-a", Duration: 0, Mtime: 1700000000000,
		FilePath: "/elsewhere/quirk.mp3", ReplayGain: -3.5,
		ISRCsJSON: `["ISRC1","ISRC2"]`, SortName: "Quirk (Remaster)",
	})

	env := getOK(t, app, "/rest/getSong.view", "&id=s-quirk")
	song := env["song"].(map[string]any)
	rg := song["replayGain"].(map[string]any)
	if rg["trackGain"] != float64(-3.5) {
		t.Fatalf("replayGain = %v", rg)
	}
	if song["duration"] != float64(1) {
		t.Fatalf("duration floor = %v", song["duration"])
	}
	if song["displayTitle"] != "Quirk (Remaster)" {
		t.Fatalf("displayTitle = %v", song["displayTitle"])
	}
	isrcs := song["isrcs"].([]any)
	alias := song["isrc"].([]any)
	if len(isrcs) != 2 || len(alias) != 2 || isrcs[0] != "ISRC1" || alias[1] != "ISRC2" {
		t.Fatalf("isrcs = %v isrc = %v", isrcs, alias)
	}
	// X1: path falls back to the basename when no library root prefixes it.
	if song["path"] != "quirk.mp3" {
		t.Fatalf("path = %v", song["path"])
	}
}

func TestGetSongLibraryRelativePath(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")
	// Library path is /music/lib-a (seedLibrary); a file under it strips the
	// prefix (X1).
	app.seedSong(t, songSeed{
		ID: "s-rel", Title: "Rel", AlbumID: "al-abbey", ArtistID: "ar-beatles",
		LibraryID: "lib-a", Mtime: 1700000000000, FilePath: "/music/lib-a/beatles/x.mp3",
	})

	env := getOK(t, app, "/rest/getSong.view", "&id=s-rel")
	if path := env["song"].(map[string]any)["path"]; path != "beatles/x.mp3" {
		t.Fatalf("path = %v", path)
	}
}

func TestGetSongOutOfScopeIs70(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getSong.view", "&id=s-low-1"), nil)
	assertFailed(t, rec, CodeForbidden)
}

// ---------------------------------------------------------------------------
// getAlbumList / getAlbumList2 (B8)
// ---------------------------------------------------------------------------

func TestGetAlbumListAlphabeticalAndKeys(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getAlbumList.view", "")
	list := env["albumList"].(map[string]any)["album"].([]any)
	if len(list) != 3 || list[0].(map[string]any)["name"] != "Abbey Road" {
		t.Fatalf("albumList = %v", list)
	}

	env = getOK(t, app, "/rest/getAlbumList2.view", "")
	if _, ok := env["albumList2"]; !ok {
		t.Fatalf("albumList2 key missing: %v", env)
	}
	if _, ok := env["albumList"]; ok {
		t.Fatalf("albumList key must not leak into albumList2: %v", env)
	}
}

func TestGetAlbumListSizeClampAndOffset(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")
	for i := 0; i < 30; i++ {
		app.seedAlbum(t, fmt.Sprintf("al-extra-%02d", i), fmt.Sprintf("Extra %02d", i), "ar-beatles", 1990)
	}

	// B8: size is clamped to 500 — requesting 600 yields everything (33).
	env := getOK(t, app, "/rest/getAlbumList.view", "&size=600")
	list := env["albumList"].(map[string]any)["album"].([]any)
	if len(list) != 33 {
		t.Fatalf("size=600 clamp: got %d albums", len(list))
	}
	// Offset paginates.
	env = getOK(t, app, "/rest/getAlbumList.view", "&size=2&offset=1")
	list = env["albumList"].(map[string]any)["album"].([]any)
	if len(list) != 2 || list[0].(map[string]any)["name"] != "Extra 00" {
		t.Fatalf("offset page = %v", list[0])
	}
}

func TestGetAlbumListByYearSwapAndUnknownType(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	// B8: fromYear > toYear is swapped, window inclusive.
	env := getOK(t, app, "/rest/getAlbumList.view", "&type=byYear&fromYear=1975&toYear=1968")
	list := env["albumList"].(map[string]any)["album"].([]any)
	if len(list) != 2 {
		t.Fatalf("byYear window = %v", list)
	}
	// byYear orders year, name: Abbey Road (1969) then Ziggy (1972).
	if list[0].(map[string]any)["name"] != "Abbey Road" {
		t.Fatalf("byYear order = %v", list[0])
	}

	// Unknown type silently falls back to alphabeticalByName (B8).
	env = getOK(t, app, "/rest/getAlbumList2.view", "&type=bogus")
	list = env["albumList2"].(map[string]any)["album"].([]any)
	if len(list) != 3 || list[0].(map[string]any)["name"] != "Abbey Road" {
		t.Fatalf("unknown-type fallback = %v", list)
	}
}

func TestGetAlbumListNewest(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	// newest = per-album max song mtime DESC: ziggy (…003) low (…002) abbey (…001).
	env := getOK(t, app, "/rest/getAlbumList.view", "&type=newest")
	list := env["albumList"].(map[string]any)["album"].([]any)
	got := []string{}
	for _, a := range list {
		got = append(got, a.(map[string]any)["id"].(string))
	}
	if strings.Join(got, ",") != "al-ziggy,al-low,al-abbey" {
		t.Fatalf("newest order = %v", got)
	}
}

func TestGetAlbumListFrequent(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	app.seedUserSong(t, testUserID, c.SZiggy1, 0, nullableRating(0), 9)
	app.seedUserSong(t, testUserID, c.SAbbey1, 0, nullableRating(0), 2)

	// frequent = per-user play sums: ziggy (9) before abbey (2), low's NULL
	// aggregate sorts last (NULLS LAST).
	env := getOK(t, app, "/rest/getAlbumList.view", "&type=frequent")
	list := env["albumList"].(map[string]any)["album"].([]any)
	if len(list) != 3 || list[0].(map[string]any)["id"] != "al-ziggy" || list[1].(map[string]any)["id"] != "al-abbey" || list[2].(map[string]any)["id"] != "al-low" {
		t.Fatalf("frequent order = %v", list)
	}
}

func TestGetAlbumListGenreFilter(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getAlbumList.view", "&genre=Rock&size=500")
	list := env["albumList"].(map[string]any)["album"].([]any)
	if len(list) != 3 {
		t.Fatalf("genre filter = %v", list)
	}
	env = getOK(t, app, "/rest/getAlbumList.view", "&genre=Pop")
	list = env["albumList"].(map[string]any)["album"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["id"] != "al-ziggy" {
		t.Fatalf("pop filter = %v", list)
	}
}

// ---------------------------------------------------------------------------
// getGenres (B10)
// ---------------------------------------------------------------------------

func TestGetGenres(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getGenres.view", "")
	genres := env["genres"].(map[string]any)["genre"].([]any)
	if len(genres) != 2 {
		t.Fatalf("genres = %v", genres)
	}
	// B10: global counts, NOT scoped — alice sees lib-b's songs too.
	byName := map[string]map[string]any{}
	for _, g := range genres {
		byName[g.(map[string]any)["value"].(string)] = g.(map[string]any)
	}
	if byName["Rock"]["songCount"] != float64(3) || byName["Rock"]["albumCount"] != float64(3) {
		t.Fatalf("Rock = %v", byName["Rock"])
	}
	if byName["Pop"]["songCount"] != float64(0) || byName["Pop"]["albumCount"] != float64(1) {
		t.Fatalf("Pop = %v", byName["Pop"])
	}
}

func TestGetGenresXMLValueAsText(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getGenres.view", "&f=xml"), nil)
	body := rec.Body.String()
	// E6: the value field renders as element text.
	if !strings.Contains(body, `<genre albumCount="3" songCount="3">Rock</genre>`) {
		t.Fatalf("genre XML: %s", body)
	}
}

// ---------------------------------------------------------------------------
// search3 (B6/B7)
// ---------------------------------------------------------------------------

func TestSearch3XMLSnapshot(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/search3.view", "&query=abbey&f=xml"), nil)
	got := xmlNorm(rec.Body.String())
	want := `<subsonic-response status="ok" version="1.16.1" type="sonarly" serverVersion="X" openSubsonic="true">
  <searchResult3>
    <album id="al-abbey" name="Abbey Road" title="Abbey Road" album="Abbey Road" artist="The Beatles" artistId="ar-beatles" coverArt="ca-abbey" isDir="true" isVideo="false" parent="ar-beatles" songCount="2" duration="441" created="2023-11-14T22:13:21.000Z" year="1969" genre="Rock">
      <artists id="ar-beatles" name="The Beatles"></artists>
      <genres name="Rock"></genres>
    </album>
    <song id="s-abbey-1" parent="al-abbey" title="Come Together" album="Abbey Road" albumId="al-abbey" artist="The Beatles" artistId="ar-beatles" displayArtist="The Beatles" displayAlbumArtist="The Beatles" displayTitle="Come Together" duration="259" isDir="false" isVideo="false" coverArt="al-abbey" created="2023-11-14T22:13:20.000Z" path="01-ComeTogether.mp3" size="0" suffix="mp3" contentType="audio/mpeg" type="music" track="1" discNumber="1" year="1969" genre="Rock" bitRate="320" mediaType="audio/mpeg">
      <artists id="ar-beatles" name="The Beatles"></artists>
      <albumArtists id="ar-beatles" name="The Beatles"></albumArtists>
      <genres name="Rock"></genres>
    </song>
    <song id="s-abbey-2" parent="al-abbey" title="Something" album="Abbey Road" albumId="al-abbey" artist="The Beatles" artistId="ar-beatles" displayArtist="The Beatles" displayAlbumArtist="The Beatles" displayTitle="Something" duration="182" isDir="false" isVideo="false" coverArt="al-abbey" created="2023-11-14T22:13:21.000Z" path="02-Something.mp3" size="0" suffix="mp3" contentType="audio/mpeg" type="music" track="2" discNumber="1" year="1969" genre="Rock" bitRate="320">
      <artists id="ar-beatles" name="The Beatles"></artists>
      <albumArtists id="ar-beatles" name="The Beatles"></albumArtists>
      <genres name="Rock"></genres>
    </song>
  </searchResult3>
</subsonic-response>`
	if got != want {
		gl, wl := strings.Split(got, "\n"), strings.Split(want, "\n")
		for i := 0; i < len(gl) || i < len(wl); i++ {
			g, w := "", ""
			if i < len(gl) {
				g = gl[i]
			}
			if i < len(wl) {
				w = wl[i]
			}
			if g != w {
				t.Errorf("line %d:\n GOT %q\nWANT %q", i+1, g, w)
			}
		}
		t.Fatalf("search3 XML mismatch")
	}
}

func TestSearch3EmptyQueryPagination(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	// B6: empty query = unfiltered paginated browse (Symphonium sync mode).
	env := getOK(t, app, "/rest/search3.view", "&songCount=2&songOffset=0")
	songs := env["searchResult3"].(map[string]any)["song"].([]any)
	if len(songs) != 2 {
		t.Fatalf("page 1 = %v", songs)
	}
	env = getOK(t, app, "/rest/search3.view", "&songCount=2&songOffset=2")
	songs = env["searchResult3"].(map[string]any)["song"].([]any)
	if len(songs) != 2 || songs[0].(map[string]any)["id"] != "s-abbey-2" || songs[1].(map[string]any)["id"] != "s-low-1" {
		t.Fatalf("page 2 = %v", songs)
	}
	env = getOK(t, app, "/rest/search3.view", "&songCount=2&songOffset=4")
	if _, present := env["searchResult3"].(map[string]any)["song"]; present {
		t.Fatalf("page 3 must omit the song key (B6): %v", env["searchResult3"])
	}
}

// TestSearch3ToleratesLegacyFractionalSongNumerics is the regression for the
// corrected P10b finding (2026-09-26): production written by the retired server rows carry
// fractional REAL durations/bit_rates (Eminem catalog: duration 254.77,
// bit_rate 924936.36). SUM(duration) returns REAL in SQLite whenever any
// song is fractional, and albumStatsForMany's strict int scan failed the
// whole mapAlbums pipeline — search3/getAlbumList answered code 20
// "internal error" on real data. The tolerant db scan truncates instead.
func TestSearch3ToleratesLegacyFractionalSongNumerics(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	// Abbey Road: 259 + 182.9 = 441.9 -> truncated 441 (rounding would
	// give 442, so the truncation is observable).
	app.exec(t, `UPDATE songs SET duration = 182.9, bit_rate = 924936.3617333054 WHERE id = ?`, c.SAbbey2)

	env := getOK(t, app, "/rest/search3.view", "&query=abbey")
	sr := env["searchResult3"].(map[string]any)
	albums, ok := sr["album"].([]any)
	if !ok || len(albums) == 0 {
		t.Fatalf("no albums in searchResult3: %v", sr)
	}
	al := albums[0].(map[string]any)
	if d, _ := al["duration"].(float64); d != 441 {
		t.Errorf("album duration = %v, want 441 (truncated 441.9)", al["duration"])
	}

	// getAlbumList flows through the same mapAlbums pipeline.
	env = getOK(t, app, "/rest/getAlbumList.view", "&type=newest")
	if lst, ok := env["albumList"].(map[string]any); ok {
		if a, ok := lst["album"].([]any); !ok || len(a) == 0 {
			t.Errorf("albumList empty: %v", lst)
		}
	} else {
		t.Errorf("no albumList in %v", env)
	}
}

func TestSearch3CountClamp(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	// 600 songs to prove the 500 clamp (B6 fix).
	app.seedLibrary(t, "lib-a", "Alpha")
	for i := 0; i < 600; i++ {
		id := fmt.Sprintf("s-bulk-%03d", i)
		app.seedSong(t, songSeed{
			ID: id, Title: fmt.Sprintf("Bulk %03d", i), LibraryID: "lib-a",
			Mtime: 1700000000000, FilePath: "/x/" + id + ".mp3",
		})
	}

	env := getOK(t, app, "/rest/search3.view", "&query=Bulk&songCount=9999")
	songs := env["searchResult3"].(map[string]any)["song"].([]any)
	if len(songs) != 500 {
		t.Fatalf("songCount=9999 must clamp to 500, got %d", len(songs))
	}
}

func TestSearch3EmptyResultOmitsKeys(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/search3.view", "&query=zzzz-no-match")
	result := env["searchResult3"].(map[string]any)
	// B6: results omit empty artist/album/song keys.
	for _, k := range []string{"artist", "album", "song"} {
		if _, present := result[k]; present {
			t.Fatalf("key %q must be omitted in an empty result: %v", k, result)
		}
	}
}

func TestSearch3Scoped(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/search3.view", "")
	result := env["searchResult3"].(map[string]any)
	// Alice (lib-a only): bowie/ziggy/low must not leak.
	if _, present := result["album"]; present {
		for _, a := range result["album"].([]any) {
			if a.(map[string]any)["id"] != "al-abbey" {
				t.Fatalf("out-of-scope album leaked: %v", a)
			}
		}
	}
	songs := result["song"].([]any)
	for _, s := range songs {
		if s.(map[string]any)["id"] != "s-abbey-1" && s.(map[string]any)["id"] != "s-abbey-2" {
			t.Fatalf("out-of-scope song leaked: %v", s)
		}
	}
	if _, present := result["artist"]; !present {
		t.Fatalf("beatles must be searchable: %v", result)
	}
}

func TestSearch3LikeEscapesMetachars(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")
	app.seedArtist(t, "ar-100", "100% Sure")
	app.seedArtist(t, "ar-1000", "1000 Volt") // would match if % weren't escaped

	env := getOK(t, app, "/rest/search3.view", "&query=100%25")
	artists := env["searchResult3"].(map[string]any)["artist"].([]any)
	if len(artists) != 1 || artists[0].(map[string]any)["id"] != "ar-100" {
		t.Fatalf("LIKE escape: %v", artists)
	}
}

func TestSearch3QuoteStripping(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	// B6: surrounding quotes are stripped from the term.
	env := getOK(t, app, "/rest/search3.view", "&query=%22abbey%22")
	if _, present := env["searchResult3"].(map[string]any)["album"]; !present {
		t.Fatalf("quoted term must match: %v", env["searchResult3"])
	}
}

// ---------------------------------------------------------------------------
// getSongsByGenre (B9)
// ---------------------------------------------------------------------------

func TestGetSongsByGenre(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getSongsByGenre.view", "&genre=Rock")
	songs := env["songsByGenre"].(map[string]any)["song"].([]any)
	// Junction-based (songs without a song_genres row don't match): abbey-1,
	// abbey-2, low-1.
	if len(songs) != 3 {
		t.Fatalf("songsByGenre = %d songs", len(songs))
	}
	// Scoped.
	app.seedUser(t, "user-2", "bob", "bobpass", false)
	app.assignLibrary(t, "user-2", "lib-b")
	rec := app.get(t, fmt.Sprintf("/rest/getSongsByGenre.view?u=bob&t=%s&s=%s&genre=Rock",
		tokenFor("bobpass", testSalt), testSalt), nil)
	env = assertOK(t, rec)
	songs = env["songsByGenre"].(map[string]any)["song"].([]any)
	if len(songs) != 1 || songs[0].(map[string]any)["id"] != "s-low-1" {
		t.Fatalf("scoped songsByGenre = %v", songs)
	}
}

func TestGetSongsByGenreMissingParam(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getSongsByGenre.view", ""), nil)
	assertFailed(t, rec, CodeMissingParam)
}

func TestGetSongsByGenreSizeClamp(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedLibrary(t, "lib-a", "Alpha")
	app.seedGenre(t, "g-rock", "Rock")
	for i := 0; i < 600; i++ {
		id := fmt.Sprintf("s-gbulk-%03d", i)
		app.seedSong(t, songSeed{ID: id, Title: id, LibraryID: "lib-a", Mtime: 1, FilePath: "/x/" + id + ".mp3"})
		app.junction(t, "song_genres", "song_id", "genre_id", id, "g-rock", 0)
	}

	env := getOK(t, app, "/rest/getSongsByGenre.view", "&genre=Rock&size=9999")
	songs := env["songsByGenre"].(map[string]any)["song"].([]any)
	if len(songs) != 500 {
		t.Fatalf("size clamp = %d", len(songs))
	}
}

// ---------------------------------------------------------------------------
// getRandomSongs
// ---------------------------------------------------------------------------

func TestGetRandomSongs(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getRandomSongs.view", "&size=2")
	songs := env["randomSongs"].(map[string]any)["song"].([]any)
	if len(songs) != 2 {
		t.Fatalf("randomSongs = %v", songs)
	}
	// size clamp.
	env = getOK(t, app, "/rest/getRandomSongs.view", "&size=9999")
	songs = env["randomSongs"].(map[string]any)["song"].([]any)
	if len(songs) != 4 {
		t.Fatalf("size=9999 clamp = %d", len(songs))
	}
	// Scoped to the caller.
	rec := app.get(t, authedURL("/rest/getRandomSongs.view", "&size=9999"), nil)
	_ = rec
}

func TestGetRandomSongsScopedAndFiltered(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")

	// Alice only reaches lib-a: 2 songs, both abbey tracks.
	env := getOK(t, app, "/rest/getRandomSongs.view", "&size=50")
	songs := env["randomSongs"].(map[string]any)["song"].([]any)
	if len(songs) != 2 {
		t.Fatalf("scoped random = %d", len(songs))
	}

	// Year window (swapped bounds behave the same): abbey tracks are 1969,
	// so 1980..1990 matches nothing for alice; the song array still renders
	// as [] (old always emits it).
	env = getOK(t, app, "/rest/getRandomSongs.view", "&fromYear=1990&toYear=1980")
	songs = env["randomSongs"].(map[string]any)["song"].([]any)
	if len(songs) != 0 {
		t.Fatalf("empty year window = %v", songs)
	}
}

// ---------------------------------------------------------------------------
// getTopSongs (B9)
// ---------------------------------------------------------------------------

func TestGetTopSongs(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	app.seedUserSong(t, testUserID, c.SZiggy1, 0, nullableRating(0), 10)
	app.seedUserSong(t, testUserID, c.SLow1, 0, nullableRating(0), 3)

	// Case-insensitive artist match across primary/junction/album artists.
	env := getOK(t, app, "/rest/getTopSongs.view", "&artist=dAVID+bOWIE")
	songs := env["topSongs"].(map[string]any)["song"].([]any)
	if len(songs) != 2 || songs[0].(map[string]any)["id"] != "s-ziggy-1" {
		t.Fatalf("topSongs = %v", songs)
	}
}

func TestGetTopSongsMissingParam(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getTopSongs.view", ""), nil)
	assertFailed(t, rec, CodeMissingParam)
}

// ---------------------------------------------------------------------------
// getSimilarSongs2 (B4)
// ---------------------------------------------------------------------------

func TestGetSimilarSongs2(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getSimilarSongs2.view", "&id=s-abbey-1&count=10")
	songs := env["similarSongs2"].(map[string]any)["song"].([]any)
	// Same artist (primary or junction), seed excluded: only s-abbey-2.
	if len(songs) != 1 || songs[0].(map[string]any)["id"] != "s-abbey-2" {
		t.Fatalf("similarSongs2 = %v", songs)
	}
}

func TestGetSimilarSongs2AlbumFallbackAndMissing(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")
	// Song with no artist: falls back to album peers.
	app.seedSong(t, songSeed{
		ID: "s-noartist", Title: "No Artist", AlbumID: "al-abbey", LibraryID: "lib-a",
		Mtime: 1700000000000, FilePath: "/x/na.mp3",
	})

	env := getOK(t, app, "/rest/getSimilarSongs2.view", "&id=s-noartist")
	songs := env["similarSongs2"].(map[string]any)["song"].([]any)
	if len(songs) != 2 {
		t.Fatalf("album-peer similar = %v", songs)
	}

	rec := app.get(t, authedURL("/rest/getSimilarSongs2.view", "&id=nope"), nil)
	assertFailed(t, rec, CodeForbidden)
}

func TestGetSimilarSongs2Scoped(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")

	// Seed is alice-visible; the same-artist lib-a peer is in scope, the
	// lib-b bowie peers are not.
	env := getOK(t, app, "/rest/getSimilarSongs2.view", "&id=s-abbey-1&count=10")
	songs := env["similarSongs2"].(map[string]any)["song"].([]any)
	if len(songs) != 1 || songs[0].(map[string]any)["id"] != "s-abbey-2" {
		t.Fatalf("scoped peers = %v", songs)
	}
	// Out-of-scope seed: wire parity — the probe has no scope check (B4 covers
	// missing/inactive), and the candidate query is scoped, so the answer is
	// an empty list, never a leak of lib-b content.
	rec := app.get(t, authedURL("/rest/getSimilarSongs2.view", "&id=s-low-1"), nil)
	env = assertOK(t, rec)
	if songs := env["similarSongs2"].(map[string]any)["song"].([]any); len(songs) != 0 {
		t.Fatalf("out-of-scope seed candidates = %v", songs)
	}
}

// ---------------------------------------------------------------------------
// getArtistInfo2 (B4)
// ---------------------------------------------------------------------------

func TestGetArtistInfo2(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")
	app.exec(t, `UPDATE artists SET artist_image_url = 'https://img/bowie.jpg',
		musicbrainz_artist_ids = '["mb-b1","mb-b2"]' WHERE id = 'ar-bowie'`)

	env := getOK(t, app, "/rest/getArtistInfo2.view", "&id=ar-bowie")
	info := env["artistInfo2"].(map[string]any)
	if info["biography"] != "" || info["smallImageUrl"] != "https://img/bowie.jpg" ||
		info["largeImageUrl"] != "https://img/bowie.jpg" || info["musicBrainzId"] != "mb-b1" {
		t.Fatalf("artistInfo2 = %v", info)
	}
	// Similar artists share an album genre with bowie (Rock): beatles.
	similar, ok := info["similarArtists"].([]any)
	if !ok || len(similar) == 0 {
		t.Fatalf("similarArtists = %v", info)
	}
	found := false
	for _, s := range similar {
		if s.(map[string]any)["id"] == "ar-beatles" {
			found = true
		}
		if s.(map[string]any)["id"] == "ar-bowie" {
			t.Fatalf("self in similar: %v", similar)
		}
	}
	if !found {
		t.Fatalf("beatles must be similar: %v", similar)
	}
}

// the retired server always emits similarArtists — [] when no similar artists exist.
func TestGetArtistInfo2EmitsEmptySimilarArtists(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getArtistInfo2.view", "&id=ar-10cc")
	info := env["artistInfo2"].(map[string]any)
	similar, ok := info["similarArtists"].([]any)
	if !ok || len(similar) != 0 {
		t.Fatalf("empty similarArtists must render as [] (wire parity): %v", info)
	}
}

func TestGetArtistInfo2EmptyStructure(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	// No image, no MB ids: the empty structure, exactly like the old adapter.
	env := getOK(t, app, "/rest/getArtistInfo2.view", "&id=ar-beatles")
	info := env["artistInfo2"].(map[string]any)
	if info["biography"] != "" {
		t.Fatalf("biography = %v", info)
	}
	for _, k := range []string{"smallImageUrl", "largeImageUrl", "musicBrainzId"} {
		if _, present := info[k]; present {
			t.Fatalf("%s must be omitted when absent: %v", k, info)
		}
	}
}

func TestGetArtistInfo2MissingAndOutOfScope(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getArtistInfo2.view", "&id=nope"), nil)
	assertFailed(t, rec, CodeForbidden)
	// Bowie has no lib-a songs → out of scope → 70 (Go-server scope enforcement on
	// an endpoint the retired server left unscoped; recorded under B4).
	rec = app.get(t, authedURL("/rest/getArtistInfo2.view", "&id=ar-bowie"), nil)
	assertFailed(t, rec, CodeForbidden)
}

// ---------------------------------------------------------------------------
// getAlbumInfo / getAlbumInfo2 (B5)
// ---------------------------------------------------------------------------

func TestGetAlbumInfoBothEndpointsReturnAlbumInfo(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")
	app.exec(t, `UPDATE albums SET musicbrainz_album_id = 'mb-abbey' WHERE id = 'al-abbey'`)

	for _, ep := range []string{"getAlbumInfo", "getAlbumInfo2"} {
		env := getOK(t, app, "/rest/"+ep+".view", "&id=al-abbey")
		// B5: BOTH endpoints answer the albumInfo element.
		info, ok := env["albumInfo"].(map[string]any)
		if !ok {
			t.Fatalf("%s must return albumInfo: %v", ep, env)
		}
		if info["notes"] != "" || info["musicBrainzId"] != "mb-abbey" {
			t.Fatalf("%s albumInfo = %v", ep, info)
		}
		if _, wrong := env["albumInfo2"]; wrong {
			t.Fatalf("%s must NOT return albumInfo2: %v", ep, env)
		}
	}
}

func TestGetAlbumInfoXML(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getAlbumInfo2.view", "&id=al-abbey&f=xml"), nil)
	body := rec.Body.String()
	if !strings.Contains(body, `<albumInfo notes="">`) {
		t.Fatalf("albumInfo element: %s", body)
	}
	if strings.Contains(body, "albumInfo2") {
		t.Fatalf("albumInfo2 must not appear: %s", body)
	}
}

func TestGetAlbumInfoMissingAndOutOfScope(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getAlbumInfo.view", "&id=nope"), nil)
	assertFailed(t, rec, CodeForbidden)
	rec = app.get(t, authedURL("/rest/getAlbumInfo2.view", "&id=al-low"), nil)
	assertFailed(t, rec, CodeForbidden)
}

// ---------------------------------------------------------------------------
// Cross-cutting: anonymous auth on browsing endpoints (A-group)
// ---------------------------------------------------------------------------

func TestBrowsingAnonymousIs10(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	for _, path := range []string{
		"/rest/getMusicFolders.view",
		"/rest/getIndexes.view",
		"/rest/getAlbum.view?id=al-abbey",
		"/rest/search3.view",
	} {
		rec := app.get(t, path, nil)
		assertFailed(t, rec, CodeMissingParam)
	}
}

// ---------------------------------------------------------------------------
// XML envelope well-formedness on a complex payload
// ---------------------------------------------------------------------------

func TestGetAlbumXMLWellFormed(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getAlbum.view", "&id=al-abbey&f=xml"), nil)
	var v any
	if err := xml.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("getAlbum XML not well-formed: %v", err)
	}
}

func nullableRating(f float64) sql.NullFloat64 {
	return sql.NullFloat64{Float64: f, Valid: true}
}

// TestGetSongLiveFileSize is the X9 sign-off: `size` is a live stat at
// serialize time — the real byte count for existing files, 0 when the file
// vanished (the old statSync-in-try/catch).
func TestGetSongLiveFileSize(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	target := app.seedFileSong(t, c, c.SAbbey1, "spike.mp3")

	env := getOK(t, app, "/rest/getSong.view", "&id="+c.SAbbey1)
	if size := env["song"].(map[string]any)["size"]; size != float64(fileLen(t, target)) {
		t.Fatalf("live size = %v, want %d", size, fileLen(t, target))
	}

	// Vanished file → 0, never a serializer error.
	app.exec(t, `UPDATE songs SET file_path = '/gone/vanished.mp3' WHERE id = ?`, c.SAbbey1)
	env = getOK(t, app, "/rest/getSong.view", "&id="+c.SAbbey1)
	if size := env["song"].(map[string]any)["size"]; size != float64(0) {
		t.Fatalf("vanished size = %v", size)
	}
}
