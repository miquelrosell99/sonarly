// Package autodj ports the old auto-dj: similar / random / smart candidate
// generation for playback continuity. The selection SQL, the JS scoring
// port, the exclude windows, the 500-id cap and the user-preference-driven
// options all follow the old server; deliberate deviations:
//
//   - Errors surface as a typed 502 instead of the old silent "200 with an
//     empty songs array" — the audit called that swallow a bug: a client
//     cannot tell "nothing fits" from "the server broke". Generation
//     failures (DB errors) answer 502 Bad Gateway with a generic message;
//     "nothing fits" is still a 200 with an empty list.
//   - ORDER BY RANDOM() stays (wire parity): at SQLite scale — one library,
//     one writer, candidate sets capped at 500 — the sort is milliseconds.
//     The smart pool is additionally bounded (500 rows) like the retired server.
//   - The similarity seed resolves beyond the current song: a signal-less
//     current song falls back to the posted queue tail, then to the user's
//     most recently played track, so a session keeps scoring against what
//     actually started it.
//   - Batches pass the diversity caps (no consecutive same-artist picks, one
//     song per album, era spread where years exist) and never duplicate a
//     song from the caller's posted queue — that last rule is absolute.
//   - Every suggestion carries a server-computed `reason` string explaining
//     which scoring signals fired.
//
// Explicit-content filtering stays OFF (wire parity): auto-dj follows the
// user's own listening context, and the client can post-filter.
package autodj

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/miquelrosell99/sonarly/server/internal/db"

	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

// maxExcludeIDs caps the exclusion id list (the old MAX_EXCLUDE_IDS).
const maxExcludeIDs = 500

// maxQueueIDs caps the caller's queue id list (POST body). The queue-length
// contract is a hard guarantee, so the final duplicate filter always runs
// against the full posted list — the SQL exclusion only sees the capped head.
const maxQueueIDs = 1000

// idChunkSize bounds the genre batch loader's IN lists.
const idChunkSize = 400

// smartPoolSize bounds the smart-mode candidate pool (the old LIMIT 500).
const smartPoolSize = 500

// ExcludeWindow is a whitelisted recent-history exclusion window.
type ExcludeWindow string

const (
	Window24h ExcludeWindow = "24h"
	Window7d  ExcludeWindow = "7d"
	Window30d ExcludeWindow = "30d"
)

// excludeWindowModifiers maps windows to sqlite datetime modifiers. The map
// is hardcoded — modifiers are never interpolated from user input (the old
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

// Options carries the dj configuration the retired server stored in user preferences.
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
// DTO, plus the caller's interaction state — the old rowToSong shape).
// Reason is the server-computed explanation for the pick ("More like X",
// "Hidden gem — you haven't played this", …) derived from the scoring
// signals that fired; additive field, empty when no explanation exists.
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
	Reason      string   `json:"reason,omitempty"`
}

// SongContext is the seed song's similarity inputs (the old SongContext,
// extended with the display names the reason strings quote).
type SongContext struct {
	ID         string
	ArtistID   *string
	ArtistName *string
	AlbumID    *string
	BPM        *int
	Mood       *string
	GenreIDs   []string
	GenreNames []string
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
	genreIDs     []string // loaded separately, like the old server
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
		var duration db.NullInt64 // the retired server may have stored fractional REAL seconds
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

// buildExcludeClause caps and placeholders the exclusion list (wire parity:
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
// per listening_history (wire parity). The threshold renders in the same ISO
// 8601 shape scrobble writes into played_at — the retired server compared a space-format
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

// songContext loads the similarity inputs for one song (the old getSongContext:
// a missing song yields nil, which the modes treat as "no context"). The
// artist and genre display names ride along because the reason strings quote
// them ("More like {artist}", "Because you love {genre}").
func (s *Service) songContext(ctx context.Context, userID, songID string) (*SongContext, error) {
	var c SongContext
	var artistID, artistName, albumID, mood sql.NullString
	var bpm, playCount sql.NullInt64
	var rating sql.NullFloat64
	var lastPlayed sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT s.artist_id, ar.name, s.album_id, s.bpm, s.mood, us.rating, us.play_count, us.last_played
		FROM songs s
		LEFT JOIN artists ar ON ar.id = s.artist_id
		LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id
		WHERE s.id = ? AND s.active = 1`, userID, songID).
		Scan(&artistID, &artistName, &albumID, &bpm, &mood, &rating, &playCount, &lastPlayed)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load song context: %w", err)
	}
	c.ID = songID
	c.ArtistID, c.ArtistName = strPtr(artistID), strPtr(artistName)
	c.AlbumID, c.Mood = strPtr(albumID), strPtr(mood)
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
		`SELECT g.id, g.name FROM song_genres sg
		JOIN genres g ON g.id = sg.genre_id
		WHERE sg.song_id = ? ORDER BY sg.position`, songID)
	if err != nil {
		return nil, fmt.Errorf("load song context genres: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("load song context genres: %w", err)
		}
		c.GenreIDs = append(c.GenreIDs, id)
		c.GenreNames = append(c.GenreNames, name)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load song context genres: %w", err)
	}
	return &c, nil
}

// latestPlayedSong is the session-anchor fallback for seed resolution: the
// song id of the caller's most recent listening_history row, or "" when the
// history is empty.
func (s *Service) latestPlayedSong(ctx context.Context, userID string) (string, error) {
	var id string
	err := s.db.QueryRowContext(ctx,
		`SELECT song_id FROM listening_history
		WHERE user_id = ? ORDER BY played_at DESC LIMIT 1`, userID).Scan(&id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("load latest played song: %w", err)
	}
	return id, nil
}

// loadGenreIDs batch-loads the genre id lists for candidates (the old
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

// similarCandidates ports the old getSimilarCandidates: artist/album/genre
// overlap with the seed first, trimmed by the diversity caps, then random
// backfill so the request still returns count songs when the overlap pool
// runs dry.
func (s *Service) similarCandidates(ctx context.Context, userID string, seed *SongContext, count int, excludeIDs []string, opts Options, scope libraries.Scope) ([]Song, error) {
	exclude, excludeArgs := buildExcludeClause(excludeIDs)
	recent, recentArgs := recentHistoryClause(userID, opts.ExcludeWindow)
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	candidates := []candidateRow{}
	if seed != nil && (seed.ArtistID != nil || seed.AlbumID != nil || len(seed.GenreIDs) > 0) {
		genrePlaceholders := ""
		genreArgs := []any{}
		if len(seed.GenreIDs) > 0 {
			for i, id := range seed.GenreIDs {
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
		args := []any{userID, seed.ID}
		args = append(args, scopeCond.Params...)
		args = append(args, excludeArgs...)
		args = append(args, recentArgs...)
		args = append(args, nilOr(seed.ArtistID), nilOr(seed.AlbumID))
		args = append(args, genreArgs...)
		args = append(args, poolWindowLimit(count))
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
	// The overlap query filters by genre EXISTS without counting hits; the
	// reason strings ("Because you love {genre}") need the count.
	if seed != nil && len(seed.GenreIDs) > 0 {
		seedGenres := idSet(seed.GenreIDs)
		for i := range candidates {
			overlap := 0
			for _, gid := range candidates[i].genreIDs {
				if seedGenres[gid] {
					overlap++
				}
			}
			candidates[i].genreOverlap = overlap
		}
	}
	ordered := make([]scoredCandidate, len(candidates))
	for i, row := range candidates {
		ordered[i] = scoredCandidate{row: row}
	}
	songs := []Song{}
	for _, sc := range diversePick(ordered, count) {
		song := sc.row.song
		song.Reason = reasonFor(sc.row, seed)
		songs = append(songs, song)
	}
	if len(songs) < count {
		extra := []string{}
		extra = append(extra, excludeIDs...)
		for _, song := range songs {
			extra = append(extra, song.ID)
		}
		if seed != nil {
			extra = append(extra, seed.ID)
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

// randomCandidates ports the old getRandomCandidates: the recent-play window
// applies through user_songs.last_played (old behavior — similar/smart use
// listening_history instead), with a no-window fallback pass when the window
// drains the pool. The pool fetches overscanned so the diversity caps can
// spread the batch before it falls back.
func (s *Service) randomCandidates(ctx context.Context, userID string, count int, excludeIDs []string, opts Options, scope libraries.Scope) ([]Song, error) {
	windowLimit := poolWindowLimit(count)
	exclude, excludeArgs := buildExcludeClause(excludeIDs)
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	query := func(limit int, whereFragment string, windowArg any, args []any) ([]candidateRow, error) {
		windowClause := ""
		if windowArg != nil {
			windowClause = ` AND (us.last_played IS NULL OR us.last_played < datetime('now', ?))`
		}
		rows, err := s.db.QueryContext(ctx,
			`SELECT `+songColumns+` `+songJoins+`
			WHERE s.active = 1
				`+scopeCond.SQL+`
				`+whereFragment+`
				`+windowClause+`
			`+favoritesFirst(opts.PreferFavorites)+`
			LIMIT ?`, args...)
		if err != nil {
			return nil, err
		}
		return scanCandidate(rows, false)
	}

	fullArgs := func(fragment string, fragmentArgs []any, limit int, windowArg any) []any {
		args := append([]any{userID}, scopeCond.Params...)
		args = append(args, fragmentArgs...)
		if windowArg != nil {
			args = append(args, windowArg)
		}
		return append(args, limit)
	}

	candidates, err := query(windowLimit, exclude, windowModifier(opts.ExcludeWindow), fullArgs(exclude, excludeArgs, windowLimit, windowModifier(opts.ExcludeWindow)))
	if err != nil {
		return nil, fmt.Errorf("random candidates: %w", err)
	}

	// The no-window fallback (old behavior) runs only when the windowed pool
	// cannot fill the batch — either raw rows or diversity-capped picks.
	picked := diversePick(asOrdered(candidates), count)
	if len(picked) < count && len(candidates) < windowLimit {
		fallbackExclude := append(append([]string{}, excludeIDs...), candidateIDs(candidates)...)
		exc, excArgs := buildExcludeClause(fallbackExclude)
		more, err := query(windowLimit-len(candidates), exc, nil, fullArgs(exc, excArgs, windowLimit-len(candidates), nil))
		if err != nil {
			return nil, fmt.Errorf("random candidates fallback: %w", err)
		}
		candidates = append(candidates, more...)
		picked = diversePick(asOrdered(candidates), count)
	}
	if err := s.loadGenreIDs(ctx, candidates); err != nil {
		return nil, err
	}
	songs := make([]Song, 0, len(picked))
	for _, sc := range picked {
		song := sc.row.song
		song.Reason = reasonFor(sc.row, nil)
		songs = append(songs, song)
	}
	return songs, nil
}

// asOrdered wraps pool rows in fetch order for the diversity picker.
func asOrdered(candidates []candidateRow) []scoredCandidate {
	ordered := make([]scoredCandidate, len(candidates))
	for i, row := range candidates {
		ordered[i] = scoredCandidate{row: row}
	}
	return ordered
}

// smartCandidateRows draws the bounded random pool with per-candidate genre
// overlap against the seed (the old getSmartCandidateRows).
func (s *Service) smartCandidateRows(ctx context.Context, userID string, seed *SongContext, excludeIDs []string, opts Options, scope libraries.Scope) ([]candidateRow, error) {
	exclude, excludeArgs := buildExcludeClause(excludeIDs)
	recent, recentArgs := recentHistoryClause(userID, opts.ExcludeWindow)
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	genrePlaceholders := ""
	genreArgs := []any{}
	if seed != nil && len(seed.GenreIDs) > 0 {
		for i, id := range seed.GenreIDs {
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
	// + window) — exactly like the retired server.
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

// userAveragePlayCount is the old getUserAveragePlayCount: the familiarity
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

func chunkIDs(ids []string) [][]string {
	chunks := make([][]string, 0, (len(ids)+idChunkSize-1)/idChunkSize)
	for len(ids) > 0 {
		n := min(len(ids), idChunkSize)
		chunks = append(chunks, ids[:n])
		ids = ids[n:]
	}
	return chunks
}
