package search

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
)

// maxQueryLen bounds free-text search input (v1 bounded nothing; the web
// search box is far smaller than this).
const maxQueryLen = 200

// idChunkSize mirrors the catalog batch loaders: SQLite's bound-parameter
// ceiling is far higher, but 400 keeps statements small and cacheable.
const idChunkSize = 400

func chunkIDs(ids []string) [][]string {
	chunks := make([][]string, 0, (len(ids)+idChunkSize-1)/idChunkSize)
	for len(ids) > 0 {
		n := min(len(ids), idChunkSize)
		chunks = append(chunks, ids[:n])
		ids = ids[n:]
	}
	return chunks
}

func placeholders(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		if i > 0 {
			s += ", "
		}
		s += "?"
	}
	return s
}

func stringArgs(ids []string) []any {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return args
}

func songIDs(songs []Song) []string {
	ids := make([]string, len(songs))
	for i := range songs {
		ids[i] = songs[i].ID
	}
	return ids
}

func albumIDs(albums []Album) []string {
	ids := make([]string, len(albums))
	for i := range albums {
		ids[i] = albums[i].ID
	}
	return ids
}

func scanSongs(rows *sql.Rows) ([]Song, error) {
	defer rows.Close()
	songs := []Song{}
	for rows.Next() {
		var s Song
		var artistName, albumName, genre, genreID, coverArt sql.NullString
		var track, disc, duration, year sql.NullInt64
		var explicit, active, starred sql.NullInt64
		var rating sql.NullFloat64
		if err := rows.Scan(&s.ID, &s.Title, &track, &disc, &duration,
			&s.ArtistID, &s.AlbumID, &artistName, &albumName, &genre, &genreID, &year,
			&explicit, &coverArt, &s.Mtime, &active, &starred, &rating); err != nil {
			return nil, fmt.Errorf("scan song result: %w", err)
		}
		s.TrackNumber, s.DiscNumber, s.Duration = intPtr(track), intPtr(disc), intPtr(duration)
		s.ArtistName, s.AlbumName = strPtr(artistName), strPtr(albumName)
		s.Genre, s.GenreID, s.Year = strPtr(genre), strPtr(genreID), intPtr(year)
		s.CoverArt = strPtr(coverArt)
		s.Explicit = explicit.Valid && explicit.Int64 == 1
		s.Active = active.Valid && active.Int64 == 1
		s.Starred = starred.Valid && starred.Int64 == 1
		if rating.Valid {
			s.Rating = &rating.Float64
		}
		songs = append(songs, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan song results: %w", err)
	}
	return songs, nil
}

func scanAlbums(rows *sql.Rows) ([]Album, error) {
	defer rows.Close()
	albums := []Album{}
	for rows.Next() {
		var a Album
		var artistName, genre, coverArt sql.NullString
		var year, active, starred, explicit sql.NullInt64
		var rating sql.NullFloat64
		if err := rows.Scan(&a.ID, &a.Name, &a.ArtistID, &artistName, &year, &genre,
			&coverArt, &active, &starred, &rating, &explicit); err != nil {
			return nil, fmt.Errorf("scan album result: %w", err)
		}
		a.ArtistName, a.Year = strPtr(artistName), intPtr(year)
		a.Genre, a.CoverArt = strPtr(genre), strPtr(coverArt)
		a.Active = active.Valid && active.Int64 == 1
		a.Starred = starred.Valid && starred.Int64 == 1
		a.Explicit = explicit.Valid && explicit.Int64 == 1
		if rating.Valid {
			a.Rating = &rating.Float64
		}
		albums = append(albums, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan album results: %w", err)
	}
	return albums, nil
}

func scanArtists(rows *sql.Rows) ([]Artist, error) {
	defer rows.Close()
	artists := []Artist{}
	for rows.Next() {
		var a Artist
		var active, starred sql.NullInt64
		var rating sql.NullFloat64
		if err := rows.Scan(&a.ID, &a.Name, &active, &starred, &rating); err != nil {
			return nil, fmt.Errorf("scan artist result: %w", err)
		}
		a.Active = active.Valid && active.Int64 == 1
		a.Starred = starred.Valid && starred.Int64 == 1
		if rating.Valid {
			a.Rating = &rating.Float64
		}
		artists = append(artists, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scan artist results: %w", err)
	}
	return artists, nil
}

// attachSongRelations batch-attaches artist and genre names to song hits
// (the catalog module's anti-N+1 pattern): one chunked IN query per
// relation, never one per song.
func attachSongRelations(ctx context.Context, q auth.Queries, songs []Song) error {
	if len(songs) == 0 {
		return nil
	}
	ids := songIDs(songs)
	artists := map[string][]string{}
	entries := map[string][]Entry{}
	genres := map[string][]string{}
	for _, chunk := range chunkIDs(ids) {
		rows, err := q.QueryContext(ctx,
			`SELECT j.song_id, e.id, e.name FROM song_artists j JOIN artists e ON e.id = j.artist_id
			WHERE j.song_id IN (`+placeholders(len(chunk))+`) ORDER BY j.position`, stringArgs(chunk)...)
		if err != nil {
			return fmt.Errorf("attach song artists: %w", err)
		}
		for rows.Next() {
			var songID, id, name string
			if err := rows.Scan(&songID, &id, &name); err != nil {
				rows.Close()
				return fmt.Errorf("attach song artists: %w", err)
			}
			artists[songID] = append(artists[songID], name)
			entries[songID] = append(entries[songID], Entry{ID: id, Name: name})
		}
		rows.Close()
		if err := rows.Err(); nil != err {
			return fmt.Errorf("attach song artists: %w", err)
		}
		rows, err = q.QueryContext(ctx,
			`SELECT j.song_id, e.name FROM song_genres j JOIN genres e ON e.id = j.genre_id
			WHERE j.song_id IN (`+placeholders(len(chunk))+`) ORDER BY j.position`, stringArgs(chunk)...)
		if err != nil {
			return fmt.Errorf("attach song genres: %w", err)
		}
		for rows.Next() {
			var songID, name string
			if err := rows.Scan(&songID, &name); err != nil {
				rows.Close()
				return fmt.Errorf("attach song genres: %w", err)
			}
			genres[songID] = append(genres[songID], name)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("attach song genres: %w", err)
		}
	}
	for i := range songs {
		if names, ok := artists[songs[i].ID]; ok {
			songs[i].Artists = names
		}
		if es, ok := entries[songs[i].ID]; ok {
			songs[i].ArtistEntries = es
		}
		if names, ok := genres[songs[i].ID]; ok {
			songs[i].Genres = names
		}
	}
	return nil
}

// attachAlbumRelations batch-attaches artist and genre names to album hits.
func attachAlbumRelations(ctx context.Context, q auth.Queries, albums []Album) error {
	if len(albums) == 0 {
		return nil
	}
	ids := albumIDs(albums)
	artists := map[string][]string{}
	genres := map[string][]string{}
	for _, chunk := range chunkIDs(ids) {
		rows, err := q.QueryContext(ctx,
			`SELECT j.album_id, e.name FROM album_artists j JOIN artists e ON e.id = j.artist_id
			WHERE j.album_id IN (`+placeholders(len(chunk))+`) ORDER BY j.position`, stringArgs(chunk)...)
		if err != nil {
			return fmt.Errorf("attach album artists: %w", err)
		}
		for rows.Next() {
			var albumID, name string
			if err := rows.Scan(&albumID, &name); err != nil {
				rows.Close()
				return fmt.Errorf("attach album artists: %w", err)
			}
			artists[albumID] = append(artists[albumID], name)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("attach album artists: %w", err)
		}
		rows, err = q.QueryContext(ctx,
			`SELECT j.album_id, e.name FROM album_genres j JOIN genres e ON e.id = j.genre_id
			WHERE j.album_id IN (`+placeholders(len(chunk))+`) ORDER BY j.position`, stringArgs(chunk)...)
		if err != nil {
			return fmt.Errorf("attach album genres: %w", err)
		}
		for rows.Next() {
			var albumID, name string
			if err := rows.Scan(&albumID, &name); err != nil {
				rows.Close()
				return fmt.Errorf("attach album genres: %w", err)
			}
			genres[albumID] = append(genres[albumID], name)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("attach album genres: %w", err)
		}
	}
	for i := range albums {
		if names, ok := artists[albums[i].ID]; ok {
			albums[i].Artists = names
		}
		if names, ok := genres[albums[i].ID]; ok {
			albums[i].Genres = names
		}
	}
	return nil
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
