// Package artistimages is the artist image sync (P9c): the v1
// features/artists/images.ts port running as the P4b artist_images job
// handler, plus the public file-serving route and the admin refetch
// trigger.
//
// The sync walks active artists (optionally only those missing a local
// image), resolves each one's image URL through the Deezer search API,
// downloads it with a 10s timeout, verifies the magic bytes (an HTML error
// page must never be saved as an artist image), writes
// DATA_DIR/artist-images/<id>.<ext> — new file first, old file removed
// after, so a failed write cannot leave the artist imageless — and records
// the paths on the artists row. Errors skip the artist and count toward
// stats; a 200ms politeness delay runs between artists.
package artistimages

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/miquelrosell99/sonarly/v2/internal/httpserver"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/library"
)

// fetchTimeout is v1's FETCH_TIMEOUT_MS.
const fetchTimeout = 10 * time.Second

// defaultPolitenessDelay is v1's RATE_LIMIT_DELAY_MS between artists.
const defaultPolitenessDelay = 200 * time.Millisecond

// deezerBaseURL is v1's hardcoded API origin; tests override it.
const deezerBaseURL = "https://api.deezer.com"

// SyncStats is v1's ArtistImageSyncStats (the scan_jobs stats document).
type SyncStats struct {
	Scanned int `json:"scanned"`
	Updated int `json:"updated"`
	Failed  int `json:"failed"`
}

// Syncer runs artist image syncs as a library worker job.
type Syncer struct {
	db      *sql.DB
	dataDir string
	log     *slog.Logger
	client  *http.Client
	deezer  string
	delay   time.Duration
}

// Option customizes the syncer (tests point the Deezer API at an httptest
// server and skip the politeness delay).
type Option func(*Syncer)

// WithDeezerBaseURL overrides the Deezer API base.
func WithDeezerBaseURL(base string) Option {
	return func(s *Syncer) { s.deezer = base }
}

// WithPolitenessDelay overrides the inter-artist delay.
func WithPolitenessDelay(d time.Duration) Option {
	return func(s *Syncer) { s.delay = d }
}

// WithHTTPClient overrides the download transport.
func WithHTTPClient(c *http.Client) Option {
	return func(s *Syncer) { s.client = c }
}

// NewSyncer constructs the production syncer.
func NewSyncer(db *sql.DB, dataDir string, log *slog.Logger, opts ...Option) *Syncer {
	s := &Syncer{
		db:      db,
		dataDir: dataDir,
		log:     log,
		client:  &http.Client{},
		deezer:  deezerBaseURL,
		delay:   defaultPolitenessDelay,
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

type deezerArtist struct {
	ID            int    `json:"id"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	PictureSmall  string `json:"picture_small"`
	PictureMedium string `json:"picture_medium"`
	PictureBig    string `json:"picture_big"`
	PictureXL     string `json:"picture_xl"`
}

type deezerSearchResult struct {
	Data []deezerArtist `json:"data"`
}

// fetchArtistImageURL is v1's fetchArtistImageUrl: the Deezer artist search,
// best picture variant first. No usable hit answers ("", nil).
func (s *Syncer) fetchArtistImageURL(ctx context.Context, name string) (string, error) {
	endpoint := fmt.Sprintf("%s/search/artist?q=%s&limit=1", s.deezer, url.QueryEscape(name))
	reqCtx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("deezer returned %d", resp.StatusCode)
	}
	var result deezerSearchResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if len(result.Data) == 0 {
		return "", nil
	}
	artist := result.Data[0]
	for _, candidate := range []string{artist.PictureXL, artist.PictureBig, artist.PictureMedium, artist.PictureSmall, artist.Picture} {
		if candidate != "" {
			return candidate, nil
		}
	}
	return "", nil
}

// sniffImageFormat is v1's magic-byte sniffer (jpeg/png/gif/webp).
func sniffImageFormat(data []byte) string {
	switch {
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return ".jpg"
	case len(data) >= 4 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4e && data[3] == 0x47:
		return ".png"
	case len(data) >= 4 && data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x38:
		return ".gif"
	case len(data) >= 12 &&
		data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 &&
		data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50:
		return ".webp"
	}
	return ""
}

// extensionFromResponse mirrors v1's extensionFromResponse: the content type
// wins, then the URL's own extension, defaulting to .jpg.
func extensionFromResponse(contentType, rawURL string) string {
	switch contentType {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	}
	if ext := filepath.Ext(rawURL); ext == ".jpeg" || ext == ".jpg" || ext == ".png" || ext == ".webp" || ext == ".gif" {
		return ext
	}
	return ".jpg"
}

func (s *Syncer) imagesDir() string {
	return filepath.Join(s.dataDir, "artist-images")
}

type artistRow struct {
	id        string
	name      string
	imageURL  *string
	localPath *string
}

// candidates returns the artist rows to process (v1's SQL): active, named,
// and — unless refetchExisting — only those missing a local image.
func (s *Syncer) candidates(ctx context.Context, refetchExisting bool) ([]artistRow, error) {
	statement := `SELECT id, name, artist_image_url, artist_image_local_path FROM artists
		WHERE active = 1 AND name != ''`
	if !refetchExisting {
		statement += ` AND (artist_image_local_path IS NULL OR artist_image_local_path = '')`
	}
	statement += ` ORDER BY name`
	rows, err := s.db.QueryContext(ctx, statement)
	if err != nil {
		return nil, fmt.Errorf("list artists: %w", err)
	}
	defer rows.Close()
	var out []artistRow
	for rows.Next() {
		var row artistRow
		if err := rows.Scan(&row.id, &row.name, &row.imageURL, &row.localPath); err != nil {
			return nil, fmt.Errorf("list artists: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list artists: %w", err)
	}
	return out, nil
}

// download fetches one image URL and validates the payload.
func (s *Syncer) download(ctx context.Context, url string) ([]byte, string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("image download returned %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if err != nil {
		return nil, "", err
	}
	if len(data) == 0 {
		return nil, "", errors.New("downloaded image is empty")
	}
	if sniffImageFormat(data) == "" {
		return nil, "", errors.New("downloaded content is not a supported image")
	}
	contentType := resp.Header.Get("Content-Type")
	if i := strings.IndexByte(contentType, ';'); i >= 0 {
		contentType = strings.TrimSpace(contentType[:i])
	}
	return data, extensionFromResponse(strings.TrimSpace(contentType), url), nil
}

// RunJob is the library.Worker handler for artist_images jobs: decode the
// typed payload and sync.
func (s *Syncer) RunJob(ctx context.Context, job *library.Job) (any, error) {
	var payload library.ArtistImagesPayload
	if err := job.DecodePayload(&payload); err != nil {
		return nil, err
	}
	return s.Sync(ctx, payload.RefetchExisting)
}

// Sync is v1's syncMissingArtistImages: per-artist error isolation, the
// write-new-then-remove-old ordering, and the politeness delay.
func (s *Syncer) Sync(ctx context.Context, refetchExisting bool) (*SyncStats, error) {
	stats := &SyncStats{}
	artists, err := s.candidates(ctx, refetchExisting)
	if err != nil {
		return stats, err
	}
	if err := os.MkdirAll(s.imagesDir(), 0o755); err != nil {
		return stats, fmt.Errorf("create artist images dir: %w", err)
	}

	for _, artist := range artists {
		if err := ctx.Err(); err != nil {
			return stats, err
		}
		stats.Scanned++
		updated, err := s.syncOne(ctx, artist)
		if err != nil {
			stats.Failed++
			s.log.WarnContext(ctx, "artist image lookup failed", "artist", artist.name, "err", err)
			continue
		}
		if updated {
			stats.Updated++
		}
		if updated && s.delay > 0 {
			select {
			case <-ctx.Done():
				return stats, ctx.Err()
			case <-time.After(s.delay):
			}
		}
	}
	return stats, nil
}

// syncOne resolves, downloads, stores, and records one artist image. A
// missing remote image is not an error (v1: `continue`) — updated is false
// and nothing was written.
func (s *Syncer) syncOne(ctx context.Context, artist artistRow) (bool, error) {
	imageURL, err := s.fetchArtistImageURL(ctx, artist.name)
	if err != nil {
		return false, err
	}
	if imageURL == "" {
		return false, nil
	}
	data, ext, err := s.download(ctx, imageURL)
	if err != nil {
		return false, err
	}
	localPath := filepath.Join(s.imagesDir(), artist.id+ext)

	// Write the new image before removing the old one so a failed write
	// cannot leave the artist without any image on disk (v1).
	if err := os.WriteFile(localPath, data, 0o644); err != nil {
		return false, err
	}
	if artist.localPath != nil && *artist.localPath != localPath {
		if err := os.Remove(*artist.localPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			s.log.WarnContext(ctx, "remove old artist image failed", "path", *artist.localPath, "err", err)
		}
	}
	if _, err := s.db.ExecContext(ctx,
		`UPDATE artists SET artist_image_url = ?, artist_image_local_path = ? WHERE id = ?`,
		imageURL, localPath, artist.id); err != nil {
		return false, fmt.Errorf("record artist image: %w", err)
	}
	return true, nil
}

// ---------------------------------------------------------------------------
// HTTP wiring
// ---------------------------------------------------------------------------

// Handler wires the artist-image routes: the public file server and the
// admin refetch trigger.
type Handler struct {
	syncer *Syncer
	queue  *library.Queue
}

// NewHandler constructs the route handler.
func NewHandler(syncer *Syncer, queue *library.Queue) *Handler {
	return &Handler{syncer: syncer, queue: queue}
}

// Routes registers GET /api/artist-images/{id} (public — <img> tags carry
// no API key, v1 parity) and POST /api/admin/artists/refetch (admin).
func (h *Handler) Routes(r chi.Router, mw *auth.Middleware) {
	r.Get("/api/artist-images/{id}", h.getImage)
	r.Group(func(r chi.Router) {
		r.Use(mw.AuthMiddleware, auth.RequireAuth, mw.RequireAdmin)
		r.Post("/api/admin/artists/refetch", h.refetch)
	})
}

var contentTypeByExt = map[string]string{
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".gif":  "image/gif",
	".webp": "image/webp",
}

// getImage serves the artist's local image file when one exists (v1's
// column-first lookup with a filesystem fallback), else 404.
func (h *Handler) getImage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	path, ok := h.localPath(r, id)
	if !ok {
		httpserver.Error(w, http.StatusNotFound, "Artist image not found")
		return
	}
	data, err := os.ReadFile(path)
	if err != nil {
		httpserver.Error(w, http.StatusNotFound, "Artist image not found")
		return
	}
	contentType := contentTypeByExt[filepath.Ext(path)]
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// localPath resolves the on-disk image: the artists row's recorded path
// when the file exists, else any DATA_DIR/artist-images/<id>.<ext> leftover
// (e.g. recorded by an older run), else not-found.
func (h *Handler) localPath(r *http.Request, id string) (string, bool) {
	var recorded *string
	err := h.syncer.db.QueryRowContext(r.Context(),
		`SELECT artist_image_local_path FROM artists WHERE id = ? AND active = 1`, id).Scan(&recorded)
	if err == nil && recorded != nil && *recorded != "" {
		if info, err := os.Stat(*recorded); err == nil && !info.IsDir() {
			return *recorded, true
		}
	}
	matches, _ := filepath.Glob(filepath.Join(h.syncer.imagesDir(), id+".*"))
	for _, match := range matches {
		if info, err := os.Stat(match); err == nil && !info.IsDir() {
			return match, true
		}
	}
	return "", false
}

// refetch is POST /api/admin/artists/refetch: enqueue an artist_images job
// that re-downloads every artist (v1: RefetchExisting true), answering 202
// with the job id.
func (h *Handler) refetch(w http.ResponseWriter, r *http.Request) {
	jobID, err := h.queue.Push(r.Context(), library.JobTypeArtistImages,
		library.ArtistImagesPayload{RefetchExisting: true})
	if err != nil {
		httpserver.Error(w, http.StatusInternalServerError, "Internal Server Error")
		return
	}
	httpserver.JSON(w, http.StatusAccepted, map[string]any{"ok": true, "jobId": jobID})
}
