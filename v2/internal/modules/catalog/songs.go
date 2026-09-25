package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/libraries"
)

// songColumns is the explicit column list every song SELECT shares; the
// joined display names (artist_name, album_name, album_artist_name,
// album_cover_art_id) and interaction columns (starred, rating) are appended
// by each query in a fixed order and scanned by scanSong.
const songColumns = `s.id, s.title, s.track_number, s.disc_number, s.duration,
	s.artist_id, s.album_id, s.genre, s.genre_id, s.library_id, s.year,
	s.explicit, s.cover_art_id, s.cover_art_missing, s.mtime, s.active,
	s.bit_rate, s.bits_per_sample, s.sample_rate, s.channels, s.bpm,
	s.music_brainz_id, s.replay_gain, s.average_rating, s.comment,
	s.sort_name, s.mood, s.media_type, s.original_release_date, s.release_date,
	s.remix_of, s.display_artist, s.display_album_artist, s.lyrics,
	s.synced_lyrics, s.producers, s.isrcs, s.musicbrainz_track_id,
	s.musicbrainz_work_id, s.musicbrainz_disc_id, s.original_year,
	s.original_artist, s.gapless, s.total_tracks, s.total_discs`

const songJoins = `FROM songs s
	LEFT JOIN artists ar ON ar.id = s.artist_id
	LEFT JOIN albums al ON al.id = s.album_id
	LEFT JOIN user_songs us ON us.user_id = ? AND us.song_id = s.id`

// Junction fragments for the batch loaders (j = junction, e = entry).
const (
	songArtistJoin   = "FROM song_artists j JOIN artists e ON e.id = j.artist_id WHERE j.song_id"
	songComposerJoin = "FROM song_composers j JOIN artists e ON e.id = j.artist_id WHERE j.song_id"
	songGenreJoin    = "FROM song_genres j JOIN genres e ON e.id = j.genre_id WHERE j.song_id"
)

// SongFilter is the /api/songs query surface (v1's list plus the by-album /
// by-artist filters the v2 spec folds into one endpoint).
type SongFilter struct {
	AlbumID      string
	ArtistID     string
	GenreID      string
	LibraryID    string
	HideExplicit bool
	Limit        int
}

func scanSong(s interface{ Scan(...any) error }) (*Song, error) {
	var song Song
	var syncedLyrics, producers, isrcs sql.NullString
	var explicit, coverArtMissing, gapless sql.NullInt64
	var mtime db.Millis
	// Numeric columns v1 may have written as fractional REALs (mtimeMs,
	// duration seconds, and any music-metadata format number) scan through
	// the tolerant db.NullInt64 — see internal/db.
	var trackNo, discNo, duration, year db.NullInt64
	var bitRate, bitsPerSample, sampleRate, channels, bpm db.NullInt64
	var active int
	var starred sql.NullInt64
	var rating sql.NullFloat64
	err := s.Scan(
		&song.ID, &song.Title, &trackNo, &discNo, &duration,
		&song.ArtistID, &song.AlbumID, &song.Genre, &song.GenreID, &song.LibraryID, &year,
		&explicit, &song.CoverArt, &coverArtMissing, &mtime, &active,
		&bitRate, &bitsPerSample, &sampleRate, &channels, &bpm,
		&song.MusicBrainzID, &song.ReplayGain, &song.AverageRating, &song.Comment,
		&song.SortName, &song.Mood, &song.MediaType, &song.OriginalReleaseDate, &song.ReleaseDate,
		&song.RemixOf, &song.DisplayArtist, &song.DisplayAlbumArtist, &song.Lyrics,
		&syncedLyrics, &producers, &isrcs, &song.MusicBrainzTrackID,
		&song.MusicBrainzWorkID, &song.MusicBrainzDiscID, &song.OriginalYear,
		&song.OriginalArtist, &gapless, &song.TotalTracks, &song.TotalDiscs,
		&song.ArtistName, &song.AlbumName, &song.AlbumArtistName, &song.AlbumCoverArt,
		&starred, &rating,
	)
	if err != nil {
		return nil, err
	}
	intPtr := func(n db.NullInt64) *int {
		if v, ok := n.Value(); ok {
			i := int(v)
			return &i
		}
		return nil
	}
	song.TrackNumber = intPtr(trackNo)
	song.DiscNumber = intPtr(discNo)
	song.Duration = intPtr(duration)
	song.Year = intPtr(year)
	song.BitRate = intPtr(bitRate)
	song.BitsPerSample = intPtr(bitsPerSample)
	song.SampleRate = intPtr(sampleRate)
	song.Channels = intPtr(channels)
	song.BPM = intPtr(bpm)
	song.Explicit = explicit.Valid && explicit.Int64 == 1
	song.CoverArtMissing = coverArtMissing.Valid && coverArtMissing.Int64 == 1
	song.Active = active == 1
	song.Gapless = gapless.Valid && gapless.Int64 == 1
	song.Mtime = int64(mtime)
	song.Starred = starred.Valid && starred.Int64 == 1
	if rating.Valid {
		song.Rating = &rating.Float64
	}
	if v, ok := parseAnyColumn(syncedLyrics); ok {
		song.SyncedLyrics = v
	}
	if v, ok := parseStringArrayColumn(producers); ok {
		song.Producers = v
	}
	if v, ok := parseStringArrayColumn(isrcs); ok {
		song.ISRCs = v
	}
	return &song, nil
}

func scanSongs(rows *sql.Rows) ([]Song, error) {
	var songs []Song
	for rows.Next() {
		song, err := scanSong(rows)
		if err != nil {
			return nil, err
		}
		songs = append(songs, *song)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return songs, nil
}

// attachSongCredits batch-attaches artist and composer entries (v1's
// attachSongArtistEntries + attachSongComposerEntries): one chunked IN
// query per relation, never one per song.
func attachSongCredits(ctx context.Context, q auth.Queries, songs []Song) error {
	if len(songs) == 0 {
		return nil
	}
	ids := songIDs(songs)
	artists, err := entriesForMany(ctx, q, "song_id", songArtistJoin, ids)
	if err != nil {
		return err
	}
	composers, err := entriesForMany(ctx, q, "song_id", songComposerJoin, ids)
	if err != nil {
		return err
	}
	for i := range songs {
		if entries, ok := artists[songs[i].ID]; ok {
			songs[i].ArtistEntries = entries
			songs[i].Artists = make([]string, len(entries))
			for j, e := range entries {
				songs[i].Artists[j] = e.Name
			}
		}
		if entries, ok := composers[songs[i].ID]; ok {
			songs[i].ComposerEntries = entries
		}
	}
	return nil
}

// attachSongGenres batch-attaches genre names (v1's getSongGenreNamesForMany
// step of the /api/songs list).
func attachSongGenres(ctx context.Context, q auth.Queries, songs []Song) error {
	if len(songs) == 0 {
		return nil
	}
	genres, err := namesForMany(ctx, q, "song_id", songGenreJoin, songIDs(songs))
	if err != nil {
		return err
	}
	for i := range songs {
		if names, ok := genres[songs[i].ID]; ok {
			songs[i].Genres = names
		}
	}
	return nil
}

// listSongs is the /api/songs query: active songs only, scope condition,
// optional album/artist/genre/library filters, explicit hiding, title order.
func listSongs(ctx context.Context, q auth.Queries, userID string, scope libraries.Scope, f SongFilter) ([]Song, error) {
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	where := `WHERE s.active = 1 ` + scopeCond.SQL
	args := []any{userID}
	args = append(args, scopeCond.Params...)
	if f.AlbumID != "" {
		where += ` AND s.album_id = ?`
		args = append(args, f.AlbumID)
	}
	if f.ArtistID != "" {
		where += ` AND s.artist_id = ?`
		args = append(args, f.ArtistID)
	}
	if f.GenreID != "" {
		where += ` AND EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id AND sg.genre_id = ?)`
		args = append(args, f.GenreID)
	}
	if f.LibraryID != "" {
		where += ` AND s.library_id = ?`
		args = append(args, f.LibraryID)
	}
	if f.HideExplicit {
		where += ` AND s.explicit = 0`
	}
	args = append(args, f.Limit)

	rows, err := q.QueryContext(ctx,
		`SELECT `+songColumns+`,
			ar.name AS artist_name, al.name AS album_name,
			al.artist_name AS album_artist_name, al.cover_art_id AS album_cover_art_id,
			us.starred, us.rating
		`+songJoins+` `+where+` ORDER BY s.title LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("list songs: %w", err)
	}
	defer rows.Close()
	songs, err := scanSongs(rows)
	if err != nil {
		return nil, fmt.Errorf("list songs: %w", err)
	}
	if err := attachSongCredits(ctx, q, songs); err != nil {
		return nil, err
	}
	if err := attachSongGenres(ctx, q, songs); err != nil {
		return nil, err
	}
	return songs, nil
}

// getSongByID loads one song with its display names. Scope is NOT part of
// the query: the service probes IsSongInScope first and answers 404 either
// way, so the two paths stay indistinguishable.
func getSongByID(ctx context.Context, q auth.Queries, userID, id string) (*Song, error) {
	song, err := scanSong(q.QueryRowContext(ctx,
		`SELECT `+songColumns+`,
			ar.name AS artist_name, al.name AS album_name,
			al.artist_name AS album_artist_name, al.cover_art_id AS album_cover_art_id,
			us.starred, us.rating
		`+songJoins+` WHERE s.id = ?`, userID, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err != nil {
		return nil, fmt.Errorf("get song: %w", err)
	}
	songs := []Song{*song}
	if err := attachSongCredits(ctx, q, songs); err != nil {
		return nil, err
	}
	if err := attachSongGenres(ctx, q, songs); err != nil {
		return nil, err
	}
	return &songs[0], nil
}

// listSongsByAlbum loads an album's active in-scope songs in playing order
// (v1's listSongsByAlbum: disc, track, title).
func listSongsByAlbum(ctx context.Context, q auth.Queries, userID, albumID string, scope libraries.Scope) ([]Song, error) {
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	rows, err := q.QueryContext(ctx,
		`SELECT `+songColumns+`,
			ar.name AS artist_name, al.name AS album_name,
			al.artist_name AS album_artist_name, al.cover_art_id AS album_cover_art_id,
			us.starred, us.rating
		`+songJoins+`
		WHERE s.album_id = ? AND s.active = 1 `+scopeCond.SQL+`
		ORDER BY s.disc_number, s.track_number, s.title`,
		append([]any{userID, albumID}, scopeCond.Params...)...)
	if err != nil {
		return nil, fmt.Errorf("list songs by album: %w", err)
	}
	defer rows.Close()
	songs, err := scanSongs(rows)
	if err != nil {
		return nil, fmt.Errorf("list songs by album: %w", err)
	}
	if err := attachSongCredits(ctx, q, songs); err != nil {
		return nil, err
	}
	return songs, nil
}

// listSongsByArtist loads an artist's active in-scope songs (v1's
// listSongsByArtist: year, album, disc, track, title).
func listSongsByArtist(ctx context.Context, q auth.Queries, userID, artistID string, scope libraries.Scope) ([]Song, error) {
	scopeCond := libraries.ScopeCondition(scope, "s.library_id")
	rows, err := q.QueryContext(ctx,
		`SELECT `+songColumns+`,
			ar.name AS artist_name, al.name AS album_name,
			al.artist_name AS album_artist_name, al.cover_art_id AS album_cover_art_id,
			us.starred, us.rating
		`+songJoins+`
		WHERE s.artist_id = ? AND s.active = 1 `+scopeCond.SQL+`
		ORDER BY s.year, s.album_id, s.disc_number, s.track_number, s.title`,
		append([]any{userID, artistID}, scopeCond.Params...)...)
	if err != nil {
		return nil, fmt.Errorf("list songs by artist: %w", err)
	}
	defer rows.Close()
	songs, err := scanSongs(rows)
	if err != nil {
		return nil, fmt.Errorf("list songs by artist: %w", err)
	}
	if err := attachSongCredits(ctx, q, songs); err != nil {
		return nil, err
	}
	return songs, nil
}
