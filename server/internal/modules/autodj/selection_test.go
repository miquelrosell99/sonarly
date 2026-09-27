package autodj

import (
	"strings"
	"testing"
)

func row(id, artist, album string, year *int) candidateRow {
	r := candidateRow{song: Song{ID: id, Title: id}}
	if artist != "" {
		r.artistID = &artist
		r.song.ArtistID = &artist
	}
	if album != "" {
		r.albumID = &album
		r.song.AlbumID = &album
	}
	r.song.Year = year
	return r
}

func scored(rows ...candidateRow) []scoredCandidate {
	out := make([]scoredCandidate, len(rows))
	for i, r := range rows {
		out[i] = scoredCandidate{row: r}
	}
	return out
}

func pickedIDs(picked []scoredCandidate) []string {
	ids := make([]string, len(picked))
	for i, p := range picked {
		ids[i] = p.row.song.ID
	}
	return ids
}

func intPtrOf(v int) *int { return &v }

func TestDiversePickCapsArtistAlbumAndDecade(t *testing.T) {
	// All-score input keeps fetch order, so the pick is fully deterministic:
	// a1..a3 by artist A (two sharing an album, two sharing a decade), b1/b2
	// by artist B (one album, one decade), c1 by artist C.
	a1 := row("a1", "ar-a", "al-1", intPtrOf(1971))
	a2 := row("a2", "ar-a", "al-1", intPtrOf(1972))
	a3 := row("a3", "ar-a", "al-2", intPtrOf(1981))
	b1 := row("b1", "ar-b", "al-3", intPtrOf(1991))
	b2 := row("b2", "ar-b", "al-3", intPtrOf(1992))
	c1 := row("c1", "ar-c", "al-4", intPtrOf(2001))

	picked := diversePick(scored(a1, a2, a3, b1, b2, c1), 4)
	ids := pickedIDs(picked)
	// Pass 1 takes a1 (new everything), b1, c1; pass 2 adds a3 once the era
	// constraint relaxes. a2/b2 stay deferred — the batch is full.
	want := []string{"a1", "b1", "c1", "a3"}
	if strings.Join(ids, ",") != strings.Join(want, ",") {
		t.Fatalf("diversePick order: %v", ids)
	}

	seenAlbums := map[string]bool{}
	seenDecades := map[string]bool{}
	for i, p := range picked {
		if i > 0 {
			prev := picked[i-1].row
			if prev.artistID != nil && p.row.artistID != nil && *prev.artistID == *p.row.artistID {
				t.Fatalf("consecutive same-artist picks at %d: %v", i, ids)
			}
		}
		_, albumKey, decadeKey := pickKeys(p.row)
		if seenAlbums[albumKey] {
			t.Fatalf("album %s picked twice: %v", albumKey, ids)
		}
		seenAlbums[albumKey] = true
		if seenDecades[decadeKey] {
			t.Fatalf("decade %s picked twice: %v", decadeKey, ids)
		}
		seenDecades[decadeKey] = true
	}
}

func TestDiversePickFillPassKeepsSingleArtistLibraryFull(t *testing.T) {
	// One artist, one album, one era: the caps must yield so the batch fills.
	s1 := row("s1", "ar-a", "al-1", intPtrOf(1971))
	s2 := row("s2", "ar-a", "al-1", intPtrOf(1972))
	s3 := row("s3", "ar-a", "al-1", intPtrOf(1973))
	picked := diversePick(scored(s1, s2, s3), 3)
	if len(picked) != 3 {
		t.Fatalf("fill pass must return the full batch, got %v", pickedIDs(picked))
	}
}

func TestDiversePickPrefersNewErasWhileAlternativesExist(t *testing.T) {
	old1 := row("old1", "ar-a", "al-1", intPtrOf(1971))
	old2 := row("old2", "ar-b", "al-2", intPtrOf(1979))
	new1 := row("new1", "ar-c", "al-3", intPtrOf(1995))
	picked := diversePick(scored(old1, old2, new1), 2)
	ids := pickedIDs(picked)
	if strings.Join(ids, ",") != "old1,new1" {
		t.Fatalf("era spread should prefer the unrepeated decade: %v", ids)
	}
}

func TestDiversePickUnknownMetadataIsExempt(t *testing.T) {
	u1 := row("u1", "", "", nil)
	u2 := row("u2", "", "", nil)
	picked := diversePick(scored(u1, u2), 2)
	if len(picked) != 2 {
		t.Fatalf("unknown artist/album/year must not trip the caps: %v", pickedIDs(picked))
	}
}

func TestReasonForPriority(t *testing.T) {
	artist, album := "ar-a", "al-1"
	seed := &SongContext{
		ID:         "seed",
		ArtistID:   &artist,
		ArtistName: strPtrOfS("Anchor Artist"),
		AlbumID:    &album,
		GenreNames: []string{"Rock"},
	}

	sameArtist := row("r", "ar-a", "al-9", nil)
	sameArtist.song.Starred = true // must still lose to the artist relation
	if got := reasonFor(sameArtist, seed); got != "More like Anchor Artist" {
		t.Fatalf("artist relation must win: %q", got)
	}

	sameAlbum := row("r", "ar-b", "al-1", nil)
	if got := reasonFor(sameAlbum, seed); got != "From the same album" {
		t.Fatalf("album relation: %q", got)
	}

	g := row("r", "ar-b", "al-9", nil)
	g.genreOverlap = 1
	if got := reasonFor(g, seed); got != "Because you love Rock" {
		t.Fatalf("genre relation: %q", got)
	}

	starred := row("r", "ar-b", "al-9", nil)
	starred.song.Starred = true
	if got := reasonFor(starred, seed); got != "One of your favorites" {
		t.Fatalf("starred: %q", got)
	}

	rated := row("r", "ar-b", "al-9", nil)
	rating := 4.0
	rated.rating = &rating
	if got := reasonFor(rated, seed); got != "From your highly rated" {
		t.Fatalf("high rating: %q", got)
	}

	lowRated := row("r", "ar-b", "al-9", nil)
	low := 3.5
	lowRated.rating = &low
	if got := reasonFor(lowRated, seed); got != "Hidden gem — you haven't played this" {
		t.Fatalf("low rating with no plays must fall through to hidden gem: %q", got)
	}

	played := row("r", "ar-b", "al-9", nil)
	plays := 3
	played.playCount = &plays
	if got := reasonFor(played, seed); got != "Fresh pick from your library" {
		t.Fatalf("fallback: %q", got)
	}

	// No seed: relation rules never fire.
	if got := reasonFor(sameArtist, nil); got != "One of your favorites" {
		t.Fatalf("seedless reason: %q", got)
	}
}

func strPtrOfS(v string) *string { return &v }

func TestDropQueuedSongsHardRule(t *testing.T) {
	songs := []Song{{ID: "a"}, {ID: "b"}, {ID: "c"}, {ID: "a"}}
	out := dropQueuedSongs(songs, idSet([]string{"b", "seed"}))
	ids := []string{}
	for _, s := range out {
		ids = append(ids, s.ID)
	}
	if strings.Join(ids, ",") != "a,c,a" {
		t.Fatalf("dropQueuedSongs: %v", ids)
	}
	if dropQueuedSongs(nil, idSet([]string{"a"})) != nil {
		t.Fatalf("nil in must stay nil")
	}
}
