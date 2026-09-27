package playback

import (
	"archive/zip"
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/miquelrosell99/sonarly/server/internal/modules/auth"
	"github.com/miquelrosell99/sonarly/server/internal/modules/ingest"
	"github.com/miquelrosell99/sonarly/server/internal/modules/libraries"
)

// maxDownloadBatch caps one ZIP pack request; larger batches are a 400.
const maxDownloadBatch = 1000

// downloadSong is the slice of the songs row the packer needs: display
// metadata for the archive path plus the on-disk location.
type downloadSong struct {
	id       string
	filePath string
	title    string
	track    *int // nil = no track number (the archive name omits the prefix)
	artist   string
	album    string
	ext      string
}

// DownloadZip answers POST /api/download: packs the requested songs into a
// streaming ZIP archive. Signed-in callers get every active, in-scope song
// whose file still exists; anonymous callers must carry a playlist share
// token whose link opted into downloads (share_download = 1) and receive
// only the token's granted songs. Every filter is silent — unknown,
// out-of-scope, inactive, or vanished songs simply drop out — except two
// terminal cases answered before anything is written: an over-cap batch or
// an empty packable set is a 400, and an anonymous request without a usable
// grant is 401/404 (the loadPlayableSong contract, so tokens cannot be
// probed).
//
// The archive streams: entry paths are built per song
// ({artist} - {album}/{track:02d} - {title}.{ext}, each segment sanitized
// with the organizer's rules, collision-safe " (n)" suffixes) and files are
// copied into the response as they are read. A file that vanishes mid-pack
// is skipped; a read failure after the first byte is logged and ends the
// pack cleanly — the response is already committed by then.
func (s *Service) DownloadZip(w http.ResponseWriter, r *http.Request, id auth.Identity, songIDs []string, shareToken string) error {
	if len(songIDs) > maxDownloadBatch {
		return invalidBody(fmt.Sprintf("at most %d songs per download", maxDownloadBatch))
	}
	unique := dedupSongIDs(songIDs)

	var (
		songs []*downloadSong
		err   error
	)
	if id.UserID == "" {
		songs, err = s.loadTokenGrantedSongs(r.Context(), shareToken, unique)
	} else {
		songs, err = s.loadScopedSongs(r.Context(), id, unique)
	}
	if err != nil {
		return err
	}
	songs, err = s.filterExistingFiles(r.Context(), songs)
	if err != nil {
		return err
	}
	if len(songs) == 0 {
		return invalidBody("no downloadable songs")
	}

	filename := "sonarly-" + time.Now().Format("20060102-150405") + ".zip"
	h := w.Header()
	h.Set("Content-Type", "application/zip")
	h.Set("Content-Disposition", `attachment; filename="`+filename+`"`)

	zw := zip.NewWriter(w)
	defer zw.Close()
	used := map[string]int{}
	for _, song := range songs {
		if err := s.packSong(zw, song, used); err != nil {
			// Read/write failure after bytes have flowed: the response is
			// committed, so log and stop rather than double-write an error.
			s.log.ErrorContext(r.Context(), "download pack failed mid-archive",
				"song", song.id, "file", song.filePath, "err", err.Error())
			return nil
		}
	}
	return nil
}

// dedupSongIDs collapses repeat ids keeping first-seen order, so the archive
// preserves the caller's sequence without duplicate entries.
func dedupSongIDs(ids []string) []string {
	seen := make(map[string]bool, len(ids))
	unique := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != "" && !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	return unique
}

// loadScopedSongs resolves the session caller's packable set: active,
// in-library-scope songs with display metadata, in request order.
func (s *Service) loadScopedSongs(ctx context.Context, id auth.Identity, ids []string) ([]*downloadSong, error) {
	scope, err := libraries.GetScope(ctx, s.db, id.UserID, id.IsAdmin)
	if err != nil {
		return nil, err
	}
	return s.loadDownloadSongs(ctx, ids, &scope)
}

// loadTokenGrantedSongs resolves the anonymous packable set: the token's
// playlist must permit downloads (404 otherwise — indistinguishable from an
// unknown token, per the no-probing contract), and only ids the token
// grants are kept; zero granted ids answer 404. Library scope does not
// apply to token viewers (the old share semantics — the token authorizes
// the linked playlist's own content).
func (s *Service) loadTokenGrantedSongs(ctx context.Context, token string, ids []string) ([]*downloadSong, error) {
	if token == "" {
		return nil, ErrUnauthorized
	}
	allowed, err := s.policy.TokenAllowsDownload(ctx, s.db, token)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrNotFound
	}
	granted := make([]string, 0, len(ids))
	for _, songID := range ids {
		ok, err := s.policy.TokenGrantsSong(ctx, s.db, token, songID)
		if err != nil {
			return nil, err
		}
		if ok {
			granted = append(granted, songID)
		}
	}
	if len(granted) == 0 {
		return nil, ErrNotFound
	}
	return s.loadDownloadSongs(ctx, granted, nil)
}

// loadDownloadSongs loads display metadata for ids, chunked under SQLite's
// variable limit, restoring request order. scope nil means "already
// authorized" (the token path). Missing metadata falls back to the
// organizer's Unknown-* names so every entry has a complete path.
func (s *Service) loadDownloadSongs(ctx context.Context, ids []string, scope *libraries.Scope) ([]*downloadSong, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	byID := make(map[string]*downloadSong, len(ids))
	const chunk = 500
	for i := 0; i < len(ids); i += chunk {
		part := ids[i:min(i+chunk, len(ids))]
		placeholders := make([]string, len(part))
		args := make([]any, 0, len(part)+8)
		for j, sid := range part {
			placeholders[j] = "?"
			args = append(args, sid)
		}
		cond := `s.active = 1 AND s.id IN (` + strings.Join(placeholders, ", ") + `)`
		if scope != nil {
			scopeCond := libraries.ScopeCondition(*scope, "s.library_id")
			cond += " " + scopeCond.SQL
			args = append(args, scopeCond.Params...)
		}
		rows, err := s.db.QueryContext(ctx, `
			SELECT s.id, s.file_path, s.title, s.track_number,
			       COALESCE(ar.name, 'Unknown Artist'), COALESCE(a.name, 'Unknown Album')
			FROM songs s
			LEFT JOIN artists ar ON ar.id = s.artist_id
			LEFT JOIN albums a ON a.id = s.album_id
			WHERE `+cond, args...)
		if err != nil {
			return nil, fmt.Errorf("load download songs: %w", err)
		}
		for rows.Next() {
			var song downloadSong
			var track sql.NullInt64
			if err := rows.Scan(&song.id, &song.filePath, &song.title, &track,
				&song.artist, &song.album); err != nil {
				rows.Close()
				return nil, fmt.Errorf("load download songs: %w", err)
			}
			if track.Valid {
				t := int(track.Int64)
				song.track = &t
			}
			song.ext = strings.ToLower(strings.TrimPrefix(filepath.Ext(song.filePath), "."))
			byID[song.id] = &song
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("load download songs: %w", err)
		}
		rows.Close()
	}
	out := make([]*downloadSong, 0, len(byID))
	for _, sid := range ids {
		if song, ok := byID[sid]; ok {
			out = append(out, song)
		}
	}
	return out, nil
}

// filterExistingFiles drops songs whose file is already gone (or is a
// directory) before the first byte is written, so an all-vanished request
// answers the honest 400 instead of an empty archive. A file that vanishes
// AFTER this check is the pack-time race packSong skips mid-archive.
func (s *Service) filterExistingFiles(ctx context.Context, songs []*downloadSong) ([]*downloadSong, error) {
	out := make([]*downloadSong, 0, len(songs))
	for _, song := range songs {
		info, err := os.Stat(song.filePath)
		if err != nil || info.IsDir() {
			s.log.InfoContext(ctx, "download: skipping vanished file", "song", song.id, "file", song.filePath)
			continue
		}
		out = append(out, song)
	}
	return out, nil
}

// packSong appends one file to the archive. A missing/unreadable file is
// skipped gracefully (the row outlived the file); entry-creation and copy
// failures are returned — by then the response is committed and the caller
// ends the pack.
func (s *Service) packSong(zw *zip.Writer, song *downloadSong, used map[string]int) error {
	f, err := os.Open(song.filePath)
	if err != nil {
		s.log.Info("download: skipping vanished file", "song", song.id, "file", song.filePath)
		return nil
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		return nil
	}
	name := zipEntryName(song, used)
	hdr := &zip.FileHeader{Name: name, Method: zip.Deflate, Modified: st.ModTime()}
	wr, err := zw.CreateHeader(hdr)
	if err != nil {
		return fmt.Errorf("create zip entry %s: %w", name, err)
	}
	if _, err := io.Copy(wr, f); err != nil {
		return fmt.Errorf("pack %s: %w", name, err)
	}
	return nil
}

// zipEntryName builds the archive path {artist} - {album}/{track:02d} -
// {title}.{ext}. Every segment goes through the organizer's Sanitize
// (forbidden characters become "_", whitespace collapses, one trailing dot
// dropped, empty becomes "_"); missing metadata already fell back to the
// Unknown-* names at load, and a missing track number omits the numeric
// prefix. Collisions (same album + same formatted name + same extension)
// get " (1)", " (2)", ... suffixes before the extension, the organizer's
// collision convention.
func zipEntryName(song *downloadSong, used map[string]int) string {
	folder := ingest.Sanitize(song.artist) + " - " + ingest.Sanitize(song.album)
	file := ingest.Sanitize(song.title)
	if song.track != nil {
		file = fmt.Sprintf("%02d - %s", *song.track, file)
	}
	base := folder + "/" + file
	name := base + "." + song.ext
	for counter := 1; used[name] > 0; counter++ {
		name = fmt.Sprintf("%s (%d).%s", base, counter, song.ext)
	}
	used[name] = 1
	return name
}

// streamDownloadGate enforces the share_download flag on the anonymous
// download path: a token whose link has not opted in answers 404 (the
// song-level grant alone is not enough to fetch binaries). Plain streaming
// never consults this.
func (s *Service) streamDownloadGate(ctx context.Context, shareToken string) error {
	allowed, err := s.policy.TokenAllowsDownload(ctx, s.db, shareToken)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrNotFound
	}
	return nil
}
