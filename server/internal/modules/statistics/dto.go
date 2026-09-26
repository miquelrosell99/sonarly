// Package statistics ports the old listening-statistics endpoints with
// consolidated SQL. the retired server assembled one response from ~20 statements, including
// three redundant global-rating-AVG scans (one per rated list). The Go server computes
// the Bayesian prior once per request inside a MATERIALIZED CTE shared by
// all three rated-list arms, folds the five top lists into one UNION ALL
// statement, the six favorite/rating-distribution counts into one, and keeps
// the range filters on the indexed played_at column (no date() wrapping).
// Statistics stay server-wide per user, like old: they are not library
// scoped (a user's listening history spans libraries). Errors are typed —
// the route contract never surfaces raw driver messages (old lesson).
package statistics

// TimeRange is the statistics window; the zero value "" means all time.
type TimeRange string

const (
	Range7d  TimeRange = "7d"
	Range30d TimeRange = "30d"
	Range90d TimeRange = "90d"
	Range1y  TimeRange = "1y"
	RangeAll TimeRange = "all"
)

// GroupBy is the monthly-grouped breakdown dimension.
type GroupBy string

const (
	GroupByArtist   GroupBy = "artist"
	GroupByGenre    GroupBy = "genre"
	GroupByYear     GroupBy = "year"
	GroupByRating   GroupBy = "rating"
	GroupByFavorite GroupBy = "favorite"
)

// Totals is the headline counters block (old StatisticsTotals).
type Totals struct {
	TotalPlays            int `json:"totalPlays"`
	TotalDurationListened int `json:"totalDurationListened"`
	FavoriteSongs         int `json:"favoriteSongs"`
	FavoriteAlbums        int `json:"favoriteAlbums"`
	FavoriteArtists       int `json:"favoriteArtists"`
}

// TopSongItem is one row of topSongs (old TopSongItem).
type TopSongItem struct {
	SongID        string  `json:"songId"`
	Title         string  `json:"title"`
	ArtistName    *string `json:"artistName,omitempty"`
	AlbumCoverArt *string `json:"albumCoverArt,omitempty"`
	Plays         int     `json:"plays"`
}

// TopArtistItem is one row of topArtists.
type TopArtistItem struct {
	ArtistID   *string `json:"artistId,omitempty"`
	ArtistName string  `json:"artistName"`
	Plays      int     `json:"plays"`
}

// TopAlbumItem is one row of topAlbums.
type TopAlbumItem struct {
	AlbumID    *string `json:"albumId,omitempty"`
	AlbumName  string  `json:"albumName"`
	ArtistName *string `json:"artistName,omitempty"`
	CoverArt   *string `json:"coverArt,omitempty"`
	Plays      int     `json:"plays"`
}

// GenreDistributionItem is one row of topGenres.
type GenreDistributionItem struct {
	Genre                 string `json:"genre"`
	Plays                 int    `json:"plays"`
	TotalDurationListened int    `json:"totalDurationListened"`
}

// TopYearItem is one row of topYears.
type TopYearItem struct {
	Year                  int `json:"year"`
	Plays                 int `json:"plays"`
	TotalDurationListened int `json:"totalDurationListened"`
}

// TopLists is the five top-N blocks (old StatisticsTopLists).
type TopLists struct {
	TopSongs   []TopSongItem           `json:"topSongs"`
	TopArtists []TopArtistItem         `json:"topArtists"`
	TopAlbums  []TopAlbumItem          `json:"topAlbums"`
	TopGenres  []GenreDistributionItem `json:"topGenres"`
	TopYears   []TopYearItem           `json:"topYears"`
}

// RatedArtistItem is one row of topRatedArtists (Bayesian-adjusted).
type RatedArtistItem struct {
	ArtistID        *string `json:"artistId,omitempty"`
	ArtistName      string  `json:"artistName"`
	AverageRating   float64 `json:"averageRating"`
	BayesianAverage float64 `json:"bayesianAverage"`
	RatedSongs      int     `json:"ratedSongs"`
}

// TopRatedGenreItem is one row of topRatedGenres.
type TopRatedGenreItem struct {
	Genre           string  `json:"genre"`
	AverageRating   float64 `json:"averageRating"`
	BayesianAverage float64 `json:"bayesianAverage"`
	RatedSongs      int     `json:"ratedSongs"`
}

// TopRatedYearItem is one row of topRatedYears.
type TopRatedYearItem struct {
	Year            int     `json:"year"`
	AverageRating   float64 `json:"averageRating"`
	BayesianAverage float64 `json:"bayesianAverage"`
	RatedSongs      int     `json:"ratedSongs"`
}

// RatedLists is the three Bayesian-rated blocks (old StatisticsRatedLists).
type RatedLists struct {
	TopRatedArtists []RatedArtistItem   `json:"topRatedArtists"`
	TopRatedGenres  []TopRatedGenreItem `json:"topRatedGenres"`
	TopRatedYears   []TopRatedYearItem  `json:"topRatedYears"`
}

// RatingDistributionItem is one histogram bucket.
type RatingDistributionItem struct {
	Rating int `json:"rating"`
	Count  int `json:"count"`
}

// RatingDistribution is the combined histogram across songs, albums and
// artists, plus the unrated total (old RatingDistributionWithUnrated).
type RatingDistribution struct {
	Unrated int                      `json:"unrated"`
	Ratings []RatingDistributionItem `json:"ratings"`
}

// Charts is the charts block (old StatisticsCharts).
type Charts struct {
	RatingDistribution RatingDistribution `json:"ratingDistribution"`
}

// MonthlyPlaysItem is one month of the plays timeline.
type MonthlyPlaysItem struct {
	Month string `json:"month"`
	Plays int    `json:"plays"`
}

// GroupItem is one ranked group inside a month.
type GroupItem struct {
	Key   string `json:"key"`
	Plays int    `json:"plays"`
}

// MonthlyGroupedItem is one month of a grouped breakdown (top 6 groups plus
// an "Other" rollup, wire parity).
type MonthlyGroupedItem struct {
	Month  string      `json:"month"`
	Groups []GroupItem `json:"groups"`
}

// UserStatistics is the /api/statistics/me payload (old UserStatistics).
type UserStatistics struct {
	UserID       string             `json:"userId"`
	Username     string             `json:"username"`
	DisplayName  *string            `json:"displayName,omitempty"`
	Range        TimeRange          `json:"range"`
	Totals       Totals             `json:"totals"`
	Top          TopLists           `json:"top"`
	Rated        RatedLists         `json:"rated"`
	Charts       Charts             `json:"charts"`
	MonthlyPlays []MonthlyPlaysItem `json:"monthlyPlays"`
}

// UserSummary is one row of the overall statistics' per-user rollup.
type UserSummary struct {
	UserID                string  `json:"userId"`
	Username              string  `json:"username"`
	DisplayName           *string `json:"displayName,omitempty"`
	TotalPlays            int     `json:"totalPlays"`
	TotalDurationListened int     `json:"totalDurationListened"`
	UniqueSongs           int     `json:"uniqueSongs"`
}

// OverallStatistics is the /api/statistics/overall payload (old
// OverallStatistics).
type OverallStatistics struct {
	Range         TimeRange          `json:"range"`
	Totals        Totals             `json:"totals"`
	Top           TopLists           `json:"top"`
	Rated         RatedLists         `json:"rated"`
	Charts        Charts             `json:"charts"`
	MonthlyPlays  []MonthlyPlaysItem `json:"monthlyPlays"`
	UserSummaries []UserSummary      `json:"userSummaries"`
}
