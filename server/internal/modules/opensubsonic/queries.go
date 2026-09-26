package opensubsonic

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/miquelrosell99/sonarly/server/internal/db"
	"strings"
	"time"

	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

// This file is the browsing/retrieval repository layer: the SQL v1's
// browsing.ts and retrieval.ts ran, ported statement for statement (quirks
// doc B/X/R groups). Handlers stay thin — parse params, call these loaders,
// map through serializer.go, respond through envelope.go.

// ---------------------------------------------------------------------------
// Scope helpers (v1 browsing.ts albumScopeFilter/artistScopeFilter)
// ---------------------------------------------------------------------------

// albumScopeFilter scopes albums to those with at least one active in-scope
// song (v1's EXISTS pattern; albums have no library_id of their own).
func albumScopeFilter(scope libraries.Scope) libraries.Condition {
	if scope.All {
		return libraries.Condition{}
	}
	c := libraries.ScopeCondition(scope, "s.library_id")
	return libraries.Condition{
		SQL:    "AND EXISTS (SELECT 1 FROM songs s WHERE s.album_id = a.id AND s.active = 1 " + c.SQL + ")",
		Params: c.Params,
	}
}

// artistScopeFilter scopes artists to those with at least one active
// in-scope song via the primary artist column.
func artistScopeFilter(scope libraries.Scope) libraries.Condition {
	if scope.All {
		return libraries.Condition{}
	}
	c := libraries.ScopeCondition(scope, "s.library_id")
	return libraries.Condition{
		SQL:    "AND EXISTS (SELECT 1 FROM songs s WHERE s.artist_id = ar.id AND s.active = 1 " + c.SQL + ")",
		Params: c.Params,
	}
}

// millisToISO renders an mtime the way JS Date.toISOString() did in v1.
func millisToISO(mtime int64) string {
	return time.UnixMilli(mtime).UTC().Format(createdLayout)
}

// ---------------------------------------------------------------------------
// Chunked IN loaders (v1's get*ForMany batch pattern, catalog-parity)
// ---------------------------------------------------------------------------

const idChunkSize = 400

func chunkIDs(ids []string) [][]string {
	if len(ids) == 0 {
		return nil
	}
	chunks := make([][]string, 0, (len(ids)+idChunkSize-1)/idChunkSize)
	for len(ids) > 0 {
		n := min(idChunkSize, len(ids))
		chunks = append(chunks, ids[:n])
		ids = ids[n:]
	}
	return chunks
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func stringArgs(ids []string) []any {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return args
}

// entryJoin mirrors v1's junction batch loads: ownerCol is the junction
// column selected for grouping, joinSQL the fixed fragment naming junction
// alias j and entry alias e ending at the owner predicate.
type entryJoin struct {
	ownerCol string
	joinSQL  string
}

var (
	songArtistJoin   = entryJoin{"song_id", "FROM song_artists j JOIN artists e ON e.id = j.artist_id WHERE j.song_id"}
	songComposerJoin = entryJoin{"song_id", "FROM song_composers j JOIN artists e ON e.id = j.artist_id WHERE j.song_id"}
	songGenreJoin    = entryJoin{"song_id", "FROM song_genres j JOIN genres e ON e.id = j.genre_id WHERE j.song_id"}
	albumArtistJoin  = entryJoin{"album_id", "FROM album_artists j JOIN artists e ON e.id = j.artist_id WHERE j.album_id"}
	albumLabelJoin   = entryJoin{"album_id", "FROM album_labels j JOIN labels e ON e.id = j.label_id WHERE j.album_id"}
	albumGenreJoin   = entryJoin{"album_id", "FROM album_genres j JOIN genres e ON e.id = j.genre_id WHERE j.album_id"}
)

// entriesForMany loads {id, name} entries grouped by owner id.
func entriesForMany(ctx context.Context, q *sql.DB, join entryJoin, ids []string) (map[string][]Entry, error) {
	out := make(map[string][]Entry)
	for _, chunk := range chunkIDs(ids) {
		rows, err := q.QueryContext(ctx,
			`SELECT j.`+join.ownerCol+`, e.id, e.name `+join.joinSQL+
				` IN (`+placeholders(len(chunk))+`) ORDER BY j.`+join.ownerCol+`, j.position`,
			stringArgs(chunk)...)
		if err != nil {
			return nil, fmt.Errorf("batch-load %s entries: %w", join.ownerCol, err)
		}
		for rows.Next() {
			var owner, id, name string
			if err := rows.Scan(&owner, &id, &name); err != nil {
				rows.Close()
				return nil, fmt.Errorf("batch-load %s entries: %w", join.ownerCol, err)
			}
			out[owner] = append(out[owner], Entry{ID: id, Name: name})
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("batch-load %s entries: %w", join.ownerCol, err)
		}
		rows.Close()
	}
	return out, nil
}

// namesForMany loads entry name lists grouped by owner id (genre names).
func namesForMany(ctx context.Context, q *sql.DB, join entryJoin, ids []string) (map[string][]string, error) {
	out := make(map[string][]string)
	for _, chunk := range chunkIDs(ids) {
		rows, err := q.QueryContext(ctx,
			`SELECT j.`+join.ownerCol+`, e.name `+join.joinSQL+
				` IN (`+placeholders(len(chunk))+`) ORDER BY j.`+join.ownerCol+`, j.position`,
			stringArgs(chunk)...)
		if err != nil {
			return nil, fmt.Errorf("batch-load %s names: %w", join.ownerCol, err)
		}
		for rows.Next() {
			var owner, name string
			if err := rows.Scan(&owner, &name); err != nil {
				rows.Close()
				return nil, fmt.Errorf("batch-load %s names: %w", join.ownerCol, err)
			}
			out[owner] = append(out[owner], name)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("batch-load %s names: %w", join.ownerCol, err)
		}
		rows.Close()
	}
	return out, nil
}

// albumSongStats is v1's getAlbumSongStatsForMany row: active song count and
// summed duration per album. Deliberately NOT scope-filtered (v1 parity:
// stats describe the album, not the caller's slice).
type albumSongStats struct {
	SongCount int
	Duration  int
}

func albumStatsForMany(ctx context.Context, q *sql.DB, albumIDs []string) (map[string]albumSongStats, error) {
	out := make(map[string]albumSongStats)
	for _, chunk := range chunkIDs(albumIDs) {
		rows, err := q.QueryContext(ctx,
			`SELECT album_id, COUNT(*) AS song_count, COALESCE(SUM(duration), 0) AS duration
			 FROM songs WHERE album_id IN (`+placeholders(len(chunk))+`) AND active = 1
			 GROUP BY album_id`, stringArgs(chunk)...)
		if err != nil {
			return nil, fmt.Errorf("batch-load album stats: %w", err)
		}
		for rows.Next() {
			var id string
			var st albumSongStats
			// SUM(duration) returns REAL when any song carries a v1-written
			// fractional duration (production reality); the tolerant
			// db.NullInt64 truncates instead of failing the whole listing —
			// strict scanning 500'd search3/getAlbumList on real data.
			var duration db.NullInt64
			if err := rows.Scan(&id, &st.SongCount, &duration); err != nil {
				rows.Close()
				return nil, fmt.Errorf("batch-load album stats: %w", err)
			}
			if v, ok := duration.Value(); ok {
				st.Duration = int(v)
			}
			out[id] = st
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("batch-load album stats: %w", err)
		}
		rows.Close()
	}
	return out, nil
}

// albumMaxMtimeForMany is v1's getAlbumMaxMtimesForMany: the newest active
// song mtime per album, used for the album `created` approximation (X13).
func albumMaxMtimeForMany(ctx context.Context, q *sql.DB, albumIDs []string) (map[string]int64, error) {
	out := make(map[string]int64)
	for _, chunk := range chunkIDs(albumIDs) {
		rows, err := q.QueryContext(ctx,
			`SELECT album_id, MAX(mtime) AS max_mtime
			 FROM songs WHERE album_id IN (`+placeholders(len(chunk))+`) AND active = 1
			 GROUP BY album_id`, stringArgs(chunk)...)
		if err != nil {
			return nil, fmt.Errorf("batch-load album mtimes: %w", err)
		}
		for rows.Next() {
			var id string
			var mtime db.NullMillis
			if err := rows.Scan(&id, &mtime); err != nil {
				rows.Close()
				return nil, fmt.Errorf("batch-load album mtimes: %w", err)
			}
			if v, ok := mtime.Value(); ok {
				out[id] = v
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("batch-load album mtimes: %w", err)
		}
		rows.Close()
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Song rows (v1 SongRow + songSelectSql)
// ---------------------------------------------------------------------------

// songColumns is the explicit songs-column list every Subsonic song SELECT
// shares (v1's `s.*` made deterministic); joined display columns and the
// per-user interaction columns follow in a fixed order (scanSongRow).
const songColumns = `s.id, s.album_id, s.artist_id, s.title, s.track_number, s.disc_number,
	s.genre, s.year, s.duration, s.cover_art_id, s.mtime, s.file_path,
	s.bit_rate, s.bits_per_sample, s.sample_rate, s.channels, s.bpm,
	s.music_brainz_id, s.musicbrainz_track_id, s.musicbrainz_work_id, s.musicbrainz_disc_id,
	s.replay_gain, s.average_rating, s.comment, s.sort_name, s.mood, s.media_type,
	s.original_release_date, s.release_date, s.remix_of, s.display_artist, s.display_album_artist,
	s.producers, s.isrcs, s.original_year, s.original_artist, s.gapless, s.total_tracks, s.total_discs,
	s.library_id`

const songJoins = `FROM songs s
	LEFT JOIN albums a ON a.id = s.album_id
	LEFT JOIN artists ar ON ar.id = s.artist_id
	LEFT JOIN libraries l ON l.id = s.library_id
	LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id`

func scanSongRow(s interface{ Scan(...any) error }) (SongSource, error) {
	var src SongSource
	var albumID, artistID, genre, coverArtID sql.NullString
	// v1 may have written any of these as fractional REALs (music-metadata
	// floats) — scan through the tolerant db.NullInt64 (see internal/db).
	var trackNumber, discNumber, year, duration db.NullInt64
	var bitRate, bitsPerSample, sampleRate, channels, bpm db.NullInt64
	var mbID, mbTrackID, mbWorkID, mbDiscID sql.NullString
	var replayGain, averageRating sql.NullFloat64
	var comment, sortName, mood, mediaType sql.NullString
	var originalReleaseDate, releaseDate, remixOf sql.NullString
	var displayArtist, displayAlbumArtist sql.NullString
	var producers, isrcs sql.NullString
	var originalYear sql.NullInt64
	var originalArtist sql.NullString
	var gapless sql.NullInt64
	var totalTracks, totalDiscs sql.NullString
	var albumName, artistName, libraryPath sql.NullString
	var libraryID sql.NullString
	var starred sql.NullInt64
	var rating sql.NullFloat64
	var playCount sql.NullInt64
	var mtime db.Millis
	err := s.Scan(
		&src.ID, &albumID, &artistID, &src.Title, &trackNumber, &discNumber,
		&genre, &year, &duration, &coverArtID, &mtime, &src.FilePath,
		&bitRate, &bitsPerSample, &sampleRate, &channels, &bpm,
		&mbID, &mbTrackID, &mbWorkID, &mbDiscID,
		&replayGain, &averageRating, &comment, &sortName, &mood, &mediaType,
		&originalReleaseDate, &releaseDate, &remixOf, &displayArtist, &displayAlbumArtist,
		&producers, &isrcs, &originalYear, &originalArtist, &gapless, &totalTracks, &totalDiscs,
		&libraryID,
		&albumName, &artistName, &libraryPath,
		&starred, &rating, &playCount,
	)
	if err != nil {
		return SongSource{}, err
	}
	src.MtimeMillis = int64(mtime)
	src.AlbumID = nullString(albumID)
	src.ArtistID = nullString(artistID)
	src.TrackNumber = nullIntTolerant(trackNumber)
	src.DiscNumber = nullIntTolerant(discNumber)
	src.Genre = nullString(genre)
	src.Year = nullIntTolerant(year)
	src.Duration = nullIntTolerant(duration)
	src.CoverArtID = nullString(coverArtID)
	src.BitRate = nullIntTolerant(bitRate)
	src.BitsPerSample = nullIntTolerant(bitsPerSample)
	src.SampleRate = nullIntTolerant(sampleRate)
	src.Channels = nullIntTolerant(channels)
	src.BPM = nullIntTolerant(bpm)
	src.MusicBrainzID = nullString(mbID)
	src.MusicBrainzTrackID = nullString(mbTrackID)
	src.MusicBrainzWorkID = nullString(mbWorkID)
	src.MusicBrainzDiscID = nullString(mbDiscID)
	src.ReplayGain = nullFloat(replayGain)
	src.AverageRating = nullFloat(averageRating)
	src.Comment = nullString(comment)
	src.SortName = nullString(sortName)
	src.Mood = nullString(mood)
	src.MediaType = nullString(mediaType)
	src.OriginalReleaseDate = nullString(originalReleaseDate)
	src.ReleaseDate = nullString(releaseDate)
	src.RemixOf = nullString(remixOf)
	src.DisplayArtist = nullString(displayArtist)
	src.DisplayAlbumArtist = nullString(displayAlbumArtist)
	src.ProducersJSON = nullString(producers)
	src.ISRCsJSON = nullString(isrcs)
	src.OriginalYear = nullInt(originalYear)
	src.OriginalArtist = nullString(originalArtist)
	src.Gapless = gapless.Valid && gapless.Int64 == 1
	src.TotalTracks = nullString(totalTracks)
	src.TotalDiscs = nullString(totalDiscs)
	src.AlbumName = nullString(albumName)
	src.ArtistName = nullString(artistName)
	src.LibraryPath = nullString(libraryPath)
	src.Starred = starred.Valid && starred.Int64 == 1
	src.Rating = nullFloat(rating)
	if playCount.Valid {
		pc := int(playCount.Int64)
		src.PlayCount = &pc
	}
	return src, nil
}

func nullString(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}

func nullInt(v sql.NullInt64) *int {
	if !v.Valid {
		return nil
	}
	n := int(v.Int64)
	return &n
}

// nullIntTolerant is nullInt for the db.NullInt64 columns that may hold
// v1-written fractional REALs (duration, format numbers).
func nullIntTolerant(v db.NullInt64) *int {
	if n, ok := v.Value(); ok {
		i := int(n)
		return &i
	}
	return nil
}

func nullFloat(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	f := v.Float64
	return &f
}

// ---------------------------------------------------------------------------
// Album / artist rows
// ---------------------------------------------------------------------------

// albumColumns is v1's `a.*` made explicit.
const albumColumns = `a.id, a.name, a.artist_id, a.artist_name, a.cover_art_id, a.year, a.genre,
	a.catalog_numbers, a.barcode, a.asin, a.musicbrainz_album_id, a.musicbrainz_release_group_id,
	a.musicbrainz_album_artist_ids, a.original_year, a.compilation, a.total_tracks, a.total_discs`

func scanAlbumRow(s interface{ Scan(...any) error }) (AlbumSource, error) {
	var src AlbumSource
	var artistID, coverArtID sql.NullString
	var year sql.NullInt64
	var genre, catalogNumbers, barcode, asin sql.NullString
	var mbAlbumID, mbReleaseGroupID, mbArtistIDs sql.NullString
	var originalYear sql.NullInt64
	var compilation sql.NullInt64
	var totalTracks, totalDiscs sql.NullString
	var averageRating sql.NullFloat64
	var starred sql.NullInt64
	var rating sql.NullFloat64
	err := s.Scan(
		&src.ID, &src.Name, &artistID, &src.ArtistName, &coverArtID, &year, &genre,
		&catalogNumbers, &barcode, &asin, &mbAlbumID, &mbReleaseGroupID,
		&mbArtistIDs, &originalYear, &compilation, &totalTracks, &totalDiscs,
		&averageRating, &starred, &rating,
	)
	if err != nil {
		return AlbumSource{}, err
	}
	src.ArtistID = nullString(artistID)
	src.CoverArtID = nullString(coverArtID)
	src.Year = nullInt(year)
	src.Genre = nullString(genre)
	src.CatalogNumbersJSON = nullString(catalogNumbers)
	src.Barcode = nullString(barcode)
	src.ASIN = nullString(asin)
	src.MusicBrainzAlbumID = nullString(mbAlbumID)
	src.MusicBrainzReleaseGroupID = nullString(mbReleaseGroupID)
	src.MusicBrainzAlbumArtistIDsJSON = nullString(mbArtistIDs)
	src.OriginalYear = nullInt(originalYear)
	src.Compilation = compilation.Valid && compilation.Int64 == 1
	src.TotalTracks = nullString(totalTracks)
	src.TotalDiscs = nullString(totalDiscs)
	src.AverageRating = nullFloat(averageRating)
	src.Starred = starred.Valid && starred.Int64 == 1
	src.Rating = nullFloat(rating)
	return src, nil
}

// albumSelect is v1's shared album SELECT: row + per-user interactions +
// the global average rating subquery.
const albumSelect = `SELECT ` + albumColumns + `,
		(SELECT AVG(rating) FROM user_albums WHERE album_id = a.id) AS average_rating,
		ua.starred, ua.rating
	FROM albums a
	LEFT JOIN user_albums ua ON ua.user_id = ? AND ua.album_id = a.id`

// artistColumns is the artist row the Subsonic artist mapper needs.
const artistColumns = `ar.id, ar.name, ar.artist_image_url, ar.musicbrainz_artist_ids`

// scanArtistRow scans the artist columns plus album count and the per-user
// interaction columns (getArtists/search3/getArtist shapes).
func scanArtistRow(s interface{ Scan(...any) error }) (ArtistSource, error) {
	var src ArtistSource
	var imageURL, mbIDs sql.NullString
	var albumCount int
	var starred sql.NullInt64
	var rating sql.NullFloat64
	err := s.Scan(&src.ID, &src.Name, &imageURL, &mbIDs, &albumCount, &starred, &rating)
	if err != nil {
		return ArtistSource{}, err
	}
	src.ArtistImageURL = nullString(imageURL)
	src.MusicBrainzIDsJSON = nullString(mbIDs)
	src.AlbumCount = albumCount
	src.Starred = starred.Valid && starred.Int64 == 1
	src.Rating = nullFloat(rating)
	return src, nil
}

// scanIndexArtistRow scans the artist columns plus album count without the
// interaction join (v1's getIndexes shape — no user_artists columns).
func scanIndexArtistRow(s interface{ Scan(...any) error }) (ArtistSource, error) {
	var src ArtistSource
	var imageURL, mbIDs sql.NullString
	var albumCount int
	err := s.Scan(&src.ID, &src.Name, &imageURL, &mbIDs, &albumCount)
	if err != nil {
		return ArtistSource{}, err
	}
	src.ArtistImageURL = nullString(imageURL)
	src.MusicBrainzIDsJSON = nullString(mbIDs)
	src.AlbumCount = albumCount
	return src, nil
}

// artistAlbumCountSQL is v1's correlated album-count subquery (X15): active
// albums via the primary artist column OR the album_artists junction.
const artistAlbumCountSQL = `(SELECT COUNT(*)
	FROM albums a
	WHERE a.active = 1
		AND (a.artist_id = ar.id
			OR EXISTS (SELECT 1 FROM album_artists aa WHERE aa.album_id = a.id AND aa.artist_id = ar.id))
	) AS album_count`

// mapSongs runs the v1 mapSongRowsToOpenSubsonic batch-attach: artist and
// composer entries plus genre names, one chunked query per relation.
func (h *Handler) mapSongs(ctx context.Context, rows []SongSource, forUser bool) ([]Song, error) {
	songs := make([]Song, len(rows))
	if len(rows) == 0 {
		return songs, nil
	}
	ids := make([]string, len(rows))
	for i := range rows {
		ids[i] = rows[i].ID
	}
	artistMap, err := entriesForMany(ctx, h.db, songArtistJoin, ids)
	if err != nil {
		return nil, err
	}
	composerMap, err := entriesForMany(ctx, h.db, songComposerJoin, ids)
	if err != nil {
		return nil, err
	}
	genreMap, err := namesForMany(ctx, h.db, songGenreJoin, ids)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		songs[i] = MapSong(rows[i], artistMap[rows[i].ID], composerMap[rows[i].ID], genreMap[rows[i].ID], forUser)
	}
	return songs, nil
}

// mapAlbums runs the v1 fetchAlbumList/search3 album mapping pipeline:
// artist/label/genre entries, stats and newest-mtime per album.
func (h *Handler) mapAlbums(ctx context.Context, rows []AlbumSource, forUser bool) ([]Album, error) {
	albums := make([]Album, len(rows))
	if len(rows) == 0 {
		return albums, nil
	}
	ids := make([]string, len(rows))
	for i := range rows {
		ids[i] = rows[i].ID
	}
	artistMap, err := entriesForMany(ctx, h.db, albumArtistJoin, ids)
	if err != nil {
		return nil, err
	}
	labelMap, err := entriesForMany(ctx, h.db, albumLabelJoin, ids)
	if err != nil {
		return nil, err
	}
	genreMap, err := namesForMany(ctx, h.db, albumGenreJoin, ids)
	if err != nil {
		return nil, err
	}
	statsMap, err := albumStatsForMany(ctx, h.db, ids)
	if err != nil {
		return nil, err
	}
	mtimeMap, err := albumMaxMtimeForMany(ctx, h.db, ids)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		stats := statsMap[rows[i].ID]
		mtime, ok := mtimeMap[rows[i].ID]
		albums[i] = MapAlbum(rows[i], nil, stats.Duration, forUser,
			artistMap[rows[i].ID], genreMap[rows[i].ID], entryNames(labelMap[rows[i].ID]),
			&stats.SongCount, albumCreatedAt(mtime, ok))
	}
	return albums, nil
}

// albumCreatedAt converts a newest-song mtime to the ISO string v1 put in
// `created` (X13); absent mtime → nil → the mapper's epoch fallback.
func albumCreatedAt(mtime int64, ok bool) *string {
	if !ok || mtime == 0 {
		return nil
	}
	s := millisToISO(mtime)
	return &s
}

// ---------------------------------------------------------------------------
// Songs by id list (v1 fetchOpenSubsonicSongsByIds)
// ---------------------------------------------------------------------------

// songsByIDs is v1's fetchOpenSubsonicSongsByIds: the full Subsonic Child
// rows for an id list, active only, in the caller's interaction context.
// A nil scope means NO library filter (v1's getNowPlaying call passed none);
// getStarred/getBookmarks pass the caller's scope. Ids that are missing,
// inactive, or out of scope simply drop out of the result (v1 parity).
func (h *Handler) songsByIDs(ctx context.Context, userID string, ids []string, scope *libraries.Scope) ([]Song, error) {
	if len(ids) == 0 {
		return []Song{}, nil
	}
	scopeCond := libraries.Condition{}
	if scope != nil {
		scopeCond = libraries.ScopeCondition(*scope, "s.library_id")
	}
	rows := []SongSource{}
	for _, chunk := range chunkIDs(ids) {
		result, err := h.db.QueryContext(ctx,
			`SELECT `+songColumns+`,
				a.name AS album_name, ar.name AS artist_name, l.path AS library_path,
				us.starred, us.rating, us.play_count
			`+songJoins+`
			WHERE s.active = 1 AND s.id IN (`+placeholders(len(chunk))+`) `+scopeCond.SQL,
			append(append([]any{userID}, stringArgs(chunk)...), scopeCond.Params...)...)
		if err != nil {
			return nil, fmt.Errorf("fetch songs by ids: %w", err)
		}
		for result.Next() {
			s, err := scanSongRow(result)
			if err != nil {
				result.Close()
				return nil, fmt.Errorf("fetch songs by ids: %w", err)
			}
			rows = append(rows, s)
		}
		if err := result.Err(); err != nil {
			result.Close()
			return nil, fmt.Errorf("fetch songs by ids: %w", err)
		}
		result.Close()
	}
	return h.mapSongs(ctx, rows, userID != "")
}
