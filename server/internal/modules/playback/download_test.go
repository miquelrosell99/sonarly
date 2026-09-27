package playback

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"
)

// downloadRequest packs a POST /api/download body.
func downloadRequest(ids []string) string {
	body, err := json.Marshal(map[string]any{"songIds": ids})
	if err != nil {
		panic(err)
	}
	return string(body)
}

// unpackZip reads a ZIP archive response into name → content.
func unpackZip(t *testing.T, data []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open zip response: %v", err)
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open entry %s: %v", f.Name, err)
		}
		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("read entry %s: %v", f.Name, err)
		}
		out[f.Name] = content
	}
	return out
}

func zipNames(files map[string][]byte) []string {
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	return names
}

var zipDispositionRe = regexp.MustCompile(`^attachment; filename="sonarly-\d{8}-\d{6}\.zip"$`)

// TestDownloadZipContents: the pack streams a ZIP with organizer-sanitized
// {artist} - {album}/{track:02d} - {title}.{ext} entries whose bytes are the
// original files, under the timestamped Content-Disposition contract.
func TestDownloadZipContents(t *testing.T) {
	env := newEnv(t, Options{})
	env.mustExec(t, `UPDATE songs SET track_number = 1 WHERE id = 's-a1'`)
	env.mustExec(t, `UPDATE songs SET track_number = 2 WHERE id = 's-a2'`)
	alice := env.cookie(t, "user-alice", "alice", false)

	res, body := env.do(t, "POST", "/api/download", alice, downloadRequest([]string{"s-a1", "s-a2"}))
	if res.StatusCode != http.StatusOK {
		t.Fatalf("download: want 200, got %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "application/zip" {
		t.Errorf("Content-Type = %q", ct)
	}
	if disp := res.Header.Get("Content-Disposition"); !zipDispositionRe.MatchString(disp) {
		t.Errorf("Content-Disposition = %q", disp)
	}

	files := unpackZip(t, body)
	if len(files) != 2 {
		t.Fatalf("entries = %v", zipNames(files))
	}
	if !bytes.Equal(files["Alpha - A1/01 - One.mp3"], fileBytes(t, env.files["s-a1"])) {
		t.Error("s-a1 entry bytes != original file")
	}
	if !bytes.Equal(files["Alpha - A1/02 - Two.flac"], fileBytes(t, env.files["s-a2"])) {
		t.Error("s-a2 entry bytes != original file")
	}
}

// TestDownloadZipEntryNameEdges: fallback names, per-segment sanitization,
// missing-track prefix omission, and collision-safe suffixes.
func TestDownloadZipEntryNameEdges(t *testing.T) {
	used := map[string]int{}
	track := 7
	cases := []struct {
		name string
		song *downloadSong
		want string
	}{
		{"full", &downloadSong{artist: "Alpha", album: "A1", title: "One", track: &track, ext: "mp3"}, "Alpha - A1/07 - One.mp3"},
		{"no track omits prefix", &downloadSong{artist: "Alpha", album: "A1", title: "One", ext: "flac"}, "Alpha - A1/One.flac"},
		{"metadata fallbacks", &downloadSong{artist: "Unknown Artist", album: "Unknown Album", title: "Unknown Title", ext: "ogg"}, "Unknown Artist - Unknown Album/Unknown Title.ogg"},
		{"forbidden chars replaced", &downloadSong{artist: `A/B:C*D?`, album: `E"F<G>H|I`, title: `J\\K`, ext: "mp3"}, "A_B_C_D_ - E_F_G_H_I/J__K.mp3"},
		{"non-forbidden punctuation survives", &downloadSong{artist: "AC/DC", album: "B*Witched", title: "Really?!", ext: "mp3"}, "AC_DC - B_Witched/Really_!.mp3"},
		{"whitespace collapse + trailing dot", &downloadSong{artist: "  Alpha   Beta  ", album: "A1.", title: " One ", ext: "mp3"}, "Alpha Beta - A1/One.mp3"},
		{"empty segment becomes underscore", &downloadSong{artist: ".", album: "  ", title: "?", ext: "mp3"}, "_ - _/_.mp3"},
	}
	for _, tc := range cases {
		if got := zipEntryName(tc.song, used); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}

	// Collisions: same folder/name/ext get " (1)", " (2)"… — and a naturally
	// occurring " (1)" name occupies its slot, pushing the colliding song to
	// the next free suffix.
	colliding := &downloadSong{artist: "A", album: "B", title: "T", track: &track, ext: "mp3"}
	first := zipEntryName(colliding, used)
	second := zipEntryName(colliding, used)
	third := zipEntryName(colliding, used)
	if first != "A - B/07 - T.mp3" || second != "A - B/07 - T (1).mp3" || third != "A - B/07 - T (2).mp3" {
		t.Errorf("collision chain = %q, %q, %q", first, second, third)
	}
	fresh := map[string]int{}
	natural := zipEntryName(&downloadSong{artist: "A", album: "B", title: "T (1)", track: &track, ext: "mp3"}, fresh)
	if natural != "A - B/07 - T (1).mp3" {
		t.Errorf("natural (1) name = %q", natural)
	}
	one := zipEntryName(colliding, fresh)
	pushed := zipEntryName(colliding, fresh)
	if one != "A - B/07 - T.mp3" || pushed != "A - B/07 - T (2).mp3" {
		t.Errorf("collision against natural (1): got %q then %q, want %q then %q",
			one, pushed, "A - B/07 - T.mp3", "A - B/07 - T (2).mp3")
	}
}

// TestDownloadZipScopeFiltering: out-of-scope, inactive, and unknown ids are
// silently dropped; the admin scope packs everything incl. the NULL-library
// song, which exercises the Unknown-* path fallbacks.
func TestDownloadZipScopeFiltering(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)
	admin := env.cookie(t, "user-admin", "root", true)

	res, body := env.do(t, "POST", "/api/download", alice,
		downloadRequest([]string{"s-a1", "s-b1", "s-inactive", "s-nolib", "nope"}))
	if res.StatusCode != http.StatusOK {
		t.Fatalf("scoped download: want 200, got %d", res.StatusCode)
	}
	files := unpackZip(t, body)
	if len(files) != 1 {
		t.Fatalf("entries = %v, want only the in-scope song", zipNames(files))
	}
	if _, ok := files["Alpha - A1/One.mp3"]; !ok {
		t.Errorf("entries = %v", zipNames(files))
	}

	res, body = env.do(t, "POST", "/api/download", admin, downloadRequest([]string{"s-nolib"}))
	if res.StatusCode != http.StatusOK {
		t.Fatalf("admin download: %d", res.StatusCode)
	}
	files = unpackZip(t, body)
	if len(files) != 1 {
		t.Fatalf("entries = %v", zipNames(files))
	}
	if _, ok := files["Unknown Artist - Unknown Album/NoLib.flac"]; !ok {
		t.Errorf("fallback entry missing: %v", zipNames(files))
	}
}

// TestDownloadZipCapsAndEmpties: over-cap batches and empty packable sets
// answer 400 before anything is written.
func TestDownloadZipCapsAndEmpties(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)

	tooMany := make([]string, maxDownloadBatch+1)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("song-%d", i)
	}
	res, _ := env.do(t, "POST", "/api/download", alice, downloadRequest(tooMany))
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("over-cap batch: want 400, got %d", res.StatusCode)
	}

	res, _ = env.do(t, "POST", "/api/download", alice, downloadRequest(nil))
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("empty songIds: want 400, got %d", res.StatusCode)
	}

	// Nothing packable: only inactive / unknown ids.
	res, _ = env.do(t, "POST", "/api/download", alice, downloadRequest([]string{"s-inactive", "nope"}))
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("zero packable: want 400, got %d", res.StatusCode)
	}

	// Malformed bodies.
	res, _ = env.do(t, "POST", "/api/download", alice, `{"songIds": "s-a1"}`)
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("non-array songIds: want 400, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "POST", "/api/download", alice, `not json`)
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("garbage body: want 400, got %d", res.StatusCode)
	}

	// Anonymous without a token is a 401 (same contract as streaming).
	res, _ = env.do(t, "POST", "/api/download", nil, downloadRequest([]string{"s-a1"}))
	if res.StatusCode != http.StatusUnauthorized {
		t.Errorf("anonymous without token: want 401, got %d", res.StatusCode)
	}
}

// TestDownloadZipVanishedFiles: a song whose file disappeared between scan
// and pack is skipped gracefully; when nothing remains the answer is 400.
func TestDownloadZipVanishedFiles(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)

	if err := os.Remove(env.files["s-a2"]); err != nil {
		t.Fatal(err)
	}
	res, body := env.do(t, "POST", "/api/download", alice, downloadRequest([]string{"s-a1", "s-a2"}))
	if res.StatusCode != http.StatusOK {
		t.Fatalf("partially vanished pack: want 200, got %d", res.StatusCode)
	}
	files := unpackZip(t, body)
	if len(files) != 1 {
		t.Fatalf("entries = %v, want the surviving song only", zipNames(files))
	}

	if err := os.Remove(env.files["s-a1"]); err != nil {
		t.Fatal(err)
	}
	res, _ = env.do(t, "POST", "/api/download", alice, downloadRequest([]string{"s-a1", "s-a2"}))
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("fully vanished pack: want 400, got %d", res.StatusCode)
	}
}

// TestDownloadZipShareGating: the anonymous pack requires the link's
// share_download flag, packs ONLY token-granted ids, and answers 404 when
// nothing is granted — the no-probing contract.
func TestDownloadZipShareGating(t *testing.T) {
	env := newEnv(t, Options{})
	env.seedSharePlaylists(t)

	// Flag off (the 0006 default): no binaries through the token.
	res, _ := env.do(t, "POST", "/api/download?shareToken=tok-static", nil, downloadRequest([]string{"s-a1"}))
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("flag off: want 404, got %d", res.StatusCode)
	}
	// Unknown token: indistinguishable from flag-off (404, not 401 — the
	// download path answers every grant failure with the same status).
	res, _ = env.do(t, "POST", "/api/download?shareToken=nope", nil, downloadRequest([]string{"s-a1"}))
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("unknown token: want 404, got %d", res.StatusCode)
	}

	// Opt the link in.
	env.mustExec(t, `UPDATE playlists SET share_download = 1 WHERE id = 'pl-static'`)

	// Granted-only packing: s-a2 is outside the linked playlist.
	res, body := env.do(t, "POST", "/api/download?shareToken=tok-static", nil,
		downloadRequest([]string{"s-a1", "s-a2", "s-b1"}))
	if res.StatusCode != http.StatusOK {
		t.Fatalf("flag on: want 200, got %d", res.StatusCode)
	}
	files := unpackZip(t, body)
	if len(files) != 2 {
		t.Fatalf("entries = %v, want the two granted songs", zipNames(files))
	}
	if _, ok := files["Alpha - A1/One.mp3"]; !ok {
		t.Errorf("granted s-a1 missing: %v", zipNames(files))
	}
	if _, ok := files["Beta - B1/Beta One.mp3"]; !ok {
		t.Errorf("granted cross-library s-b1 missing: %v", zipNames(files))
	}

	// Zero granted ids → 404.
	res, _ = env.do(t, "POST", "/api/download?shareToken=tok-static", nil, downloadRequest([]string{"s-a2"}))
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("zero granted: want 404, got %d", res.StatusCode)
	}

	// Smart link playlists resolve through the same grant + flag path.
	env.mustExec(t, `UPDATE playlists SET share_download = 1 WHERE id = 'pl-smart'`)
	res, body = env.do(t, "POST", "/api/download?shareToken=tok-smart", nil,
		downloadRequest([]string{"s-b1", "s-a1"}))
	if res.StatusCode != http.StatusOK {
		t.Fatalf("smart flag on: want 200, got %d", res.StatusCode)
	}
	files = unpackZip(t, body)
	if len(files) != 1 {
		t.Fatalf("smart entries = %v, want only the resolved song", zipNames(files))
	}
	if _, ok := files["Beta - B1/Beta One.mp3"]; !ok {
		t.Errorf("smart granted song missing: %v", zipNames(files))
	}
}

// TestStreamShareTokenDownloadGating: ?download=1 with a share token
// requires the link's flag (404 otherwise); plain streaming is untouched.
func TestStreamShareTokenDownloadGating(t *testing.T) {
	env := newEnv(t, Options{})
	env.seedSharePlaylists(t)

	// Flag off: plain streaming works, download is a 404.
	res, _ := env.do(t, "GET", "/api/stream/s-a1?share=tok-static", nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("plain token stream: want 200, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "GET", "/api/stream/s-a1?download=1&share=tok-static", nil, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("flag-off download: want 404, got %d", res.StatusCode)
	}

	// Flag on: the download streams with the attachment disposition.
	env.mustExec(t, `UPDATE playlists SET share_download = 1 WHERE id = 'pl-static'`)
	res, body := env.do(t, "GET", "/api/stream/s-a1?download=1&share=tok-static", nil, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("flag-on download: want 200, got %d", res.StatusCode)
	}
	if disp := res.Header.Get("Content-Disposition"); !strings.Contains(disp, "attachment") {
		t.Errorf("download disposition = %q", disp)
	}
	if !bytes.Equal(body, fileBytes(t, env.files["s-a1"])) {
		t.Error("downloaded bytes != original file")
	}

	// A signed-in caller is never gated by the playlist flag (scope decides).
	alice := env.cookie(t, "user-alice", "alice", false)
	res, _ = env.do(t, "GET", "/api/stream/s-a2?download=1", alice, nil)
	if res.StatusCode != http.StatusOK {
		t.Errorf("signed-in download: want 200, got %d", res.StatusCode)
	}
	res, _ = env.do(t, "POST", "/api/download", alice, downloadRequest([]string{"s-a2"}))
	if res.StatusCode != http.StatusOK {
		t.Errorf("signed-in ZIP ignores the flag: want 200, got %d", res.StatusCode)
	}
}
