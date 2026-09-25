package opensubsonic

import (
	"context"
	"database/sql"
	"encoding/xml"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/miquelrosell99/sonarly/v2/internal/audio"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/libraries"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/playback"
)

// Retrieval group payloads (v1 routes/retrieval.ts, quirks doc R group).

// coverArtCacheControl is v1's immutable-by-id caching header (R7).
const coverArtCacheControl = "private, max-age=86400"

type lyricsBody struct {
	Value  string `xml:",chardata" json:"value"`
	Artist string `xml:"artist,attr,omitempty" json:"artist,omitempty"`
	Title  string `xml:"title,attr,omitempty" json:"title,omitempty"`
}

type lyricsPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Lyrics lyricsBody `xml:"lyrics" json:"lyrics"`
}

type internetRadioStationsBody struct {
	InternetRadioStation []string `xml:"internetRadioStation" json:"internetRadioStation"`
}

type internetRadioStationsPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	InternetRadioStations internetRadioStationsBody `xml:"internetRadioStations" json:"internetRadioStations"`
}

type podcastsBody struct {
	Channel []string `xml:"channel" json:"channel"`
}

type podcastsPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Podcasts podcastsBody `xml:"podcasts" json:"podcasts"`
}

type newestPodcastsBody struct {
	Episode []string `xml:"episode" json:"episode"`
}

type newestPodcastsPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	NewestPodcasts newestPodcastsBody `xml:"newestPodcasts" json:"newestPodcasts"`
}

// notFoundPlain answers the binary-endpoint 404 v1 sent on missing /
// out-of-scope ids (R1): plain text, no envelope.
func notFoundPlain(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	w.Write([]byte("Not found"))
}

// stream/download share v1's retrieval flow with the streaming half
// delegated to the playback StreamingService (P5): this handler only maps
// the adapter-boundary error contract (R1/R3), the service owns liveness,
// scope, transcode decision, ranges and the body.
func (h *Handler) stream(w http.ResponseWriter, r *http.Request) {
	h.streamOrDownload(w, r, false)
}

func (h *Handler) download(w http.ResponseWriter, r *http.Request) {
	h.streamOrDownload(w, r, true)
}

func (h *Handler) streamOrDownload(w http.ResponseWriter, r *http.Request, download bool) {
	id, _ := auth.IdentityFrom(r.Context())
	songID := r.URL.Query().Get("id")
	if songID == "" {
		notFoundPlain(w)
		return
	}
	filePath, active, ok := h.probeSong(r.Context(), songID)
	if !ok {
		// R1: missing id → plain-text 404, no envelope.
		notFoundPlain(w)
		return
	}
	scope, err := libraries.GetScope(r.Context(), h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	inScope, err := libraries.IsSongInScope(r.Context(), h.db, scope, songID)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if !inScope {
		// R1: out-of-scope → plain-text 404 (ids cannot be probed).
		notFoundPlain(w)
		return
	}
	if !active {
		// v2 deviation surfaced at the boundary: the playback service
		// refuses inactive songs (S2 sign-off S5 — v1 silently streamed
		// them); the Subsonic contract answers the data-not-found code.
		Error(w, r, CodeForbidden, "Data not found")
		return
	}
	if _, err := os.Stat(filePath); err != nil {
		// R3: vanished between index and request → enveloped 70.
		Error(w, r, CodeForbidden, "Data not found")
		return
	}

	var requested int
	var hasRequested bool
	if raw := r.URL.Query().Get("maxBitRate"); raw != "" {
		requested, hasRequested = playback.ParseMaxBitRate(raw)
	}
	err = h.playback.Stream(w, r, id, songID, requested, hasRequested, download, "")
	switch {
	case err == nil:
		// Body committed by the service.
	case errors.Is(err, playback.ErrNotFound), errors.Is(err, playback.ErrUnauthorized):
		// Race with a deactivation between the probe and the service's own
		// load — same wire answer as the probe path.
		notFoundPlain(w)
	default:
		Error(w, r, CodeGeneric, "internal error")
	}
}

// probeSong loads the slice of the songs row the stream boundary needs.
// Active is returned separately: v1's getSongById had no active filter, so
// existence and liveness stay distinguishable (inactive → 70, missing → 404).
func (h *Handler) probeSong(ctx context.Context, songID string) (filePath string, active bool, ok bool) {
	var activeFlag int
	err := h.db.QueryRowContext(ctx,
		`SELECT file_path, active FROM songs WHERE id = ?`, songID).
		Scan(&filePath, &activeFlag)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, false
	}
	if err != nil {
		return "", false, false
	}
	return filePath, activeFlag == 1, true
}

// coverArtHit serves one resolved cover art payload with v1's cache header.
func coverArtHit(w http.ResponseWriter, contentType string, data []byte) {
	w.Header().Set("Cache-Control", coverArtCacheControl)
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// imageContentType is the pinned artist-image lookup: extension → MIME for
// the formats Sonarly writes (v1 used the host mime table; container images
// may lack /etc/mime.types, so the table is pinned like playback's).
func imageContentType(filePath string) string {
	switch strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), ".")) {
	case "jpg", "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "webp":
		return "image/webp"
	case "gif":
		return "image/gif"
	}
	return "application/octet-stream"
}

// getCoverArt ports v1's multi-tier resolution (retrieval.ts:156-253, R7):
// cached blob (scope-checked) → song → song's art → embedded picture →
// album → album's art → album's first song's embedded picture → artist
// image file on disk → 302 redirect to the external artist_image_url →
// enveloped 70 "Cover art not found". Every hit carries the private
// day-long cache header.
func (h *Handler) getCoverArt(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	ctx := r.Context()
	artID := r.URL.Query().Get("id")
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	// Tier 1: cached blob.
	if format, data, found := h.coverArtBlob(ctx, artID); found {
		if ok, err := libraries.IsCoverArtInScope(ctx, h.db, scope, artID); err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		} else if !ok {
			Error(w, r, CodeForbidden, "Cover art not found")
			return
		}
		coverArtHit(w, format, data)
		return
	}

	// Tier 2: the id is a song → its art, then its embedded picture.
	var songFile string
	var songFound bool
	var songActiveCover sql.NullString
	err = h.db.QueryRowContext(ctx,
		`SELECT file_path, cover_art_id FROM songs WHERE id = ?`, artID).
		Scan(&songFile, &songActiveCover)
	switch {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		Error(w, r, CodeGeneric, "internal error")
		return
	default:
		songFound = true
	}
	if songFound {
		if ok, err := libraries.IsSongInScope(ctx, h.db, scope, artID); err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		} else if !ok {
			Error(w, r, CodeForbidden, "Cover art not found")
			return
		}
		if songActiveCover.Valid && songActiveCover.String != "" {
			if format, data, found := h.coverArtBlob(ctx, songActiveCover.String); found {
				coverArtHit(w, format, data)
				return
			}
		}
		if picture := embeddedPicture(songFile); picture != nil {
			coverArtHit(w, picture.MIMEType, picture.Data)
			return
		}
	}

	// Tier 3: the id is an album → its art, then its first song's picture.
	var albumID string
	var albumFound bool
	var albumCover sql.NullString
	err = h.db.QueryRowContext(ctx,
		`SELECT id, cover_art_id FROM albums WHERE id = ?`, artID).
		Scan(&albumID, &albumCover)
	switch {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		Error(w, r, CodeGeneric, "internal error")
		return
	default:
		albumFound = true
	}
	if albumFound {
		if ok, err := libraries.IsAlbumInScope(ctx, h.db, scope, albumID); err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		} else if !ok {
			Error(w, r, CodeForbidden, "Cover art not found")
			return
		}
		if albumCover.Valid && albumCover.String != "" {
			if format, data, found := h.coverArtBlob(ctx, albumCover.String); found {
				coverArtHit(w, format, data)
				return
			}
		}
		var firstSongFile string
		err := h.db.QueryRowContext(ctx,
			`SELECT s.file_path FROM songs s
			WHERE s.album_id = ? AND s.active = 1
			ORDER BY s.disc_number, s.track_number LIMIT 1`, albumID).
			Scan(&firstSongFile)
		if err == nil {
			if picture := embeddedPicture(firstSongFile); picture != nil {
				coverArtHit(w, picture.MIMEType, picture.Data)
				return
			}
		} else if !errors.Is(err, sql.ErrNoRows) {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
	}

	// Tier 4: artist image file on disk (active artists only, v1 parity).
	var localPath sql.NullString
	err = h.db.QueryRowContext(ctx,
		`SELECT artist_image_local_path FROM artists WHERE id = ? AND active = 1`, artID).
		Scan(&localPath)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if localPath.Valid && localPath.String != "" {
		if info, err := os.Stat(localPath.String); err == nil && !info.IsDir() {
			data, err := os.ReadFile(localPath.String)
			if err == nil {
				coverArtHit(w, imageContentType(localPath.String), data)
				return
			}
		}
	}

	// Tier 5: external artist image → redirect without the cache header
	// (v1's redirect branch set none).
	var imageURL sql.NullString
	err = h.db.QueryRowContext(ctx,
		`SELECT artist_image_url FROM artists WHERE id = ? AND active = 1`, artID).
		Scan(&imageURL)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if imageURL.Valid && imageURL.String != "" {
		w.Header().Set("Location", imageURL.String)
		w.WriteHeader(http.StatusFound)
		return
	}

	Error(w, r, CodeForbidden, "Cover art not found")
}

// coverArtBlob loads a cover_arts row (v1 getCoverArtById).
func (h *Handler) coverArtBlob(ctx context.Context, id string) (format string, data []byte, found bool) {
	err := h.db.QueryRowContext(ctx,
		`SELECT format, data FROM cover_arts WHERE id = ?`, id).
		Scan(&format, &data)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil, false
	}
	if err != nil {
		return "", nil, false
	}
	return format, data, true
}

// embeddedPicture parses the first embedded picture of the file via the P4a
// metadata reader (v1's music-metadata tier). Any failure → nil (fall
// through), exactly like v1's try/catch.
func embeddedPicture(filePath string) *audio.Picture {
	md, err := audio.ReadMetadata(filePath)
	if err != nil || md.Picture == nil {
		return nil
	}
	return md.Picture
}

// getLyrics ports v1:255-285 (R8): lyrics by id (scope-checked) or
// artist+title (COLLATE NOCASE, scoped), always wrapped in the {value,
// artist?, title?} object — a bare string breaks py-opensonic.
func (h *Handler) getLyrics(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.IdentityFrom(r.Context())
	ctx := r.Context()
	q := r.URL.Query()
	lyrics := ""
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	if songID := q.Get("id"); songID != "" {
		var text sql.NullString
		err := h.db.QueryRowContext(ctx,
			`SELECT lyrics FROM songs WHERE id = ?`, songID).Scan(&text)
		found := err == nil
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		if found {
			inScope, err := libraries.IsSongInScope(ctx, h.db, scope, songID)
			if err != nil {
				Error(w, r, CodeGeneric, "internal error")
				return
			}
			if inScope {
				lyrics = stringOr(nullString(text))
			}
		}
	} else if artist, title := q.Get("artist"), q.Get("title"); artist != "" && title != "" {
		songScope := libraries.ScopeCondition(scope, "s.library_id")
		var text sql.NullString
		err = h.db.QueryRowContext(ctx,
			`SELECT s.lyrics FROM songs s
			JOIN artists a ON a.id = s.artist_id
			WHERE a.name = ? COLLATE NOCASE AND s.title = ? COLLATE NOCASE AND s.active = 1 `+songScope.SQL+`
			LIMIT 1`,
			append([]any{artist, title}, songScope.Params...)...).Scan(&text)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		lyrics = stringOr(nullString(text))
	}

	respond(w, r, lyricsPayload{
		Envelope: okEnvelope(),
		Lyrics: lyricsBody{
			Value:  lyrics,
			Artist: q.Get("artist"),
			Title:  q.Get("title"),
		},
	})
}

// getAvatar stays a v2 stub even though native avatars exist (P9c): v1 had
// no getAvatar endpoint at all — Subsonic clients received its default 404
// — and serving avatar bytes through /rest would leak them outside the
// session policy the native /api/avatars/{id} route deliberately keeps
// public. The binary-endpoint convention answers a plain 404; recorded in
// the quirks doc R group.
func (h *Handler) getAvatar(w http.ResponseWriter, r *http.Request) {
	notFoundPlain(w)
}

// getInternetRadioStations / getPodcasts / getNewestPodcasts are the empty
// stubs v1 served so sync clients succeed with zero items (R9).
func (h *Handler) getInternetRadioStations(w http.ResponseWriter, r *http.Request) {
	respond(w, r, internetRadioStationsPayload{
		Envelope: okEnvelope(),
		InternetRadioStations: internetRadioStationsBody{
			InternetRadioStation: []string{},
		},
	})
}

func (h *Handler) getPodcasts(w http.ResponseWriter, r *http.Request) {
	respond(w, r, podcastsPayload{
		Envelope: okEnvelope(),
		Podcasts: podcastsBody{Channel: []string{}},
	})
}

func (h *Handler) getNewestPodcasts(w http.ResponseWriter, r *http.Request) {
	respond(w, r, newestPodcastsPayload{
		Envelope:       okEnvelope(),
		NewestPodcasts: newestPodcastsBody{Episode: []string{}},
	})
}
