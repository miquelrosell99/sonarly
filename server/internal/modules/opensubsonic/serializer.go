package opensubsonic

import (
	"encoding/json"
	"math"
	"mime"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// epochStarred is the fabricated star timestamp v1 emitted for starred
// entities (toStarredDate; quirks doc X6) — no real star time is stored.
const epochStarred = "1970-01-01T00:00:00.000Z"

// createdLayout renders mtimes the way JS Date.toISOString() does
// (milliseconds, Z), which is what v1 put in `created` fields.
const createdLayout = "2006-01-02T15:04:05.000Z"

// SongSource is the songs-table row shape the Subsonic song serializer
// needs (v1 SongRow plus its joined display names, library path and
// per-user interactions). P9 endpoint queries fill it; the mapper itself
// is pure and unit-testable.
type SongSource struct {
	ID          string
	Title       string
	AlbumID     *string
	ArtistID    *string
	TrackNumber *int
	DiscNumber  *int
	Genre       *string
	Year        *int
	Duration    *int
	CoverArtID  *string
	MtimeMillis int64
	FilePath    string
	LibraryPath *string

	BitRate       *int // bits/sec in the DB; Subsonic wants kbps
	BitsPerSample *int
	SampleRate    *int
	Channels      *int
	BPM           *int

	MusicBrainzID      *string
	MusicBrainzTrackID *string
	MusicBrainzWorkID  *string
	MusicBrainzDiscID  *string

	ReplayGain    *float64
	AverageRating *float64
	Comment       *string
	SortName      *string
	Mood          *string
	MediaType     *string

	OriginalReleaseDate *string
	ReleaseDate         *string
	RemixOf             *string
	DisplayArtist       *string
	DisplayAlbumArtist  *string

	AlbumName  *string
	ArtistName *string

	ProducersJSON *string // JSON array column
	ISRCsJSON     *string // JSON array column

	OriginalYear   *int
	OriginalArtist *string
	Gapless        bool
	TotalTracks    *string
	TotalDiscs     *string

	// Per-user interactions; Starred/Rating/PlayCount stay unset for
	// anonymous callers (the mapper gates on forUser, quirks doc X14).
	Starred   bool
	Rating    *float64
	PlayCount *int
}

// AlbumSource is the albums-table row shape for the album serializer (v1
// AlbumRow plus interactions). CatalogNumbersJSON and
// MusicBrainzAlbumArtistIDsJSON are JSON array columns.
type AlbumSource struct {
	ID                            string
	Name                          string
	ArtistID                      *string
	ArtistName                    *string
	CoverArtID                    *string
	Year                          *int
	Genre                         *string
	CatalogNumbersJSON            *string
	Barcode                       *string
	ASIN                          *string
	MusicBrainzAlbumID            *string
	MusicBrainzReleaseGroupID     *string
	MusicBrainzAlbumArtistIDsJSON *string
	OriginalYear                  *int
	Compilation                   bool
	TotalTracks                   *string
	TotalDiscs                    *string

	AverageRating *float64
	Starred       bool
	Rating        *float64
}

// ArtistSource is the artists-table row shape for the artist serializer.
type ArtistSource struct {
	ID                 string
	Name               string
	ArtistImageURL     *string
	MusicBrainzIDsJSON *string
	AlbumCount         int
	Starred            bool
	Rating             *float64
}

// MapSong ports v1's toOpenSubsonicSong (quirks doc X1-X11). artistEntries
// are the song_artists junction entries; when empty the mapper falls back
// to the song's primary artist. forUser gates the interaction fields.
func MapSong(src SongSource, artistEntries, composerEntries []Entry, genreNames []string, forUser bool) Song {
	artists := artistEntries
	if len(artists) == 0 && src.ArtistID != nil {
		artists = []Entry{{ID: *src.ArtistID, Name: stringOr(src.ArtistName)}}
	}
	joined := joinNames(artists)
	displayArtist := nullishString(src.DisplayArtist, joined)
	displayAlbumArtist := nullishString(src.DisplayAlbumArtist, joined)

	genreName := firstString(genreNames)
	if genreName == "" {
		genreName = stringOr(src.Genre)
	}
	genres := namedRefs(genreNames)
	if len(genres) == 0 && genreName != "" {
		genres = []NamedRef{{Name: genreName}}
	}

	song := Song{
		ID:                 src.ID,
		Parent:             stringOr(src.AlbumID),
		Title:              src.Title,
		Album:              stringOr(src.AlbumName),
		AlbumID:            stringOr(src.AlbumID),
		Artist:             joined,
		ArtistID:           firstID(artists, src.ArtistID),
		Artists:            nonNilEntries(artists),
		AlbumArtists:       nonNilEntries(artists),
		DisplayArtist:      displayArtist,
		DisplayAlbumArtist: displayAlbumArtist,
		DisplayTitle:       nullishString(src.SortName, src.Title),
		Duration:           maxDuration(src.Duration),
		IsDir:              false,
		IsVideo:            false,
		CoverArt:           coverArtOr(src.CoverArtID, src.AlbumID),
		Created:            time.UnixMilli(src.MtimeMillis).UTC().Format(createdLayout),
		Path:               relativePath(src.FilePath, src.LibraryPath),
		Size:               fileSize(src.FilePath),
		Suffix:             fileSuffix(src.FilePath),
		ContentType:        contentType(src.MediaType, src.FilePath),
		Type:               "music",

		Track:      src.TrackNumber,
		DiscNumber: src.DiscNumber,
		Year:       src.Year,
		Genres:     genres,
	}
	if genreName != "" {
		song.Genre = genreName
	}

	if src.BitRate != nil && *src.BitRate > 0 {
		kbps := int(math.Round(float64(*src.BitRate) / 1000))
		song.BitRate = &kbps
	}
	if src.BitsPerSample != nil && *src.BitsPerSample > 0 {
		song.BitDepth = src.BitsPerSample
	}
	if src.SampleRate != nil && *src.SampleRate > 0 {
		song.SamplingRate = src.SampleRate
	}
	if src.Channels != nil && *src.Channels > 0 {
		song.ChannelCount = src.Channels
	}
	if src.BPM != nil && *src.BPM > 0 {
		bpm := int(math.Round(float64(*src.BPM)))
		song.BPM = &bpm
	}

	song.MusicBrainzID = stringOr(src.MusicBrainzID)
	song.MusicBrainzTrackID = stringOr(src.MusicBrainzTrackID)
	song.MusicBrainzWorkID = stringOr(src.MusicBrainzWorkID)
	song.MusicBrainzDiscID = stringOr(src.MusicBrainzDiscID)
	if src.ReplayGain != nil {
		song.ReplayGain = &ReplayGain{TrackGain: *src.ReplayGain}
	}
	if src.AverageRating != nil {
		song.AverageRating = src.AverageRating
	}
	song.Comment = stringOr(src.Comment)
	song.SortName = stringOr(src.SortName)
	song.Mood = stringOr(src.Mood)
	song.MediaType = stringOr(src.MediaType)
	if validDateString(src.OriginalReleaseDate) {
		song.OriginalReleaseDate = *src.OriginalReleaseDate
	}
	if validDateString(src.ReleaseDate) {
		song.ReleaseDate = *src.ReleaseDate
	}
	song.RemixOf = stringOr(src.RemixOf)

	if names := entryNames(composerEntries); len(names) > 0 {
		song.Composers = names
	}
	if producers := parseStringArray(src.ProducersJSON); len(producers) > 0 {
		song.Producers = producers
	}
	if isrcs := parseStringArray(src.ISRCsJSON); len(isrcs) > 0 {
		song.ISRCs = isrcs
		song.ISRC = isrcs
	}
	if src.OriginalYear != nil {
		song.OriginalYear = src.OriginalYear
	}
	song.OriginalArtist = stringOr(src.OriginalArtist)
	if src.Gapless {
		song.Gapless = true
	}
	song.TrackCount = jsParseInt(src.TotalTracks)
	song.DiscCount = jsParseInt(src.TotalDiscs)

	if forUser {
		if src.PlayCount != nil {
			song.PlayCount = src.PlayCount
		}
		if src.Starred {
			song.Starred = epochStarred
		}
		if src.Rating != nil {
			song.UserRating = src.Rating
		}
	}
	return song
}

// MapAlbum ports v1's toOpenSubsonicAlbum (quirks doc X13). songs are the
// album's song children (empty for list views); songCount nil falls back
// to len(songs). createdAt is the caller-computed newest-song-mtime ISO
// string; nil renders the epoch fallback exactly like v1.
func MapAlbum(src AlbumSource, songs []Song, duration int, forUser bool, artistEntries []Entry, genreNames []string, labelNames []string, songCount *int, createdAt *string) Album {
	artists := artistEntries
	if len(artists) == 0 && src.ArtistID != nil {
		artists = []Entry{{ID: *src.ArtistID, Name: stringOr(src.ArtistName)}}
	}
	joined := joinNames(artists)

	genreName := firstString(genreNames)
	if genreName == "" {
		genreName = stringOr(src.Genre)
	}
	genres := namedRefs(genreNames)
	if len(genres) == 0 && genreName != "" {
		genres = []NamedRef{{Name: genreName}}
	}

	count := 0
	if songCount != nil {
		count = *songCount
	} else {
		count = len(songs)
	}
	created := epochStarred // same epoch string shape v1 used for missing mtimes
	if createdAt != nil && *createdAt != "" {
		created = *createdAt
	}

	album := Album{
		ID:        src.ID,
		Name:      src.Name,
		Title:     src.Name,
		Album:     src.Name,
		Artist:    albumArtistName(joined, src.ArtistName),
		ArtistID:  firstID(artists, src.ArtistID),
		Artists:   nonNilEntries(artists),
		CoverArt:  coverArtOr(src.CoverArtID, &src.ID),
		IsDir:     true,
		IsVideo:   false,
		Parent:    firstID(artists, src.ArtistID),
		SongCount: count,
		Duration:  duration,
		Created:   created,
		Year:      src.Year,
		Genres:    genres,
		Song:      songs,
	}
	if genreName != "" {
		album.Genre = genreName
	}
	if src.AverageRating != nil {
		album.AverageRating = src.AverageRating
	}
	if src.OriginalYear != nil {
		album.OriginalYear = src.OriginalYear
	}
	if src.Compilation {
		album.Compilation = true
	}
	if len(labelNames) > 0 {
		album.Labels = labelNames
	}
	if catalogNumbers := parseStringArray(src.CatalogNumbersJSON); len(catalogNumbers) > 0 {
		album.CatalogNumbers = catalogNumbers
	}
	album.Barcode = stringOr(src.Barcode)
	album.ASIN = stringOr(src.ASIN)
	album.MusicBrainzID = stringOr(src.MusicBrainzAlbumID)
	album.MusicBrainzReleaseGroupID = stringOr(src.MusicBrainzReleaseGroupID)
	if mbArtistIDs := parseStringArray(src.MusicBrainzAlbumArtistIDsJSON); len(mbArtistIDs) > 0 {
		album.MusicBrainzArtistIDs = mbArtistIDs
	}
	album.TrackCount = jsParseInt(src.TotalTracks)
	album.DiscCount = jsParseInt(src.TotalDiscs)

	if forUser {
		if src.Starred {
			album.Starred = epochStarred
		}
		if src.Rating != nil {
			album.UserRating = src.Rating
		}
	}
	return album
}

// MapArtist ports v1's toOpenSubsonicArtist (quirks doc X15).
func MapArtist(src ArtistSource, forUser bool) Artist {
	artist := Artist{
		ID:             src.ID,
		Name:           src.Name,
		CoverArt:       src.ID,
		AlbumCount:     src.AlbumCount,
		ArtistImageURL: stringOr(src.ArtistImageURL),
	}
	if mbIDs := parseStringArray(src.MusicBrainzIDsJSON); len(mbIDs) > 0 {
		artist.MusicBrainzIDs = mbIDs
	}
	if forUser {
		if src.Starred {
			artist.Starred = epochStarred
		}
		if src.Rating != nil {
			artist.UserRating = src.Rating
		}
	}
	return artist
}

// relativePath strips the library root from a file path (quirks doc X1):
// the Subsonic `path` is always library-relative, falling back to the bare
// filename when no library root prefixes it — never the absolute path.
func relativePath(filePath string, libraryPath *string) string {
	if libraryPath != nil && *libraryPath != "" && strings.HasPrefix(filePath, *libraryPath) {
		if rel, err := filepath.Rel(*libraryPath, filePath); err == nil {
			return rel
		}
	}
	return filepath.Base(filePath)
}

// fileSuffix lowercases the extension without the dot.
func fileSuffix(filePath string) string {
	return strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))
}

// contentType mirrors v1: stored media type wins, then mime-by-extension,
// then audio/mpeg.
func contentType(mediaType *string, filePath string) string {
	if mediaType != nil && *mediaType != "" {
		return *mediaType
	}
	if mt := mime.TypeByExtension(filepath.Ext(filePath)); mt != "" {
		return mt
	}
	return "audio/mpeg"
}

// fileSize stats the file at serialize time, returning 0 when it vanished
// (v1 statSync-in-try/catch parity, quirks doc X9).
func fileSize(filePath string) int64 {
	info, err := os.Stat(filePath)
	if err != nil {
		return 0
	}
	return info.Size()
}

// maxDuration implements v1's Math.max(1, round(duration ?? 0)): missing
// or zero durations surface as 1 (quirks doc X3).
func maxDuration(d *int) int {
	if d == nil || *d <= 0 {
		return 1
	}
	return *d
}

// validDateString ports v1's isValidDateString guard (quirks doc X11):
// denylist of zero-dates plus a parseability check. The parse accepts the
// ISO-shaped strings taggers actually store; JS Date's full grammar is not
// reproduced (documented approximation).
func validDateString(s *string) bool {
	if s == nil || *s == "" {
		return false
	}
	v := *s
	if v == "0000" || v == "0000-00-00" || v == "0000-00-00T00:00:00" {
		return false
	}
	if _, err := time.Parse("2006", v); err == nil {
		return true
	}
	if _, err := time.Parse("2006-01", v); err == nil {
		return true
	}
	if _, err := time.Parse("2006-01-02", v); err == nil {
		return true
	}
	if _, err := time.Parse(time.RFC3339, v); err == nil {
		return true
	}
	return false
}

// parseStringArray is v1's guarded JSON-array parse (quirks doc X10/X12):
// malformed JSON or non-string items are dropped, never fatal — v2 applies
// this guard to every JSON column, fixing v1's unguarded 500s.
func parseStringArray(value *string) []string {
	if value == nil || *value == "" {
		return nil
	}
	var parsed []any
	if err := json.Unmarshal([]byte(*value), &parsed); err != nil {
		return nil
	}
	out := make([]string, 0, len(parsed))
	for _, item := range parsed {
		if s, ok := item.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

// jsParseInt reproduces v1's parseInt(String(x), 10) for the total_tracks /
// total_discs string columns: leading whitespace, optional sign, digits up
// to the first non-digit; anything else is NaN → omitted (quirks doc X13).
func jsParseInt(value *string) *int {
	if value == nil {
		return nil
	}
	s := strings.TrimLeft(*value, " \t\n\r")
	i := 0
	if i < len(s) && (s[i] == '+' || s[i] == '-') {
		i++
	}
	start := i
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i == start {
		return nil
	}
	n, err := strconv.Atoi(s[:i])
	if err != nil {
		return nil
	}
	return &n
}

// albumArtistName implements v1's `(join(entries) || album.artist_name) ?? ”`.
func albumArtistName(joined string, primary *string) string {
	if joined != "" {
		return joined
	}
	return stringOr(primary)
}

func stringOr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// nullishString reproduces JavaScript `value ?? fallback`: only a nil
// pointer falls back, an empty string is kept.
func nullishString(s *string, fallback string) string {
	if s == nil {
		return fallback
	}
	return *s
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func namedRefs(names []string) []NamedRef {
	if len(names) == 0 {
		return nil
	}
	out := make([]NamedRef, len(names))
	for i, name := range names {
		out[i] = NamedRef{Name: name}
	}
	return out
}

func joinNames(entries []Entry) string {
	names := make([]string, len(entries))
	for i, e := range entries {
		names[i] = e.Name
	}
	return strings.Join(names, " / ")
}

func entryNames(entries []Entry) []string {
	if len(entries) == 0 {
		return nil
	}
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.Name
	}
	return out
}

func nonNilEntries(entries []Entry) []Entry {
	if entries == nil {
		return []Entry{}
	}
	return entries
}

// firstID returns the first entry's id, falling back to the primary artist
// column, then "" (v1's artists[0]?.id ?? artist_id ?? ”).
func firstID(entries []Entry, primary *string) string {
	if len(entries) > 0 {
		return entries[0].ID
	}
	return stringOr(primary)
}

// coverArtOr mirrors v1's coverArt fallbacks: song prefers its own art then
// the album id; album prefers its own art then the album id.
func coverArtOr(own *string, fallback *string) string {
	if own != nil && *own != "" {
		return *own
	}
	return stringOr(fallback)
}
