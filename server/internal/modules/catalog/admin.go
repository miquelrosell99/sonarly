package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"

	"github.com/google/uuid"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
)

// Admin mutations on catalog entities (the old features/songs|albums|artists|
// routes.ts DELETE handlers and the genres routes write path). All handlers
// are admin-gated by the route layer; song/album deletes remove the physical
// files first, then the rows (junction and user rows cascade through the
// schema's FKs, like the admin missing-file deletes).

// ErrArtistHasSongs mirrors the retired server's 409: an artist with active
// songs (directly or through a junction) cannot be deleted.
var ErrArtistHasSongs = errors.New("Cannot delete artist with active songs")

// songFilePath loads a song's file path (any activity state — admins also
// purge rows for files that are already gone).
func songFilePath(ctx context.Context, q auth.Queries, id string) (string, error) {
	var path string
	err := q.QueryRowContext(ctx, `SELECT file_path FROM songs WHERE id = ?`, id).Scan(&path)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("load song path: %w", err)
	}
	return path, nil
}

// removeFile unlinks one library file; a missing file is not an error (the
// row may already be stale), anything else is (permissions, busy media).
func removeFile(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("delete file %s: %w", path, err)
	}
	return nil
}

// DeleteSong removes one song: unlink the physical file first (a missing
// file is tolerated), then the row — junction and per-user rows cascade.
func (s *Service) DeleteSong(ctx context.Context, id string) error {
	path, err := songFilePath(ctx, s.db, id)
	if err != nil {
		return err
	}
	if err := removeFile(path); err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM songs WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete song: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// deleteAlbumSongs removes every song row of an album plus its physical
// file; per-file failures stop the sweep so the admin sees the error
// instead of a silently half-deleted album.
func deleteAlbumSongs(ctx context.Context, tx *sql.Tx, albumID string) error {
	rows, err := tx.QueryContext(ctx,
		`SELECT id, file_path FROM songs WHERE album_id = ?`, albumID)
	if err != nil {
		return fmt.Errorf("list album songs: %w", err)
	}
	var songs []struct {
		id   string
		path string
	}
	for rows.Next() {
		var song struct {
			id   string
			path string
		}
		if err := rows.Scan(&song.id, &song.path); err != nil {
			rows.Close()
			return fmt.Errorf("list album songs: %w", err)
		}
		songs = append(songs, song)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list album songs: %w", err)
	}
	for _, song := range songs {
		if err := removeFile(song.path); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM songs WHERE id = ?`, song.id); err != nil {
			return fmt.Errorf("delete album song: %w", err)
		}
	}
	return nil
}

// DeleteAlbum removes an active album with all its songs (files first, then
// the rows in one transaction ending with the album row).
func (s *Service) DeleteAlbum(ctx context.Context, id string) error {
	var one int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM albums WHERE id = ? AND active = 1`, id).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("load album: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin album delete: %w", err)
	}
	defer tx.Rollback()
	if err := deleteAlbumSongs(ctx, tx, id); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM albums WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete album: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// artistEmptyAlbums lists the artist's active albums that carry no active
// songs (the old emptyAlbums sweep of the artist delete).
func artistEmptyAlbums(ctx context.Context, q auth.Queries, artistID string) ([]string, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT a.id
		 FROM albums a
		 LEFT JOIN songs s ON s.album_id = a.id AND s.active = 1
		 WHERE a.artist_id = ? AND a.active = 1 AND s.id IS NULL`, artistID)
	if err != nil {
		return nil, fmt.Errorf("list empty albums: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("list empty albums: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list empty albums: %w", err)
	}
	return ids, nil
}

// DeleteArtist removes an artist with no active songs: the empty albums go
// first (their own junction rows cascade), then the leftover junction rows
// from inactive songs, then the artist row. Artists still carrying active
// songs are rejected with ErrArtistHasSongs (old 409).
func (s *Service) DeleteArtist(ctx context.Context, id string) error {
	var one int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM artists WHERE id = ? AND active = 1`, id).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("load artist: %w", err)
	}

	hasSongs, err := s.artistHasActiveSongs(ctx, id)
	if err != nil {
		return err
	}
	if hasSongs {
		return ErrArtistHasSongs
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin artist delete: %w", err)
	}
	defer tx.Rollback()

	emptyAlbums, err := artistEmptyAlbums(ctx, tx, id)
	if err != nil {
		return err
	}
	for _, albumID := range emptyAlbums {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM albums WHERE id = ?`, albumID); err != nil {
			return fmt.Errorf("delete empty album: %w", err)
		}
	}
	// Leftover junction rows (e.g. from inactive songs) are cleaned
	// explicitly, like the old code, before the artist row goes.
	for _, table := range []string{"song_artists", "song_composers", "album_artists"} {
		if _, err := tx.ExecContext(ctx,
			fmt.Sprintf(`DELETE FROM %s WHERE artist_id = ?`, table), id); err != nil {
			return fmt.Errorf("clean %s: %w", table, err)
		}
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM artists WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete artist: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

// artistHasActiveSongs reports whether any active song references the artist
// through the primary column or the artist/composer junctions (the old
// two-probe UNION).
func (s *Service) artistHasActiveSongs(ctx context.Context, artistID string) (bool, error) {
	var one int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM songs WHERE artist_id = ? AND active = 1 LIMIT 1`, artistID).Scan(&one)
	if err == nil {
		return true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, fmt.Errorf("check artist songs: %w", err)
	}
	err = s.db.QueryRowContext(ctx,
		`SELECT 1 FROM song_artists sa JOIN songs s ON s.id = sa.song_id AND s.active = 1
		 WHERE sa.artist_id = ? LIMIT 1`, artistID).Scan(&one)
	if err == nil {
		return true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, fmt.Errorf("check artist junction songs: %w", err)
	}
	err = s.db.QueryRowContext(ctx,
		`SELECT 1 FROM song_composers sc JOIN songs s ON s.id = sc.song_id AND s.active = 1
		 WHERE sc.artist_id = ? LIMIT 1`, artistID).Scan(&one)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return false, fmt.Errorf("check composer junction songs: %w", err)
}

// ---------------------------------------------------------------------------
// Genre create / rename / move / delete (the old genres routes write path)
// ---------------------------------------------------------------------------

// ErrGenreExists mirrors the NOCASE-unique genres.name index: creating or
// renaming onto an existing name is a client conflict, not a leaked 500.
var ErrGenreExists = errors.New("Genre already exists")

// genreNameTaken reports whether name already belongs to another genre.
func genreNameTaken(ctx context.Context, q auth.Queries, name, excludeID string) (bool, error) {
	var id string
	err := q.QueryRowContext(ctx,
		`SELECT id FROM genres WHERE name = ? COLLATE NOCASE`, name).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("get genre by name: %w", err)
	}
	return id != excludeID, nil
}

// genrePath resolves the "Root > ... > Leaf" path for one genre row against
// the active set (the same chain walk the list endpoint uses).
func genrePath(ctx context.Context, q auth.Queries, g GenreRecord) (string, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT id, name, parent_id FROM genres WHERE active = 1`)
	if err != nil {
		return "", fmt.Errorf("list genres: %w", err)
	}
	var all []GenreRecord
	for rows.Next() {
		var r GenreRecord
		var parentID sql.NullString
		if err := rows.Scan(&r.ID, &r.Name, &parentID); err != nil {
			rows.Close()
			return "", fmt.Errorf("list genres: %w", err)
		}
		if parentID.Valid {
			r.ParentID = parentID.String
		}
		all = append(all, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("list genres: %w", err)
	}
	return buildGenrePaths(all)[g.ID], nil
}

// genreDTO re-reads one genre and shapes it like the list endpoint entries
// (the create/rename responses mirror /api/genres items).
func genreDTO(ctx context.Context, q auth.Queries, id string) (Genre, error) {
	g, err := getGenreByID(ctx, q, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Genre{}, ErrNotFound
	}
	if err != nil {
		return Genre{}, err
	}
	path, err := genrePath(ctx, q, *g)
	if err != nil {
		return Genre{}, err
	}
	return Genre{
		ID:       g.ID,
		Name:     g.Name,
		ParentID: g.ParentID,
		Path:     path,
		Active:   g.Active,
	}, nil
}

// CreateGenre inserts a new active genre, optionally under an existing
// parent (old createGenre + its parent existence check).
func (s *Service) CreateGenre(ctx context.Context, name, parentID string) (Genre, error) {
	taken, err := genreNameTaken(ctx, s.db, name, "")
	if err != nil {
		return Genre{}, err
	}
	if taken {
		return Genre{}, ErrGenreExists
	}
	if parentID != "" {
		if _, err := getGenreByID(ctx, s.db, parentID); errors.Is(err, sql.ErrNoRows) {
			return Genre{}, ErrNotFound
		} else if err != nil {
			return Genre{}, err
		}
	}
	var parentValue any
	if parentID != "" {
		parentValue = parentID
	}
	id := uuid.NewString()
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO genres (id, name, parent_id, active) VALUES (?, ?, ?, 1)`,
		id, name, parentValue); err != nil {
		return Genre{}, fmt.Errorf("create genre: %w", err)
	}
	return genreDTO(ctx, s.db, id)
}

// RenameGenre renames a genre and refreshes the denormalized genre-name
// cache on the active songs/albums that carry it (old updateGenre +
// updateGenreNameCache) — the row update and both cache sweeps run in one
// transaction so a rename never half-lands.
func (s *Service) RenameGenre(ctx context.Context, id, name string) (Genre, error) {
	if _, err := getGenreByID(ctx, s.db, id); errors.Is(err, sql.ErrNoRows) {
		return Genre{}, ErrNotFound
	} else if err != nil {
		return Genre{}, err
	}
	taken, err := genreNameTaken(ctx, s.db, name, id)
	if err != nil {
		return Genre{}, err
	}
	if taken {
		return Genre{}, ErrGenreExists
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Genre{}, fmt.Errorf("begin genre rename: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`UPDATE genres SET name = ? WHERE id = ?`, name, id); err != nil {
		return Genre{}, fmt.Errorf("rename genre: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE songs SET genre = ? WHERE genre_id = ? AND active = 1`, name, id); err != nil {
		return Genre{}, fmt.Errorf("refresh song genre cache: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE albums SET genre = ? WHERE genre_id = ? AND active = 1`, name, id); err != nil {
		return Genre{}, fmt.Errorf("refresh album genre cache: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Genre{}, fmt.Errorf("commit genre rename: %w", err)
	}
	return genreDTO(ctx, s.db, id)
}

// MoveGenre reparents a genre: parentID empty means root. The parent must
// exist (404) and moving under itself is a no-op, mirroring the retired
// server's changes.parentId semantics. The denormalized genre-name cache on
// songs/albums stores names, not paths, so a move leaves it untouched.
func (s *Service) MoveGenre(ctx context.Context, id, parentID string) (Genre, error) {
	if _, err := getGenreByID(ctx, s.db, id); errors.Is(err, sql.ErrNoRows) {
		return Genre{}, ErrNotFound
	} else if err != nil {
		return Genre{}, err
	}
	if parentID != "" && parentID != id {
		if _, err := getGenreByID(ctx, s.db, parentID); errors.Is(err, sql.ErrNoRows) {
			return Genre{}, ErrNotFound
		} else if err != nil {
			return Genre{}, err
		}
	}
	if parentID != id {
		var parentValue any
		if parentID != "" {
			parentValue = parentID
		}
		if _, err := s.db.ExecContext(ctx,
			`UPDATE genres SET parent_id = ? WHERE id = ?`, parentValue, id); err != nil {
			return Genre{}, fmt.Errorf("move genre: %w", err)
		}
	}
	return genreDTO(ctx, s.db, id)
}

// ErrGenreHasChildren mirrors the retired server's 409: a genre with active
// children cannot be deleted.
var ErrGenreHasChildren = errors.New("Cannot delete genre with children")

// DeleteGenre removes a genre with no active children (old deleteGenre): the
// direct song/album genre_id references are nulled first, then the row. The
// junction rows (song_genres, album_genres) cascade through the schema's
// ON DELETE CASCADE FKs, and the denormalized genre-name cache is left
// untouched, like the old code.
func (s *Service) DeleteGenre(ctx context.Context, id string) error {
	if _, err := getGenreByID(ctx, s.db, id); errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	var one int
	err := s.db.QueryRowContext(ctx,
		`SELECT 1 FROM genres WHERE parent_id = ? AND active = 1 LIMIT 1`, id).Scan(&one)
	if err == nil {
		return ErrGenreHasChildren
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("check genre children: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin genre delete: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`UPDATE songs SET genre_id = NULL WHERE genre_id = ?`, id); err != nil {
		return fmt.Errorf("detach songs: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE albums SET genre_id = NULL WHERE genre_id = ?`, id); err != nil {
		return fmt.Errorf("detach albums: %w", err)
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM genres WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete genre: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}
