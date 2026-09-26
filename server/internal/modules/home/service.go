// Package home is the /api/home aggregator (P8): the five landing-page
// sections in one round trip, scoped to the caller's libraries.
//
// Shapes follow the retired server where they exist (mostPlayed, random and recentlyPlayed
// are album cards) with two deliberate deviations:
//
//   - genres ranks by in-scope active song count (the task's "top by song
//     count") and returns {name, songCount} objects instead of the old
//     alphabetical name union — a flat list cannot express popularity.
//   - recentAdditions is a SONG list in import order. Songs carry no
//     created_at column; the rowid is the import order, which is what
//     "created order" means for this schema. the retired server had no song section — it
//     folded recent additions into album cards by file mtime.
//
// random is seeded per request: candidate album ids are fetched once and
// shuffled in Go with a seeded RNG, which keeps the selection reproducible
// under a known seed (tests) while every real request draws a fresh one.
// Like every other read, all sections enforce library scope; hideExplicit
// (query flag, the Go server catalog convention) drops explicit content.
package home

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/miquelrosell99/sonarly/server/internal/db"
	"math/rand/v2"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

// homeLimit is the old HOME_LIMIT: every section's default size.
const homeLimit = 10

// maxRandomLimit caps the random-albums section.
const maxRandomLimit = 50

// AlbumCard is the album shape the album sections return (the old home album
// row: display fields plus the caller's interaction state).
type AlbumCard struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	ArtistID   *string  `json:"artistId,omitempty"`
	ArtistName *string  `json:"artistName,omitempty"`
	Year       *int     `json:"year,omitempty"`
	Genre      *string  `json:"genre,omitempty"`
	CoverArt   *string  `json:"coverArt,omitempty"`
	Active     bool     `json:"active"`
	Artists    []string `json:"artists,omitempty"`
	Genres     []string `json:"genres,omitempty"`
	Starred    bool     `json:"starred"`
	Rating     *float64 `json:"rating,omitempty"`
}

// SongCard is the song shape the recentAdditions section returns (the
// display subset of the catalog song DTO).
type SongCard struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	ArtistID   *string  `json:"artistId,omitempty"`
	ArtistName *string  `json:"artistName,omitempty"`
	AlbumID    *string  `json:"albumId,omitempty"`
	AlbumName  *string  `json:"albumName,omitempty"`
	Duration   *int     `json:"duration,omitempty"`
	Year       *int     `json:"year,omitempty"`
	Genre      *string  `json:"genre,omitempty"`
	Explicit   bool     `json:"explicit"`
	CoverArt   *string  `json:"coverArt,omitempty"`
	Mtime      int64    `json:"mtime"`
	Artists    []string `json:"artists,omitempty"`
	Genres     []string `json:"genres,omitempty"`
	Starred    bool     `json:"starred"`
	Rating     *float64 `json:"rating,omitempty"`
}

// GenreCard is one ranked genre: the name and its in-scope active song
// count.
type GenreCard struct {
	Name      string `json:"name"`
	SongCount int    `json:"songCount"`
}

// Response is the /api/home envelope (old keys plus recentAdditions).
type Response struct {
	Genres          []GenreCard `json:"genres"`
	MostPlayed      []AlbumCard `json:"mostPlayed"`
	Random          []AlbumCard `json:"random"`
	RecentAdditions []SongCard  `json:"recentAdditions"`
	RecentlyPlayed  []AlbumCard `json:"recentlyPlayed"`
}

// Service loads the home sections. All queries take the caller's library
// scope; libraryId narrows further to one library (wire parity).
type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service { return &Service{db: db} }

// Home assembles the five sections. seed drives the random section's
// shuffle (the route draws a fresh seed per request; tests pin one).
func (s *Service) Home(ctx context.Context, id auth.Identity, libraryID string, hideExplicit bool, randomLimit int, seed int64) (*Response, error) {
	scope, err := libraries.GetScope(ctx, s.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	resp := &Response{
		Genres:          []GenreCard{},
		MostPlayed:      []AlbumCard{},
		Random:          []AlbumCard{},
		RecentAdditions: []SongCard{},
		RecentlyPlayed:  []AlbumCard{},
	}
	sections := []func() error{
		func() error { genres, err := s.topGenres(ctx, scope, libraryID); resp.Genres = genres; return err },
		func() error {
			albums, err := s.mostPlayed(ctx, id.UserID, scope, libraryID, hideExplicit)
			resp.MostPlayed = albums
			return err
		},
		func() error {
			albums, err := s.randomAlbums(ctx, id.UserID, scope, libraryID, hideExplicit, randomLimit, seed)
			resp.Random = albums
			return err
		},
		func() error {
			songs, err := s.recentAdditions(ctx, id.UserID, scope, libraryID, hideExplicit)
			resp.RecentAdditions = songs
			return err
		},
		func() error {
			albums, err := s.recentlyPlayed(ctx, id.UserID, scope, libraryID, hideExplicit)
			resp.RecentlyPlayed = albums
			return err
		},
	}
	for _, section := range sections {
		if err := section(); err != nil {
			return nil, err
		}
	}
	return resp, nil
}

// topGenres ranks genres by in-scope active song count. Songs without a
// genre text stay unlisted (old excluded empty genres too).
func (s *Service) topGenres(ctx context.Context, scope libraries.Scope, libraryID string) ([]GenreCard, error) {
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	where := `WHERE s.active = 1 AND s.genre IS NOT NULL AND s.genre != '' ` + scopeCond.SQL
	args := append([]any{}, scopeCond.Params...)
	if libraryID != "" {
		where += ` AND s.library_id = ?`
		args = append(args, libraryID)
	}
	args = append(args, homeLimit)
	rows, err := s.db.QueryContext(ctx,
		`SELECT s.genre AS name, COUNT(*) AS song_count
		FROM songs s
		`+where+`
		GROUP BY s.genre ORDER BY song_count DESC, name LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("load home genres: %w", err)
	}
	defer rows.Close()
	genres := []GenreCard{}
	for rows.Next() {
		var g GenreCard
		if err := rows.Scan(&g.Name, &g.SongCount); err != nil {
			return nil, fmt.Errorf("load home genres: %w", err)
		}
		genres = append(genres, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load home genres: %w", err)
	}
	return genres, nil
}

// albumJoin builds the album↔song join the album sections share. Scoped (or
// library-filtered) callers get an INNER join so albums without in-scope
// songs drop out; unrestricted admins keep the old LEFT join for mostPlayed
// and random.
func albumJoin(kind string, scope libraries.Scope, libraryID string) (join string, args []any) {
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	switch kind {
	case "inner":
		join = `JOIN songs s ON s.album_id = a.id AND s.active = 1 ` + scopeCond.SQL
		args = append([]any{}, scopeCond.Params...)
	case "auto":
		if libraryID != "" || !scope.All {
			return albumJoin("inner", scope, libraryID)
		}
		join = `LEFT JOIN songs s ON s.album_id = a.id AND s.active = 1`
	}
	if libraryID != "" && kind == "inner" {
		join += ` AND s.library_id = ?`
		args = append(args, libraryID)
	}
	return join, args
}

// albumLibraryWhere mirrors the old libraryWhere EXISTS guard (meaningful only
// for the admin + libraryId combination, where the join stays a LEFT one).
func albumLibraryWhere(libraryID string) (string, []any) {
	if libraryID == "" {
		return "", nil
	}
	return ` AND EXISTS (SELECT 1 FROM songs s2 WHERE s2.album_id = a.id AND s2.active = 1 AND s2.library_id = ?)`, []any{libraryID}
}

// explicitHaving is the old hideExplicit guard: the album keeps a slot only if
// at least one of its in-scope songs is not explicit.
func explicitHaving(hideExplicit bool) string {
	if !hideExplicit {
		return ""
	}
	return ` HAVING SUM(CASE WHEN s.explicit = 0 THEN 1 ELSE 0 END) > 0`
}

// albumCardColumns is the shared album-card projection; ua carries the
// caller's starred/rating.
const albumCardColumns = `a.id, a.name, a.artist_id, a.artist_name, a.year, a.genre, a.cover_art_id, a.active, ua.starred, ua.rating`

type albumCardRow struct {
	id         string
	name       string
	artistID   sql.NullString
	artistName sql.NullString
	year       sql.NullInt64
	genre      sql.NullString
	coverArt   sql.NullString
	active     sql.NullInt64
	starred    sql.NullInt64
	rating     sql.NullFloat64
}

func scanAlbumCardRow(row interface{ Scan(...any) error }) (*albumCardRow, error) {
	var r albumCardRow
	if err := row.Scan(&r.id, &r.name, &r.artistID, &r.artistName, &r.year, &r.genre,
		&r.coverArt, &r.active, &r.starred, &r.rating); err != nil {
		return nil, err
	}
	return &r, nil
}

// scanAlbumCardRows scans album-card rows that carry one trailing aggregate
// column (mostPlayed's SUM, recentlyPlayed's MAX). The aggregate value is
// consumed into extra and discarded by the caller.
func scanAlbumCardRows(rows *sql.Rows, extra any) ([]AlbumCard, error) {
	defer rows.Close()
	albums := []AlbumCard{}
	for rows.Next() {
		var r albumCardRow
		if err := rows.Scan(&r.id, &r.name, &r.artistID, &r.artistName, &r.year, &r.genre,
			&r.coverArt, &r.active, &r.starred, &r.rating, extra); err != nil {
			return nil, err
		}
		albums = append(albums, r.card())
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return albums, nil
}

func (r *albumCardRow) card() AlbumCard {
	a := AlbumCard{
		ID:         r.id,
		Name:       r.name,
		ArtistID:   strPtr(r.artistID),
		ArtistName: strPtr(r.artistName),
		Year:       intPtr(r.year),
		Genre:      strPtr(r.genre),
		CoverArt:   strPtr(r.coverArt),
		Active:     r.active.Valid && r.active.Int64 == 1,
		Starred:    r.starred.Valid && r.starred.Int64 == 1,
	}
	if r.rating.Valid {
		a.Rating = &r.rating.Float64
	}
	return a
}

// mostPlayed is the old most-played albums: total plays from user_songs across
// the album's in-scope songs.
func (s *Service) mostPlayed(ctx context.Context, userID string, scope libraries.Scope, libraryID string, hideExplicit bool) ([]AlbumCard, error) {
	join, joinArgs := albumJoin("auto", scope, libraryID)
	libWhere, libArgs := albumLibraryWhere(libraryID)
	args := append(append([]any{}, joinArgs...), userID, userID)
	args = append(args, libArgs...)
	args = append(args, homeLimit)
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+albumCardColumns+`, COALESCE(SUM(us.play_count), 0) AS total_plays
		FROM albums a
		`+join+`
		LEFT JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?
		LEFT JOIN user_albums ua ON ua.album_id = a.id AND ua.user_id = ?
		WHERE a.active = 1 `+libWhere+`
		GROUP BY a.id`+explicitHaving(hideExplicit)+`
		ORDER BY total_plays DESC, a.name
		LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("load most played: %w", err)
	}
	albums, err := scanAlbumCardRows(rows, new(sql.NullInt64))
	if err != nil {
		return nil, fmt.Errorf("load most played: %w", err)
	}
	return albums, nil
}

// randomAlbums draws a seeded sample of in-scope active albums. The
// candidates come from one id-only query; the shuffle happens in Go so the
// seed fully determines the selection; full rows load for the chosen ids
// and are reordered to match the draw.
func (s *Service) randomAlbums(ctx context.Context, userID string, scope libraries.Scope, libraryID string, hideExplicit bool, limit int, seed int64) ([]AlbumCard, error) {
	join, joinArgs := albumJoin("auto", scope, libraryID)
	libWhere, libArgs := albumLibraryWhere(libraryID)
	args := append(append([]any{}, joinArgs...), libArgs...)
	rows, err := s.db.QueryContext(ctx,
		`SELECT a.id
		FROM albums a
		`+join+`
		WHERE a.active = 1 `+libWhere+`
		GROUP BY a.id`+explicitHaving(hideExplicit), args...)
	if err != nil {
		return nil, fmt.Errorf("load random candidates: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("load random candidates: %w", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load random candidates: %w", err)
	}
	if len(ids) == 0 {
		return []AlbumCard{}, nil
	}
	rng := rand.New(rand.NewPCG(uint64(seed), uint64(seed)>>32|1))
	rng.Shuffle(len(ids), func(i, j int) { ids[i], ids[j] = ids[j], ids[i] })
	ids = ids[:min(limit, len(ids))]

	placeholders := ""
	for i := range ids {
		if i > 0 {
			placeholders += ", "
		}
		placeholders += "?"
	}
	cardArgs := append([]any{userID}, stringArgs(ids)...)
	cardRows, err := s.db.QueryContext(ctx,
		`SELECT `+albumCardColumns+`
		FROM albums a
		LEFT JOIN user_albums ua ON ua.album_id = a.id AND ua.user_id = ?
		WHERE a.id IN (`+placeholders+`)`, cardArgs...)
	if err != nil {
		return nil, fmt.Errorf("load random albums: %w", err)
	}
	defer cardRows.Close()
	byID := map[string]AlbumCard{}
	for cardRows.Next() {
		row, err := scanAlbumCardRow(cardRows)
		if err != nil {
			return nil, fmt.Errorf("load random albums: %w", err)
		}
		byID[row.id] = row.card()
	}
	if err := cardRows.Err(); err != nil {
		return nil, fmt.Errorf("load random albums: %w", err)
	}
	out := []AlbumCard{}
	for _, id := range ids {
		if card, ok := byID[id]; ok {
			out = append(out, card)
		}
	}
	return out, nil
}

// recentAdditions lists the newest imports first: the songs rowid is the
// import order (there is no created_at column).
func (s *Service) recentAdditions(ctx context.Context, userID string, scope libraries.Scope, libraryID string, hideExplicit bool) ([]SongCard, error) {
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	where := `WHERE s.active = 1 ` + scopeCond.SQL
	args := append([]any{}, scopeCond.Params...)
	if libraryID != "" {
		where += ` AND s.library_id = ?`
		args = append(args, libraryID)
	}
	if hideExplicit {
		where += ` AND s.explicit = 0`
	}
	args = append(args, homeLimit)
	rows, err := s.db.QueryContext(ctx,
		`SELECT s.id, s.title, s.artist_id, ar.name, s.album_id, al.name, s.duration,
			s.year, s.genre, s.explicit, s.cover_art_id, s.mtime, us.starred, us.rating
		FROM songs s
		LEFT JOIN artists ar ON ar.id = s.artist_id
		LEFT JOIN albums al ON al.id = s.album_id
		LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
		`+where+`
		ORDER BY s.rowid DESC
		LIMIT ?`, append([]any{userID}, args...)...)
	if err != nil {
		return nil, fmt.Errorf("load recent additions: %w", err)
	}
	defer rows.Close()
	songs := []SongCard{}
	for rows.Next() {
		var card SongCard
		var artistID, artistName, albumID, albumName, genre, coverArt sql.NullString
		var year, starred sql.NullInt64
		var explicit sql.NullInt64
		var rating sql.NullFloat64
		var mtime db.Millis
		var duration db.NullInt64 // the retired server may have stored fractional REAL seconds
		if err := rows.Scan(&card.ID, &card.Title, &artistID, &artistName, &albumID, &albumName,
			&duration, &year, &genre, &explicit, &coverArt, &mtime, &starred, &rating); err != nil {
			return nil, fmt.Errorf("load recent additions: %w", err)
		}
		card.Mtime = int64(mtime)
		if v, ok := duration.Value(); ok {
			d := int(v)
			card.Duration = &d
		}
		card.ArtistID, card.ArtistName = strPtr(artistID), strPtr(artistName)
		card.AlbumID, card.AlbumName = strPtr(albumID), strPtr(albumName)
		card.Year = intPtr(year)
		card.Genre, card.CoverArt = strPtr(genre), strPtr(coverArt)
		card.Explicit = explicit.Valid && explicit.Int64 == 1
		card.Starred = starred.Valid && starred.Int64 == 1
		if rating.Valid {
			card.Rating = &rating.Float64
		}
		songs = append(songs, card)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load recent additions: %w", err)
	}
	return songs, nil
}

// recentlyPlayed is the old section: albums ordered by the caller's most
// recent play of any in-scope song.
func (s *Service) recentlyPlayed(ctx context.Context, userID string, scope libraries.Scope, libraryID string, hideExplicit bool) ([]AlbumCard, error) {
	join, joinArgs := albumJoin("inner", scope, libraryID)
	libWhere, libArgs := albumLibraryWhere(libraryID)
	having := `HAVING last_played IS NOT NULL`
	if hideExplicit {
		having += ` AND SUM(CASE WHEN s.explicit = 0 THEN 1 ELSE 0 END) > 0`
	}
	args := append(append([]any{}, joinArgs...), userID, userID)
	args = append(args, libArgs...)
	args = append(args, homeLimit)
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+albumCardColumns+`, MAX(us.last_played) AS last_played
		FROM albums a
		`+join+`
		LEFT JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?
		LEFT JOIN user_albums ua ON ua.album_id = a.id AND ua.user_id = ?
		WHERE a.active = 1 `+libWhere+`
		GROUP BY a.id
		`+having+`
		ORDER BY last_played DESC, a.name
		LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("load recently played: %w", err)
	}
	albums, err := scanAlbumCardRows(rows, new(sql.NullString))
	if err != nil {
		return nil, fmt.Errorf("load recently played: %w", err)
	}
	return albums, nil
}

func stringArgs(ids []string) []any {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return args
}

func strPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	return &v.String
}

func intPtr(v sql.NullInt64) *int {
	if !v.Valid {
		return nil
	}
	n := int(v.Int64)
	return &n
}
