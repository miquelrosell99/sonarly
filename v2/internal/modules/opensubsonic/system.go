package opensubsonic

import (
	"database/sql"
	"encoding/xml"
	"errors"
	"net/http"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/libraries"
)

// System group payloads (v1 routes/system.ts).

type licensePayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	License licenseBody `xml:"license" json:"license"`
}

type licenseBody struct {
	Valid bool `xml:"valid,attr" json:"valid"`
}

type extensionsPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	// Empty non-nil slice: JSON keeps "openSubsonicExtensions":[] while XML
	// omits the element — exactly v1's empty-array shape (quirks doc E7/S3).
	OpenSubsonicExtensions []string `xml:"openSubsonicExtensions" json:"openSubsonicExtensions"`
}

type userPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	User *User `xml:"user" json:"user"`
}

// ping answers an empty OK envelope (v1 /rest/ping.view).
func (h *Handler) ping(w http.ResponseWriter, r *http.Request) {
	respond(w, r, emptyPayload{Envelope: okEnvelope()})
}

// getLicense answers the unconditional valid license (v1 /rest/getLicense.view).
func (h *Handler) getLicense(w http.ResponseWriter, r *http.Request) {
	respond(w, r, licensePayload{
		Envelope: okEnvelope(),
		License:  licenseBody{Valid: true},
	})
}

// getOpenSubsonicExtensions answers an empty extension list (v1 parity —
// Sonarly implements no OpenSubsonic extensions yet).
func (h *Handler) getOpenSubsonicExtensions(w http.ResponseWriter, r *http.Request) {
	respond(w, r, extensionsPayload{
		Envelope:               okEnvelope(),
		OpenSubsonicExtensions: []string{},
	})
}

// getUser describes the authenticated caller (v1 /rest/getUser.view,
// quirks doc S4/S5): the v1 role matrix, transcoding prefs from the users
// row, and — the one v2 fix — the real scoped library ids in folder
// instead of the hardcoded ["0"].
func (h *Handler) getUser(w http.ResponseWriter, r *http.Request) {
	id, ok := auth.IdentityFrom(r.Context())
	if !ok {
		// Cannot happen through the auth hook; guards direct composition.
		Error(w, r, CodeUnauthorized, "Wrong username or password")
		return
	}

	var (
		username        string
		isAdmin         bool
		maxBitrateKbps  *int
		transcodeFormat *string
	)
	err := h.db.QueryRowContext(r.Context(),
		`SELECT username, is_admin, max_bitrate_kbps, transcode_format FROM users WHERE id = ?`,
		id.UserID).Scan(&username, &isAdmin, &maxBitrateKbps, &transcodeFormat)
	if errors.Is(err, sql.ErrNoRows) {
		// v1 answers 40 when the user row vanished after auth (system.ts:47-52).
		Error(w, r, CodeUnauthorized, "Wrong username or password")
		return
	}
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	folders, err := h.musicFolderIDs(r, id)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}

	respond(w, r, userPayload{
		Envelope: okEnvelope(),
		User: &User{
			Username:          username,
			AdminRole:         isAdmin,
			CommentRole:       true,
			CoverArtRole:      true,
			DownloadRole:      true,
			Folder:            folders,
			JukeboxRole:       false,
			PlaylistRole:      true,
			PodcastRole:       false,
			ScrobblingEnabled: true,
			SettingsRole:      isAdmin,
			ShareRole:         false,
			StreamRole:        true,
			UploadRole:        isAdmin,
			MaxBitRate:        maxBitrateKbps,
			TranscodeFormat:   transcodeFormat,
		},
	})
}

// musicFolderIDs resolves the folder list for getUser: admins see every
// library, other users their user_libraries assignments (the P2 scope
// policy, libraries.GetScope). Always non-nil so JSON renders [].
func (h *Handler) musicFolderIDs(r *http.Request, id auth.Identity) ([]string, error) {
	scope, err := libraries.GetScope(r.Context(), h.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	if !scope.All {
		if scope.IDs == nil {
			return []string{}, nil
		}
		return scope.IDs, nil
	}
	rows, err := h.db.QueryContext(r.Context(),
		`SELECT id FROM libraries ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var libraryID string
		if err := rows.Scan(&libraryID); err != nil {
			return nil, err
		}
		ids = append(ids, libraryID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}
