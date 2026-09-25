package opensubsonic

import (
	"encoding/xml"
	"errors"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/miquelrosell99/sonarly/v2/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/v2/internal/modules/playlists"
)

// Playlist group (v1 features/playlists/opensubsonic-routes.ts, quirks doc
// P1). All access decisions go through the playlists module's ONE policy
// (playlists.Resolve) and all reads/writes through its service — the
// adapter never runs its own playlist SQL beyond what the module exports.

// playlistEntry is the reduced song child v1's fetchPlaylistSongs built for
// playlist payloads (NOT the full browsing Child): album/artist display
// names, no ids. v1 emitted JSON nulls for absent track/discNumber/genre/
// year/duration while XML omitted them (xml-js dropped nulls) — the Go tags
// reproduce exactly that split: no json omitempty, xml omitempty.
type playlistEntry struct {
	ID         string  `xml:"id,attr" json:"id"`
	Title      string  `xml:"title,attr" json:"title"`
	Album      string  `xml:"album,attr" json:"album"`
	Artist     string  `xml:"artist,attr" json:"artist"`
	Track      *int    `xml:"track,attr,omitempty" json:"track"`
	DiscNumber *int    `xml:"discNumber,attr,omitempty" json:"discNumber"`
	Genre      *string `xml:"genre,attr,omitempty" json:"genre"`
	Year       *int    `xml:"year,attr,omitempty" json:"year"`
	Explicit   bool    `xml:"explicit,attr" json:"explicit"`
	Duration   *int    `xml:"duration,attr,omitempty" json:"duration"`
	Type       string  `xml:"type,attr" json:"type"`
	IsDir      bool    `xml:"isDir,attr" json:"isDir"`
	Created    string  `xml:"created,attr" json:"created"`
}

// subsonicPlaylist is v1's toOpenSubsonicPlaylist: the fields Subsonic
// clients read, with `entry` present only on detail responses. coverArt is
// the playlist's own id (self-reference placeholder; playlist art does not
// exist yet — getCoverArt answers 70 for it, same as any unknown id).
type subsonicPlaylist struct {
	ID        string          `xml:"id,attr" json:"id"`
	Name      string          `xml:"name,attr" json:"name"`
	Owner     string          `xml:"owner,attr" json:"owner"`
	Public    bool            `xml:"public,attr" json:"public"`
	SongCount int             `xml:"songCount,attr" json:"songCount"`
	Duration  int             `xml:"duration,attr" json:"duration"`
	CoverArt  string          `xml:"coverArt,attr" json:"coverArt"`
	Created   string          `xml:"created,attr" json:"created"`
	Changed   string          `xml:"changed,attr" json:"changed"`
	Entry     []playlistEntry `xml:"entry" json:"entry,omitempty"`
}

type playlistsBody struct {
	Playlist []subsonicPlaylist `xml:"playlist" json:"playlist"`
}

type playlistsPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Playlists playlistsBody `xml:"playlists" json:"playlists"`
}

type playlistPayload struct {
	XMLName xml.Name `xml:"subsonic-response" json:"-"`
	Envelope
	Playlist subsonicPlaylist `xml:"playlist" json:"playlist"`
}

// dbTimeToISO renders a stored playlist timestamp the way v1 did: v1 kept
// ISO strings in the table, v2 stores SQLite datetime('now') ("YYYY-MM-DD
// HH:MM:SS", UTC) — the wire format stays v1's toISOString with millis.
func dbTimeToISO(s string) string {
	for _, layout := range []string{"2006-01-02 15:04:05", time.RFC3339Nano} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC().Format("2006-01-02T15:04:05.000Z")
		}
	}
	return s
}

func listItemToPlaylist(item playlists.SubsonicListItem) subsonicPlaylist {
	return subsonicPlaylist{
		ID:        item.ID,
		Name:      item.Name,
		Owner:     item.OwnerUsername,
		Public:    item.Visibility == "public" || item.Visibility == "link",
		SongCount: item.SongCount,
		Duration:  item.Duration,
		CoverArt:  item.ID,
		Created:   dbTimeToISO(item.CreatedAt),
		Changed:   dbTimeToISO(item.UpdatedAt),
	}
}

// mapDetailToPlaylist maps the service detail (P6 Get: viewer-scope filtered,
// hideExplicit applied, owner's shares/token stripped for non-owners) onto
// the wire shape. Duration follows v1's includeEntries math: the rounded
// sum of the visible entry durations.
func mapDetailToPlaylist(d *playlists.Detail) subsonicPlaylist {
	duration := 0
	entries := make([]playlistEntry, 0, len(d.Entries))
	for _, e := range d.Entries {
		if e.Duration != nil {
			duration += *e.Duration
		}
		entries = append(entries, playlistEntry{
			ID:         e.ID,
			Title:      e.Title,
			Album:      e.Album,
			Artist:     e.Artist,
			Track:      e.Track,
			DiscNumber: e.DiscNumber,
			Genre:      e.Genre,
			Year:       e.Year,
			Explicit:   e.Explicit,
			Duration:   e.Duration,
			Type:       "music",
			IsDir:      false,
			Created:    e.Created,
		})
	}
	return subsonicPlaylist{
		ID:        d.ID,
		Name:      d.Name,
		Owner:     d.OwnerUsername,
		Public:    d.Visibility == "public" || d.Visibility == "link",
		SongCount: d.SongCount,
		Duration:  int(math.Round(float64(duration))),
		CoverArt:  d.ID,
		Created:   dbTimeToISO(d.CreatedAt),
		Changed:   dbTimeToISO(d.UpdatedAt),
		Entry:     entries,
	}
}

// writePlaylistServiceError maps playlists-module sentinel errors onto the
// envelope: vanished mid-request → 70, forbidden → 50 (v1's adapter code
// for playlist authorization), validation → 10 (family of missing/invalid
// params). Returns true when the error was handled.
func writePlaylistServiceError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, playlists.ErrNotFound):
		Error(w, r, CodeForbidden, "Data not found")
	case errors.Is(err, playlists.ErrForbidden):
		Error(w, r, CodeDataNotFound, "User is not authorized for this operation")
	case playlists.IsRulesError(err):
		Error(w, r, CodeMissingParam, err.Error())
	default:
		Error(w, r, CodeGeneric, "internal error")
	}
	return true
}

func playlistNotAuthorized(w http.ResponseWriter, r *http.Request) {
	Error(w, r, CodeDataNotFound, "User is not authorized for this operation")
}

func playlistIsSmart(w http.ResponseWriter, r *http.Request) {
	Error(w, r, CodeDataNotFound, "Smart playlists cannot be edited through this endpoint")
}

// resolvePlaylistAccess loads the playlist (70 when missing) and resolves
// the ONE policy. minAccess gates the operation; below it the caller gets
// v1's authorization error (50), never a presence leak.
func (h *Handler) resolvePlaylistAccess(w http.ResponseWriter, r *http.Request, playlistID, shareToken string, minAccess playlists.Access) (*playlists.Playlist, bool) {
	p, err := playlists.GetByID(r.Context(), h.db, playlistID)
	if errors.Is(err, playlists.ErrNotFound) {
		Error(w, r, CodeForbidden, "Data not found")
		return nil, false
	}
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return nil, false
	}
	access, err := playlists.Resolve(r.Context(), h.db, p, authIdentity(r), shareToken)
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return nil, false
	}
	if access < minAccess {
		playlistNotAuthorized(w, r)
		return nil, false
	}
	return p, true
}

func authIdentity(r *http.Request) auth.Identity {
	id, _ := auth.IdentityFrom(r.Context())
	return id
}

// getPlaylists implements getPlaylists.view: own + public + shared, ordered
// by name (v1), no entries (v1 includeEntries=false).
func (h *Handler) getPlaylists(w http.ResponseWriter, r *http.Request) {
	items, err := h.playlists.SubsonicList(r.Context(), authIdentity(r))
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	list := make([]subsonicPlaylist, 0, len(items))
	for _, item := range items {
		list = append(list, listItemToPlaylist(item))
	}
	// The SQL already orders by name; keep a stable secondary key so equal
	// names cannot flip between requests.
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].Name == list[j].Name {
			return list[i].ID < list[j].ID
		}
		return list[i].Name < list[j].Name
	})
	respond(w, r, playlistsPayload{Envelope: okEnvelope(), Playlists: playlistsBody{Playlist: list}})
}

// getPlaylist implements getPlaylist.view (P1): the anonymous shareToken
// hook (A8) already let the request through the auth hook; the ONE policy
// validates it — token honored only for visibility=link with an exact
// match, otherwise owner/public/share rules as usual. Missing → 70, no
// access → 50 (v1's adapter code).
func (h *Handler) getPlaylist(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	playlistID := r.URL.Query().Get("id")
	shareToken := r.URL.Query().Get("shareToken")
	if _, ok := h.resolvePlaylistAccess(w, r, playlistID, shareToken, playlists.AccessView); !ok {
		return
	}
	detail, err := h.playlists.Get(ctx, authIdentity(r), playlistID, shareToken)
	if writePlaylistServiceError(w, r, err) {
		return
	}
	respond(w, r, playlistPayload{Envelope: okEnvelope(), Playlist: mapDetailToPlaylist(detail)})
}

// firstParam is v1's asName: the first value of a maybe-repeated param, ""
// when absent or empty.
func firstParam(q map[string][]string, key string) string {
	if values := q[key]; len(values) > 0 {
		return values[0]
	}
	return ""
}

// getPlaylists implements createPlaylist.view (v1 opensubsonic-routes.ts):
// songId params seed a new playlist (name defaults to "New Playlist",
// visibility to private, link visibility mints a share token); a
// playlistId param instead REPLACES an existing playlist's songs per the
// Subsonic API contract. Song ids are validated by the playlists service
// (one data path) — v1 stored bogus ids silently, v2 answers enveloped 10.
func (h *Handler) createPlaylist(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	id := authIdentity(r)
	songIDs := normalizeIDs(q, "songId")

	if playlistID := firstParam(q, "playlistId"); playlistID != "" {
		p, ok := h.resolvePlaylistAccess(w, r, playlistID, "", playlists.AccessEdit)
		if !ok {
			return
		}
		if p.IsSmart {
			playlistIsSmart(w, r)
			return
		}
		detail, err := h.playlists.Update(ctx, id, playlistID, playlists.UpdateInput{SongIDs: &songIDs})
		if writePlaylistServiceError(w, r, err) {
			return
		}
		respond(w, r, playlistPayload{Envelope: okEnvelope(), Playlist: mapDetailToPlaylist(detail)})
		return
	}

	name := firstParam(q, "name")
	if name == "" {
		name = "New Playlist"
	}
	visibility := firstParam(q, "visibility")
	if visibility != "" && !playlists.IsVisibility(visibility) {
		visibility = "" // v1's asVisibility: garbage → default (private)
	}
	detail, err := h.playlists.Create(ctx, id, playlists.Input{
		Name:       name,
		Visibility: visibility,
		SongIDs:    songIDs,
	})
	if writePlaylistServiceError(w, r, err) {
		return
	}
	respond(w, r, playlistPayload{Envelope: okEnvelope(), Playlist: mapDetailToPlaylist(detail)})
}

// updatePlaylist implements updatePlaylist.view: songId replaces the member
// list, songIdToAdd appends, songIndexToRemove splices (descending, invalid
// indexes ignored — v1 semantics), name/visibility patch when present.
// v1 answered an EMPTY OK envelope, not the playlist — preserve.
func (h *Handler) updatePlaylist(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	id := authIdentity(r)
	playlistID := firstParam(q, "playlistId")

	p, ok := h.resolvePlaylistAccess(w, r, playlistID, "", playlists.AccessEdit)
	if !ok {
		return
	}
	if p.IsSmart {
		playlistIsSmart(w, r)
		return
	}

	replaceIDs := normalizeIDs(q, "songId")
	addIDs := normalizeIDs(q, "songIdToAdd")
	removeRaw := normalizeIDs(q, "songIndexToRemove")

	in := playlists.UpdateInput{}
	if len(replaceIDs) > 0 || len(addIDs) > 0 || len(removeRaw) > 0 {
		songIDs, err := playlists.SongIDs(ctx, h.db, playlistID)
		if err != nil {
			Error(w, r, CodeGeneric, "internal error")
			return
		}
		if len(replaceIDs) > 0 {
			songIDs = replaceIDs
		}
		songIDs = append(songIDs, addIDs...)
		if len(removeRaw) > 0 {
			indexes := make([]int, 0, len(removeRaw))
			for _, raw := range removeRaw {
				idx, err := strconv.Atoi(raw)
				if err == nil {
					indexes = append(indexes, idx)
				}
			}
			sort.Sort(sort.Reverse(sort.IntSlice(indexes)))
			for _, idx := range indexes {
				if idx >= 0 && idx < len(songIDs) {
					songIDs = append(songIDs[:idx], songIDs[idx+1:]...)
				}
			}
		}
		in.SongIDs = &songIDs
	}
	if name := firstParam(q, "name"); name != "" {
		in.Name = &name
	}
	if visibility := firstParam(q, "visibility"); visibility != "" && playlists.IsVisibility(visibility) {
		in.Visibility = &visibility
	}

	if _, err := h.playlists.Update(ctx, id, playlistID, in); writePlaylistServiceError(w, r, err) {
		return
	}
	respond(w, r, emptyPayload{Envelope: okEnvelope()})
}

// deletePlaylist implements deletePlaylist.view. v1 semantics: a missing
// playlist is a silent OK (NOT 70); otherwise the editor-or-owner rule
// (the Subsonic adapter's verb rule, v1 canEditOrOwnPlaylist — the native
// route stays owner-only) decides, then the module deletes.
func (h *Handler) deletePlaylist(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	playlistID := r.URL.Query().Get("id")
	p, err := playlists.GetByID(ctx, h.db, playlistID)
	if errors.Is(err, playlists.ErrNotFound) {
		respond(w, r, emptyPayload{Envelope: okEnvelope()})
		return
	}
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	access, err := playlists.Resolve(ctx, h.db, p, authIdentity(r), "")
	if err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	if access < playlists.AccessEdit {
		playlistNotAuthorized(w, r)
		return
	}
	if err := playlists.Delete(ctx, h.db, playlistID); err != nil {
		Error(w, r, CodeGeneric, "internal error")
		return
	}
	respond(w, r, emptyPayload{Envelope: okEnvelope()})
}
