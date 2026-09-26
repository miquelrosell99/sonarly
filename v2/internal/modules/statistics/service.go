package statistics

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// v1's statistics constants, ported unchanged.
const (
	topLimit           = 10
	genreLimit         = 10
	minRatedSongs      = 2
	bayesianPriorCount = 5
	groupByLimit       = 6
)

// ErrUserNotFound is the only typed failure the service surfaces: routes
// answer 404 for it and a generic 500 for everything else — raw driver
// messages never reach the client (v1 leaked err.message).
var ErrUserNotFound = errors.New("statistics: user not found")

// Service loads listening statistics. Every method issues a fixed,
// request-independent number of statements (see the package doc): the
// consolidation is the point — v1 ran ~20 per request.
type Service struct {
	db *sql.DB
}

func NewService(db *sql.DB) *Service { return &Service{db: db} }

// rangeModifiers maps the whitelisted range to a sqlite datetime modifier.
// Values are hardcoded, never user input (v1's whitelist pattern).
var rangeModifiers = map[TimeRange]string{
	Range7d:  "-7 days",
	Range30d: "-30 days",
	Range90d: "-90 days",
	Range1y:  "-1 year",
}

// historyConds builds the listening_history conditions: user filter plus
// the range threshold compared AGAINST the indexed played_at column as an
// ISO string (v1's index-preserving pattern — no date()/strftime wrapping
// of the column itself).
func historyConds(userID string, r TimeRange) ([]string, []any) {
	conds := []string{}
	args := []any{}
	if userID != "" {
		conds = append(conds, "lh.user_id = ?")
		args = append(args, userID)
	}
	if mod, ok := rangeModifiers[r]; ok {
		conds = append(conds, "lh.played_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)")
		args = append(args, mod)
	}
	return conds, args
}

func where(conds []string) string {
	if len(conds) == 0 {
		return ""
	}
	return "WHERE " + strings.Join(conds, " AND ")
}

func repeatArgs(args []any, n int) []any {
	out := make([]any, 0, len(args)*n)
	for i := 0; i < n; i++ {
		out = append(out, args...)
	}
	return out
}

// UserStatistics assembles one user's statistics in six statements (v1: ~20):
// user row, totals+favorites, top lists, rated lists, rating distribution,
// monthly plays.
func (s *Service) UserStatistics(ctx context.Context, userID string, r TimeRange) (*UserStatistics, error) {
	var user UserStatistics
	var name, surname sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT id, username, name, surname FROM users WHERE id = ?`, userID).
		Scan(&user.UserID, &user.Username, &name, &surname)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load statistics user: %w", err)
	}
	user.Range = r
	if display := displayName(name, surname); display != nil {
		user.DisplayName = display
	}

	totals, err := s.totals(ctx, userID, r)
	if err != nil {
		return nil, err
	}
	user.Totals = *totals

	top, err := s.topLists(ctx, userID, r)
	if err != nil {
		return nil, err
	}
	user.Top = *top

	rated, err := s.ratedLists(ctx, userID)
	if err != nil {
		return nil, err
	}
	user.Rated = *rated

	distribution, err := s.ratingDistribution(ctx, userID)
	if err != nil {
		return nil, err
	}
	user.Charts = Charts{RatingDistribution: *distribution}

	monthly, err := s.monthlyPlays(ctx, userID, r)
	if err != nil {
		return nil, err
	}
	user.MonthlyPlays = monthly
	return &user, nil
}

// OverallStatistics assembles the server-wide statistics in six statements.
func (s *Service) OverallStatistics(ctx context.Context, r TimeRange) (*OverallStatistics, error) {
	stats := &OverallStatistics{Range: r}
	totals, err := s.totals(ctx, "", r)
	if err != nil {
		return nil, err
	}
	stats.Totals = *totals
	top, err := s.topLists(ctx, "", r)
	if err != nil {
		return nil, err
	}
	stats.Top = *top
	rated, err := s.ratedLists(ctx, "")
	if err != nil {
		return nil, err
	}
	stats.Rated = *rated
	distribution, err := s.ratingDistribution(ctx, "")
	if err != nil {
		return nil, err
	}
	stats.Charts = Charts{RatingDistribution: *distribution}
	monthly, err := s.monthlyPlays(ctx, "", r)
	if err != nil {
		return nil, err
	}
	stats.MonthlyPlays = monthly
	summaries, err := s.userSummaries(ctx, r)
	if err != nil {
		return nil, err
	}
	stats.UserSummaries = summaries
	return stats, nil
}

// totals folds the two history aggregates and the three starred counts into
// one UNION ALL statement.
func (s *Service) totals(ctx context.Context, userID string, r TimeRange) (*Totals, error) {
	conds, args := historyConds(userID, r)
	historyWhere := where(conds)
	favCond := "WHERE starred = 1"
	favArgs := []any{}
	if userID != "" {
		favCond = "WHERE user_id = ? AND starred = 1"
		favArgs = []any{userID}
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT k, n FROM (
			SELECT 'total_plays' AS k, COUNT(*) AS n
			FROM listening_history lh JOIN songs s ON s.id = lh.song_id AND s.active = 1
			`+historyWhere+`
			UNION ALL
			SELECT 'total_duration', COALESCE(SUM(lh.duration_listened), 0)
			FROM listening_history lh JOIN songs s ON s.id = lh.song_id AND s.active = 1
			`+historyWhere+`
			UNION ALL
			SELECT 'favorite_songs', COUNT(*) FROM user_songs `+favCond+`
			UNION ALL
			SELECT 'favorite_albums', COUNT(*) FROM user_albums `+favCond+`
			UNION ALL
			SELECT 'favorite_artists', COUNT(*) FROM user_artists `+favCond+`
		)`,
		append(append(append([]any{}, args...), args...),
			repeatArgs(favArgs, 3)...)...)
	if err != nil {
		return nil, fmt.Errorf("load totals: %w", err)
	}
	defer rows.Close()
	var totals Totals
	for rows.Next() {
		var k string
		var n int
		if err := rows.Scan(&k, &n); err != nil {
			return nil, fmt.Errorf("load totals: %w", err)
		}
		switch k {
		case "total_plays":
			totals.TotalPlays = n
		case "total_duration":
			totals.TotalDurationListened = n
		case "favorite_songs":
			totals.FavoriteSongs = n
		case "favorite_albums":
			totals.FavoriteAlbums = n
		case "favorite_artists":
			totals.FavoriteArtists = n
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load totals: %w", err)
	}
	return &totals, nil
}

// topLists folds the five top-N lists into one UNION ALL statement; each arm
// keeps its own ORDER BY + LIMIT inside a subselect. Genre rows carry the
// listening-time sum like v1's getTopGenres.
func (s *Service) topLists(ctx context.Context, userID string, r TimeRange) (*TopLists, error) {
	conds, args := historyConds(userID, r)
	historyWhere := where(conds)
	yearWhere := where(append([]string{"s.year IS NOT NULL"}, conds...))
	query := fmt.Sprintf(`
		SELECT * FROM (
			SELECT 'songs' AS kind, s.id AS rid, s.title AS name, ar.name AS sub,
				COALESCE(s.cover_art_id, al.cover_art_id) AS cover, COUNT(*) AS plays,
				COALESCE(SUM(lh.duration_listened), 0) AS dur, NULL AS yr
			FROM listening_history lh
			JOIN songs s ON s.id = lh.song_id AND s.active = 1
			LEFT JOIN artists ar ON ar.id = s.artist_id
			LEFT JOIN albums al ON al.id = s.album_id
			%s
			GROUP BY s.id ORDER BY plays DESC, s.title LIMIT %d)
		UNION ALL
		SELECT * FROM (
			SELECT 'artists', ar.id, ar.name, NULL, NULL, COUNT(*) AS plays, 0, NULL
			FROM listening_history lh
			JOIN songs s ON s.id = lh.song_id AND s.active = 1
			LEFT JOIN artists ar ON ar.id = s.artist_id
			%s
			GROUP BY ar.id ORDER BY plays DESC, ar.name LIMIT %d)
		UNION ALL
		SELECT * FROM (
			SELECT 'albums', al.id, al.name, ar.name, al.cover_art_id, COUNT(*) AS plays, 0, NULL
			FROM listening_history lh
			JOIN songs s ON s.id = lh.song_id AND s.active = 1
			LEFT JOIN albums al ON al.id = s.album_id
			LEFT JOIN artists ar ON ar.id = al.artist_id
			%s
			GROUP BY al.id ORDER BY plays DESC, al.name LIMIT %d)
		UNION ALL
		SELECT * FROM (
			SELECT 'genres', NULL, COALESCE(NULLIF(g.name, ''), 'Unknown'), NULL, NULL, COUNT(*) AS plays,
				COALESCE(SUM(lh.duration_listened), 0), NULL
			FROM listening_history lh
			JOIN songs s ON s.id = lh.song_id AND s.active = 1
			LEFT JOIN genres g ON g.id = s.genre_id
			%s
			GROUP BY g.name ORDER BY plays DESC LIMIT %d)
		UNION ALL
		SELECT * FROM (
			SELECT 'years', NULL, CAST(s.year AS TEXT), NULL, NULL, COUNT(*) AS plays,
				COALESCE(SUM(lh.duration_listened), 0), s.year
			FROM listening_history lh
			JOIN songs s ON s.id = lh.song_id AND s.active = 1
			%s
			GROUP BY s.year ORDER BY plays DESC LIMIT %d)`,
		historyWhere, topLimit,
		historyWhere, topLimit,
		historyWhere, topLimit,
		historyWhere, genreLimit,
		yearWhere, topLimit)
	stmtArgs := repeatArgs(args, 5)
	rows, err := s.db.QueryContext(ctx, query, stmtArgs...)
	if err != nil {
		return nil, fmt.Errorf("load top lists: %w", err)
	}
	defer rows.Close()
	top := &TopLists{
		TopSongs:   []TopSongItem{},
		TopArtists: []TopArtistItem{},
		TopAlbums:  []TopAlbumItem{},
		TopGenres:  []GenreDistributionItem{},
		TopYears:   []TopYearItem{},
	}
	for rows.Next() {
		var kind string
		var rid, name, sub, cover sql.NullString
		var plays, dur, yr sql.NullInt64
		if err := rows.Scan(&kind, &rid, &name, &sub, &cover, &plays, &dur, &yr); err != nil {
			return nil, fmt.Errorf("load top lists: %w", err)
		}
		switch kind {
		case "songs":
			top.TopSongs = append(top.TopSongs, TopSongItem{
				SongID: strValue(rid), Title: strValue(name), ArtistName: strPtr(sub),
				AlbumCoverArt: strPtr(cover), Plays: int(plays.Int64),
			})
		case "artists":
			top.TopArtists = append(top.TopArtists, TopArtistItem{
				ArtistID: strPtr(rid), ArtistName: strValue(name), Plays: int(plays.Int64),
			})
		case "albums":
			top.TopAlbums = append(top.TopAlbums, TopAlbumItem{
				AlbumID: strPtr(rid), AlbumName: strValue(name), ArtistName: strPtr(sub),
				CoverArt: strPtr(cover), Plays: int(plays.Int64),
			})
		case "genres":
			top.TopGenres = append(top.TopGenres, GenreDistributionItem{
				Genre: strValue(name), Plays: int(plays.Int64), TotalDurationListened: int(dur.Int64),
			})
		case "years":
			if yr.Valid {
				top.TopYears = append(top.TopYears, TopYearItem{
					Year: int(yr.Int64), Plays: int(plays.Int64), TotalDurationListened: int(dur.Int64),
				})
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load top lists: %w", err)
	}
	return top, nil
}

// ratedLists folds the three Bayesian-rated lists into one UNION ALL. The
// global rating average is computed ONCE per request by the MATERIALIZED
// prior CTE and shared by all three arms (v1 scanned it three times).
func (s *Service) ratedLists(ctx context.Context, userID string) (*RatedLists, error) {
	priorAvg := `SELECT AVG(rating) FROM user_songs WHERE rating IS NOT NULL`
	conds := []string{"us.rating IS NOT NULL"}
	args := []any{}
	if userID != "" {
		priorAvg += ` AND user_id = ?`
		conds = append(conds, "us.user_id = ?")
		args = append(args, userID)
	}
	// priorAvg binds first, then the three arms share the same where args.
	armWhere := where(conds)
	query := fmt.Sprintf(`
		WITH prior AS MATERIALIZED (
			SELECT %d.0 AS n, COALESCE((%s), 0) AS avg
		)
		SELECT * FROM (
			SELECT 'artists' AS kind, ar.id AS rid, ar.name AS name,
				ROUND(AVG(us.rating), 2) AS avg_r, COUNT(*) AS rated,
				ROUND((SUM(us.rating) + prior.n * prior.avg) / (COUNT(*) + prior.n), 2) AS bayes
			FROM user_songs us
			JOIN songs s ON s.id = us.song_id AND s.active = 1
			LEFT JOIN artists ar ON ar.id = s.artist_id
			CROSS JOIN prior
			%s
			GROUP BY ar.id HAVING COUNT(*) >= %d
			ORDER BY bayes DESC, rated DESC, ar.name LIMIT %d)
		UNION ALL
		SELECT * FROM (
			SELECT 'genres', NULL, COALESCE(NULLIF(g.name, ''), 'Unknown'),
				ROUND(AVG(us.rating), 2) AS avg_r, COUNT(*) AS rated,
				ROUND((SUM(us.rating) + prior.n * prior.avg) / (COUNT(*) + prior.n), 2) AS bayes
			FROM user_songs us
			JOIN songs s ON s.id = us.song_id AND s.active = 1
			LEFT JOIN genres g ON g.id = s.genre_id
			CROSS JOIN prior
			%s
			GROUP BY g.name HAVING COUNT(*) >= %d
			ORDER BY bayes DESC, rated DESC LIMIT %d)
		UNION ALL
		SELECT * FROM (
			SELECT 'years', NULL, CAST(s.year AS TEXT),
				ROUND(AVG(us.rating), 2) AS avg_r, COUNT(*) AS rated,
				ROUND((SUM(us.rating) + prior.n * prior.avg) / (COUNT(*) + prior.n), 2) AS bayes
			FROM user_songs us
			JOIN songs s ON s.id = us.song_id AND s.active = 1
			CROSS JOIN prior
			%s AND s.year IS NOT NULL
			GROUP BY s.year HAVING COUNT(*) >= %d
			ORDER BY bayes DESC, rated DESC LIMIT %d)`,
		bayesianPriorCount, priorAvg,
		armWhere, minRatedSongs, topLimit,
		armWhere, minRatedSongs, topLimit,
		armWhere, minRatedSongs, topLimit)
	stmtArgs := []any{}
	if userID != "" {
		stmtArgs = append(stmtArgs, userID)
	}
	stmtArgs = append(stmtArgs, repeatArgs(args, 3)...)
	rows, err := s.db.QueryContext(ctx, query, stmtArgs...)
	if err != nil {
		return nil, fmt.Errorf("load rated lists: %w", err)
	}
	defer rows.Close()
	rated := &RatedLists{
		TopRatedArtists: []RatedArtistItem{},
		TopRatedGenres:  []TopRatedGenreItem{},
		TopRatedYears:   []TopRatedYearItem{},
	}
	for rows.Next() {
		var kind string
		var rid, name sql.NullString
		var avgR, bayes float64
		var ratedCount int
		if err := rows.Scan(&kind, &rid, &name, &avgR, &ratedCount, &bayes); err != nil {
			return nil, fmt.Errorf("load rated lists: %w", err)
		}
		switch kind {
		case "artists":
			rated.TopRatedArtists = append(rated.TopRatedArtists, RatedArtistItem{
				ArtistID: strPtr(rid), ArtistName: strValue(name),
				AverageRating: avgR, BayesianAverage: bayes, RatedSongs: ratedCount,
			})
		case "genres":
			rated.TopRatedGenres = append(rated.TopRatedGenres, TopRatedGenreItem{
				Genre: strValue(name), AverageRating: avgR, BayesianAverage: bayes, RatedSongs: ratedCount,
			})
		case "years":
			year, err := strconv.Atoi(strValue(name))
			if err != nil {
				continue
			}
			rated.TopRatedYears = append(rated.TopRatedYears, TopRatedYearItem{
				Year: year, AverageRating: avgR, BayesianAverage: bayes, RatedSongs: ratedCount,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load rated lists: %w", err)
	}
	return rated, nil
}

// ratingDistribution folds the six per-table histogram scans into one UNION
// ALL (v1 ran six statements). v1 merged rated counts across songs, albums
// and artists into a single histogram; unrated is the sum of the three
// unrated counts.
func (s *Service) ratingDistribution(ctx context.Context, userID string) (*RatingDistribution, error) {
	ratedCond := "WHERE rating IS NOT NULL"
	unratedCond := "WHERE rating IS NULL"
	args := []any{}
	if userID != "" {
		ratedCond = "WHERE rating IS NOT NULL AND user_id = ?"
		unratedCond = "WHERE rating IS NULL AND user_id = ?"
		args = append(args, userID)
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT k, rating, cnt, unrated FROM (
			SELECT 'songs' AS k, rating, COUNT(*) AS cnt, 0 AS unrated FROM user_songs `+ratedCond+` GROUP BY rating
			UNION ALL
			SELECT 'albums', rating, COUNT(*), 0 FROM user_albums `+ratedCond+` GROUP BY rating
			UNION ALL
			SELECT 'artists', rating, COUNT(*), 0 FROM user_artists `+ratedCond+` GROUP BY rating
			UNION ALL
			SELECT 'songs', NULL, 0, COUNT(*) FROM user_songs `+unratedCond+`
			UNION ALL
			SELECT 'albums', NULL, 0, COUNT(*) FROM user_albums `+unratedCond+`
			UNION ALL
			SELECT 'artists', NULL, 0, COUNT(*) FROM user_artists `+unratedCond+`
		)`,
		append(repeatArgs(args, 3), repeatArgs(args, 3)...)...)
	if err != nil {
		return nil, fmt.Errorf("load rating distribution: %w", err)
	}
	defer rows.Close()
	counts := map[int]int{}
	unrated := 0
	for rows.Next() {
		var k string
		var rating sql.NullFloat64
		var cnt, unr sql.NullInt64
		if err := rows.Scan(&k, &rating, &cnt, &unr); err != nil {
			return nil, fmt.Errorf("load rating distribution: %w", err)
		}
		if rating.Valid {
			counts[int(rating.Float64)] += int(cnt.Int64)
		} else {
			unrated += int(unr.Int64)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load rating distribution: %w", err)
	}
	distribution := &RatingDistribution{Unrated: unrated}
	for rating := 1; rating <= 5; rating++ {
		distribution.Ratings = append(distribution.Ratings, RatingDistributionItem{Rating: rating, Count: counts[rating]})
	}
	return distribution, nil
}

func (s *Service) monthlyPlays(ctx context.Context, userID string, r TimeRange) ([]MonthlyPlaysItem, error) {
	conds, args := historyConds(userID, r)
	rows, err := s.db.QueryContext(ctx,
		`SELECT strftime('%Y-%m', lh.played_at) AS month, COUNT(*) AS plays
		FROM listening_history lh JOIN songs s ON s.id = lh.song_id AND s.active = 1
		`+where(conds)+`
		GROUP BY month ORDER BY month`, args...)
	if err != nil {
		return nil, fmt.Errorf("load monthly plays: %w", err)
	}
	defer rows.Close()
	items := []MonthlyPlaysItem{}
	for rows.Next() {
		var item MonthlyPlaysItem
		if err := rows.Scan(&item.Month, &item.Plays); err != nil {
			return nil, fmt.Errorf("load monthly plays: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load monthly plays: %w", err)
	}
	return items, nil
}

func (s *Service) userSummaries(ctx context.Context, r TimeRange) ([]UserSummary, error) {
	conds, args := historyConds("", r)
	rows, err := s.db.QueryContext(ctx,
		`SELECT u.id, u.username, u.name, u.surname, COUNT(*) AS total_plays,
			COALESCE(SUM(lh.duration_listened), 0) AS total_duration, COUNT(DISTINCT s.id) AS unique_songs
		FROM listening_history lh
		JOIN songs s ON s.id = lh.song_id AND s.active = 1
		JOIN users u ON u.id = lh.user_id
		`+where(conds)+`
		GROUP BY u.id ORDER BY total_plays DESC`, args...)
	if err != nil {
		return nil, fmt.Errorf("load user summaries: %w", err)
	}
	defer rows.Close()
	summaries := []UserSummary{}
	for rows.Next() {
		var summary UserSummary
		var name, surname sql.NullString
		if err := rows.Scan(&summary.UserID, &summary.Username, &name, &surname,
			&summary.TotalPlays, &summary.TotalDurationListened, &summary.UniqueSongs); err != nil {
			return nil, fmt.Errorf("load user summaries: %w", err)
		}
		summary.DisplayName = displayName(name, surname)
		summaries = append(summaries, summary)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load user summaries: %w", err)
	}
	return summaries, nil
}

// MonthlyGrouped returns the month × group breakdown. Every groupBy runs as
// a single statement (rating and favorite union their two arms).
func (s *Service) MonthlyGrouped(ctx context.Context, userID string, r TimeRange, groupBy GroupBy) ([]MonthlyGroupedItem, error) {
	conds, args := historyConds(userID, r)
	historyWhere := where(conds)
	var query string
	var stmtArgs []any
	switch groupBy {
	case GroupByArtist, GroupByGenre, GroupByYear:
		key := "COALESCE(ar.name, 'Unknown')"
		join := "LEFT JOIN artists ar ON ar.id = s.artist_id"
		groupCols := "ar.name"
		if groupBy == GroupByGenre {
			key = "COALESCE(NULLIF(g.name, ''), 'Unknown')"
			join = "LEFT JOIN genres g ON g.id = s.genre_id"
			groupCols = "g.name"
		} else if groupBy == GroupByYear {
			key = "COALESCE(CAST(s.year AS TEXT), 'Unknown')"
			join = ""
			groupCols = "s.year"
		}
		query = `SELECT strftime('%Y-%m', lh.played_at) AS month, ` + key + ` AS key, COUNT(*) AS plays
			FROM listening_history lh
			JOIN songs s ON s.id = lh.song_id AND s.active = 1
			` + join + `
			` + historyWhere + `
			GROUP BY month, ` + groupCols + ` ORDER BY month, plays DESC`
		stmtArgs = args
	case GroupByRating:
		query = `SELECT month, key, plays FROM (
			SELECT strftime('%Y-%m', lh.played_at) AS month, CAST(us.rating AS TEXT) AS key, COUNT(*) AS plays
			FROM listening_history lh
			JOIN songs s ON s.id = lh.song_id AND s.active = 1
			JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?
			` + historyWhere + ` AND us.rating IS NOT NULL
			GROUP BY month, us.rating
			UNION ALL
			SELECT strftime('%Y-%m', lh.played_at) AS month, 'Unrated' AS key, COUNT(*) AS plays
			FROM listening_history lh
			JOIN songs s ON s.id = lh.song_id AND s.active = 1
			LEFT JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?
			` + historyWhere + ` AND us.rating IS NULL
			GROUP BY month)`
		stmtArgs = append([]any{userID}, args...)
		stmtArgs = append(stmtArgs, userID)
		stmtArgs = append(stmtArgs, args...)
	case GroupByFavorite:
		query = `SELECT month, key, plays FROM (
			SELECT strftime('%Y-%m', lh.played_at) AS month, 'Favorite' AS key, COUNT(*) AS plays
			FROM listening_history lh
			JOIN songs s ON s.id = lh.song_id AND s.active = 1
			JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?
			` + historyWhere + ` AND us.starred = 1
			GROUP BY month
			UNION ALL
			SELECT strftime('%Y-%m', lh.played_at) AS month, 'Not favorite' AS key, COUNT(*) AS plays
			FROM listening_history lh
			JOIN songs s ON s.id = lh.song_id AND s.active = 1
			LEFT JOIN user_songs us ON us.song_id = s.id AND us.user_id = ?
			` + historyWhere + ` AND (us.starred = 0 OR us.starred IS NULL)
			GROUP BY month)`
		stmtArgs = append([]any{userID}, args...)
		stmtArgs = append(stmtArgs, userID)
		stmtArgs = append(stmtArgs, args...)
	default:
		return nil, fmt.Errorf("statistics: unsupported groupBy %q", groupBy)
	}
	rows, err := s.db.QueryContext(ctx, query, stmtArgs...)
	if err != nil {
		return nil, fmt.Errorf("load monthly grouped: %w", err)
	}
	defer rows.Close()
	var raw []groupedRow
	for rows.Next() {
		var r groupedRow
		if err := rows.Scan(&r.month, &r.key, &r.plays); err != nil {
			return nil, fmt.Errorf("load monthly grouped: %w", err)
		}
		raw = append(raw, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load monthly grouped: %w", err)
	}
	return aggregateGroupedPlays(raw), nil
}

// groupedRow is one raw month × group count before the top-N rollup.
type groupedRow struct {
	month, key string
	plays      int
}

// aggregateGroupedPlays ports v1's in-memory rollup: per month, rank groups
// by plays, keep the top groupByLimit and fold the rest into "Other".
func aggregateGroupedPlays(raw []groupedRow) []MonthlyGroupedItem {
	byMonth := map[string]map[string]int{}
	order := []string{}
	for _, r := range raw {
		groups, ok := byMonth[r.month]
		if !ok {
			groups = map[string]int{}
			byMonth[r.month] = groups
			order = append(order, r.month)
		}
		groups[r.key] += r.plays
	}
	sort.Strings(order)
	out := []MonthlyGroupedItem{}
	for _, month := range order {
		groups := byMonth[month]
		keys := make([]string, 0, len(groups))
		for key := range groups {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool {
			if groups[keys[i]] != groups[keys[j]] {
				return groups[keys[i]] > groups[keys[j]]
			}
			return keys[i] < keys[j]
		})
		item := MonthlyGroupedItem{Month: month, Groups: []GroupItem{}}
		other := 0
		for i, key := range keys {
			if i < groupByLimit {
				item.Groups = append(item.Groups, GroupItem{Key: key, Plays: groups[key]})
			} else {
				other += groups[key]
			}
		}
		if other > 0 {
			item.Groups = append(item.Groups, GroupItem{Key: "Other", Plays: other})
		}
		out = append(out, item)
	}
	return out
}

func displayName(name, surname sql.NullString) *string {
	parts := []string{}
	if name.Valid && name.String != "" {
		parts = append(parts, name.String)
	}
	if surname.Valid && surname.String != "" {
		parts = append(parts, surname.String)
	}
	if len(parts) == 0 {
		return nil
	}
	full := strings.Join(parts, " ")
	return &full
}

func strPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	return &v.String
}

func strValue(v sql.NullString) string {
	if !v.Valid {
		return ""
	}
	return v.String
}
