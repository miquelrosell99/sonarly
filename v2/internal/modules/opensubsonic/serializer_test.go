package opensubsonic

import (
	"encoding/json"
	"reflect"
	"testing"
)

func strPtr(s string) *string     { return &s }
func intPtr(i int) *int           { return &i }
func floatPtr(f float64) *float64 { return &f }

// TestMapSongWireShape exercises the mapping rules v1 clients depend on
// (quirks doc X1-X11) on one fully-populated source.
func TestMapSongWireShape(t *testing.T) {
	src := SongSource{
		ID:                 "s1",
		Title:              "Track",
		AlbumID:            strPtr("al1"),
		ArtistID:           strPtr("ar1"),
		TrackNumber:        intPtr(3),
		DiscNumber:         intPtr(1),
		Genre:              strPtr("Primary"),
		Year:               intPtr(2020),
		Duration:           intPtr(200),
		CoverArtID:         strPtr("ca1"),
		MtimeMillis:        1700000000000, // 2023-11-14T22:13:20.000Z
		FilePath:           "/music/lib/Artist/Album/track.MP3",
		LibraryPath:        strPtr("/music/lib"),
		BitRate:            intPtr(320000),
		BPM:                intPtr(128),
		MusicBrainzTrackID: strPtr("mb-track"),
		ReplayGain:         floatPtr(-5.5),
		SortName:           strPtr("Sort Track"),
		MediaType:          strPtr("audio/mpeg"),
		AlbumName:          strPtr("Album"),
		ArtistName:         strPtr("Artist"),
		ISRCsJSON:          strPtr(`["X1","X2"]`),
		Gapless:            true,
		TotalTracks:        strPtr("10"),
	}

	song := MapSong(src,
		[]Entry{{ID: "ar1", Name: "Artist"}},
		[]Entry{{ID: "cp1", Name: "Composer"}},
		[]string{"Rock", "Alt"},
		true,
	)

	// X1: library-relative path, X9: lowercased suffix.
	if song.Path != "Artist/Album/track.MP3" {
		t.Errorf("path = %q, want library-relative", song.Path)
	}
	if song.Suffix != "mp3" {
		t.Errorf("suffix = %q, want mp3", song.Suffix)
	}
	// X2: bits/sec → kbps.
	if song.BitRate == nil || *song.BitRate != 320 {
		t.Errorf("bitRate = %v, want 320", song.BitRate)
	}
	// X4: replayGain object.
	if song.ReplayGain == nil || song.ReplayGain.TrackGain != -5.5 {
		t.Errorf("replayGain = %+v", song.ReplayGain)
	}
	// X5: isrc/isrcs dual alias.
	if !reflect.DeepEqual(song.ISRCs, []string{"X1", "X2"}) || !reflect.DeepEqual(song.ISRC, []string{"X1", "X2"}) {
		t.Errorf("isrc alias = %v / %v", song.ISRCs, song.ISRC)
	}
	// X7: albumArtists duplicates the song artists.
	if !reflect.DeepEqual(song.AlbumArtists, song.Artists) || len(song.Artists) != 1 {
		t.Errorf("artists = %v, albumArtists = %v", song.Artists, song.AlbumArtists)
	}
	// X8: displayTitle falls back through sort_name.
	if song.DisplayTitle != "Sort Track" {
		t.Errorf("displayTitle = %q", song.DisplayTitle)
	}
	if song.Genre != "Rock" || len(song.Genres) != 2 || song.Genres[1].Name != "Alt" {
		t.Errorf("genre = %q genres = %+v", song.Genre, song.Genres)
	}
	if song.Composers == nil || song.Composers[0] != "Composer" {
		t.Errorf("composers = %v", song.Composers)
	}
	if song.Created != "2023-11-14T22:13:20.000Z" {
		t.Errorf("created = %q", song.Created)
	}
	if song.TrackCount == nil || *song.TrackCount != 10 {
		t.Errorf("trackCount = %v", song.TrackCount)
	}
	if !song.Gapless {
		t.Error("gapless must be true")
	}
}

// TestMapSongMinimalJSONShape deep-compares the JSON of an anonymous,
// minimally-populated song against the exact key set v1 emitted — the
// always-present keys with their empty defaults, and no interaction keys.
func TestMapSongMinimalJSONShape(t *testing.T) {
	src := SongSource{
		ID:          "s1",
		Title:       "T",
		FilePath:    "/music/lib/A/B/t.mp3",
		LibraryPath: strPtr("/music/lib"),
		MtimeMillis: 1700000000000,
	}
	song := MapSong(src, nil, nil, nil, false)

	gotJSON, err := json.Marshal(song)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(gotJSON, &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"id": "s1", "parent": "", "title": "T", "album": "", "albumId": "",
		"artist": "", "artistId": "", "artists": []any{}, "albumArtists": []any{},
		"displayArtist": "", "displayAlbumArtist": "", "displayTitle": "T",
		"duration": float64(1), "isDir": false, "isVideo": false, "coverArt": "",
		"created": "2023-11-14T22:13:20.000Z", "path": "A/B/t.mp3",
		"size": float64(0), "suffix": "mp3", "contentType": "audio/mpeg", "type": "music",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("JSON shape mismatch:\n got: %v\nwant: %v", got, want)
	}
}

func TestMapSongInteractionGating(t *testing.T) {
	src := SongSource{
		ID: "s1", Title: "T", FilePath: "/x/t.mp3",
		MtimeMillis: 1700000000000,
		Starred:     true,
		Rating:      floatPtr(4.5),
		PlayCount:   intPtr(7),
	}

	anon := MapSong(src, nil, nil, nil, false)
	if anon.Starred != "" || anon.UserRating != nil || anon.PlayCount != nil {
		t.Fatalf("anonymous song leaked interactions: %+v", anon)
	}

	authd := MapSong(src, nil, nil, nil, true)
	// X6: starred fabricates the epoch date.
	if authd.Starred != "1970-01-01T00:00:00.000Z" {
		t.Errorf("starred = %q", authd.Starred)
	}
	if authd.UserRating == nil || *authd.UserRating != 4.5 {
		t.Errorf("userRating = %v", authd.UserRating)
	}
	if authd.PlayCount == nil || *authd.PlayCount != 7 {
		t.Errorf("playCount = %v", authd.PlayCount)
	}
}

func TestMapSongPathFallbacks(t *testing.T) {
	// No library root at all → bare basename (never absolute).
	song := MapSong(SongSource{ID: "s", Title: "t", FilePath: "/music/x/t.mp3"}, nil, nil, nil, false)
	if song.Path != "t.mp3" {
		t.Errorf("no library path: path = %q", song.Path)
	}
	// File outside the library root → basename too.
	song = MapSong(SongSource{ID: "s", Title: "t", FilePath: "/elsewhere/t.mp3", LibraryPath: strPtr("/music")}, nil, nil, nil, false)
	if song.Path != "t.mp3" {
		t.Errorf("outside library: path = %q", song.Path)
	}
}

func TestMapSongDurationFloor(t *testing.T) {
	for _, tc := range []struct {
		name string
		d    *int
		want int
	}{
		{"nil becomes 1", nil, 1},
		{"zero becomes 1", intPtr(0), 1},
		{"negative becomes 1", intPtr(-5), 1},
		{"real value kept", intPtr(200), 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			song := MapSong(SongSource{ID: "s", Title: "t", FilePath: "/x/t.mp3", Duration: tc.d}, nil, nil, nil, false)
			if song.Duration != tc.want {
				t.Fatalf("duration = %d, want %d", song.Duration, tc.want)
			}
		})
	}
}

func TestMapSongContentTypeFallbacks(t *testing.T) {
	// Stored media type wins.
	song := MapSong(SongSource{ID: "s", Title: "t", FilePath: "/x/t.mp3", MediaType: strPtr("audio/x-custom")}, nil, nil, nil, false)
	if song.ContentType != "audio/x-custom" {
		t.Errorf("stored media type = %q", song.ContentType)
	}
	// Unknown extension falls back to audio/mpeg.
	song = MapSong(SongSource{ID: "s", Title: "t", FilePath: "/x/t.unknownext"}, nil, nil, nil, false)
	if song.ContentType != "audio/mpeg" {
		t.Errorf("unknown ext content type = %q", song.ContentType)
	}
}

func TestMapSongDateValidation(t *testing.T) {
	cases := []struct {
		value string
		want  bool
	}{
		{"2020-05-01", true},
		{"2020", true},
		{"2020-05-01T10:00:00Z", true},
		{"0000", false},
		{"0000-00-00", false},
		{"0000-00-00T00:00:00", false},
		{"not a date", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := validDateString(strPtr(tc.value)); got != tc.want {
			t.Errorf("validDateString(%q) = %v, want %v", tc.value, got, tc.want)
		}
	}
	// Mapper wiring: invalid dates are omitted, valid ones kept.
	src := SongSource{
		ID: "s", Title: "t", FilePath: "/x/t.mp3",
		OriginalReleaseDate: strPtr("0000-00-00"), ReleaseDate: strPtr("1999-01-01"),
	}
	song := MapSong(src, nil, nil, nil, false)
	if song.OriginalReleaseDate != "" {
		t.Errorf("zero originalReleaseDate leaked: %q", song.OriginalReleaseDate)
	}
	if song.ReleaseDate != "1999-01-01" {
		t.Errorf("releaseDate = %q", song.ReleaseDate)
	}
}

func TestJsParseInt(t *testing.T) {
	cases := []struct {
		value *string
		want  *int
	}{
		{nil, nil},
		{strPtr("12"), intPtr(12)},
		{strPtr("12 of 15"), intPtr(12)}, // v1 parseInt stops at non-digits
		{strPtr("abc"), nil},
		{strPtr("  7"), intPtr(7)},
		{strPtr(""), nil},
	}
	for _, tc := range cases {
		got := jsParseInt(tc.value)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("jsParseInt(%v) = %v, want %v", tc.value, got, tc.want)
		}
	}
}

func TestParseStringArrayGuarded(t *testing.T) {
	cases := []struct {
		value *string
		want  []string
	}{
		{nil, nil},
		{strPtr(`["a","b"]`), []string{"a", "b"}},
		{strPtr(`["a",42,""]`), []string{"a"}}, // non-strings and empties dropped
		{strPtr(`{"not":"array"}`), nil},       // X12 fix: malformed never panics
		{strPtr(`garbage`), nil},
	}
	for _, tc := range cases {
		if got := parseStringArray(tc.value); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("parseStringArray(%v) = %v, want %v", tc.value, got, tc.want)
		}
	}
}

// TestMapAlbumDefaults covers the v1 fallbacks: coverArt → album id,
// created → epoch, title/album duplicate name, songCount → len(songs),
// parent/artistId → artist_id (quirks doc X13).
func TestMapAlbumDefaults(t *testing.T) {
	src := AlbumSource{
		ID:       "al1",
		Name:     "Album",
		ArtistID: strPtr("ar1"),
		// X12 fix: malformed JSON columns are dropped, not fatal.
		CatalogNumbersJSON: strPtr(`{bad json`),
	}
	album := MapAlbum(src, nil, 0, false, nil, nil, nil, nil, nil)

	if album.CoverArt != "al1" {
		t.Errorf("coverArt = %q, want album id fallback", album.CoverArt)
	}
	if album.Created != "1970-01-01T00:00:00.000Z" {
		t.Errorf("created = %q", album.Created)
	}
	if album.Title != "Album" || album.Album != "Album" {
		t.Errorf("title/album = %q/%q", album.Title, album.Album)
	}
	if album.SongCount != 0 || album.Parent != "ar1" || album.ArtistID != "ar1" {
		t.Errorf("songCount/parent/artistId = %d/%q/%q", album.SongCount, album.Parent, album.ArtistID)
	}
	if len(album.Artists) != 1 || album.Artists[0].ID != "ar1" {
		t.Errorf("artists fallback = %+v", album.Artists)
	}
	if album.CatalogNumbers != nil {
		t.Errorf("malformed catalogNumbers must be dropped, got %v", album.CatalogNumbers)
	}
	if album.Artist != "" {
		t.Errorf("artist = %q, want empty (no entries, no name)", album.Artist)
	}
}

func TestMapAlbumPopulated(t *testing.T) {
	src := AlbumSource{
		ID: "al1", Name: "Album",
		CoverArtID:                    strPtr("ca1"),
		Year:                          intPtr(2001),
		Genre:                         strPtr("Rock"),
		CatalogNumbersJSON:            strPtr(`["cat-1"]`),
		Barcode:                       strPtr("1234"),
		MusicBrainzAlbumID:            strPtr("mb-album"),
		MusicBrainzAlbumArtistIDsJSON: strPtr(`["mb-ar1"]`),
		Compilation:                   true,
		TotalDiscs:                    strPtr("2"),
		Starred:                       true,
		Rating:                        floatPtr(5),
	}
	songs := []Song{{ID: "s1"}, {ID: "s2"}}
	created := "2024-01-02T03:04:05.000Z"
	count := 9

	album := MapAlbum(src, songs, 360, true,
		[]Entry{{ID: "ar1", Name: "Artist A"}, {ID: "ar2", Name: "Artist B"}},
		[]string{"Rock"}, []string{"Label X"}, &count, &created)

	if album.CoverArt != "ca1" || album.Year == nil || *album.Year != 2001 {
		t.Errorf("coverArt/year = %q/%v", album.CoverArt, album.Year)
	}
	if album.Artist != "Artist A / Artist B" || album.ArtistID != "ar1" || album.Parent != "ar1" {
		t.Errorf("artist/artistId/parent = %q/%q/%q", album.Artist, album.ArtistID, album.Parent)
	}
	if album.SongCount != 9 || album.Duration != 360 || album.Created != created {
		t.Errorf("count/duration/created = %d/%d/%q", album.SongCount, album.Duration, album.Created)
	}
	if len(album.Song) != 2 || len(album.Labels) != 1 || album.Labels[0] != "Label X" {
		t.Errorf("song/labels = %d/%v", len(album.Song), album.Labels)
	}
	if !reflect.DeepEqual(album.CatalogNumbers, []string{"cat-1"}) || album.Barcode != "1234" {
		t.Errorf("catalogNumbers/barcode = %v/%q", album.CatalogNumbers, album.Barcode)
	}
	if album.MusicBrainzID != "mb-album" || !reflect.DeepEqual(album.MusicBrainzArtistIDs, []string{"mb-ar1"}) {
		t.Errorf("musicbrainz = %q/%v", album.MusicBrainzID, album.MusicBrainzArtistIDs)
	}
	if !album.Compilation || album.DiscCount == nil || *album.DiscCount != 2 {
		t.Errorf("compilation/discCount = %v/%v", album.Compilation, album.DiscCount)
	}
	if album.Starred != "1970-01-01T00:00:00.000Z" || album.UserRating == nil || *album.UserRating != 5 {
		t.Errorf("interactions = %q/%v", album.Starred, album.UserRating)
	}
}

func TestMapArtist(t *testing.T) {
	src := ArtistSource{
		ID: "ar1", Name: "Artist",
		ArtistImageURL:     strPtr("https://img/1.jpg"),
		MusicBrainzIDsJSON: strPtr(`["mb-1","mb-2"]`),
		AlbumCount:         4,
		Starred:            true,
	}
	anon := MapArtist(src, false)
	if anon.CoverArt != "ar1" || anon.AlbumCount != 4 || anon.Starred != "" || anon.UserRating != nil {
		t.Errorf("anonymous artist = %+v", anon)
	}
	if !reflect.DeepEqual(anon.MusicBrainzIDs, []string{"mb-1", "mb-2"}) || anon.ArtistImageURL != "https://img/1.jpg" {
		t.Errorf("mbIds/image = %v/%q", anon.MusicBrainzIDs, anon.ArtistImageURL)
	}
	authd := MapArtist(src, true)
	if authd.Starred != "1970-01-01T00:00:00.000Z" {
		t.Errorf("starred = %q", authd.Starred)
	}
}
