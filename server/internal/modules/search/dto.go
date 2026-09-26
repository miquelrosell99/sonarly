package search

// Entry is an id+name pair, the artistEntries shape v1's search attaches to
// song hits (songs/routes attachSongArtistEntries).
type Entry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Song is one hit of the songs category: the display subset of the catalog
// song DTO (v2 omits filePath/checksum everywhere; search adds the joined
// artist/album display names and the caller's interaction state).
type Song struct {
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	TrackNumber   *int     `json:"trackNumber,omitempty"`
	DiscNumber    *int     `json:"discNumber,omitempty"`
	Duration      *int     `json:"duration,omitempty"`
	ArtistID      *string  `json:"artistId,omitempty"`
	AlbumID       *string  `json:"albumId,omitempty"`
	ArtistName    *string  `json:"artistName,omitempty"`
	AlbumName     *string  `json:"albumName,omitempty"`
	Genre         *string  `json:"genre,omitempty"`
	GenreID       *string  `json:"genreId,omitempty"`
	Year          *int     `json:"year,omitempty"`
	Explicit      bool     `json:"explicit"`
	CoverArt      *string  `json:"coverArt,omitempty"`
	Mtime         int64    `json:"mtime"`
	Active        bool     `json:"active"`
	Artists       []string `json:"artists,omitempty"`
	ArtistEntries []Entry  `json:"artistEntries,omitempty"`
	Genres        []string `json:"genres,omitempty"`
	Starred       bool     `json:"starred"`
	Rating        *float64 `json:"rating,omitempty"`
}

// Album is one hit of the albums category (v1's search album shape).
type Album struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	ArtistID   *string  `json:"artistId,omitempty"`
	ArtistName *string  `json:"artistName,omitempty"`
	Year       *int     `json:"year,omitempty"`
	Genre      *string  `json:"genre,omitempty"`
	CoverArt   *string  `json:"coverArt,omitempty"`
	Active     bool     `json:"active"`
	Artists    []string `json:"artists,omitempty"`
	Genres     []string `json:"genres,omitempty"`
	Starred    bool     `json:"starred"`
	Rating     *float64 `json:"rating,omitempty"`
	Explicit   bool     `json:"explicit"`
}

// Artist is one hit of the artists category (v1's search artist shape).
type Artist struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Active  bool     `json:"active"`
	Starred bool     `json:"starred"`
	Rating  *float64 `json:"rating,omitempty"`
}

// Playlist is one hit of the playlists category (v1's search playlist shape:
// songIds stays empty; songCount carries the count).
type Playlist struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	OwnerID       string   `json:"ownerId"`
	OwnerUsername string   `json:"ownerUsername"`
	Visibility    string   `json:"visibility"`
	ShareToken    *string  `json:"shareToken,omitempty"`
	IsSmart       bool     `json:"isSmart"`
	CreatedAt     string   `json:"createdAt"`
	UpdatedAt     string   `json:"updatedAt"`
	SongIDs       []string `json:"songIds"`
	SongCount     int      `json:"songCount"`
	Starred       bool     `json:"starred"`
	Rating        *float64 `json:"rating,omitempty"`
}

// Results is the /api/search envelope: every category is always present
// (possibly empty), exactly like v1.
type Results struct {
	Songs     []Song     `json:"songs"`
	Albums    []Album    `json:"albums"`
	Artists   []Artist   `json:"artists"`
	Playlists []Playlist `json:"playlists"`
}
