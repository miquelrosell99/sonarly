package autodj

import "fmt"

// randomOverscan bounds how far past `count` the random/similar pools fetch
// before the diversity caps trim them back: caps can only spread a batch over
// artists/albums/decades that were actually fetched.
const randomOverscan = 4

// poolWindowLimit is the SQL LIMIT for the pre-cap candidate window.
func poolWindowLimit(count int) int {
	return max(count*randomOverscan, count+12)
}

// scoredCandidate is one candidate row plus its smart-mode score. The
// diversity picker consumes it in slice order (smart pre-sorts by score;
// random/similar preserve fetch order with score 0), so the type is shared
// even where the score is unused.
type scoredCandidate struct {
	row   candidateRow
	score float64
}

// decadeOf buckets a year into its decade for the era-spread cap. Unknown
// years return "" and are exempt — there is no era to spread.
func decadeOf(year *int) string {
	if year == nil {
		return ""
	}
	return fmt.Sprintf("%d", *year/10*10)
}

// diversePick applies the batch diversity caps to an ordered candidate list:
//
//   - pass 1 (strict): no two consecutive picks by the same artist, at most
//     one pick per album, and every new decade preferred over a repeated one;
//   - pass 2: decade repeats allowed (all distinct eras in the pool are
//     already represented), artist-consecutive and album caps stand;
//   - pass 3 (fill): the remaining caps yield so an honest request still gets
//     a batch — a single-artist/single-album library must not starve the DJ.
//
// The queue-duplicate rule is NOT handled here; it is a hard guarantee
// enforced in candidates() against the full posted queue id set.
func diversePick(ordered []scoredCandidate, count int) []scoredCandidate {
	if count <= 0 || len(ordered) == 0 {
		return nil
	}
	chosen := make([]bool, len(ordered))
	picked := make([]scoredCandidate, 0, min(count, len(ordered)))
	usedAlbums := map[string]bool{}
	usedDecades := map[string]bool{}
	var lastArtist *string

	type pass struct {
		blockConsecutiveArtist bool
		blockAlbumRepeat       bool
		blockDecadeRepeat      bool
	}
	passes := []pass{
		{blockConsecutiveArtist: true, blockAlbumRepeat: true, blockDecadeRepeat: true},
		{blockConsecutiveArtist: true, blockAlbumRepeat: true},
		{},
	}

	for _, p := range passes {
		if len(picked) >= count {
			break
		}
		for i, cand := range ordered {
			if len(picked) >= count || chosen[i] {
				continue
			}
			artistKey, albumKey, decadeKey := pickKeys(cand.row)
			if p.blockConsecutiveArtist && artistKey != "" && lastArtist != nil && *lastArtist == artistKey {
				continue
			}
			if p.blockAlbumRepeat && albumKey != "" && usedAlbums[albumKey] {
				continue
			}
			if p.blockDecadeRepeat && decadeKey != "" && usedDecades[decadeKey] {
				continue
			}
			chosen[i] = true
			picked = append(picked, cand)
			if albumKey != "" {
				usedAlbums[albumKey] = true
			}
			if decadeKey != "" {
				usedDecades[decadeKey] = true
			}
			if artistKey != "" {
				key := artistKey
				lastArtist = &key
			}
		}
	}
	return picked
}

func pickKeys(row candidateRow) (artistKey, albumKey, decadeKey string) {
	if row.artistID != nil {
		artistKey = *row.artistID
	}
	if row.albumID != nil {
		albumKey = *row.albumID
	}
	return artistKey, albumKey, decadeOf(row.song.Year)
}

// reasonFor turns the firing scoring signals into the human-readable
// explanation the client renders per suggestion. Relationship-to-seed signals
// win over interaction signals, matching the order in which the scorer adds
// them; every song gets some reason (the library-wide fallback last).
func reasonFor(row candidateRow, seed *SongContext) string {
	song := row.song
	if seed != nil {
		if seed.ArtistID != nil && song.ArtistID != nil && *song.ArtistID == *seed.ArtistID &&
			seed.ArtistName != nil && *seed.ArtistName != "" {
			return fmt.Sprintf("More like %s", *seed.ArtistName)
		}
		if seed.AlbumID != nil && row.albumID != nil && *row.albumID == *seed.AlbumID {
			return "From the same album"
		}
		if row.genreOverlap > 0 && len(seed.GenreNames) > 0 {
			return fmt.Sprintf("Because you love %s", seed.GenreNames[0])
		}
	}
	if song.Starred {
		return "One of your favorites"
	}
	if row.rating != nil && *row.rating >= 4 {
		return "From your highly rated"
	}
	if intValue(row.playCount) == 0 {
		return "Hidden gem — you haven't played this"
	}
	return "Fresh pick from your library"
}

// idSet builds the hard-exclusion lookup from the posted queue ids.
func idSet(ids []string) map[string]bool {
	set := make(map[string]bool, len(ids))
	for _, id := range ids {
		set[id] = true
	}
	return set
}

// dropQueuedSongs enforces the hard queue-duplicate rule: a suggestion must
// never duplicate anything the caller already has in the queue (or the seed
// itself), regardless of SQL exclusion caps.
func dropQueuedSongs(songs []Song, blocked map[string]bool) []Song {
	out := songs[:0]
	for _, song := range songs {
		if !blocked[song.ID] {
			out = append(out, song)
		}
	}
	return out
}
