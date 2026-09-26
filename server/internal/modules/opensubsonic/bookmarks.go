package opensubsonic

import (
	"encoding/xml"
	"errors"
	"net/http"
	"strconv"

	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
	"github.com/miquelrosell99/sonarly/server/internal/modules/playback"
)

// maxBookmarkCommentLen mirrors the playback module's bound (the old adapter accepted an
// unbounded Subsonic query parameter; the audit fix caps it, and the
// adapter shares the native cap).
const maxBookmarkCommentLen = 1000

// Bookmark group (old features/bookmarks/routes.ts). The adapter is a thin
// envelope over the playback bookmark service: bookmark I/O, liveness and
// library-scope checks all live there (one data path with the native
// endpoints). The Go server deltas recorded in the quirks doc: create/delete now
// enforce scope like the native routes (the old adapter checked liveness on create and
// nothing on delete), and the comment is length-bounded like the native
// body contract.

// bookmarkEntry is one getBookmarks entry: the resume position, the caller's
// username, and the full song child under the literal key `entry` (omitted
// when the song left the catalog or the caller's scope — the retired server answered the
// bookmark without a child instead of dropping the row).
type bookmarkEntry struct {
	Position int    `xml:"position,attr" json:"position"`
	Username string `xml:"username,attr" json:"username"`
	Comment  string `xml:"comment,attr" json:"comment"`
	Created  string `xml:"created,attr" json:"created"`
	Changed  string `xml:"changed,attr" json:"changed"`
	Entry    *Song  `xml:"entry" json:"entry,omitempty"`
}

type bookmarksBody struct {
	Bookmark []bookmarkEntry `xml:"bookmark" json:"bookmark"`
}

type bookmarksPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Bookmarks bookmarksBody `xml:"bookmarks" json:"bookmarks"`
}

// getBookmarks implements getBookmarks.view (old bookmarks/routes.ts:10-42):
// every bookmark row of the caller, newest change first, with the scoped
// song child resolved where possible.
func (h *Handler) getBookmarks(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := authIdentity(r)

	rows, err := h.playback.SubsonicBookmarks(ctx, id)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	songIDs := make([]string, 0, len(rows))
	for _, b := range rows {
		songIDs = append(songIDs, b.SongID)
	}
	// the retired server fetched the children WITH the caller's scope — bookmarks whose song
	// fell out of scope keep their row and render without entry.
	scope, err := libraries.GetScope(ctx, h.db, id.UserID, id.IsAdmin)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	songs, err := h.songsByIDs(ctx, id.UserID, songIDs, &scope)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	songByID := make(map[string]Song, len(songs))
	for _, s := range songs {
		songByID[s.ID] = s
	}

	entries := make([]bookmarkEntry, 0, len(rows))
	for _, b := range rows {
		entry := bookmarkEntry{
			Position: b.Position,
			Username: id.Username,
			Created:  dbTimeToISO(b.CreatedAt),
			Changed:  dbTimeToISO(b.UpdatedAt),
		}
		if b.Comment != nil {
			entry.Comment = *b.Comment
		}
		if song, ok := songByID[b.SongID]; ok {
			entry.Entry = &song
		}
		entries = append(entries, entry)
	}
	respond(w, r, bookmarksPayload{Envelope: okEnvelope(), Bookmarks: bookmarksBody{Bookmark: entries}})
}

// parsePosition is the old parsePosition: required, a non-negative integer,
// else the route answers enveloped 10.
func parsePosition(values []string) (int, bool) {
	if len(values) == 0 || values[0] == "" {
		return 0, false
	}
	n, err := strconv.Atoi(values[0])
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

// createBookmark implements createBookmark.view (old bookmarks/routes.ts:44-81):
// id and position are required (10 when missing/invalid), the song must be
// playable for the caller (70 through the playback service — the retired server checked
// liveness only; scope enforcement is the Go server one-path delta).
func (h *Handler) createBookmark(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := authIdentity(r)
	q := r.URL.Query()

	songID := q.Get("id")
	if songID == "" {
		Error(w, r, CodeMissingParam, "Missing id parameter")
		return
	}
	position, ok := parsePosition(q["position"])
	if !ok {
		Error(w, r, CodeMissingParam, "Missing or invalid position parameter")
		return
	}
	var comment *string
	if c := firstParam(q, "comment"); c != "" {
		if len(c) > maxBookmarkCommentLen {
			Error(w, r, CodeMissingParam, "comment must be at most "+strconv.Itoa(maxBookmarkCommentLen)+" characters")
			return
		}
		comment = &c
	}

	err := h.playback.PutBookmark(ctx, id, songID, position, comment)
	if errors.Is(err, playback.ErrNotFound) {
		Error(w, r, CodeForbidden, "Data not found")
		return
	}
	if errors.Is(err, playback.ErrUnauthorized) {
		Error(w, r, CodeMissingParam, "Missing authentication")
		return
	}
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	respond(w, r, emptyPayload{Envelope: okEnvelope()})
}

// deleteBookmark implements deleteBookmark.view: id is required (10); the
// delete itself delegates to the playback service, so an unplayable song
// answers 70 (Go-server delta — the retired server deleted unconditionally) and a missing bookmark
// is still a silent OK.
func (h *Handler) deleteBookmark(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := authIdentity(r)
	songID := r.URL.Query().Get("id")
	if songID == "" {
		Error(w, r, CodeMissingParam, "Missing id parameter")
		return
	}
	err := h.playback.DeleteBookmark(ctx, id, songID)
	if errors.Is(err, playback.ErrNotFound) {
		Error(w, r, CodeForbidden, "Data not found")
		return
	}
	if errors.Is(err, playback.ErrUnauthorized) {
		Error(w, r, CodeMissingParam, "Missing authentication")
		return
	}
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	respond(w, r, emptyPayload{Envelope: okEnvelope()})
}
