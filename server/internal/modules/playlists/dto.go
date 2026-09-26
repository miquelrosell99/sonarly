package playlists

// Playlist is the domain model: one row of playlists plus the owner's
// username when loaded for display. ShareToken is "" when the playlist has
// no link token (token exists iff visibility == "link").
type Playlist struct {
	ID            string
	Name          string
	Description   string
	OwnerID       string
	OwnerUsername string
	Visibility    string // private | shared | public | link
	ShareToken    string
	IsSmart       bool
	Rules         *Rules
	ResolveMode   string // tracks | query
	CreatedAt     string
	UpdatedAt     string
}

// Visibilities is the whitelist for the visibility column.
var Visibilities = []string{"private", "shared", "public", "link"}

// IsVisibility reports whether v is a known playlist visibility.
func IsVisibility(v string) bool {
	for _, known := range Visibilities {
		if v == known {
			return true
		}
	}
	return false
}

// ResolveModes mirrors the retired server migration 048: 'tracks' resolves a smart
// playlist's user-scoped rule fields against the owner's data so every
// viewer receives the same curated list; 'query' re-resolves live against
// each viewer's own data.
const (
	ResolveModeTracks = "tracks"
	ResolveModeQuery  = "query"
)

// IsResolveMode reports whether v is a known resolve mode.
func IsResolveMode(v string) bool {
	return v == ResolveModeTracks || v == ResolveModeQuery
}

// NormalizeResolveMode maps anything unknown to the retired server default 'tracks'.
func NormalizeResolveMode(v string) string {
	if v == ResolveModeQuery {
		return ResolveModeQuery
	}
	return ResolveModeTracks
}

// ListItem is one entry of GET /api/playlists. ShareToken rides the struct
// but is only populated for the playlist's owner (the old B10 fix: the token is
// the owner's secret; other viewers authorize with it but never see it).
type ListItem struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   string   `json:"description,omitempty"`
	OwnerID       string   `json:"ownerId"`
	OwnerUsername string   `json:"ownerUsername"`
	Visibility    string   `json:"visibility"`
	ShareToken    string   `json:"shareToken,omitempty"`
	IsSmart       bool     `json:"isSmart"`
	ResolveMode   string   `json:"resolveMode"`
	SongCount     int      `json:"songCount"`
	Starred       bool     `json:"starred"`
	Rating        *float64 `json:"rating,omitempty"`
	CreatedAt     string   `json:"createdAt"`
	UpdatedAt     string   `json:"updatedAt"`
}

// NameEntry is an {id, name} pair attached to a song entry (the old
// attachSongArtistEntries shape).
type NameEntry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Entry is one song inside a playlist detail response (the old
// fetchPlaylistSongs shape).
type Entry struct {
	ID            string      `json:"id"`
	Title         string      `json:"title"`
	Album         string      `json:"album"`
	AlbumID       *string     `json:"albumId,omitempty"`
	Artist        string      `json:"artist"`
	ArtistID      *string     `json:"artistId,omitempty"`
	Artists       []string    `json:"artists,omitempty"`
	ArtistEntries []NameEntry `json:"artistEntries,omitempty"`
	Track         *int        `json:"track"`
	DiscNumber    *int        `json:"discNumber"`
	Genre         *string     `json:"genre,omitempty"`
	Year          *int        `json:"year,omitempty"`
	Explicit      bool        `json:"explicit"`
	Duration      *int        `json:"duration"`
	CoverArt      *string     `json:"coverArt,omitempty"`
	AlbumCoverArt *string     `json:"albumCoverArt,omitempty"`
	Type          string      `json:"type"`
	IsDir         bool        `json:"isDir"`
	Created       string      `json:"created"`
}

// ShareEntry is one row of a playlist's share list (owner-only detail view).
type ShareEntry struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
	CanEdit  bool   `json:"canEdit"`
}

// Detail is the GET /api/playlists/{id} response body. Shares and
// ShareToken are owner-only.
// CoverAlbum is one entry of the playlist cover mosaic: the display
// fields the 2x2 grid needs.
type CoverAlbum struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	CoverArt *string `json:"coverArt,omitempty"`
}

type Detail struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Description   string  `json:"description,omitempty"`
	OwnerID       string  `json:"ownerId"`
	OwnerUsername string  `json:"ownerUsername"`
	Visibility    string  `json:"visibility"`
	ShareToken    string  `json:"shareToken,omitempty"`
	IsSmart       bool    `json:"isSmart"`
	ResolveMode   string  `json:"resolveMode"`
	Rules         *Rules  `json:"rules,omitempty"`
	SongCount     int     `json:"songCount"`
	Entries       []Entry `json:"entries"`
	// Shares renders for the owner even when empty (wire parity) — a pointer
	// so nil (non-owner) omits entirely while &[] renders as [].
	Shares    *[]ShareEntry `json:"shares,omitempty"`
	Starred   bool          `json:"starred"`
	Rating    *float64      `json:"rating,omitempty"`
	CreatedAt string        `json:"createdAt"`
	UpdatedAt string        `json:"updatedAt"`
}
