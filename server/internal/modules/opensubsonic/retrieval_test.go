package opensubsonic

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Fixtures: real corpus files on disk for the streaming/cover-art tiers.
// ---------------------------------------------------------------------------

// corpusDir holds the P4a audio corpus (real files with real tags and an
// embedded PNG picture in spike.mp3).
const corpusDir = "../../audio/testdata/corpus"

// seedFileLibrary copies a corpus file into a per-test library root and
// registers it as the given song id (rewriting the catalog fixture's file).
func (a *testApp) seedFileSong(t *testing.T, c catalogIDs, songID, corpusFile string) string {
	t.Helper()
	dir := t.TempDir()
	target := filepath.Join(dir, "music", songID+filepath.Ext(corpusFile))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(corpusDir, corpusFile))
	if err != nil {
		t.Fatalf("read corpus: %v", err)
	}
	if err := os.WriteFile(target, data, 0o644); err != nil {
		t.Fatalf("write corpus copy: %v", err)
	}
	a.exec(t, `UPDATE songs SET file_path = ? WHERE id = ?`, target, songID)
	return target
}

// ---------------------------------------------------------------------------
// stream.view / download.view (R1-R6)
// ---------------------------------------------------------------------------

func TestStreamDirect(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	target := app.seedFileSong(t, c, c.SAbbey1, "spike.mp3")

	rec := app.get(t, authedURL("/rest/stream.view", "&id="+c.SAbbey1), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("stream status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/mpeg" {
		t.Fatalf("content-type = %q", ct)
	}
	if ar := rec.Header().Get("Accept-Ranges"); ar != "bytes" {
		t.Fatalf("accept-ranges = %q", ar)
	}
	want, _ := os.ReadFile(target)
	if rec.Body.Len() != len(want) {
		t.Fatalf("streamed %d bytes, want %d", rec.Body.Len(), len(want))
	}
}

func TestStreamRangeAndInvalidRange(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	target := app.seedFileSong(t, c, c.SAbbey1, "spike.mp3")
	size := fileLen(t, target)

	rec := app.get(t, authedURL("/rest/stream.view", "&id="+c.SAbbey1), map[string]string{"Range": "bytes=0-99"})
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("range status = %d", rec.Code)
	}
	if cr := rec.Header().Get("Content-Range"); cr != fmt.Sprintf("bytes 0-99/%d", size) {
		t.Fatalf("content-range = %q", cr)
	}
	if rec.Body.Len() != 100 {
		t.Fatalf("range body = %d bytes", rec.Body.Len())
	}

	// R2: an unsatisfiable range is a plain-text 416.
	rec = app.get(t, authedURL("/rest/stream.view", "&id="+c.SAbbey1), map[string]string{"Range": fmt.Sprintf("bytes=%d-", size+10)})
	if rec.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("invalid range status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Invalid range") {
		t.Fatalf("invalid range body = %q", rec.Body.String())
	}
}

func TestStreamHead(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	target := app.seedFileSong(t, c, c.SAbbey1, "spike.mp3")

	// R4: HEAD on a direct-decision stream answers the full size, no body.
	rec := app.head(t, authedURL("/rest/stream.view", "&id="+c.SAbbey1), nil)
	if rec.Code != http.StatusOK || rec.Body.Len() != 0 {
		t.Fatalf("HEAD status=%d body=%d", rec.Code, rec.Body.Len())
	}
	if rec.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("HEAD accept-ranges = %q", rec.Header().Get("Accept-Ranges"))
	}
	if cl := rec.Header().Get("Content-Length"); cl != fmt.Sprintf("%d", fileLen(t, target)) {
		t.Fatalf("HEAD content-length = %q", cl)
	}
}

func TestStreamTranscodesViaPlaybackService(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	app.seedFileSong(t, c, c.SAbbey1, "spike.mp3")
	// User prefs: opus target (suffix mismatch → transcode) with a bitrate
	// cap (effective = min(requested, cap)) — libopus needs -b:a, not -q:a.
	app.exec(t, `UPDATE users SET transcode_format = 'opus', max_bitrate_kbps = 128 WHERE id = ?`, testUserID)

	rec := app.get(t, authedURL("/rest/stream.view", "&id="+c.SAbbey1), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("transcode status = %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/opus" {
		t.Fatalf("transcode content-type = %q", ct)
	}
	if ar := rec.Header().Get("Accept-Ranges"); ar != "none" {
		t.Fatalf("transcode accept-ranges = %q", ar)
	}
	// R6: the body is the raw ffmpeg muxer output — opus streams start with
	// the OggS container magic.
	if !strings.HasPrefix(rec.Body.String(), "OggS") {
		t.Fatalf("transcode body must be raw muxer output, got %q", rec.Body.String()[:16])
	}
}

func TestStreamMaxBitRateParam(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	app.seedFileSong(t, c, c.SAbbey1, "spike.mp3")

	// R5: maxBitRate below the source bitrate forces a transcode; the
	// default format for a bare maxBitRate is mp3.
	rec := app.get(t, authedURL("/rest/stream.view", "&id="+c.SAbbey1+"&maxBitRate=128"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("maxBitRate stream status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/mpeg" {
		t.Fatalf("maxBitRate content-type = %q", ct)
	}
	// An out-of-range maxBitRate is ignored (R5) → direct mp3 serving of
	// the full file.
	rec = app.get(t, authedURL("/rest/stream.view", "&id="+c.SAbbey1+"&maxBitRate=5"), nil)
	if cl := rec.Header().Get("Content-Length"); cl == "" || cl == "0" {
		t.Fatalf("invalid maxBitRate must be ignored (direct): headers %v", rec.Header())
	}
}

func TestStreamOutOfScopePlain404(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	app.seedFileSong(t, c, c.SLow1, "spike.mp3")

	// R1: alice cannot stream lib-b's song — plain-text 404, no envelope.
	rec := app.get(t, authedURL("/rest/stream.view", "&id="+c.SLow1), nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("out-of-scope stream status = %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "subsonic-response") {
		t.Fatalf("R1: binary endpoints never answer an envelope: %s", rec.Body.String())
	}
}

func TestStreamInactiveIs70(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	app.seedFileSong(t, c, c.SAbbey1, "spike.mp3")
	app.exec(t, `UPDATE songs SET active = 0 WHERE id = ?`, c.SAbbey1)

	// The playback service refuses inactive songs; the adapter boundary
	// surfaces that as the Subsonic data-not-found code.
	rec := app.get(t, authedURL("/rest/stream.view", "&id="+c.SAbbey1), nil)
	assertFailed(t, rec, CodeForbidden)
}

func TestStreamVanishedFileIs70(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	app.seedFileSong(t, c, c.SAbbey1, "spike.mp3")
	// The file vanishes between index and request.
	target := filepath.Join(t.TempDir(), "gone.mp3")
	app.exec(t, `UPDATE songs SET file_path = ? WHERE id = ?`, target, c.SAbbey1)

	// R3: a vanished file is a data error → enveloped 70.
	rec := app.get(t, authedURL("/rest/stream.view", "&id="+c.SAbbey1), nil)
	assertFailed(t, rec, CodeForbidden)
}

func TestStreamMissingIsPlain404(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/stream.view", "&id=nope"), nil)
	if rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "subsonic-response") {
		t.Fatalf("missing stream = %d %q", rec.Code, rec.Body.String())
	}
}

func TestStreamAnonymousIs10(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	app.seedFileSong(t, c, c.SAbbey1, "spike.mp3")

	rec := app.get(t, "/rest/stream.view?id="+c.SAbbey1, nil)
	assertFailed(t, rec, CodeMissingParam)
}

func TestStreamScopeAcrossAuthMethods(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedAPIKey(t, testAPIKey, testUserID)
	c := app.seedCatalog(t, "")
	app.seedFileSong(t, c, c.SLow1, "spike.mp3")
	cookie := app.sessionCookie(t, "sid-1", testUserID, testUser, false)

	// The scope is the principal's regardless of the credential method.
	rec := app.get(t, "/rest/stream.view?id="+c.SLow1+"&apiKey="+testAPIKey, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("apiKey scope: %d", rec.Code)
	}
	rec = app.get(t, "/rest/stream.view?id="+c.SLow1, nil, cookie)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cookie scope: %d", rec.Code)
	}
}

func TestDownloadDirect(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	target := app.seedFileSong(t, c, c.SAbbey1, "spike.mp3")
	app.exec(t, `UPDATE users SET transcode_format = 'opus' WHERE id = ?`, testUserID)

	rec := app.get(t, authedURL("/rest/download.view", "&id="+c.SAbbey1+"&maxBitRate=64"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("download status = %d", rec.Code)
	}
	// download.view never transcodes, even with prefs + maxBitRate: the
	// body is the untouched file.
	want, _ := os.ReadFile(target)
	if rec.Body.Len() != len(want) {
		t.Fatalf("download body = %d bytes, want %d (direct)", rec.Body.Len(), len(want))
	}
	cd := rec.Header().Get("Content-Disposition")
	if !strings.HasPrefix(cd, `attachment; filename="s-abbey-1.mp3"; filename*=UTF-8''`) {
		t.Fatalf("content-disposition = %q", cd)
	}
}

func TestDownloadScopeAndMissing(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	app.seedFileSong(t, c, c.SLow1, "spike.mp3")

	rec := app.get(t, authedURL("/rest/download.view", "&id="+c.SLow1), nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("out-of-scope download = %d", rec.Code)
	}
	rec = app.get(t, authedURL("/rest/download.view", "&id=nope"), nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing download = %d", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// getCoverArt (R7)
// ---------------------------------------------------------------------------

func TestGetCoverArtCachedBlob(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id="+c.CoverAbbey), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("coverArt status = %d", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != coverArtCacheControl {
		t.Fatalf("cache-control = %q", cc)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("content-type = %q", ct)
	}
	if rec.Body.String() != "fake-jpeg-bytes" {
		t.Fatalf("coverArt body = %q", rec.Body.String())
	}
}

func TestGetCoverArtCachedOutOfScope(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")
	// The blob is only referenced from lib-b's album → out of alice's scope.
	app.seedCoverArt(t, "ca-low", "image/png", []byte("low-art"))
	app.exec(t, `UPDATE albums SET cover_art_id = 'ca-low' WHERE id = 'al-low'`)

	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id=ca-low"), nil)
	env := assertFailed(t, rec, CodeForbidden)
	errObj := env["error"].(map[string]any)
	if errObj["message"] != "Cover art not found" {
		t.Fatalf("coverArt miss message = %v", errObj)
	}
}

func TestGetCoverArtSongTier(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	app.seedCoverArt(t, "ca-song", "image/png", []byte("song-art"))
	app.exec(t, `UPDATE songs SET cover_art_id = 'ca-song' WHERE id = ?`, c.SAbbey1)

	// Song id → its own art.
	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id="+c.SAbbey1), nil)
	if rec.Body.String() != "song-art" {
		t.Fatalf("song tier body = %q", rec.Body.String())
	}
}

func TestGetCoverArtEmbeddedPicture(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	target := app.seedFileSong(t, c, c.SAbbey1, "spike.mp3")
	_ = target

	// No cached art on the song → the embedded PNG is parsed on demand.
	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id="+c.SAbbey1), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("embedded tier status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("embedded tier content-type = %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != coverArtCacheControl {
		t.Fatalf("embedded tier cache-control = %q", cc)
	}
	if rec.Body.Len() == 0 {
		t.Fatal("embedded tier body empty")
	}
}

func TestGetCoverArtAlbumFirstSongFallback(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	// al-low has no cover_art_id of its own.
	app.seedFileSong(t, c, c.SLow1, "spike.mp3")

	// Album id without its own art → first song's embedded picture.
	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id="+c.AlLow), nil)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("album fallback: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
}

func TestGetCoverArtArtistLocalFile(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	img := filepath.Join(t.TempDir(), "artist.jpg")
	if err := os.WriteFile(img, []byte("jpg-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	app.exec(t, `UPDATE artists SET artist_image_local_path = ? WHERE id = ?`, img, c.ArBeatles)

	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id="+c.ArBeatles), nil)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("artist file tier: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if rec.Body.String() != "jpg-bytes" {
		t.Fatalf("artist file body = %q", rec.Body.String())
	}
}

func TestGetCoverArtArtistExternalRedirect(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	app.exec(t, `UPDATE artists SET artist_image_url = 'https://example.com/bowie.jpg' WHERE id = ?`, c.ArBowie)

	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id="+c.ArBowie), nil)
	if rec.Code != http.StatusFound {
		t.Fatalf("redirect status = %d", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "https://example.com/bowie.jpg" {
		t.Fatalf("redirect location = %q", loc)
	}
}

func TestGetCoverArtMissIs70(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id=nope"), nil)
	assertFailed(t, rec, CodeForbidden)
}

func TestGetCoverArtPlaylistTier(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	// R7 v2 delta: a playlist id resolves to the first album art behind its
	// visible songs — clients advertise coverArt=playlist.id and used to
	// hit 70 on every playlist (Feishin, Music Assistant).
	app.seedPlaylist(t, "pl-art", "Art Mix", testUserID, "private", c.SAbbey1)

	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id=pl-art"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("playlist tier status = %d", rec.Code)
	}
	if rec.Body.String() != "fake-jpeg-bytes" {
		t.Fatalf("playlist tier body = %q", rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != coverArtCacheControl {
		t.Fatalf("playlist tier cache-control = %q", cc)
	}
}

func TestGetCoverArtPlaylistTierFallsThroughAlbums(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	// The first album has no art of its own and its song file is gone
	// (synthetic path) → the tier must try the next distinct album.
	app.seedPlaylist(t, "pl-mixed", "Mixed", testUserID, "private", c.SLow1, c.SAbbey1)

	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id=pl-mixed"), nil)
	if rec.Code != http.StatusOK || rec.Body.String() != "fake-jpeg-bytes" {
		t.Fatalf("playlist fall-through: %d %q", rec.Code, rec.Body.String())
	}
}

func TestGetCoverArtPlaylistNoAccessIs70(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	// Root's private playlist: alice must get the same 70 as any unknown
	// id — CoverAlbums answers ErrNotFound and the tier falls through.
	app.seedPlaylist(t, "pl-secret", "Secret", c.Admin, "private", c.SAbbey1)

	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id=pl-secret"), nil)
	assertFailed(t, rec, CodeForbidden)
}

func TestGetCoverArtPlaylistEmptyIs70(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	app.seedCatalog(t, "")
	app.seedPlaylist(t, "pl-empty", "Empty", testUserID, "private")

	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id=pl-empty"), nil)
	assertFailed(t, rec, CodeForbidden)
}

// colorClose reports whether two channel values are within tolerance.
func colorClose(a, b uint32, tolerance int) bool {
	d := int(a) - int(b)
	return d <= tolerance && d >= -tolerance
}

// solidJPEG renders a solid-color JPEG the mosaic tests can decode back.
func solidJPEG(t *testing.T, c color.Color) []byte {	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for y := 0; y < 64; y++ {
		for x := 0; x < 64; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("encode fixture jpeg: %v", err)
	}
	return buf.Bytes()
}

// quadrantColor decodes a mosaic JPEG and samples the center of one 256px
// quadrant: 0=TL, 1=TR, 2=BL, 3=BR. The sample is normalized to RGBA — a
// decoded JPEG reports color.YCbCr, which prints confusingly raw.
func quadrantColor(t *testing.T, data []byte, quadrant int) color.RGBA {
	t.Helper()
	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("mosaic is not a decodable JPEG: %v", err)
	}
	if img.Bounds().Dx() != mosaicTile*2 || img.Bounds().Dy() != mosaicTile*2 {
		t.Fatalf("mosaic size = %dx%d, want %dx%d", img.Bounds().Dx(), img.Bounds().Dy(), mosaicTile*2, mosaicTile*2)
	}
	offset := [2]int{(quadrant % 2) * mosaicTile, (quadrant / 2) * mosaicTile}
	r, g, b, _ := img.At(offset[0]+mosaicTile/2, offset[1]+mosaicTile/2).RGBA()
	return color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8), 255}
}

func TestGetCoverArtPlaylistMosaic(t *testing.T) {
	app := newTestApp(t)
	// Admin: the fixture albums span lib-a and lib-b, and per-cover scope
	// checks (tier-1 parity) would drop the lib-b covers for a scoped user.
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")

	// Four albums with distinct solid covers; playlist order drives the grid.
	colors := []color.Color{
		color.RGBA{200, 30, 30, 255},  // TL
		color.RGBA{30, 180, 30, 255},  // TR
		color.RGBA{40, 60, 210, 255},  // BL
		color.RGBA{220, 200, 40, 255}, // BR
	}
	// The catalog ships three albums — seed a fourth so all four quadrants
	// are distinct covers.
	app.seedAlbum(t, "al-m4", "Fourth", c.ArBeatles, 2001)
	app.seedSong(t, songSeed{ID: "s-m4", Title: "Fourth", AlbumID: "al-m4",
		ArtistID: c.ArBeatles, LibraryID: c.LibA, Track: 1, Disc: 1, Duration: 100,
		Mtime: 1700000004000, FilePath: "/x/fourth.mp3"})
	songs := []string{c.SAbbey1, c.SLow1, c.SZiggy1, "s-m4"}
	albums := []string{c.AlAbbey, c.AlLow, c.AlZiggy, "al-m4"}
	// al-abbey ships with ca-abbey ("fake-jpeg-bytes", undecodable) — give it
	// a real one so all four quadrants come from the mosaic path.
	app.seedCoverArt(t, "ca-m-real", "image/jpeg", solidJPEG(t, colors[0]))
	app.exec(t, `UPDATE albums SET cover_art_id = 'ca-m-real' WHERE id = ?`, c.AlAbbey)
	for i := 1; i < 4; i++ {
		id := fmt.Sprintf("ca-m-%d", i)
		app.seedCoverArt(t, id, "image/jpeg", solidJPEG(t, colors[i]))
		app.exec(t, `UPDATE albums SET cover_art_id = ? WHERE id = ?`, id, albums[i])
	}
	app.seedPlaylist(t, "pl-mosaic", "Mosaic", testUserID, "private", songs...)

	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id=pl-mosaic"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("mosaic status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("mosaic content-type = %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != coverArtCacheControl {
		t.Fatalf("mosaic cache-control = %q", cc)
	}
	for q, want := range colors {
		got := quadrantColor(t, rec.Body.Bytes(), q)
		wr, wg, wb, _ := want.RGBA()
		if !colorClose(wr, uint32(got.R)<<8, 24<<8) || !colorClose(wg, uint32(got.G)<<8, 24<<8) || !colorClose(wb, uint32(got.B)<<8, 24<<8) {
			t.Fatalf("quadrant %d color = %v, want ~%v", q, got, want)
		}
	}
}

func TestGetCoverArtPlaylistMosaicTwoCoversFill(t *testing.T) {
	app := newTestApp(t)
	// Admin — the two fixture albums span lib-a and lib-b (see the
	// four-cover test above).
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")

	red := solidJPEG(t, color.RGBA{200, 30, 30, 255})
	green := solidJPEG(t, color.RGBA{30, 180, 30, 255})
	app.seedCoverArt(t, "ca-2a", "image/jpeg", red)
	app.seedCoverArt(t, "ca-2b", "image/jpeg", green)
	app.exec(t, `UPDATE albums SET cover_art_id = 'ca-2a' WHERE id = ?`, c.AlAbbey)
	app.exec(t, `UPDATE albums SET cover_art_id = 'ca-2b' WHERE id = ?`, c.AlLow)
	app.seedPlaylist(t, "pl-two", "Two", testUserID, "private", c.SAbbey1, c.SLow1)

	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id=pl-two"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("two-cover mosaic status = %d", rec.Code)
	}
	// SPA fillCoverAlbums cycles 2 covers into all four quadrants (ABAB).
	redWant := color.RGBA{200, 30, 30, 255}
	greenWant := color.RGBA{30, 180, 30, 255}
	for _, tc := range []struct {
		quadrant int
		want     color.RGBA
	}{
		{0, redWant}, {1, greenWant}, {2, redWant}, {3, greenWant},
	} {
		got := quadrantColor(t, rec.Body.Bytes(), tc.quadrant)
		wr, wg, wb, _ := tc.want.RGBA()
		if !colorClose(wr, uint32(got.R)<<8, 24<<8) || !colorClose(wg, uint32(got.G)<<8, 24<<8) || !colorClose(wb, uint32(got.B)<<8, 24<<8) {
			t.Fatalf("quadrant %d = %v, want ~%v (ABAB fill)", tc.quadrant, got, tc.want)
		}
	}
}

func TestGetCoverArtOutOfScopeSongIs70(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	app.seedFileSong(t, c, c.SLow1, "spike.mp3")

	rec := app.get(t, authedURL("/rest/getCoverArt.view", "&id="+c.SLow1), nil)
	assertFailed(t, rec, CodeForbidden)
}

// ---------------------------------------------------------------------------
// getLyrics (R8)
// ---------------------------------------------------------------------------

func TestGetLyricsByID(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	app.exec(t, `UPDATE songs SET lyrics = 'she came in through the bathroom window' WHERE id = ?`, c.SAbbey1)

	env := getOK(t, app, "/rest/getLyrics.view", "&id="+c.SAbbey1)
	lyrics := env["lyrics"].(map[string]any)
	if lyrics["value"] != "she came in through the bathroom window" {
		t.Fatalf("lyrics = %v", lyrics)
	}
	// No artist/title params → keys omitted.
	for _, k := range []string{"artist", "title"} {
		if _, present := lyrics[k]; present {
			t.Fatalf("%s must be omitted: %v", k, lyrics)
		}
	}
}

func TestGetLyricsOutOfScopeEmpty(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, false)
	c := app.seedCatalog(t, "")
	app.exec(t, `UPDATE songs SET lyrics = 'secret bowie lyrics' WHERE id = ?`, c.SLow1)

	// R8: the song exists but is out of scope → empty value, never the text.
	env := getOK(t, app, "/rest/getLyrics.view", "&id="+c.SLow1)
	if v := env["lyrics"].(map[string]any)["value"]; v != "" {
		t.Fatalf("out-of-scope lyrics = %q", v)
	}
}

func TestGetLyricsByArtistTitleNoCase(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	c := app.seedCatalog(t, "")
	app.exec(t, `UPDATE songs SET lyrics = 'wam bam thank you mam' WHERE id = ?`, c.SLow1)

	env := getOK(t, app, "/rest/getLyrics.view", "&artist=david+bowie&title=SPEED+of+life")
	lyrics := env["lyrics"].(map[string]any)
	if lyrics["value"] != "wam bam thank you mam" {
		t.Fatalf("lyrics = %v", lyrics)
	}
	if lyrics["artist"] != "david bowie" || lyrics["title"] != "SPEED of life" {
		t.Fatalf("echoed params = %v", lyrics)
	}
}

func TestGetLyricsAbsentEmptyStructure(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getLyrics.view", "&id=s-abbey-1")
	lyrics := env["lyrics"].(map[string]any)
	if lyrics["value"] != "" {
		t.Fatalf("absent lyrics = %v", lyrics)
	}
	// R8: the object wrapper is always present (a bare string breaks
	// py-opensonic).
	if _, present := env["lyrics"]; !present {
		t.Fatalf("lyrics object missing: %v", env)
	}
}

// ---------------------------------------------------------------------------
// getAvatar + radio/podcast stubs (R9 + the Go-server avatar decision: /rest
// getAvatar stays 404 even though native avatars exist — see retrieval.go)
// ---------------------------------------------------------------------------

func TestGetAvatarNotImplemented(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	rec := app.get(t, authedURL("/rest/getAvatar.view", ""), nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("avatar status = %d", rec.Code)
	}
}

func TestRadioAndPodcastStubs(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	env := getOK(t, app, "/rest/getInternetRadioStations.view", "")
	stations := env["internetRadioStations"].(map[string]any)["internetRadioStation"].([]any)
	if len(stations) != 0 {
		t.Fatalf("stations = %v", stations)
	}
	env = getOK(t, app, "/rest/getPodcasts.view", "")
	if ch := env["podcasts"].(map[string]any)["channel"].([]any); len(ch) != 0 {
		t.Fatalf("channels = %v", ch)
	}
	env = getOK(t, app, "/rest/getNewestPodcasts.view", "")
	if ep := env["newestPodcasts"].(map[string]any)["episode"].([]any); len(ep) != 0 {
		t.Fatalf("episodes = %v", ep)
	}
}

func TestRadioStubXMLomitsEmptyElements(t *testing.T) {
	app := newTestApp(t)
	app.seedUser(t, testUserID, testUser, testPass, true)
	app.seedCatalog(t, "")

	// E7: empty arrays produce no element in XML.
	rec := app.get(t, authedURL("/rest/getInternetRadioStations.view", "&f=xml"), nil)
	body := rec.Body.String()
	if strings.Contains(body, "<internetRadioStation>") {
		t.Fatalf("empty station element must be omitted (E7): %s", body)
	}
	if !strings.Contains(body, `<internetRadioStations></internetRadioStations>`) {
		t.Fatalf("stub container shape: %s", body)
	}
}

// ---------------------------------------------------------------------------
// Small request helpers
// ---------------------------------------------------------------------------

func fileLen(t *testing.T, path string) int64 {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	return info.Size()
}
