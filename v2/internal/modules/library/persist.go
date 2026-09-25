// Persist is the ONE data path for writing a song and everything it
// references: artists/genres/labels get-or-create, the album row and its
// junctions, the song upsert (average_rating excluded — the v1 B4 fix lives
// here), junction rewrites, and cover-art hash dedup + links. It was
// extracted from the scanner (P4b) so the ingest pipeline writes through the
// exact same code — the audit's "one data path" principle: a song imported
// by a scan and a song imported by ingest produce identical rows.
//
// PersistSong runs everything in ONE transaction per song (v1 was
// multi-statement autocommit; a crash mid-song could leave partial rows).
// Merge modes implement v1's persistSong options for duplicate handling
// (aggregate / replacePresentOnly / keepCoverArt).
package library

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/miquelrosell99/sonarly/v2/internal/audio"
)

// execer abstracts *sql.DB and *sql.Tx so the ensure-* helpers run inside
// the per-song transaction.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

type albumMeta struct {
	barcode          string
	asin             string
	mbAlbumID        string
	mbReleaseGroupID string
	mbAlbumArtistIDs []string
	compilation      *bool
	releaseType      string
	totalTracks      int
	totalDiscs       int
}

// PersistMerge carries v1's persistSong merge options. The zero value means
// "full replace" (scanner behavior). The combinations the duplicate
// strategies use:
//
//   - replace_file_and_metadata:      zero PersistMerge
//   - replace_file_aggregate_metadata: {Aggregate: true}
//   - keep_file_replace_metadata:      {ReplacePresentOnly: true, KeepCoverArt: true}
//   - keep_file_aggregate_metadata:    {Aggregate: true, KeepCoverArt: true}
type PersistMerge struct {
	// Aggregate unions artist/genre/composer junctions and producers/isrcs
	// with the existing row's; scalar fields the new metadata leaves absent
	// keep their existing values.
	Aggregate bool
	// ReplacePresentOnly keeps existing values where the new metadata leaves
	// a field absent, but lists are NOT unioned: a present new list replaces,
	// an absent one leaves the existing rows untouched.
	ReplacePresentOnly bool
	// KeepCoverArt pins the song's cover link (and cover_art_missing) to the
	// existing row's and skips the album-cover reconciliation — the existing
	// file keeps its embedded art under every keep-file strategy.
	KeepCoverArt bool
}

// merging reports whether v1's merge path applies (both modes merge scalars;
// only the list handling differs).
func (m PersistMerge) merging() bool { return m.Aggregate || m.ReplacePresentOnly }

// PersistInput is one song write. ExistingID reuses a row (re-scan,
// move/replace detection, duplicate strategies); nil imports a new song.
type PersistInput struct {
	ExistingID *string
	Path       string
	Meta       *audio.Metadata
	Mtime      int64 // Unix milliseconds, v1 mtimeMs
	Checksum   string
	LibraryID  *string
	Merge      PersistMerge
}

// PersistSong writes one song and everything it references in a single
// transaction and returns the song id. See the package doc for the write
// set. The caller's context threads into every statement, so cancellation
// rolls the whole song back.
func PersistSong(ctx context.Context, db *sql.DB, in PersistInput) (string, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin song tx: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			tx.Rollback()
		}
	}()

	songID, err := persistSongTx(ctx, tx, in)
	if err != nil {
		return "", err
	}

	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit song tx: %w", err)
	}
	committed = true
	return songID, nil
}

// persistSongTx is the transactional body of PersistSong, callable from an
// outer transaction.
func persistSongTx(ctx context.Context, ex execer, in PersistInput) (string, error) {
	meta := in.Meta

	// Song artists, with per-index MusicBrainz ids (v1 parity).
	artistNames := artistNames(meta)
	var artistIDs []string
	for i, name := range artistNames {
		var mbids []string
		if i < len(meta.MBIDArtistIDs) && meta.MBIDArtistIDs[i] != "" {
			mbids = []string{meta.MBIDArtistIDs[i]}
		}
		id, err := ensureArtist(ctx, ex, name, mbids)
		if err != nil {
			return "", err
		}
		artistIDs = append(artistIDs, id)
	}
	var primaryArtistID *string
	if len(artistIDs) > 0 {
		primaryArtistID = &artistIDs[0]
	}

	albumArtistNames := albumArtistNames(meta, artistNames)
	var albumArtistIDs []string
	for _, name := range albumArtistNames {
		id, err := ensureArtist(ctx, ex, name, nil)
		if err != nil {
			return "", err
		}
		albumArtistIDs = append(albumArtistIDs, id)
	}

	var composerIDs []string
	for _, name := range meta.Composers {
		id, err := ensureArtist(ctx, ex, name, nil)
		if err != nil {
			return "", err
		}
		composerIDs = append(composerIDs, id)
	}

	var genreIDs []string
	for _, name := range meta.Genres {
		id, err := ensureGenre(ctx, ex, name)
		if err != nil {
			return "", err
		}
		genreIDs = append(genreIDs, id)
	}

	var albumID *string
	if trimmed := strings.TrimSpace(meta.Album); trimmed != "" {
		am := albumMeta{
			barcode:          meta.Barcode,
			asin:             meta.ASIN,
			mbAlbumID:        meta.MBIDRelease,
			mbReleaseGroupID: meta.MBIDReleaseGroup,
			compilation:      meta.Compilation,
			releaseType:      normalizeReleaseType(meta.ReleaseType),
			totalTracks:      meta.TrackTotal,
			totalDiscs:       meta.DiscTotal,
		}
		if meta.MBIDAlbumArtist != "" {
			am.mbAlbumArtistIDs = []string{meta.MBIDAlbumArtist}
		}
		id, err := ensureAlbum(ctx, ex, trimmed, albumArtistNames, albumArtistIDs, meta.Year, meta.Genres, genreIDs, meta.Labels, am)
		if err != nil {
			return "", err
		}
		albumID = &id
	}

	// Cover art: hash-dedup blob, album seeded from the first song carrying
	// embedded art (v1 behavior). Album seeding happens even under
	// KeepCoverArt (v1 parity).
	var ownCoverID *string
	if meta.HasCoverArt && meta.Picture != nil {
		id, err := ensureCoverArt(ctx, ex, meta.Picture)
		if err != nil {
			return "", err
		}
		ownCoverID = &id
		if albumID != nil {
			albumCover, err := albumCoverArtID(ctx, ex, *albumID)
			if err != nil {
				return "", err
			}
			if albumCover == nil {
				if err := setAlbumCoverArtID(ctx, ex, *albumID, ownCoverID); err != nil {
					return "", err
				}
			}
		}
	}

	songID := uuid.NewString()
	var existingData *songData
	if in.ExistingID != nil {
		// Always load the existing row: its cover link is the starting point
		// for every reuse (re-scan, move/replace target, duplicate merge).
		loaded, err := songDataByID(ctx, ex, *in.ExistingID)
		if err != nil {
			return "", err
		}
		existingData = loaded
		songID = *in.ExistingID
	}

	// Song cover link: the existing row's link survives a reuse unless
	// overwritten; otherwise the link follows the album cover (v1 embedded
	// the album cover INTO the file; v2 reconciles the link only — scans
	// never mutate audio files).
	var songCoverID *string
	coverArtMissing := !meta.HasCoverArt
	switch {
	case in.Merge.KeepCoverArt && existingData != nil:
		songCoverID = existingData.coverArtID
		coverArtMissing = existingData.coverArtMissing
	case existingData != nil:
		songCoverID = existingData.coverArtID
	}

	if albumID != nil && !(in.Merge.KeepCoverArt && existingData != nil) {
		albumCover, err := albumCoverArtID(ctx, ex, *albumID)
		if err != nil {
			return "", err
		}
		if albumCover != nil && (songCoverID == nil || *songCoverID != *albumCover) {
			songCoverID = albumCover
		}
	}
	if songCoverID == nil {
		songCoverID = ownCoverID
	}

	song := songData{
		id:                 songID,
		filePath:           in.Path,
		title:              meta.Title,
		trackNo:            zeroNil(meta.TrackNo),
		discNo:             zeroNil(meta.DiscNo),
		duration:           zeroNil(int(math.Round(meta.Properties.Duration))),
		artistID:           primaryArtistID,
		albumID:            albumID,
		genre:              firstNil(meta.Genres),
		genreID:            firstPtr(genreIDs),
		libraryID:          in.LibraryID,
		year:               zeroNil(meta.Year),
		explicit:           meta.Explicit != nil && *meta.Explicit,
		coverArtID:         songCoverID,
		coverArtMissing:    coverArtMissing,
		mtime:              in.Mtime,
		checksum:           in.Checksum,
		bitRate:            zeroNil(meta.Properties.Bitrate),
		bitsPerSample:      zeroNil(meta.Properties.BitsPerSample),
		sampleRate:         zeroNil(meta.Properties.SampleRate),
		channels:           zeroNil(meta.Properties.Channels),
		bpm:                zeroNil(meta.BPM),
		mbid:               emptyNil(meta.MBIDRecording),
		replayGain:         zeroNilF(meta.ReplayGainTrack),
		comment:            emptyNil(meta.Comment),
		mediaType:          mediaTypeFor(in.Path),
		lyrics:             emptyNil(meta.Lyrics),
		syncedLyrics:       meta.SyncedLyrics,
		producers:          meta.Producers,
		isrcs:              meta.ISRCs,
		displayArtist:      emptyNil(meta.Artist),
		displayAlbumArtist: emptyNil(firstOf(meta.AlbumArtists, meta.AlbumArtist)),
		totalTracks:        countText(meta.TrackTotal),
		totalDiscs:         countText(meta.DiscTotal),
	}

	var finalArtistIDs, finalGenreIDs, finalComposerIDs []string
	if existingData != nil && in.Merge.merging() {
		song = mergeSongData(song, *existingData, meta, in.Merge)
		artists, genres, composers, err := mergeJunctions(ctx, ex, songID, artistIDs, genreIDs, composerIDs, in.Merge)
		if err != nil {
			return "", err
		}
		finalArtistIDs, finalGenreIDs, finalComposerIDs = artists, genres, composers
	} else {
		// Full replace (scanner path): junctions are rewritten
		// unconditionally so tags that DROP a value actually drop rows.
		finalArtistIDs, finalGenreIDs, finalComposerIDs = artistIDs, genreIDs, composerIDs
	}

	if err := upsertSong(ctx, ex, song); err != nil {
		return "", err
	}

	// Junction rewrites, all inside the song's tx. Under a merge with an
	// absent new list, final*IDs stays nil and the existing rows are left
	// untouched (v1 persistSong only rewrote non-empty lists in that path).
	if finalArtistIDs != nil {
		if err := setJunction(ctx, ex, "song_artists", "song_id", "artist_id", songID, finalArtistIDs); err != nil {
			return "", err
		}
	}
	if finalGenreIDs != nil {
		if err := setJunction(ctx, ex, "song_genres", "song_id", "genre_id", songID, finalGenreIDs); err != nil {
			return "", err
		}
	}
	if finalComposerIDs != nil {
		if err := setJunction(ctx, ex, "song_composers", "song_id", "artist_id", songID, finalComposerIDs); err != nil {
			return "", err
		}
	}

	return songID, nil
}

// ---------------------------------------------------------------------------
// Merge (v1 persistSong options: aggregate / replacePresentOnly)
// ---------------------------------------------------------------------------

// mergeSongData folds the existing row's values into the new song row under
// a merge: every field the new metadata leaves absent keeps its existing
// value; mtime and checksum always come from the new write (callers pass the
// right ones — keep-file strategies pass the existing file's); title falls
// back to the existing title when the new one is empty (v1 `||`).
func mergeSongData(next, existing songData, meta *audio.Metadata, m PersistMerge) songData {
	next.trackNo = orPtr(next.trackNo, existing.trackNo)
	next.discNo = orPtr(next.discNo, existing.discNo)
	next.duration = orPtr(next.duration, existing.duration)
	next.artistID = orPtr(next.artistID, existing.artistID)
	next.albumID = orPtr(next.albumID, existing.albumID)
	next.genre = orPtr(next.genre, existing.genre)
	next.genreID = orPtr(next.genreID, existing.genreID)
	next.libraryID = orPtr(next.libraryID, existing.libraryID)
	next.year = orPtr(next.year, existing.year)
	if meta.Explicit == nil {
		next.explicit = existing.explicit
	}
	next.bitRate = orPtr(next.bitRate, existing.bitRate)
	next.bitsPerSample = orPtr(next.bitsPerSample, existing.bitsPerSample)
	next.sampleRate = orPtr(next.sampleRate, existing.sampleRate)
	next.channels = orPtr(next.channels, existing.channels)
	next.bpm = orPtr(next.bpm, existing.bpm)
	next.mbid = orPtr(next.mbid, existing.mbid)
	next.replayGain = orPtr(next.replayGain, existing.replayGain)
	next.comment = orPtr(next.comment, existing.comment)
	next.mediaType = orPtr(next.mediaType, existing.mediaType)
	next.lyrics = orPtr(next.lyrics, existing.lyrics)
	next.syncedLyrics = orSync(next.syncedLyrics, existing.syncedLyrics)
	next.displayArtist = orPtr(next.displayArtist, existing.displayArtist)
	next.displayAlbumArtist = orPtr(next.displayAlbumArtist, existing.displayAlbumArtist)
	next.totalTracks = orPtr(next.totalTracks, existing.totalTracks)
	next.totalDiscs = orPtr(next.totalDiscs, existing.totalDiscs)
	if next.title == "" {
		next.title = existing.title
	}
	if m.Aggregate {
		next.producers = unionStrings(next.producers, existing.producers)
		next.isrcs = unionStrings(next.isrcs, existing.isrcs)
	} else {
		if len(next.producers) == 0 {
			next.producers = existing.producers
		}
		if len(next.isrcs) == 0 {
			next.isrcs = existing.isrcs
		}
	}
	// coverArtID / coverArtMissing were resolved before the merge (they need
	// album context); mtime and checksum always reflect the new write.
	return next
}

// mergeJunctions computes the junction membership for a merged write.
// Aggregate unions existing rows with the new list (existing first, v1
// unionIds); ReplacePresentOnly replaces with the new list when present.
// An absent new list yields nil, meaning "leave the junction untouched".
func mergeJunctions(ctx context.Context, ex execer, songID string, artistIDs, genreIDs, composerIDs []string, m PersistMerge) (artists, genres, composers []string, err error) {
	merge := func(table, member string, newIDs []string) ([]string, error) {
		if len(newIDs) == 0 {
			return nil, nil
		}
		if !m.Aggregate {
			return newIDs, nil
		}
		existing, err := junctionIDs(ctx, ex, table, member, songID)
		if err != nil {
			return nil, err
		}
		return unionStrings(existing, newIDs), nil
	}
	artists, err = merge("song_artists", "artist_id", artistIDs)
	if err != nil {
		return nil, nil, nil, err
	}
	genres, err = merge("song_genres", "genre_id", genreIDs)
	if err != nil {
		return nil, nil, nil, err
	}
	composers, err = merge("song_composers", "artist_id", composerIDs)
	if err != nil {
		return nil, nil, nil, err
	}
	return artists, genres, composers, nil
}

// junctionIDs loads one junction table's member ids for a song in position
// order. table/member are hardcoded identifiers at call sites.
func junctionIDs(ctx context.Context, ex execer, table, member, songID string) ([]string, error) {
	rows, err := ex.QueryContext(ctx, fmt.Sprintf(`SELECT %s FROM %s WHERE song_id = ? ORDER BY position`, member, table), songID)
	if err != nil {
		return nil, fmt.Errorf("load %s: %w", table, err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("load %s: %w", table, err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load %s: %w", table, err)
	}
	return ids, nil
}

// unionStrings returns a ∪ b, a's order first, de-duplicated (v1 unionIds /
// unionArrays).
func unionStrings(a, b []string) []string {
	if len(a) == 0 {
		return b
	}
	if len(b) == 0 {
		return a
	}
	seen := make(map[string]bool, len(a)+len(b))
	out := make([]string, 0, len(a)+len(b))
	for _, v := range a {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	for _, v := range b {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func orPtr[T any](next, existing *T) *T {
	if next != nil {
		return next
	}
	return existing
}

func orSync(next, existing []audio.SyncedLyricLine) []audio.SyncedLyricLine {
	if len(next) > 0 {
		return next
	}
	return existing
}

// ---------------------------------------------------------------------------
// Row helpers (all run on the given execer — inside the song tx when called
// from persist)
// ---------------------------------------------------------------------------

// songData carries the columns the persist path writes. Columns the v2
// metadata reader does not extract (sort_name, mood, the date/remix/
// original* family, track/work/disc MBIDs) stay NULL — the upsert below
// never touches them. average_rating is deliberately absent: user ratings
// must survive rescans.
type songData struct {
	id                 string
	filePath           string
	title              string
	trackNo            *int
	discNo             *int
	duration           *int
	artistID           *string
	albumID            *string
	genre              *string
	genreID            *string
	libraryID          *string
	year               *int
	explicit           bool
	coverArtID         *string
	coverArtMissing    bool
	mtime              int64
	checksum           string
	bitRate            *int
	bitsPerSample      *int
	sampleRate         *int
	channels           *int
	bpm                *int
	mbid               *string
	replayGain         *float64
	comment            *string
	mediaType          *string
	lyrics             *string
	syncedLyrics       []audio.SyncedLyricLine
	producers          []string
	isrcs              []string
	displayArtist      *string
	displayAlbumArtist *string
	totalTracks        *string
	totalDiscs         *string
}

// songDataColumns mirrors the songData field order for SELECT and UPSERT.
const songDataColumns = `id, file_path, title, track_number, disc_number, duration, artist_id, album_id,
	genre, genre_id, library_id, year, explicit, cover_art_id, cover_art_missing, mtime, checksum,
	bit_rate, bits_per_sample, sample_rate, channels, bpm, music_brainz_id, replay_gain,
	comment, media_type, lyrics, synced_lyrics, producers, isrcs,
	display_artist, display_album_artist, total_tracks, total_discs`

func scanSongData(row interface{ Scan(...any) error }) (*songData, error) {
	var s songData
	var explicit, coverMissing int
	var syncedLyrics, producers, isrcs *string
	if err := row.Scan(&s.id, &s.filePath, &s.title, &s.trackNo, &s.discNo, &s.duration, &s.artistID, &s.albumID,
		&s.genre, &s.genreID, &s.libraryID, &s.year, &explicit, &s.coverArtID, &coverMissing, &s.mtime, &s.checksum,
		&s.bitRate, &s.bitsPerSample, &s.sampleRate, &s.channels, &s.bpm, &s.mbid, &s.replayGain,
		&s.comment, &s.mediaType, &s.lyrics, &syncedLyrics, &producers, &isrcs,
		&s.displayArtist, &s.displayAlbumArtist, &s.totalTracks, &s.totalDiscs); err != nil {
		return nil, err
	}
	s.explicit = explicit == 1
	s.coverArtMissing = coverMissing == 1
	if syncedLyrics != nil {
		_ = json.Unmarshal([]byte(*syncedLyrics), &s.syncedLyrics)
	}
	if producers != nil {
		_ = json.Unmarshal([]byte(*producers), &s.producers)
	}
	if isrcs != nil {
		_ = json.Unmarshal([]byte(*isrcs), &s.isrcs)
	}
	return &s, nil
}

// songDataByID loads one song row into songData for merge reads.
func songDataByID(ctx context.Context, ex execer, id string) (*songData, error) {
	row := ex.QueryRowContext(ctx,
		fmt.Sprintf(`SELECT %s FROM songs WHERE id = ?`, songDataColumns), id)
	s, err := scanSongData(row)
	if err != nil {
		return nil, fmt.Errorf("load existing song %s: %w", id, err)
	}
	return s, nil
}

// upsertSong inserts or replaces a song row by id. The column list excludes
// average_rating entirely so a rescan can never reset user ratings (v1 B4).
func upsertSong(ctx context.Context, ex execer, s songData) error {
	explicit := 0
	if s.explicit {
		explicit = 1
	}
	coverMissing := 0
	if s.coverArtMissing {
		coverMissing = 1
	}
	values := `?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`
	assignments := `file_path = excluded.file_path, title = excluded.title,
		track_number = excluded.track_number, disc_number = excluded.disc_number, duration = excluded.duration,
		artist_id = excluded.artist_id, album_id = excluded.album_id, genre = excluded.genre, genre_id = excluded.genre_id,
		library_id = excluded.library_id, year = excluded.year, explicit = excluded.explicit,
		cover_art_id = excluded.cover_art_id, cover_art_missing = excluded.cover_art_missing,
		mtime = excluded.mtime, checksum = excluded.checksum, active = 1,
		bit_rate = excluded.bit_rate, bits_per_sample = excluded.bits_per_sample, sample_rate = excluded.sample_rate,
		channels = excluded.channels, bpm = excluded.bpm, music_brainz_id = excluded.music_brainz_id,
		replay_gain = excluded.replay_gain, comment = excluded.comment, media_type = excluded.media_type,
		lyrics = excluded.lyrics, synced_lyrics = excluded.synced_lyrics, producers = excluded.producers,
		isrcs = excluded.isrcs, display_artist = excluded.display_artist, display_album_artist = excluded.display_album_artist,
		total_tracks = excluded.total_tracks, total_discs = excluded.total_discs`
	query := fmt.Sprintf(`INSERT INTO songs (%s) VALUES (%s)
		ON CONFLICT(id) DO UPDATE SET %s`, songDataColumns, values, assignments)
	_, err := ex.ExecContext(ctx, query,
		s.id, s.filePath, s.title, val(s.trackNo), val(s.discNo), val(s.duration), val(s.artistID), val(s.albumID),
		val(s.genre), val(s.genreID), val(s.libraryID), val(s.year), explicit, val(s.coverArtID), coverMissing, s.mtime, s.checksum,
		val(s.bitRate), val(s.bitsPerSample), val(s.sampleRate), val(s.channels), val(s.bpm), val(s.mbid), val(s.replayGain),
		val(s.comment), val(s.mediaType), val(s.lyrics), marshalNil(s.syncedLyrics), marshalNil(s.producers), marshalNil(s.isrcs),
		val(s.displayArtist), val(s.displayAlbumArtist), val(s.totalTracks), val(s.totalDiscs))
	if err != nil {
		return fmt.Errorf("upsert song: %w", err)
	}
	return nil
}

func ensureArtist(ctx context.Context, ex execer, name string, mbids []string) (string, error) {
	trimmed := strings.TrimSpace(name)
	var id, existingMB string
	err := ex.QueryRowContext(ctx,
		`SELECT id, COALESCE(musicbrainz_artist_ids, '') FROM artists WHERE name = ? COLLATE NOCASE`,
		trimmed).Scan(&id, &existingMB)
	if err == nil {
		if len(mbids) > 0 {
			merged, changed, err := mergeMBIDs(existingMB, mbids)
			if err != nil {
				return "", fmt.Errorf("merge artist mbids: %w", err)
			}
			if changed {
				if _, err := ex.ExecContext(ctx,
					`UPDATE artists SET musicbrainz_artist_ids = ? WHERE id = ?`, merged, id); err != nil {
					return "", fmt.Errorf("update artist mbids: %w", err)
				}
			}
		}
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("load artist: %w", err)
	}
	id = uuid.NewString()
	if _, err := ex.ExecContext(ctx,
		`INSERT INTO artists (id, name) VALUES (?, ?)`, id, trimmed); err != nil {
		return "", fmt.Errorf("insert artist: %w", err)
	}
	if len(mbids) > 0 {
		raw, _ := json.Marshal(mbids)
		if _, err := ex.ExecContext(ctx,
			`UPDATE artists SET musicbrainz_artist_ids = ? WHERE id = ?`, string(raw), id); err != nil {
			return "", fmt.Errorf("set artist mbids: %w", err)
		}
	}
	return id, nil
}

func ensureGenre(ctx context.Context, ex execer, name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", errors.New("genre name cannot be empty")
	}
	var id string
	err := ex.QueryRowContext(ctx,
		`SELECT id FROM genres WHERE name = ? COLLATE NOCASE`, trimmed).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("load genre: %w", err)
	}
	id = uuid.NewString()
	if _, err := ex.ExecContext(ctx,
		`INSERT INTO genres (id, name) VALUES (?, ?)`, id, trimmed); err != nil {
		return "", fmt.Errorf("insert genre: %w", err)
	}
	return id, nil
}

func ensureLabel(ctx context.Context, ex execer, name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	var id string
	err := ex.QueryRowContext(ctx,
		`SELECT id FROM labels WHERE name = ? COLLATE NOCASE`, trimmed).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("load label: %w", err)
	}
	id = uuid.NewString()
	if _, err := ex.ExecContext(ctx,
		`INSERT INTO labels (id, name) VALUES (?, ?)`, id, trimmed); err != nil {
		return "", fmt.Errorf("insert label: %w", err)
	}
	return id, nil
}

// ensureAlbum ports v1's ensureAlbum: match by (name, primary artist), fill
// junctions and release metadata on first create, only add multi-value
// junctions and never overwrite release_type on later songs. All in the
// caller's tx.
func ensureAlbum(ctx context.Context, ex execer, name string, artistNames []string, artistIDs []string, year int, genreNames []string, genreIDs []string, labelNames []string, meta albumMeta) (string, error) {
	var primaryArtistID *string
	if len(artistIDs) > 0 {
		primaryArtistID = &artistIDs[0]
	}
	var id string
	row := ex.QueryRowContext(ctx,
		`SELECT id FROM albums WHERE name = ? COLLATE NOCASE AND artist_id IS ?`,
		name, primaryArtistID)
	err := row.Scan(&id)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("load album: %w", err)
	}
	if err == nil {
		if len(artistIDs) > 1 {
			if err := setJunction(ctx, ex, "album_artists", "album_id", "artist_id", id, artistIDs); err != nil {
				return "", err
			}
		}
		if len(genreIDs) > 1 {
			if err := setJunction(ctx, ex, "album_genres", "album_id", "genre_id", id, genreIDs); err != nil {
				return "", err
			}
		}
		if len(labelNames) > 0 {
			labelIDs, err := ensureLabels(ctx, ex, labelNames)
			if err != nil {
				return "", err
			}
			if err := setJunction(ctx, ex, "album_labels", "album_id", "label_id", id, labelIDs); err != nil {
				return "", err
			}
		}
		if meta.releaseType != "" {
			// Fill in from tags but never overwrite a user edit.
			if _, err := ex.ExecContext(ctx,
				`UPDATE albums SET release_type = ? WHERE id = ? AND release_type IS NULL`, meta.releaseType, id); err != nil {
				return "", fmt.Errorf("fill album release type: %w", err)
			}
		}
		return id, nil
	}

	id = uuid.NewString()
	var yearV any
	if year != 0 {
		yearV = year
	}
	var genreV any
	if len(genreNames) > 0 {
		genreV = genreNames[0]
	}
	var genreIDV any
	if len(genreIDs) > 0 {
		genreIDV = genreIDs[0]
	}
	var artistNameV any
	if len(artistNames) > 0 {
		artistNameV = strings.Join(artistNames, " / ")
	}
	var compilationV any
	if meta.compilation != nil {
		compilationV = 0
		if *meta.compilation {
			compilationV = 1
		}
	}
	_, err = ex.ExecContext(ctx,
		`INSERT INTO albums (id, name, artist_id, artist_name, year, genre, genre_id, active,
			barcode, asin, musicbrainz_album_id, musicbrainz_release_group_id, musicbrainz_album_artist_ids,
			compilation, total_tracks, total_discs, release_type)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, name, val(primaryArtistID), artistNameV, yearV, genreV, genreIDV,
		emptyNil(meta.barcode), emptyNil(meta.asin),
		emptyNil(meta.mbAlbumID), emptyNil(meta.mbReleaseGroupID), marshalNil(meta.mbAlbumArtistIDs),
		compilationV, countText(meta.totalTracks), countText(meta.totalDiscs), emptyNil(meta.releaseType))
	if err != nil {
		return "", fmt.Errorf("insert album: %w", err)
	}
	if len(artistIDs) > 0 {
		if err := setJunction(ctx, ex, "album_artists", "album_id", "artist_id", id, artistIDs); err != nil {
			return "", err
		}
	}
	if len(genreIDs) > 0 {
		if err := setJunction(ctx, ex, "album_genres", "album_id", "genre_id", id, genreIDs); err != nil {
			return "", err
		}
	}
	if len(labelNames) > 0 {
		labelIDs, err := ensureLabels(ctx, ex, labelNames)
		if err != nil {
			return "", err
		}
		if err := setJunction(ctx, ex, "album_labels", "album_id", "label_id", id, labelIDs); err != nil {
			return "", err
		}
	}
	return id, nil
}

func ensureLabels(ctx context.Context, ex execer, names []string) ([]string, error) {
	ids := make([]string, 0, len(names))
	for _, name := range names {
		id, err := ensureLabel(ctx, ex, name)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// setJunction deletes and reinserts a junction table's rows for one owner,
// preserving position order. table/owner/member are hardcoded identifiers at
// call sites; only values are bound.
func setJunction(ctx context.Context, ex execer, table, owner, member, ownerID string, memberIDs []string) error {
	if _, err := ex.ExecContext(ctx,
		fmt.Sprintf(`DELETE FROM %s WHERE %s = ?`, table, owner), ownerID); err != nil {
		return fmt.Errorf("clear %s: %w", table, err)
	}
	if len(memberIDs) == 0 {
		return nil
	}
	insert := fmt.Sprintf(`INSERT INTO %s (%s, %s, position) VALUES (?, ?, ?)`, table, owner, member)
	for position, memberID := range memberIDs {
		if _, err := ex.ExecContext(ctx, insert, ownerID, memberID, position); err != nil {
			return fmt.Errorf("insert %s: %w", table, err)
		}
	}
	return nil
}

// ensureCoverArt returns the id of the blob with this content (sha256
// hash-dedup, v1 createCoverArt), inserting it on first sight.
func ensureCoverArt(ctx context.Context, ex execer, pic *audio.Picture) (string, error) {
	sum := sha256.Sum256(pic.Data)
	hash := hex.EncodeToString(sum[:])
	var id string
	err := ex.QueryRowContext(ctx, `SELECT id FROM cover_arts WHERE hash = ?`, hash).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("load cover art: %w", err)
	}
	id = uuid.NewString()
	if _, err := ex.ExecContext(ctx,
		`INSERT INTO cover_arts (id, format, data, hash) VALUES (?, ?, ?, ?)`,
		id, pic.MIMEType, pic.Data, hash); err != nil {
		return "", fmt.Errorf("insert cover art: %w", err)
	}
	return id, nil
}

func albumCoverArtID(ctx context.Context, ex execer, albumID string) (*string, error) {
	var id *string
	if err := ex.QueryRowContext(ctx,
		`SELECT cover_art_id FROM albums WHERE id = ?`, albumID).Scan(&id); err != nil {
		return nil, fmt.Errorf("load album cover: %w", err)
	}
	return id, nil
}

func setAlbumCoverArtID(ctx context.Context, ex execer, albumID string, coverID *string) error {
	var v any
	if coverID != nil {
		v = *coverID
	}
	if _, err := ex.ExecContext(ctx,
		`UPDATE albums SET cover_art_id = ? WHERE id = ?`, v, albumID); err != nil {
		return fmt.Errorf("set album cover: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

func artistNames(meta *audio.Metadata) []string {
	if len(meta.Artists) > 0 {
		return meta.Artists
	}
	if meta.Artist != "" {
		return []string{meta.Artist}
	}
	return nil
}

func albumArtistNames(meta *audio.Metadata, songArtists []string) []string {
	if len(meta.AlbumArtists) > 0 {
		return meta.AlbumArtists
	}
	if meta.AlbumArtist != "" {
		return []string{meta.AlbumArtist}
	}
	return songArtists
}

func normalizeReleaseType(value string) string {
	trimmed := strings.ToLower(strings.TrimSpace(value))
	return trimmed
}

// mediaTypes mirrors v1's mime-types lookup for the four audio extensions;
// a static map keeps the mapping deterministic regardless of the host's
// /etc/mime.types.
var mediaTypes = map[string]string{
	".mp3":  "audio/mpeg",
	".flac": "audio/flac",
	".ogg":  "audio/ogg",
	".m4a":  "audio/mp4",
}

func mediaTypeFor(path string) *string {
	mt, ok := mediaTypes[strings.ToLower(filepath.Ext(path))]
	if !ok {
		return nil
	}
	return &mt
}

func zeroNil(v int) *int {
	if v == 0 {
		return nil
	}
	return &v
}

func zeroNilF(v float64) *float64 {
	if v == 0 {
		return nil
	}
	return &v
}

func emptyNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func firstNil(values []string) *string {
	for i, v := range values {
		if strings.TrimSpace(v) != "" {
			return &values[i]
		}
	}
	return nil
}

func firstPtr(ids []string) *string {
	if len(ids) == 0 {
		return nil
	}
	return &ids[0]
}

func firstOf(values []string, fallback ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	for _, v := range fallback {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func countText(v int) *string {
	if v <= 0 {
		return nil
	}
	s := strconv.Itoa(v)
	return &s
}

func marshalNil(v any) *string {
	switch values := v.(type) {
	case nil:
		return nil
	case []string:
		if len(values) == 0 {
			return nil
		}
	case []audio.SyncedLyricLine:
		if len(values) == 0 {
			return nil
		}
	}
	raw, err := json.Marshal(v)
	if err != nil || string(raw) == "null" {
		return nil
	}
	s := string(raw)
	return &s
}

// val converts a pointer into a driver value: nil for the zero pointer,
// the pointee otherwise. database/sql does not dereference pointer args.
func val[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

// mergeMBIDs unions stored MusicBrainz ids with newly seen ones; the second
// return reports whether the stored set changed.
func mergeMBIDs(stored string, add []string) (string, bool, error) {
	seen := map[string]bool{}
	var merged []string
	if stored != "" {
		var existing []string
		if err := json.Unmarshal([]byte(stored), &existing); err != nil {
			return "", false, fmt.Errorf("parse artist mbids: %w", err)
		}
		for _, id := range existing {
			if !seen[id] {
				seen[id] = true
				merged = append(merged, id)
			}
		}
	}
	changed := false
	for _, id := range add {
		if !seen[id] {
			seen[id] = true
			merged = append(merged, id)
			changed = true
		}
	}
	if !changed {
		return stored, false, nil
	}
	raw, err := json.Marshal(merged)
	if err != nil {
		return "", false, err
	}
	return string(raw), true, nil
}

// ---------------------------------------------------------------------------
// Exported wrappers for the ingest pipeline (the one data path's siblings)
// ---------------------------------------------------------------------------

// EnsureArtist returns the id of the artist row for name (get-or-create,
// case-insensitive), merging the given MusicBrainz ids on sight. The ingest
// pipeline's duplicate identity resolution uses it so a song looked up and
// a song persisted share artist rows.
func EnsureArtist(ctx context.Context, db *sql.DB, name string, mbids []string) (string, error) {
	return ensureArtist(ctx, db, name, mbids)
}

// ResolveLibraryIDForPath maps a file path to its library by exact path or
// prefix at a separator boundary, longest prefix winning, so /music does not
// claim /music2 (v1 parity; the organize-existing trap).
func ResolveLibraryIDForPath(ctx context.Context, db *sql.DB, path string) (*string, error) {
	return resolveLibraryID(ctx, db, path)
}

// ChecksumFile streams the file through SHA-256 (v1 computeChecksum).
func ChecksumFile(path string) (string, error) {
	return checksumFile(path)
}

// DefaultOrganizePattern matches the libraries table default and v1's
// ORGANIZE_PATTERN config default.
const DefaultOrganizePattern = "{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}"
