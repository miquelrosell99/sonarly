package opensubsonic

import (
	"context"
	"database/sql"
	"encoding/xml"
	"errors"
	"net/http"
	"regexp"
	"strconv"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
	"github.com/miquelrosell99/sonarly/server/internal/modules/playback"
)

// Starring group (v1 routes/starring.ts, quirks doc T1-T4). Every write
// lands in the same user_songs/user_albums/user_artists junction tables the
// native API uses — one data path — and scrobble delegates to the playback
// service so the Subsonic surface cannot drift from the native scrobble
// rules (B13).

type starredBody struct {
	Song   []Song   `xml:"song" json:"song"`
	Album  []Album  `xml:"album" json:"album"`
	Artist []Artist `xml:"artist" json:"artist"`
}

// starredPayload/getStarred2 answer the IDENTICAL body under the
// starred/starred2 keys (quirks doc T4).
type starredPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Starred starredBody `xml:"starred" json:"starred"`
}

type starred2Payload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Starred2 starredBody `xml:"starred2" json:"starred2"`
}

func (h *Handler) star(w http.ResponseWriter, r *http.Request) {
	h.setStar(w, r, true)
}

func (h *Handler) unstar(w http.ResponseWriter, r *http.Request) {
	h.setStar(w, r, false)
}

// normalizeIDs flattens one repeated query param the way v1's normalizeIds
// did: absent or empty → nothing, arrays keep every non-empty value.
func normalizeIDs(q map[string][]string, key string) []string {
	values := q[key]
	out := make([]string, 0, len(values))
	for _, v := range values {
		if v != "" {
			out = append(out, v)
		}
	}
	return out
}

// entityExists is v1's check-then-write probe: existence only, deliberately
// NOT active- or scope-filtered (quirks doc T1/T2 — v1 ran
// `SELECT 1 FROM <table> WHERE id = ?`).
func (h *Handler) entityExists(ctx context.Context, table, id string) bool {
	var one int
	err := h.db.QueryRowContext(ctx, `SELECT 1 FROM `+table+` WHERE id = ?`, id).Scan(&one)
	return err == nil
}

// setStar implements star.view/unstar.view (v1 starring.ts:23-60, T1):
// multi-id (id, albumId, artistId repeatable), all-or-nothing existence
// validation — ANY unknown id answers 70 and nothing is written. v1 wrote
// each row in its own statement; v2 wraps the whole set in one transaction
// (cheap robustness fix recorded in the quirks doc, same wire behavior).
func (h *Handler) setStar(w http.ResponseWriter, r *http.Request, starred bool) {
	ctx := r.Context()
	id, _ := auth.IdentityFrom(ctx)
	q := r.URL.Query()
	songIDs := normalizeIDs(q, "id")
	albumIDs := normalizeIDs(q, "albumId")
	artistIDs := normalizeIDs(q, "artistId")

	for _, songID := range songIDs {
		if !h.entityExists(ctx, "songs", songID) {
			Error(w, r, CodeForbidden, "Data not found")
			return
		}
	}
	for _, albumID := range albumIDs {
		if !h.entityExists(ctx, "albums", albumID) {
			Error(w, r, CodeForbidden, "Data not found")
			return
		}
	}
	for _, artistID := range artistIDs {
		if !h.entityExists(ctx, "artists", artistID) {
			Error(w, r, CodeForbidden, "Data not found")
			return
		}
	}

	star := 0
	if starred {
		star = 1
	}
	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	defer tx.Rollback()
	if err := starEach(ctx, tx, "user_songs", "song_id", id.UserID, songIDs, star); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if err := starEach(ctx, tx, "user_albums", "album_id", id.UserID, albumIDs, star); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if err := starEach(ctx, tx, "user_artists", "artist_id", id.UserID, artistIDs, star); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if err := tx.Commit(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	respond(w, r, emptyPayload{Envelope: okEnvelope()})
}

func starEach(ctx context.Context, tx *sql.Tx, table, idColumn, userID string, ids []string, starred int) error {
	for _, entityID := range ids {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO `+table+` (user_id, `+idColumn+`, starred) VALUES (?, ?, ?)
			ON CONFLICT(user_id, `+idColumn+`) DO UPDATE SET starred = excluded.starred`,
			userID, entityID, starred)
		if err != nil {
			return err
		}
	}
	return nil
}

// ratingPattern is v1's setRating validation regex, verbatim (T2):
// integers or x.5 only, no sign, no exponent.
var ratingPattern = regexp.MustCompile(`^\d+(\.5)?$`)

// parseRating ports v1's parseRating: undefined/empty or anything outside
// ^\d+(\.5)?$ in 0..5 → invalid (the route answers enveloped 10).
func parseRating(values []string) (float64, bool) {
	if len(values) == 0 || values[0] == "" {
		return 0, false
	}
	raw := values[0]
	if !ratingPattern.MatchString(raw) {
		return 0, false
	}
	n, err := strconv.ParseFloat(raw, 64)
	if err != nil || n < 0 || n > 5 {
		return 0, false
	}
	return n, true
}

// setRating implements setRating.view (v1 starring.ts:143-179, T2): the
// song must exist (existence only, any scope — the deferred v1 semantics)
// else 70; the rating must match the regex and range else 10. The write
// upserts user_songs.rating and recomputes songs.average_rating exactly like
// v1 (and like the native ratings endpoint — one data path).
func (h *Handler) setRating(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, _ := auth.IdentityFrom(ctx)
	q := r.URL.Query()
	songID := q.Get("id")
	if songID == "" {
		Error(w, r, CodeMissingParam, "Missing id parameter")
		return
	}
	rating, ok := parseRating(q["rating"])
	if !ok {
		Error(w, r, CodeMissingParam, "Missing or invalid rating parameter")
		return
	}
	if !h.entityExists(ctx, "songs", songID) {
		Error(w, r, CodeForbidden, "Data not found")
		return
	}

	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO user_songs (user_id, song_id, rating) VALUES (?, ?, ?)
		ON CONFLICT(user_id, song_id) DO UPDATE SET rating = excluded.rating`,
		id.UserID, songID, rating); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE songs
		SET average_rating = (SELECT AVG(rating) FROM user_songs WHERE song_id = ?)
		WHERE id = ?`, songID, songID); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if err := tx.Commit(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	respond(w, r, emptyPayload{Envelope: okEnvelope()})
}

// scrobble implements scrobble.view (v1 starring.ts:181-203, T3):
// submission=false (or anything that is not undefined/”/'true') is a
// COMPLETE no-op answering OK — v1 never implemented now-playing. Real
// submissions delegate to the playback scrobble service, so the Subsonic
// surface shares the native scrobble's transaction, history row, and
// liveness/scope validation (B13 semantics); unknown/inactive/out-of-scope
// ids answer 70.
func (h *Handler) scrobble(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, _ := auth.IdentityFrom(ctx)
	q := r.URL.Query()
	submission := q.Get("submission")
	isSubmission := submission == "" || submission == "true"
	if !isSubmission {
		respond(w, r, emptyPayload{Envelope: okEnvelope()})
		return
	}

	songIDs := normalizeIDs(q, "id")
	// v1's all-or-nothing existence probe (nothing written when any id is
	// unknown); the service then re-checks liveness + scope per id.
	for _, songID := range songIDs {
		if !h.entityExists(ctx, "songs", songID) {
			Error(w, r, CodeForbidden, "Data not found")
			return
		}
	}
	client := "subsonic"
	for _, songID := range songIDs {
		err := h.playback.Scrobble(ctx, id, songID, &playback.ScrobbleDetails{Client: &client})
		if errors.Is(err, playback.ErrNotFound) {
			Error(w, r, CodeForbidden, "Data not found")
			return
		}
		if err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
	}
	respond(w, r, emptyPayload{Envelope: okEnvelope()})
}

func (h *Handler) getStarred(w http.ResponseWriter, r *http.Request) {
	h.starred(w, r, false)
}

func (h *Handler) getStarred2(w http.ResponseWriter, r *http.Request) {
	h.starred(w, r, true)
}

// starred implements getStarred/getStarred2 (v1 starring.ts:62-132, T4):
// the caller's starred songs/albums/artists under the caller's library
// scope. Songs drop out when they leave the catalog or scope; albums and
// artists are filtered by the same EXISTS-scope pattern as the browsing
// endpoints. Starred entities carry the fabricated epoch timestamp (X6).
func (h *Handler) starred(w http.ResponseWriter, r *http.Request, v2 bool) {
	ctx := r.Context()
	id, _ := auth.IdentityFrom(ctx)
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	body := starredBody{Song: []Song{}, Album: []Album{}, Artist: []Artist{}}

	songIDs := []string{}
	rows, err := h.db.QueryContext(ctx,
		`SELECT song_id FROM user_songs WHERE user_id = ? AND starred = 1`, id.UserID)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	for rows.Next() {
		var songID string
		if err := rows.Scan(&songID); err != nil {
			rows.Close()
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		songIDs = append(songIDs, songID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	songs, err := h.songsByIDs(ctx, id.UserID, songIDs, &scope)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	body.Song = songs

	albumScope := albumScopeFilter(scope)
	albumRows, err := h.db.QueryContext(ctx,
		`SELECT `+albumColumns+`,
			(SELECT AVG(rating) FROM user_albums WHERE album_id = a.id) AS average_rating,
			ua.starred, ua.rating
		FROM albums a
		JOIN user_albums ua ON ua.album_id = a.id AND ua.user_id = ? AND ua.starred = 1
		WHERE a.active = 1 `+albumScope.SQL,
		append([]any{id.UserID}, albumScope.Params...)...)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	albumsSrc := []AlbumSource{}
	for albumRows.Next() {
		a, err := scanAlbumRow(albumRows)
		if err != nil {
			albumRows.Close()
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		albumsSrc = append(albumsSrc, a)
	}
	albumRows.Close()
	if err := albumRows.Err(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	albums, err := h.mapAlbums(ctx, albumsSrc, id.UserID != "")
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	body.Album = albums

	artistScope := artistScopeFilter(scope)
	artistRows, err := h.db.QueryContext(ctx,
		`SELECT `+artistColumns+`, `+artistAlbumCountSQL+`, uar.starred, uar.rating
		FROM artists ar
		JOIN user_artists uar ON uar.artist_id = ar.id AND uar.user_id = ? AND uar.starred = 1
		WHERE ar.active = 1 `+artistScope.SQL,
		append([]any{id.UserID}, artistScope.Params...)...)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	artistsSrc := []ArtistSource{}
	for artistRows.Next() {
		a, err := scanArtistRow(artistRows)
		if err != nil {
			artistRows.Close()
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		artistsSrc = append(artistsSrc, a)
	}
	artistRows.Close()
	if err := artistRows.Err(); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	artists := make([]Artist, len(artistsSrc))
	for i := range artistsSrc {
		artists[i] = MapArtist(artistsSrc[i], id.UserID != "")
	}
	body.Artist = artists

	if v2 {
		respond(w, r, starred2Payload{Envelope: okEnvelope(), Starred2: body})
		return
	}
	respond(w, r, starredPayload{Envelope: okEnvelope(), Starred: body})
}
