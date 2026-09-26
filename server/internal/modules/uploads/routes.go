// HTTP routes for chunked uploads — the v1 features/uploads surface with
// the same URL shapes, all admin-gated like v1. One deliberate protocol
// deviation: chunk bodies are raw application/octet-stream with
// Content-Length where v1 accepted a multipart form per chunk. Multipart
// bought nothing here (the client is ours and sends exactly one unnamed
// blob per request) and parsing it forces a multipart reader into the hot
// path; the raw body is the same bytes minus framing, the route path is
// unchanged, and the web client's uploadChunk switches by sending the blob
// directly with the method POST→PUT (see useUpload.ts). The per-request
// limits v1 took from its global multipart config are enforced explicitly
// per request instead.

package uploads

import (
	"database/sql"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/miquelrosell99/sonarly/server/internal/httpserver"
	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/library"
)

// Handler wires sessions, the chunk store and the ingest queue to HTTP.
type Handler struct {
	repo       *Repository
	queue      *library.Queue
	mw         *auth.Middleware
	dataDir    string
	ingestPath string
}

func NewHandler(repo *Repository, queue *library.Queue, mw *auth.Middleware, dataDir, ingestPath string) *Handler {
	return &Handler{repo: repo, queue: queue, mw: mw, dataDir: dataDir, ingestPath: ingestPath}
}

// Routes registers the upload endpoints. Every route is admin-gated (v1
// parity: uploads reshape the library). AuthMiddleware runs first, then
// RequireAuth — so anonymous callers get 401 before RequireAdmin's 403 —
// then RequireAdmin re-reads is_admin from the database.
func (h *Handler) Routes(r chi.Router) {
	r.Group(func(r chi.Router) {
		r.Use(h.mw.AuthMiddleware, auth.RequireAuth, h.mw.RequireAdmin)
		r.Route("/api/upload/sessions", func(r chi.Router) {
			r.Post("/", h.createSession)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", h.getSession)
				r.Post("/complete", h.completeSession)
				r.Route("/files/{fileId}", func(r chi.Router) {
					r.Post("/complete", h.completeFile)
					r.Put("/chunks/{index}", h.putChunk)
				})
			})
		})
	})
}

// sessionDir is the on-disk root of one session's chunks and files. The id
// comes from the upload_sessions table (server-minted UUID), never directly
// from an unvalidated URL segment — loadSession gates every use.
func (h *Handler) sessionDir(id string) string {
	return filepath.Join(h.dataDir, "uploads", id)
}

// loadSession resolves the URL session id to a row, answering 404 when it
// does not exist. Every route calls this before any disk write, so an
// unknown id cannot create directories under dataDir/uploads.
func (h *Handler) loadSession(w http.ResponseWriter, r *http.Request) *Session {
	id := chi.URLParam(r, "id")
	session, err := h.repo.Get(r.Context(), id)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return nil
	}
	if session == nil {
		httpserver.Error(w, http.StatusNotFound, "Session not found")
		return nil
	}
	return session
}

func (h *Handler) createSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		LibraryID         string `json:"libraryId"`
		DuplicateStrategy string `json:"duplicateStrategy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.LibraryID == "" {
		httpserver.Error(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if _, err := uuid.Parse(body.LibraryID); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid library id")
		return
	}
	if body.DuplicateStrategy != "" && !IsDuplicateStrategy(body.DuplicateStrategy) {
		httpserver.Error(w, http.StatusBadRequest, "Invalid duplicate strategy")
		return
	}
	var exists int
	if err := h.repo.db.QueryRowContext(r.Context(),
		`SELECT 1 FROM libraries WHERE id = ? LIMIT 1`, body.LibraryID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpserver.Error(w, http.StatusNotFound, "Library not found")
			return
		}
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}

	session, err := h.repo.Create(r.Context(), body.LibraryID, body.DuplicateStrategy)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	resp := map[string]any{"sessionId": session.ID, "libraryId": session.LibraryID}
	if session.DuplicateStrategy != "" {
		resp["duplicateStrategy"] = session.DuplicateStrategy
	}
	httpserver.JSON(w, http.StatusCreated, resp)
}

// putChunk stores one raw-body chunk. The body is the chunk bytes exactly —
// no multipart framing (see the package note). Content-Length, when the
// client sends it, gets a cheap early 413; the streaming copy is capped at
// MaxChunkBytes+1 regardless, so a lying or chunked-encoding client cannot
// exceed the cap either.
func (h *Handler) putChunk(w http.ResponseWriter, r *http.Request) {
	fileID := chi.URLParam(r, "fileId")
	if !IsValidFileID(fileID) {
		httpserver.Error(w, http.StatusBadRequest, "Invalid file id")
		return
	}
	index, err := ParseChunkIndex(chi.URLParam(r, "index"))
	if err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid chunk index")
		return
	}
	session := h.loadSession(w, r)
	if session == nil {
		return
	}
	if r.ContentLength > MaxChunkBytes {
		httpserver.Error(w, http.StatusRequestEntityTooLarge, "Chunk too large")
		return
	}
	if _, err := WriteChunk(h.sessionDir(session.ID), fileID, index, r.Body); err != nil {
		writeChunkError(w, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writeChunkError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrChunkTooLarge):
		httpserver.Error(w, http.StatusRequestEntityTooLarge, "Chunk too large")
	case errors.Is(err, ErrInvalidFileID):
		httpserver.Error(w, http.StatusBadRequest, "Invalid file id")
	case errors.Is(err, ErrInvalidChunkIndex):
		httpserver.Error(w, http.StatusBadRequest, "Invalid chunk index")
	default:
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
	}
}

// completeFile reassembles one uploaded file into the session's files dir
// under its final relative path and reports name and size.
func (h *Handler) completeFile(w http.ResponseWriter, r *http.Request) {
	fileID := chi.URLParam(r, "fileId")
	if !IsValidFileID(fileID) {
		httpserver.Error(w, http.StatusBadRequest, "Invalid file id")
		return
	}
	session := h.loadSession(w, r)
	if session == nil {
		return
	}
	var body struct {
		TotalChunks  int    `json:"totalChunks"`
		RelativePath string `json:"relativePath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpserver.Error(w, http.StatusBadRequest, "Invalid input")
		return
	}
	if body.TotalChunks < 1 || body.TotalChunks > MaxTotalChunks {
		httpserver.Error(w, http.StatusBadRequest, "Invalid chunk count")
		return
	}
	if !IsSafeRelativePath(body.RelativePath) {
		httpserver.Error(w, http.StatusBadRequest, "Invalid relative path")
		return
	}

	fileName, size, err := ReassembleFile(h.sessionDir(session.ID), fileID, body.TotalChunks, body.RelativePath)
	if err != nil {
		writeReassembleError(w, err)
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"fileName": fileName, "size": size})
}

func writeReassembleError(w http.ResponseWriter, err error) {
	var missing MissingChunkError
	switch {
	case errors.As(err, &missing):
		// Typed 4xx with the missing index (v1 answered a bare 500).
		httpserver.Error(w, http.StatusBadRequest, missing.Error())
	case errors.Is(err, ErrFileTooLarge):
		httpserver.Error(w, http.StatusRequestEntityTooLarge, "File too large")
	case errors.Is(err, ErrInvalidFileID):
		httpserver.Error(w, http.StatusBadRequest, "Invalid file id")
	case errors.Is(err, ErrInvalidChunkCount):
		httpserver.Error(w, http.StatusBadRequest, "Invalid chunk count")
	case errors.Is(err, ErrInvalidRelativePath):
		httpserver.Error(w, http.StatusBadRequest, "Invalid relative path")
	default:
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
	}
}

// completeSession delivers the session: every reassembled file moves into
// <ingestPath>/<libraryId> (the ingest pipeline's per-library drop target),
// one typed ingest job is enqueued for that target, and the session row and
// directory are deleted. The move is non-atomic by nature — see
// MoveSessionFilesToIngest for the crash window and the reconciliation
// safety net. Repeating a completed session answers 404 (the row is gone),
// which is what makes a double-tap idempotent: no second move, no second
// job.
func (h *Handler) completeSession(w http.ResponseWriter, r *http.Request) {
	session := h.loadSession(w, r)
	if session == nil {
		return
	}
	var exists int
	if err := h.repo.db.QueryRowContext(r.Context(),
		`SELECT 1 FROM libraries WHERE id = ? LIMIT 1`, session.LibraryID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpserver.Error(w, http.StatusNotFound, "Library not found")
			return
		}
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if h.ingestPath == "" {
		httpserver.Error(w, http.StatusInternalServerError, "Ingest path not configured")
		return
	}

	target := filepath.Join(h.ingestPath, session.LibraryID)
	moved, err := MoveSessionFilesToIngest(h.sessionDir(session.ID), target)
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if _, err := h.queue.Push(r.Context(), library.JobTypeIngest, library.IngestPayload{
		SourcePath:        target,
		LibraryID:         session.LibraryID,
		DuplicateStrategy: session.DuplicateStrategy,
	}); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if err := h.repo.Delete(r.Context(), session.ID); err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	if err := RemoveSessionDirectory(h.sessionDir(session.ID)); err != nil {
		// The row is already gone; if the dir survives, the sweeper's
		// orphan pass reclaims it on the next tick.
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusOK, map[string]any{"ok": true, "moved": moved})
}

// getSession reports what has arrived for a session: per-file chunk counts
// and bytes plus the reassembled files with sizes — the small status the
// client needs to resume or show progress.
func (h *Handler) getSession(w http.ResponseWriter, r *http.Request) {
	session := h.loadSession(w, r)
	if session == nil {
		return
	}
	dir := h.sessionDir(session.ID)

	type chunkInfo struct {
		FileID         string `json:"fileId"`
		ChunksReceived int    `json:"chunksReceived"`
		ChunkBytes     int64  `json:"chunkBytes"`
	}
	type fileInfo struct {
		Path string `json:"path"`
		Size int64  `json:"size"`
	}
	resp := map[string]any{
		"sessionId":   session.ID,
		"libraryId":   session.LibraryID,
		"createdAt":   session.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		"files":       []chunkInfo{},
		"reassembled": []fileInfo{},
	}
	if session.DuplicateStrategy != "" {
		resp["duplicateStrategy"] = session.DuplicateStrategy
	}

	chunksDir := filepath.Join(dir, "chunks")
	entries, err := os.ReadDir(chunksDir)
	if err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			info := chunkInfo{FileID: e.Name()}
			chunkFiles, err := os.ReadDir(filepath.Join(chunksDir, e.Name()))
			if err != nil {
				continue
			}
			for _, cf := range chunkFiles {
				if cf.IsDir() {
					continue
				}
				if fi, err := cf.Info(); err == nil {
					info.ChunksReceived++
					info.ChunkBytes += fi.Size()
				}
			}
			resp["files"] = append(resp["files"].([]chunkInfo), info)
		}
	}

	filesDir := filepath.Join(dir, "files")
	reassembled := []fileInfo{}
	filepath.WalkDir(filesDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(filesDir, path)
		if err != nil {
			return nil
		}
		if fi, err := d.Info(); err == nil {
			reassembled = append(reassembled, fileInfo{Path: rel, Size: fi.Size()})
		}
		return nil
	})
	resp["reassembled"] = reassembled

	httpserver.JSON(w, http.StatusOK, resp)
}
