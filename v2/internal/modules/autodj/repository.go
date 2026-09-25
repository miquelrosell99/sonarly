// Package autodj ports v1's auto-dj: similar / random / smart candidate
// generation for playback continuity. The selection SQL, the JS scoring
// port, the exclude windows, the 500-id cap and the user-preference-driven
// options all follow v1; two deliberate deviations:
//
//   - Errors surface as a typed 502 instead of v1's silent "200 with an
//     empty songs array" — the audit called that swallow a bug: a client
//     cannot tell "nothing fits" from "the server broke". Generation
//     failures (DB errors) answer 502 Bad Gateway with a generic message;
//     "nothing fits" is still a 200 with an empty list.
//   - ORDER BY RANDOM() stays (v1 parity): at SQLite scale — one library,
//     one writer, candidate sets capped at 500 — the sort is milliseconds.
//     The smart pool is additionally bounded (500 rows) like v1.
//
// Explicit-content filtering stays OFF (v1 parity): auto-dj follows the
// user's own listening context, and the client can post-filter.
package autodj

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/miquelrosell99/sonarly/v2/internal/db"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/libraries"
)

// maxExcludeIDs caps the exclusion id list (v1's MAX_EXCLUDE_IDS).
const maxExcludeIDs = 500

// idChunkSize bounds the genre batch loader's IN lists.
const idChunkSize = 400

// smartPoolSize bounds the smart-mode candidate pool (v1's LIMIT 500).
const smartPoolSize = 500

// ExcludeWindow is a whitelisted recent-history exclusion window.
type ExcludeWindow string

const (
	Window24h ExcludeWindow = "24h"
	Window7d  ExcludeWindow = "7d"
	Window30d ExcludeWindow = "30d"
)

// excludeWindowModifiers maps windows to sqlite datetime modifiers. The map
// is hardcoded — modifiers are never interpolated from user input (v1's
// whitelist pattern).
var excludeWindowModifiers = map[ExcludeWindow]string{
	Window24h: "-24 hours",
	Window7d:  "-7 days",
	Window30d: "-30 days",
}

func windowModifier(w ExcludeWindow) string {
	if mod, ok := excludeWindowModifiers[w]; ok {
		return mod
	}
	return excludeWindowModifiers[Window24h]
}

// Options carries the dj configuration v1 stored in user preferences.
type Options struct {
	ExcludeWindow   ExcludeWindow
	PreferFavorites bool
	Discovery       int // 0 = familiar, 100 = adventurous (clamped)
}

// Mode is one of the three selection strategies.
type Mode string

const (
	ModeSimilar Mode = "similar"
	ModeRandom  Mode = "random"
	ModeSmart   Mode = "smart"
)

// Song is one auto-dj candidate (the display subset of the catalog song
// DTO, plus the caller's interaction state — v1's rowToSong shape).
type Song struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	TrackNumber *int     `json:"trackNumber,omitempty"`
	DiscNumber  *int     `json:"discNumber,omitempty"`
	Duration    *int     `json:"duration,omitempty"`
	ArtistID    *string  `json:"artistId,omitempty"`
	ArtistName  *string  `json:"artistName,omitempty"`
	AlbumID     *string  `json:"albumId,omitempty"`
	AlbumName   *string  `json:"albumName,omitempty"`
	Genre       *string  `json:"genre,omitempty"`
	GenreID     *string  `json:"genreId,omitempty"`
	Year        *int     `json:"year,omitempty"`
	Explicit    bool     `json:"explicit"`
	CoverArt    *string  `json:"coverArt,omitempty"`
	Mtime       int64    `json:"mtime"`
	Starred     bool     `json:"starred"`
	Rating      *float64 `json:"rating,omitempty"`
}

// SongContext is the current song's similarity inputs (v1's SongContext).
type SongContext struct {
	ID         string
	ArtistID   *string
	AlbumID    *string
	BPM        *int
	Mood       *string
	GenreIDs   []string
	Rating     *float64
	PlayCount  *int
	LastPlayed *string
}

// candidateRow is the shared candidate projection plus the per-user
// interaction columns the scoring needs.
type candidateRow struct {
	song         Song
	artistID     *string
	albumID      *string
	bpm          *int
	mood         *string
	genreIDs     []string // loaded separately, like v1
	rating       *float64
	playCount    *int
	lastPlayed   *string
	genreOverlap int
}

// songColumns is the candidate SELECT list shared by the three modes.
const songColumns = `s.id, s.title, s.track_number, s.disc_number, s.duration,
	s.artist_id, ar.name, s.album_id, al.name, s.genre, s.genre_id, s.year,
	s.explicit, s.cover_art_id, s.mtime, s.bpm, s.mood,
	us.starred, us.rating, us.play_count, us.last_played`

const songJoins = `FROM songs s
	LEFT JOIN artists ar ON ar.id = s.artist_id
	LEFT JOIN albums al ON al.id = s.album_id
	LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id`

func scanCandidate(rows *sql.Rows, withOverlap bool) ([]candidateRow, error) {
	defer rows.Close()
	out := []candidateRow{}
	for rows.Next() {
		var r candidateRow
		var track, disc, year sql.NullInt64
		var duration db.NullInt64 // v1 may have stored fractional REAL seconds
		var mtime db.NullMillis
		var artistID, albumID, artistName, albumName, genre, genreID, coverArt sql.NullString
		var bpm sql.NullInt64
		var mood sql.NullString
		var explicit sql.NullInt64
		var starred sql.NullInt64
		var rating sql.NullFloat64
		var playCount sql.NullInt64
		var lastPlayed sql.NullString
		var overlap sql.NullInt64
		dests := []any{
			&r.song.ID, &r.song.Title, &track, &disc, &duration,
			&artistID, &artistName, &albumID, &albumName, &genre, &genreID, &year,
			&explicit, &coverArt, &mtime, &bpm, &mood,
			&starred, &rating, &playCount, &lastPlayed,
		}
		if withOverlap {
			dests = append(dests, &overlap)
		}
		if err := rows.Scan(dests...); err != nil {
			return nil, fmt.Errorf("scan auto-dj candidate: %w", err)
		}
		r.song.TrackNumber, r.song.DiscNumber = intPtr(track), intPtr(disc)
		if v, ok := duration.Value(); ok {
			d := int(v)
			r.song.Duration = &d
		}
		r.artistID, r.song.ArtistName = strPtr(artistID), strPtr(artistName)
		r.albumID, r.song.AlbumName = strPtr(albumID), strPtr(albumName)
		r.song.ArtistID, r.song.AlbumID = r.artistID, r.albumID
		r.song.Genre, r.song.GenreID, r.song.Year = strPtr(genre), strPtr(genreID), intPtr(year)
		r.song.CoverArt = strPtr(coverArt)
		r.song.Mtime, _ = mtime.Value()
		r.song.Explicit = explicit.Valid && explicit.Int64 == 1
		r.bpm = intPtr(bpm)
		r.mood = strPtr(mood)
		r.song.Starred = starred.Valid && starred.Int64 == 1
		if rating.Valid {
			r.rating = &rating.Float64
			r.song.Rating = &rating.Float64
		}
		if playCount.Valid {
			n := int(playCount.Int64)
			r.playCount = &n
		}
		if lastPlayed.Valid {
			r.lastPlayed = &lastPlayed.String
		}
		r.genreOverlap = int(overlap.Int64)
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan auto-dj candidates: %w", err)
	}
	return out, nil
}

func intPtr(v sql.NullInt64) *int {
	if !v.Valid {
		return nil
	}
	n := int(v.Int64)
	return &n
}

func strPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	return &v.String
}

// buildExcludeClause caps and placeholders the exclusion list (v1 parity:
// slice to MAX_EXCLUDE_IDS, NOT IN).
func buildExcludeClause(excludeIDs []string) (string, []any) {
	if len(excludeIDs) == 0 {
		return "", nil
	}
	capped := excludeIDs
	if len(capped) > maxExcludeIDs {
		capped = capped[:maxExcludeIDs]
	}
	placeholders := ""
	for i := range capped {
		if i > 0 {
			placeholders += ", "
		}
		placeholders += "?"
	}
	args := make([]any, len(capped))
	for i, id := range capped {
		args[i] = id
	}
	return ` AND s.id NOT IN (` + placeholders + `)`, args
}

// recentHistoryClause excludes songs the user played inside the window,
// per listening_history (v1 parity). The threshold renders in the same ISO
// 8601 shape scrobble writes into played_at — v1 compared a space-format
// datetime() against ISO strings, which string-sorted differently (T > space).
func recentHistoryClause(userID string, w ExcludeWindow) (string, []any) {
	return ` AND NOT EXISTS (
		SELECT 1 FROM listening_history lh
		WHERE lh.song_id = s.id AND lh.user_id = ?
			AND lh.played_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
	)`, []any{userID, windowModifier(w)}
}

func favoritesFirst(preferFavorites bool) string {
	if preferFavorites {
		return ` ORDER BY (us.starred = 1) DESC, RANDOM()`
	}
	return ` ORDER BY RANDOM()`
}

// songContext loads the similarity inputs for one song (v1's getSongContext:
// a missing song yields nil, which the modes treat as "no context").
func (s *Service) songContext(ctx context.Context, userID, songID string) (*SongContext, error) {
	var c SongContext
	var artistID, albumID, mood sql.NullString
	var bpm, playCount sql.NullInt64
	var rating sql.NullFloat64
	var lastPlayed sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT s.artist_id, s.album_id, s.bpm, s.mood, us.rating, us.play_count, us.last_played
		FROM songs s
		LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
		WHERE s.id = ? AND s.active = 1`, userID, songID).
		Scan(&artistID, &albumID, &bpm, &mood, &rating, &playCount, &lastPlayed)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load song context: %w", err)
	}
	c.ID = songID
	c.ArtistID, c.AlbumID, c.Mood = strPtr(artistID), strPtr(albumID), strPtr(mood)
	c.BPM = intPtr(bpm)
	if rating.Valid {
		c.Rating = &rating.Float64
	}
	if playCount.Valid {
		n := int(playCount.Int64)
		c.PlayCount = &n
	}
	if lastPlayed.Valid {
		c.LastPlayed = &lastPlayed.String
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT genre_id FROM song_genres WHERE song_id = ?`, songID)
	if err != nil {
		return nil, fmt.Errorf("load song context genres: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("load song context genres: %w", err)
		}
		c.GenreIDs = append(c.GenreIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load song context genres: %w", err)
	}
	return &c, nil
}

// loadGenreIDs batch-loads the genre id lists for candidates (v1's
// per-candidate load, batched to keep the statement count flat).
func (s *Service) loadGenreIDs(ctx context.Context, candidates []candidateRow) error {
	if len(candidates) == 0 {
		return nil
	}
	ids := make([]string, len(candidates))
	for i := range candidates {
		ids[i] = candidates[i].song.ID
	}
	bySong := map[string][]string{}
	for _, chunk := range chunkIDs(ids) {
		placeholders := ""
		for i := range chunk {
			if i > 0 {
				placeholders += ", "
			}
			placeholders += "?"
		}
		args := make([]any, len(chunk))
		for i, id := range chunk {
			args[i] = id
		}
		rows, err := s.db.QueryContext(ctx,
			`SELECT song_id, genre_id FROM song_genres WHERE song_id IN (`+placeholders+`) ORDER BY position`, args...)
		if err != nil {
			return fmt.Errorf("load candidate genres: %w", err)
		}
		for rows.Next() {
			var songID, genreID string
			if err := rows.Scan(&songID, &genreID); err != nil {
				rows.Close()
				return fmt.Errorf("load candidate genres: %w", err)
			}
			bySong[songID] = append(bySong[songID], genreID)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("load candidate genres: %w", err)
		}
	}
	for i := range candidates {
		candidates[i].genreIDs = bySong[candidates[i].song.ID]
	}
	return nil
}

// similarCandidates ports v1's getSimilarCandidates: artist/album/genre
// overlap first, then random backfill so the request still returns count
// songs when the overlap pool runs dry.
func (s *Service) similarCandidates(ctx context.Context, userID string, c *SongContext, count int, excludeIDs []string, opts Options, scope libraries.Scope) ([]Song, error) {
	exclude, excludeArgs := buildExcludeClause(excludeIDs)
	recent, recentArgs := recentHistoryClause(userID, opts.ExcludeWindow)
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	candidates := []candidateRow{}
	if c != nil && (c.ArtistID != nil || c.AlbumID != nil || len(c.GenreIDs) > 0) {
		genrePlaceholders := ""
		genreArgs := []any{}
		if len(c.GenreIDs) > 0 {
			for i, id := range c.GenreIDs {
				if i > 0 {
					genrePlaceholders += ", "
				}
				genrePlaceholders += "?"
				genreArgs = append(genreArgs, id)
			}
		}
		overlap := ` s.artist_id IS ?
			OR s.album_id IS ?
			` + genreExistsClause(genrePlaceholders)
		args := []any{userID, c.ID}
		args = append(args, scopeCond.Params...)
		args = append(args, excludeArgs...)
		args = append(args, recentArgs...)
		args = append(args, nilOr(c.ArtistID), nilOr(c.AlbumID))
		args = append(args, genreArgs...)
		args = append(args, count)
		rows, err := s.db.QueryContext(ctx,
			`SELECT `+songColumns+` `+songJoins+`
			WHERE s.active = 1
				AND s.id != ?
				`+scopeCond.SQL+`
				`+exclude+`
				`+recent+`
				AND (`+overlap+`)
			`+favoritesFirst(opts.PreferFavorites)+`
			LIMIT ?`, args...)
		if err != nil {
			return nil, fmt.Errorf("similar candidates: %w", err)
		}
		candidates, err = scanCandidate(rows, false)
		if err != nil {
			return nil, err
		}
	}
	if err := s.loadGenreIDs(ctx, candidates); err != nil {
		return nil, err
	}
	songs := candidateSongs(candidates)
	if len(songs) < count {
		extra := []string{}
		extra = append(extra, excludeIDs...)
		for _, song := range songs {
			extra = append(extra, song.ID)
		}
		if c != nil {
			extra = append(extra, c.ID)
		}
		more, err := s.randomCandidates(ctx, userID, count-len(songs), extra, opts, scope)
		if err != nil {
			return nil, err
		}
		songs = append(songs, more...)
	}
	return songs, nil
}

// genreExistsClause renders the EXISTS probe for genre overlap; an empty
// placeholder list renders a false clause so the OR arm vanishes.
func genreExistsClause(genrePlaceholders string) string {
	if genrePlaceholders == "" {
		return ""
	}
	return ` OR EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id AND sg.genre_id IN (` + genrePlaceholders + `))`
}

func nilOr(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

// randomCandidates ports v1's getRandomCandidates: the recent-play window
// applies through user_songs.last_played (v1 behavior — similar/smart use
// listening_history instead), with a no-window fallback pass when the
// window drains the pool.
func (s *Service) randomCandidates(ctx context.Context, userID string, count int, excludeIDs []string, opts Options, scope libraries.Scope) ([]Song, error) {
	exclude, excludeArgs := buildExcludeClause(excludeIDs)
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+songColumns+` `+songJoins+`
		WHERE s.active = 1
			`+scopeCond.SQL+`
			`+exclude+`
			AND (us.last_played IS NULL OR us.last_played < datetime('now', ?))
		`+favoritesFirst(opts.PreferFavorites)+`
		LIMIT ?`,
		append(append(append([]any{userID}, scopeCond.Params...), excludeArgs...),
			windowModifier(opts.ExcludeWindow), count)...)
	if err != nil {
		return nil, fmt.Errorf("random candidates: %w", err)
	}
	candidates, err := scanCandidate(rows, false)
	if err != nil {
		return nil, err
	}
	if len(candidates) < count {
		fallbackExclude := append(append([]string{}, excludeIDs...), candidateIDs(candidates)...)
		exc, excArgs := buildExcludeClause(fallbackExclude)
		rows, err := s.db.QueryContext(ctx,
			`SELECT `+songColumns+` `+songJoins+`
			WHERE s.active = 1
				`+scopeCond.SQL+`
				`+exc+`
			`+favoritesFirst(opts.PreferFavorites)+`
			LIMIT ?`,
			append(append(append([]any{userID}, scopeCond.Params...), excArgs...), count-len(candidates))...)
		if err != nil {
			return nil, fmt.Errorf("random candidates fallback: %w", err)
		}
		more, err := scanCandidate(rows, false)
		if err != nil {
			return nil, err
		}
		candidates = append(candidates, more...)
	}
	if err := s.loadGenreIDs(ctx, candidates); err != nil {
		return nil, err
	}
	return candidateSongs(candidates), nil
}

// smartCandidateRows draws the bounded random pool with per-candidate genre
// overlap against the context (v1's getSmartCandidateRows).
func (s *Service) smartCandidateRows(ctx context.Context, userID string, c *SongContext, excludeIDs []string, opts Options, scope libraries.Scope) ([]candidateRow, error) {
	exclude, excludeArgs := buildExcludeClause(excludeIDs)
	recent, recentArgs := recentHistoryClause(userID, opts.ExcludeWindow)
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	genrePlaceholders := ""
	genreArgs := []any{}
	if c != nil && len(c.GenreIDs) > 0 {
		for i, id := range c.GenreIDs {
			if i > 0 {
				genrePlaceholders += ", "
			}
			genrePlaceholders += "?"
			genreArgs = append(genreArgs, id)
		}
	}
	overlapSQL := "0"
	if genrePlaceholders != "" {
		overlapSQL = `(SELECT COUNT(*) FROM song_genres csg WHERE csg.song_id = s.id AND csg.genre_id IN (` + genrePlaceholders + `))`
	}
	// Params appear in SELECT order (genre ids), then the user_songs join
	// (user id), then WHERE (scope ids, exclusions, recent-history user id
	// + window) — exactly like v1.
	args := append([]any{}, genreArgs...)
	args = append(args, userID)
	args = append(args, scopeCond.Params...)
	args = append(args, excludeArgs...)
	args = append(args, recentArgs...)
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+songColumns+`, `+overlapSQL+` AS genre_overlap `+songJoins+`
		WHERE s.active = 1
			`+scopeCond.SQL+`
			`+exclude+`
			`+recent+`
		ORDER BY RANDOM()
		LIMIT ?`, append(args, smartPoolSize)...)
	if err != nil {
		return nil, fmt.Errorf("smart candidates: %w", err)
	}
	candidates, err := scanCandidate(rows, true)
	if err != nil {
		return nil, err
	}
	if err := s.loadGenreIDs(ctx, candidates); err != nil {
		return nil, err
	}
	return candidates, nil
}

// userAveragePlayCount is v1's getUserAveragePlayCount: the familiarity
// baseline for the overplayed penalty.
func (s *Service) userAveragePlayCount(ctx context.Context, userID string) (float64, error) {
	var avg sql.NullFloat64
	if err := s.db.QueryRowContext(ctx,
		`SELECT AVG(play_count) FROM user_songs WHERE user_id = ?`, userID).Scan(&avg); err != nil {
		return 0, fmt.Errorf("load average play count: %w", err)
	}
	if !avg.Valid {
		return 0, nil
	}
	return avg.Float64, nil
}

func candidateIDs(candidates []candidateRow) []string {
	ids := make([]string, len(candidates))
	for i := range candidates {
		ids[i] = candidates[i].song.ID
	}
	return ids
}

// candidateSongs projects candidates to the API shape.
func candidateSongs(candidates []candidateRow) []Song {
	songs := make([]Song, len(candidates))
	for i, c := range candidates {
		songs[i] = c.song
	}
	return songs
}

func chunkIDs(ids []string) [][]string {
	chunks := make([][]string, 0, (len(ids)+idChunkSize-1)/idChunkSize)
	for len(ids) > 0 {
		n := min(len(ids), idChunkSize)
		chunks = append(chunks, ids[:n])
		ids = ids[n:]
	}
	return chunks
}
