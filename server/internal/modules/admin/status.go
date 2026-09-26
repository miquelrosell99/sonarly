// Admin dashboard status, missing-file management, and ingest-runs views —
// the remaining handlers of v1's features/users/admin-routes.ts.
package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
)

// countOf runs one SELECT COUNT(*) with optional WHERE.
func countOf(ctx context.Context, db *sql.DB, query string, args ...any) (int, error) {
	var n int
	err := db.QueryRowContext(ctx, query, args...).Scan(&n)
	return n, err
}

// AdminStatus is v1's /api/admin/status response.
type AdminStatus struct {
	Counts struct {
		Users   int `json:"users"`
		Songs   int `json:"songs"`
		Albums  int `json:"albums"`
		Artists int `json:"artists"`
	} `json:"counts"`
	ConflictsCount int `json:"conflictsCount"`
	MissingCounts  struct {
		Songs   int `json:"songs"`
		Albums  int `json:"albums"`
		Artists int `json:"artists"`
	} `json:"missingCounts"`
	IngestJobsCount int             `json:"ingestJobsCount"`
	LatestIngest    *IngestRunEntry `json:"latestIngest"`
}

// Status ports v1's GET /api/admin/status.
func (s *Service) Status(ctx context.Context) (*AdminStatus, error) {
	var out AdminStatus
	var err error
	if out.Counts.Users, err = countOf(ctx, s.db, `SELECT COUNT(*) FROM users`); err != nil {
		return nil, err
	}
	if out.Counts.Songs, err = countOf(ctx, s.db, `SELECT COUNT(*) FROM songs`); err != nil {
		return nil, err
	}
	if out.Counts.Albums, err = countOf(ctx, s.db, `SELECT COUNT(*) FROM albums`); err != nil {
		return nil, err
	}
	if out.Counts.Artists, err = countOf(ctx, s.db, `SELECT COUNT(*) FROM artists`); err != nil {
		return nil, err
	}
	if out.ConflictsCount, err = countOf(ctx, s.db,
		`SELECT COUNT(*) FROM songs WHERE active = 1 AND file_path LIKE '% (%)%'`); err != nil {
		return nil, err
	}
	if out.MissingCounts.Songs, err = countOf(ctx, s.db, `SELECT COUNT(*) FROM songs WHERE active = 0`); err != nil {
		return nil, err
	}
	if out.MissingCounts.Albums, err = countOf(ctx, s.db, `SELECT COUNT(*) FROM albums WHERE active = 0`); err != nil {
		return nil, err
	}
	if out.MissingCounts.Artists, err = countOf(ctx, s.db, `SELECT COUNT(*) FROM artists WHERE active = 0`); err != nil {
		return nil, err
	}
	if out.IngestJobsCount, err = countOf(ctx, s.db, `SELECT COUNT(*) FROM ingest_jobs`); err != nil {
		return nil, err
	}

	var (
		id                           string
		status                       string
		startedAt, finishedAt, stats *string
	)
	err = s.db.QueryRowContext(ctx,
		`SELECT id, status, started_at, finished_at, stats FROM scan_jobs WHERE type = 'ingest' ORDER BY started_at DESC LIMIT 1`).
		Scan(&id, &status, &startedAt, &finishedAt, &stats)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err == nil {
		out.LatestIngest = &IngestRunEntry{ID: id, Status: status, StartedAt: startedAt, FinishedAt: finishedAt}
		if stats != nil && *stats != "" {
			out.LatestIngest.Stats = json.RawMessage(*stats)
		}
	}
	return &out, nil
}

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	status, err := h.svc.Status(r.Context())
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, status)
}

// ---------------------------------------------------------------------------
// Missing-file management (v1's missing* endpoints)
// ---------------------------------------------------------------------------

// MissingSong is one inactive song row (the fields a management UI lists).
type MissingSong struct {
	ID         string  `json:"id"`
	FilePath   string  `json:"filePath"`
	Title      string  `json:"title"`
	ArtistName *string `json:"artistName,omitempty"`
	AlbumName  *string `json:"albumName,omitempty"`
	Year       *int    `json:"year,omitempty"`
	Genre      *string `json:"genre,omitempty"`
}

// MissingAlbum is one inactive album row.
type MissingAlbum struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	ArtistName *string `json:"artistName,omitempty"`
	Year       *int    `json:"year,omitempty"`
	Genre      *string `json:"genre,omitempty"`
}

// MissingArtist is one inactive artist row.
type MissingArtist struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// missingSongs lists inactive songs (v1 listInactiveSongs without userId).
func (s *Service) missingSongs(ctx context.Context) ([]MissingSong, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT s.id, s.file_path, s.title, ar.name, al.name, s.year, s.genre
		 FROM songs s
		 LEFT JOIN artists ar ON ar.id = s.artist_id
		 LEFT JOIN albums al ON al.id = s.album_id
		 WHERE s.active = 0
		 ORDER BY s.title`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MissingSong{}
	for rows.Next() {
		var song MissingSong
		if err := rows.Scan(&song.ID, &song.FilePath, &song.Title,
			&song.ArtistName, &song.AlbumName, &song.Year, &song.Genre); err != nil {
			return nil, err
		}
		out = append(out, song)
	}
	return out, rows.Err()
}

func (s *Service) missingAlbums(ctx context.Context) ([]MissingAlbum, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT a.id, a.name, ar.name, a.year, a.genre
		 FROM albums a
		 LEFT JOIN artists ar ON ar.id = a.artist_id
		 WHERE a.active = 0
		 ORDER BY a.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MissingAlbum{}
	for rows.Next() {
		var album MissingAlbum
		if err := rows.Scan(&album.ID, &album.Name, &album.ArtistName, &album.Year, &album.Genre); err != nil {
			return nil, err
		}
		out = append(out, album)
	}
	return out, rows.Err()
}

func (s *Service) missingArtists(ctx context.Context) ([]MissingArtist, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, name FROM artists WHERE active = 0 ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MissingArtist{}
	for rows.Next() {
		var artist MissingArtist
		if err := rows.Scan(&artist.ID, &artist.Name); err != nil {
			return nil, err
		}
		out = append(out, artist)
	}
	return out, rows.Err()
}

func (h *Handler) missing(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	songs, err := h.svc.missingSongs(ctx)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	albums, err := h.svc.missingAlbums(ctx)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	artists, err := h.svc.missingArtists(ctx)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{
		"songs": songs, "albums": albums, "artists": artists,
	})
}

func (h *Handler) deleteMissingSong(w http.ResponseWriter, r *http.Request) {
	h.deleteMissingRow(w, r, `DELETE FROM songs WHERE id = ?`, chi.URLParam(r, "id"))
}

func (h *Handler) deleteMissingAlbum(w http.ResponseWriter, r *http.Request) {
	h.deleteMissingRow(w, r, `DELETE FROM albums WHERE id = ?`, chi.URLParam(r, "id"))
}

func (h *Handler) deleteMissingArtist(w http.ResponseWriter, r *http.Request) {
	h.deleteMissingRow(w, r, `DELETE FROM artists WHERE id = ?`, chi.URLParam(r, "id"))
}

// deleteMissingRow removes one row (v1 deleteSongById/deleteAlbumById/
// deleteArtistById — plain row deletes; the file is already gone, junction
// and user rows cascade through the schema's FKs).
func (h *Handler) deleteMissingRow(w http.ResponseWriter, r *http.Request, statement, id string) {
	res, err := h.svc.db.ExecContext(r.Context(), statement, id)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// v1 answered {ok:true} unconditionally; v2 keeps the 404 honest for
		// a missing id.
		httpserver.Error(w, http.StatusNotFound, "Not found")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) deleteAllMissingSongs(w http.ResponseWriter, r *http.Request) {
	h.deleteAllMissing(w, r, `DELETE FROM songs WHERE active = 0`)
}

func (h *Handler) deleteAllMissingAlbums(w http.ResponseWriter, r *http.Request) {
	h.deleteAllMissing(w, r, `DELETE FROM albums WHERE active = 0`)
}

func (h *Handler) deleteAllMissingArtists(w http.ResponseWriter, r *http.Request) {
	h.deleteAllMissing(w, r, `DELETE FROM artists WHERE active = 0`)
}

func (h *Handler) deleteAllMissing(w http.ResponseWriter, r *http.Request, statement string) {
	if _, err := h.svc.db.ExecContext(r.Context(), statement); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------------------------------------------------------------------------
// Ingest runs (v1's /api/admin/ingest-routes)
// ---------------------------------------------------------------------------

// IngestRunEntry is one ingest scan_jobs row (v1 shape).
type IngestRunEntry struct {
	ID         string          `json:"id"`
	Status     string          `json:"status"`
	StartedAt  *string         `json:"startedAt"`
	FinishedAt *string         `json:"finishedAt"`
	Stats      json.RawMessage `json:"stats,omitempty"`
	Error      *string         `json:"error,omitempty"`
}

// IngestRunDetail adds the per-file ingest_jobs rows (v1 shape).
type IngestRunDetail struct {
	IngestRunEntry
	Jobs []IngestJobEntry `json:"jobs"`
}

// IngestJobEntry is one ingest_jobs row (v1 shape).
type IngestJobEntry struct {
	ID                string  `json:"id"`
	SourcePath        string  `json:"sourcePath"`
	TargetPath        *string `json:"targetPath"`
	Status            string  `json:"status"`
	Error             *string `json:"error"`
	Duplicate         bool    `json:"duplicate"`
	DuplicateStrategy *string `json:"duplicateStrategy"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

func (h *Handler) ingestRuns(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.db.QueryContext(r.Context(),
		`SELECT id, status, started_at, finished_at, stats, error FROM scan_jobs
		 WHERE type = 'ingest' ORDER BY started_at DESC, rowid DESC LIMIT 100`)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	defer rows.Close()
	runs := []IngestRunEntry{}
	for rows.Next() {
		var run IngestRunEntry
		var stats *string
		if err := rows.Scan(&run.ID, &run.Status, &run.StartedAt, &run.FinishedAt, &stats, &run.Error); err != nil {
			httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
			return
		}
		if stats != nil && *stats != "" {
			run.Stats = json.RawMessage(*stats)
		}
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"runs": runs})
}

// getIngestRun loads one run and its per-file jobs (v1 falls back to the
// created_at window for rows whose run_id predates the column).
func (s *Service) getIngestRun(ctx context.Context, id string) (*IngestRunDetail, error) {
	var run IngestRunEntry
	var startedAtRaw, finishedAtRaw, stats *string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, status, started_at, finished_at, stats, error FROM scan_jobs WHERE id = ? AND type = 'ingest'`, id).
		Scan(&run.ID, &run.Status, &startedAtRaw, &finishedAtRaw, &stats, &run.Error)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	run.StartedAt, run.FinishedAt = startedAtRaw, finishedAtRaw
	if stats != nil && *stats != "" {
		run.Stats = json.RawMessage(*stats)
	}

	startedAt := "1970-01-01 00:00:00"
	if startedAtRaw != nil {
		startedAt = *startedAtRaw
	}
	finishedAt := startedAt
	if finishedAtRaw != nil {
		finishedAt = *finishedAtRaw
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, source_path, target_path, status, error, duplicate, duplicate_strategy, created_at, updated_at
		 FROM ingest_jobs
		 WHERE run_id = ? OR (run_id IS NULL AND datetime(created_at) >= datetime(?) AND datetime(created_at) <= datetime(?))
		 ORDER BY created_at DESC`, id, startedAt, finishedAt)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	detail := &IngestRunDetail{IngestRunEntry: run, Jobs: []IngestJobEntry{}}
	for rows.Next() {
		var job IngestJobEntry
		var duplicate int
		if err := rows.Scan(&job.ID, &job.SourcePath, &job.TargetPath, &job.Status,
			&job.Error, &duplicate, &job.DuplicateStrategy, &job.CreatedAt, &job.UpdatedAt); err != nil {
			return nil, err
		}
		job.Duplicate = duplicate == 1
		detail.Jobs = append(detail.Jobs, job)
	}
	return detail, rows.Err()
}

func (h *Handler) ingestRun(w http.ResponseWriter, r *http.Request) {
	detail, err := h.svc.getIngestRun(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if detail == nil {
		httpserver.Error(w, http.StatusNotFound, "Ingest run not found")
		return
	}
	httpserver.JSON(w, http.StatusOK, detail)
}

func (h *Handler) deleteIngestRun(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tx, err := h.svc.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM ingest_jobs WHERE run_id = ?`, id); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	res, err := tx.ExecContext(r.Context(), `DELETE FROM scan_jobs WHERE id = ? AND type = 'ingest'`, id)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		httpserver.Error(w, http.StatusNotFound, "Ingest run not found")
		return
	}
	if err := tx.Commit(); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) deleteAllIngestRuns(w http.ResponseWriter, r *http.Request) {
	tx, err := h.svc.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM ingest_jobs`); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `DELETE FROM scan_jobs WHERE type = 'ingest'`); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if err := tx.Commit(); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}
