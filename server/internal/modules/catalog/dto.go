package catalog

// Entry is an {id, name} pair: an artist/composer/label attached to a song
// or album through its junction table, in position order.
type Entry struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Song is the API-facing song shape (v1's Song minus filePath and checksum —
// see package doc).
type Song struct {
	ID                  string   `json:"id"`
	Title               string   `json:"title"`
	TrackNumber         *int     `json:"trackNumber,omitempty"`
	DiscNumber          *int     `json:"discNumber,omitempty"`
	Duration            *int     `json:"duration,omitempty"`
	ArtistID            *string  `json:"artistId,omitempty"`
	AlbumID             *string  `json:"albumId,omitempty"`
	Genre               *string  `json:"genre,omitempty"`
	GenreID             *string  `json:"genreId,omitempty"`
	LibraryID           *string  `json:"libraryId,omitempty"`
	Year                *int     `json:"year,omitempty"`
	Explicit            bool     `json:"explicit"`
	CoverArt            *string  `json:"coverArt,omitempty"`
	AlbumCoverArt       *string  `json:"albumCoverArt,omitempty"`
	CoverArtMissing     bool     `json:"coverArtMissing"`
	Mtime               int64    `json:"mtime"`
	Active              bool     `json:"active"`
	BitRate             *int     `json:"bitRate,omitempty"`
	BitsPerSample       *int     `json:"bitsPerSample,omitempty"`
	SampleRate          *int     `json:"sampleRate,omitempty"`
	Channels            *int     `json:"channels,omitempty"`
	BPM                 *int     `json:"bpm,omitempty"`
	MusicBrainzID       *string  `json:"musicBrainzId,omitempty"`
	MusicBrainzTrackID  *string  `json:"musicBrainzTrackId,omitempty"`
	MusicBrainzWorkID   *string  `json:"musicBrainzWorkId,omitempty"`
	MusicBrainzDiscID   *string  `json:"musicBrainzDiscId,omitempty"`
	ReplayGain          *float64 `json:"replayGain,omitempty"`
	AverageRating       *float64 `json:"averageRating,omitempty"`
	Comment             *string  `json:"comment,omitempty"`
	SortName            *string  `json:"sortName,omitempty"`
	Mood                *string  `json:"mood,omitempty"`
	MediaType           *string  `json:"mediaType,omitempty"`
	OriginalReleaseDate *string  `json:"originalReleaseDate,omitempty"`
	ReleaseDate         *string  `json:"releaseDate,omitempty"`
	RemixOf             *string  `json:"remixOf,omitempty"`
	DisplayArtist       *string  `json:"displayArtist,omitempty"`
	DisplayAlbumArtist  *string  `json:"displayAlbumArtist,omitempty"`
	Lyrics              *string  `json:"lyrics,omitempty"`
	SyncedLyrics        any      `json:"syncedLyrics,omitempty"`
	Producers           []string `json:"producers,omitempty"`
	ISRCs               []string `json:"isrcs,omitempty"`
	OriginalYear        *int     `json:"originalYear,omitempty"`
	OriginalArtist      *string  `json:"originalArtist,omitempty"`
	Gapless             bool     `json:"gapless"`
	TotalTracks         *string  `json:"totalTracks,omitempty"`
	TotalDiscs          *string  `json:"totalDiscs,omitempty"`

	// Joined display names (artist_name / album_name / album artist name).
	ArtistName      *string `json:"artistName,omitempty"`
	AlbumName       *string `json:"albumName,omitempty"`
	AlbumArtistName *string `json:"albumArtistName,omitempty"`

	// Relations batch-attached after the main query (anti-N+1).
	Artists         []string `json:"artists,omitempty"`
	ArtistEntries   []Entry  `json:"artistEntries,omitempty"`
	ComposerEntries []Entry  `json:"composerEntries,omitempty"`
	Genres          []string `json:"genres,omitempty"`

	// Per-user interaction state (v1 parity).
	Starred bool     `json:"starred"`
	Rating  *float64 `json:"rating,omitempty"`
}

// Album is the API-facing album shape. Song counts ride the songs join:
// Total counts every in-scope active song, Shown excludes explicit songs
// when the caller asked to hide them, Explicit mirrors v1 (any in-scope
// active song is explicit).
type Album struct {
	ID                        string   `json:"id"`
	Name                      string   `json:"name"`
	ArtistID                  *string  `json:"artistId,omitempty"`
	ArtistName                *string  `json:"artistName,omitempty"`
	ReleaseType               *string  `json:"releaseType,omitempty"`
	Year                      *int     `json:"year,omitempty"`
	Genre                     *string  `json:"genre,omitempty"`
	CoverArt                  *string  `json:"coverArt,omitempty"`
	Active                    bool     `json:"active"`
	CatalogNumbers            []string `json:"catalogNumbers,omitempty"`
	Barcode                   *string  `json:"barcode,omitempty"`
	ASIN                      *string  `json:"asin,omitempty"`
	MusicBrainzAlbumID        *string  `json:"musicBrainzAlbumId,omitempty"`
	MusicBrainzReleaseGroupID *string  `json:"musicBrainzReleaseGroupId,omitempty"`
	MusicBrainzAlbumArtistIDs []string `json:"musicBrainzAlbumArtistIds,omitempty"`
	OriginalYear              *int     `json:"originalYear,omitempty"`
	Compilation               bool     `json:"compilation"`
	TotalTracks               *string  `json:"totalTracks,omitempty"`
	TotalDiscs                *string  `json:"totalDiscs,omitempty"`

	TotalSongCount int  `json:"totalSongCount"`
	ShownSongCount int  `json:"shownSongCount"`
	Explicit       bool `json:"explicit"`

	Artists      []string `json:"artists,omitempty"`
	Genres       []string `json:"genres,omitempty"`
	LabelEntries []Entry  `json:"labelEntries,omitempty"`

	Starred bool     `json:"starred"`
	Rating  *float64 `json:"rating,omitempty"`
}

// Artist is the API-facing artist shape. Albums is populated on the detail
// endpoint only.
type Artist struct {
	ID                   string        `json:"id"`
	Name                 string        `json:"name"`
	Active               bool          `json:"active"`
	MusicBrainzArtistIDs []string      `json:"musicBrainzArtistIds,omitempty"`
	Bio                  *string       `json:"bio,omitempty"`
	ExternalURLs         any           `json:"externalUrls,omitempty"`
	ArtistImageURL       string        `json:"artistImageUrl,omitempty"`
	Albums               []ArtistAlbum `json:"albums,omitempty"`

	Starred bool     `json:"starred"`
	Rating  *float64 `json:"rating,omitempty"`
}

// ArtistAlbum is the trimmed album shape embedded in the artist detail
// response (v1 parity).
type ArtistAlbum struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Year           *int     `json:"year,omitempty"`
	Genre          *string  `json:"genre,omitempty"`
	CoverArt       *string  `json:"coverArt,omitempty"`
	TotalSongCount int      `json:"totalSongCount"`
	ShownSongCount int      `json:"shownSongCount"`
	Starred        bool     `json:"starred"`
	Rating         *float64 `json:"rating,omitempty"`
}

// Genre is a flat genre list entry with its resolved "Parent > Child" path.
type Genre struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	ParentID string `json:"parentId,omitempty"`
	Path     string `json:"path"`
	Active   bool   `json:"active"`
}

// GenreNode is a node of the genre tree (v1's GenreNode shape: children is
// always present, possibly empty).
type GenreNode struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	ParentID string       `json:"parentId,omitempty"`
	Path     string       `json:"path"`
	Active   bool         `json:"active"`
	Children []*GenreNode `json:"children"`
}

// YearCount is one entry of the years list: a distinct year of in-scope
// active songs and how many songs carry it. (v1 returned bare year values
// without counts; the v2 spec asks for counts.)
type YearCount struct {
	Year      int `json:"year"`
	SongCount int `json:"songCount"`
}
