package opensubsonic

// Subsonic/OpenSubsonic DTOs. These are wire shapes, not domain types: the
// XML mapping follows the old xml-js compact conventions (quirks doc E6/E7) —
// scalar fields render as attributes, nested structs/slices as child
// elements (slices repeat their element), a Value field renders as element
// text. JSON mirrors the old response objects field for field, including the
// legacy aliases and duplicated keys Subsonic clients depend on.

// Entry is an {id, name} pair: an artist/composer attached to a song or
// album through its junction table (the old inline {id, name} objects).
type Entry struct {
	ID   string `xml:"id,attr" json:"id"`
	Name string `xml:"name,attr" json:"name"`
}

// NamedRef is a bare {name} reference (OpenSubsonic genres arrays).
type NamedRef struct {
	Name string `xml:"name,attr" json:"name"`
}

// ReplayGain is the OpenSubsonic replayGain object. the retired server learned that a bare
// number here crashes strict clients (py-opensonic / Music Assistant), so
// the object shape is contractual (quirks doc X4).
type ReplayGain struct {
	TrackGain float64 `xml:"trackGain,attr" json:"trackGain"`
}

// Song is the Subsonic "Child" shape for a music track (old
// toOpenSubsonicSong, quirks doc X1-X11). Fields the retired-server mapper always
// emits (even empty) carry no omitempty; conditionally-emitted fields do.
type Song struct {
	ID                 string  `xml:"id,attr" json:"id"`
	Parent             string  `xml:"parent,attr" json:"parent"`
	Title              string  `xml:"title,attr" json:"title"`
	Album              string  `xml:"album,attr" json:"album"`
	AlbumID            string  `xml:"albumId,attr" json:"albumId"`
	Artist             string  `xml:"artist,attr" json:"artist"`
	ArtistID           string  `xml:"artistId,attr" json:"artistId"`
	Artists            []Entry `xml:"artists" json:"artists"`
	AlbumArtists       []Entry `xml:"albumArtists" json:"albumArtists"`
	DisplayArtist      string  `xml:"displayArtist,attr" json:"displayArtist"`
	DisplayAlbumArtist string  `xml:"displayAlbumArtist,attr" json:"displayAlbumArtist"`
	DisplayTitle       string  `xml:"displayTitle,attr" json:"displayTitle"`
	Duration           int     `xml:"duration,attr" json:"duration"`
	IsDir              bool    `xml:"isDir,attr" json:"isDir"`
	IsVideo            bool    `xml:"isVideo,attr" json:"isVideo"`
	CoverArt           string  `xml:"coverArt,attr" json:"coverArt"`
	Created            string  `xml:"created,attr" json:"created"`
	Path               string  `xml:"path,attr" json:"path"`
	Size               int64   `xml:"size,attr" json:"size"`
	Suffix             string  `xml:"suffix,attr" json:"suffix"`
	ContentType        string  `xml:"contentType,attr" json:"contentType"`
	Type               string  `xml:"type,attr" json:"type"`

	Track        *int       `xml:"track,attr,omitempty" json:"track,omitempty"`
	DiscNumber   *int       `xml:"discNumber,attr,omitempty" json:"discNumber,omitempty"`
	Year         *int       `xml:"year,attr,omitempty" json:"year,omitempty"`
	Genre        string     `xml:"genre,attr,omitempty" json:"genre,omitempty"`
	Genres       []NamedRef `xml:"genres" json:"genres,omitempty"`
	BitRate      *int       `xml:"bitRate,attr,omitempty" json:"bitRate,omitempty"`
	BitDepth     *int       `xml:"bitDepth,attr,omitempty" json:"bitDepth,omitempty"`
	SamplingRate *int       `xml:"samplingRate,attr,omitempty" json:"samplingRate,omitempty"`
	ChannelCount *int       `xml:"channelCount,attr,omitempty" json:"channelCount,omitempty"`
	BPM          *int       `xml:"bpm,attr,omitempty" json:"bpm,omitempty"`

	MusicBrainzID      string `xml:"musicBrainzId,attr,omitempty" json:"musicBrainzId,omitempty"`
	MusicBrainzTrackID string `xml:"musicBrainzTrackId,attr,omitempty" json:"musicBrainzTrackId,omitempty"`
	MusicBrainzWorkID  string `xml:"musicBrainzWorkId,attr,omitempty" json:"musicBrainzWorkId,omitempty"`
	MusicBrainzDiscID  string `xml:"musicBrainzDiscId,attr,omitempty" json:"musicBrainzDiscId,omitempty"`

	ReplayGain          *ReplayGain `xml:"replayGain" json:"replayGain,omitempty"`
	AverageRating       *float64    `xml:"averageRating,attr,omitempty" json:"averageRating,omitempty"`
	Comment             string      `xml:"comment,attr,omitempty" json:"comment,omitempty"`
	SortName            string      `xml:"sortName,attr,omitempty" json:"sortName,omitempty"`
	Mood                string      `xml:"mood,attr,omitempty" json:"mood,omitempty"`
	MediaType           string      `xml:"mediaType,attr,omitempty" json:"mediaType,omitempty"`
	OriginalReleaseDate string      `xml:"originalReleaseDate,attr,omitempty" json:"originalReleaseDate,omitempty"`
	ReleaseDate         string      `xml:"releaseDate,attr,omitempty" json:"releaseDate,omitempty"`
	RemixOf             string      `xml:"remixOf,attr,omitempty" json:"remixOf,omitempty"`

	Composers []string `xml:"composers" json:"composers,omitempty"`
	Producers []string `xml:"producers" json:"producers,omitempty"`
	// ISRCs and its legacy alias ISRC carry the same values; Music Assistant
	// reads isrc, the OpenSubsonic spec says isrcs (quirks doc X5).
	ISRCs []string `xml:"isrcs" json:"isrcs,omitempty"`
	ISRC  []string `xml:"isrc" json:"isrc,omitempty"`

	OriginalYear   *int   `xml:"originalYear,attr,omitempty" json:"originalYear,omitempty"`
	OriginalArtist string `xml:"originalArtist,attr,omitempty" json:"originalArtist,omitempty"`
	Gapless        bool   `xml:"gapless,attr,omitempty" json:"gapless,omitempty"`
	TrackCount     *int   `xml:"trackCount,attr,omitempty" json:"trackCount,omitempty"`
	DiscCount      *int   `xml:"discCount,attr,omitempty" json:"discCount,omitempty"`

	// Per-user interaction state; populated only for authenticated callers
	// (quirks doc X14). Starred is the fabricated epoch date (X6).
	PlayCount  *int     `xml:"playCount,attr,omitempty" json:"playCount,omitempty"`
	Starred    string   `xml:"starred,attr,omitempty" json:"starred,omitempty"`
	UserRating *float64 `xml:"userRating,attr,omitempty" json:"userRating,omitempty"`
}

// Album is the Subsonic album shape (the old toOpenSubsonicAlbum, quirks doc
// X13). Title and Album duplicate Name, and Parent/ArtistID fall back
// through the artist entries — all deliberate client-compat behavior.
type Album struct {
	ID        string  `xml:"id,attr" json:"id"`
	Name      string  `xml:"name,attr" json:"name"`
	Title     string  `xml:"title,attr" json:"title"`
	Album     string  `xml:"album,attr" json:"album"`
	Artist    string  `xml:"artist,attr" json:"artist"`
	ArtistID  string  `xml:"artistId,attr" json:"artistId"`
	Artists   []Entry `xml:"artists" json:"artists"`
	CoverArt  string  `xml:"coverArt,attr" json:"coverArt"`
	IsDir     bool    `xml:"isDir,attr" json:"isDir"`
	IsVideo   bool    `xml:"isVideo,attr" json:"isVideo"`
	Parent    string  `xml:"parent,attr" json:"parent"`
	SongCount int     `xml:"songCount,attr" json:"songCount"`
	Duration  int     `xml:"duration,attr" json:"duration"`
	Created   string  `xml:"created,attr" json:"created"`

	Year          *int       `xml:"year,attr,omitempty" json:"year,omitempty"`
	Genre         string     `xml:"genre,attr,omitempty" json:"genre,omitempty"`
	Genres        []NamedRef `xml:"genres" json:"genres,omitempty"`
	Song          []Song     `xml:"song" json:"song,omitempty"`
	AverageRating *float64   `xml:"averageRating,attr,omitempty" json:"averageRating,omitempty"`

	OriginalYear   *int     `xml:"originalYear,attr,omitempty" json:"originalYear,omitempty"`
	Compilation    bool     `xml:"compilation,attr,omitempty" json:"compilation,omitempty"`
	Labels         []string `xml:"labels" json:"labels,omitempty"`
	CatalogNumbers []string `xml:"catalogNumbers" json:"catalogNumbers,omitempty"`
	Barcode        string   `xml:"barcode,attr,omitempty" json:"barcode,omitempty"`
	ASIN           string   `xml:"asin,attr,omitempty" json:"asin,omitempty"`

	MusicBrainzID             string   `xml:"musicBrainzId,attr,omitempty" json:"musicBrainzId,omitempty"`
	MusicBrainzReleaseGroupID string   `xml:"musicBrainzReleaseGroupId,attr,omitempty" json:"musicBrainzReleaseGroupId,omitempty"`
	MusicBrainzArtistIDs      []string `xml:"musicBrainzArtistIds" json:"musicBrainzArtistIds,omitempty"`

	TrackCount *int `xml:"trackCount,attr,omitempty" json:"trackCount,omitempty"`
	DiscCount  *int `xml:"discCount,attr,omitempty" json:"discCount,omitempty"`

	Starred    string   `xml:"starred,attr,omitempty" json:"starred,omitempty"`
	UserRating *float64 `xml:"userRating,attr,omitempty" json:"userRating,omitempty"`
}

// Artist is the Subsonic artist shape used by getArtists, getIndexes,
// search3 and getArtistInfo2 (the old toOpenSubsonicArtist; the Go server fixes the old B7
// divergence by using this one DTO everywhere).
type Artist struct {
	ID             string   `xml:"id,attr" json:"id"`
	Name           string   `xml:"name,attr" json:"name"`
	CoverArt       string   `xml:"coverArt,attr" json:"coverArt"`
	AlbumCount     int      `xml:"albumCount,attr" json:"albumCount"`
	ArtistImageURL string   `xml:"artistImageUrl,attr,omitempty" json:"artistImageUrl,omitempty"`
	MusicBrainzIDs []string `xml:"musicBrainzIds" json:"musicBrainzIds,omitempty"`

	Starred    string   `xml:"starred,attr,omitempty" json:"starred,omitempty"`
	UserRating *float64 `xml:"userRating,attr,omitempty" json:"userRating,omitempty"`
}

// Genre is one getGenres entry. Value renders as element text in XML
// (`<genre songCount="3">Rock</genre>`, quirks doc E6), which is why it is
// a chardata field rather than an attribute.
type Genre struct {
	Value      string `xml:",chardata" json:"value"`
	AlbumCount int    `xml:"albumCount,attr" json:"albumCount"`
	SongCount  int    `xml:"songCount,attr" json:"songCount"`
}

// User is the getUser response body (the old system.ts role matrix, quirks doc
// S4/S5). Folder lists the caller's scoped library ids — the retired server hardcoded
// ["0"], the Go server reports the real scope.
type User struct {
	Username          string   `xml:"username,attr" json:"username"`
	AdminRole         bool     `xml:"adminRole,attr" json:"adminRole"`
	CommentRole       bool     `xml:"commentRole,attr" json:"commentRole"`
	CoverArtRole      bool     `xml:"coverArtRole,attr" json:"coverArtRole"`
	DownloadRole      bool     `xml:"downloadRole,attr" json:"downloadRole"`
	Folder            []string `xml:"folder" json:"folder"`
	JukeboxRole       bool     `xml:"jukeboxRole,attr" json:"jukeboxRole"`
	PlaylistRole      bool     `xml:"playlistRole,attr" json:"playlistRole"`
	PodcastRole       bool     `xml:"podcastRole,attr" json:"podcastRole"`
	ScrobblingEnabled bool     `xml:"scrobblingEnabled,attr" json:"scrobblingEnabled"`
	SettingsRole      bool     `xml:"settingsRole,attr" json:"settingsRole"`
	ShareRole         bool     `xml:"shareRole,attr" json:"shareRole"`
	StreamRole        bool     `xml:"streamRole,attr" json:"streamRole"`
	UploadRole        bool     `xml:"uploadRole,attr" json:"uploadRole"`

	MaxBitRate      *int    `xml:"maxBitRate,attr,omitempty" json:"maxBitRate,omitempty"`
	TranscodeFormat *string `xml:"transcodeFormat,attr,omitempty" json:"transcodeFormat,omitempty"`
}
