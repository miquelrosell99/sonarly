package playback

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// TestStreamRangeMatrix is the S2 §3.1 matrix (16 cases) against the real
// route, with body bytes verified against the actual file.
func TestStreamRangeMatrix(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)
	data := fileBytes(t, env.files["s-a1"])
	size := int64(len(data))

	cases := []struct {
		name        string
		rangeHeader string
	}{
		{"no range", ""},
		{"full range", "bytes=0-999999999"},
		{"first 100", "bytes=0-99"},
		{"middle", "bytes=100-199"},
		{"open-ended", "bytes=100-"},
		{"suffix 100", "bytes=-100"},
		{"suffix == size", "bytes=-" + strconv.FormatInt(size, 10)},
		{"suffix > size", "bytes=-999999999"},
		{"start == size", "bytes=" + strconv.FormatInt(size, 10) + "-"},
		{"start > size", "bytes=999999999-"},
		{"end < start", "bytes=200-100"},
		{"zero suffix", "bytes=-0"},
		{"garbage", "bytes=abc-def"},
		{"non-bytes unit", "items=0-99"},
		{"MULTI-RANGE", "bytes=0-99,200-299"},
		{"multi-range 3 parts", "bytes=0-9,20-29,40-49"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req, _ := http.NewRequest("GET", env.srv.URL+"/api/stream/s-a1", nil)
			if c.rangeHeader != "" {
				req.Header.Set("Range", c.rangeHeader)
			}
			req.AddCookie(alice)
			res, err := env.client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			body := readAll(t, res)

			report := func() string {
				return fmt.Sprintf("status=%d CL=%q CR=%q CT=%q AR=%q body=%dB",
					res.StatusCode, res.Header.Get("Content-Length"), res.Header.Get("Content-Range"),
					res.Header.Get("Content-Type"), res.Header.Get("Accept-Ranges"), len(body))
			}
			t.Logf("%s", report())

			switch res.StatusCode {
			case 200:
				if int64(len(body)) != size || string(body) != string(data) {
					t.Errorf("200 body %d != file size %d", len(body), size)
				}
				if res.Header.Get("Content-Length") != fmt.Sprintf("%d", size) {
					t.Errorf("200 missing/wrong Content-Length (%s)", report())
				}
				if res.Header.Get("Accept-Ranges") != "bytes" {
					t.Errorf("200 must advertise Accept-Ranges: bytes (%s)", report())
				}
				if res.Header.Get("Content-Type") != "audio/mpeg" {
					t.Errorf("Content-Type = %q, want pinned audio/mpeg", res.Header.Get("Content-Type"))
				}
			case 206:
				var s, e int64
				if _, err := fmt.Sscanf(res.Header.Get("Content-Range"), "bytes %d-%d/%d", &s, &e, new(int64)); err != nil {
					t.Fatalf("bad Content-Range (%s)", report())
				}
				if int64(len(body)) != e-s+1 {
					t.Errorf("206 body %d != range length %d (%s)", len(body), e-s+1, report())
				}
				if res.Header.Get("Content-Length") != fmt.Sprintf("%d", e-s+1) {
					t.Errorf("206 missing/wrong Content-Length (%s)", report())
				}
				if string(body) != string(data[s:e+1]) {
					t.Errorf("206 body != file slice [%d:%d]", s, e+1)
				}
				if res.Header.Get("Accept-Ranges") != "bytes" {
					t.Errorf("206 must advertise Accept-Ranges: bytes (%s)", report())
				}
			case 416:
				if len(body) == 0 {
					t.Errorf("416 with empty body — wire parity answers \"Invalid range\"")
				}
				if string(body) != "Invalid range" {
					t.Errorf("416 body = %q, want the old \"Invalid range\"", body)
				}
				// The old-server 416 guard (multi-range, zero suffix) must not set
				// Content-Range — Go's native 416 does (cosmetic delta).
				if strings.Contains(c.rangeHeader, ",") || strings.HasPrefix(c.rangeHeader, "bytes=-0") {
					if cr := res.Header.Get("Content-Range"); cr != "" {
						t.Errorf("guarded 416 must not set Content-Range, got %q", cr)
					}
				}
			default:
				t.Errorf("unexpected status (%s)", report())
			}
		})
	}
}

// TestStreamHEAD covers both HEAD shapes: plain (200 + full CL) and with a
// Range header, which the retired server special-cases to 200 + full CL (guard 3).
func TestStreamHEAD(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)
	size := fmt.Sprintf("%d", int64(len(fileBytes(t, env.files["s-a1"]))))

	do := func(headers map[string]string) *http.Response {
		req, _ := http.NewRequest("HEAD", env.srv.URL+"/api/stream/s-a1", nil)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		req.AddCookie(alice)
		res, err := env.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}

	res := do(nil)
	body := readAll(t, res)
	if res.StatusCode != 200 || res.Header.Get("Content-Length") != size || len(body) != 0 {
		t.Errorf("HEAD: status=%d CL=%q body=%dB", res.StatusCode, res.Header.Get("Content-Length"), len(body))
	}
	res.Body.Close()

	res = do(map[string]string{"Range": "bytes=0-99"})
	body = readAll(t, res)
	if res.StatusCode != 200 || res.Header.Get("Content-Length") != size || len(body) != 0 {
		t.Errorf("HEAD+Range must be 200 + full CL (wire parity): status=%d CL=%q body=%dB",
			res.StatusCode, res.Header.Get("Content-Length"), len(body))
	}
	if res.Header.Get("Content-Range") != "" {
		t.Errorf("HEAD+Range must not set Content-Range, got %q", res.Header.Get("Content-Range"))
	}
	res.Body.Close()
}

// TestStreamConditionalGet: Last-Modified is always present and a future
// If-Modified-Since answers 304 (accepted the Go server improvement, S2 sign-off S3).
func TestStreamConditionalGet(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)

	get := func(headers map[string]string) *http.Response {
		req, _ := http.NewRequest("GET", env.srv.URL+"/api/stream/s-a1", nil)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		req.AddCookie(alice)
		res, err := env.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}

	res := get(nil)
	lm := res.Header.Get("Last-Modified")
	res.Body.Close()
	if lm == "" {
		t.Fatal("ServeContent must set Last-Modified")
	}

	res = get(map[string]string{"If-Modified-Since": "Wed, 21 Oct 2098 07:28:00 GMT"})
	body := readAll(t, res)
	if res.StatusCode != 304 || len(body) != 0 {
		t.Errorf("future IMS: want 304 empty body, got %d (%dB)", res.StatusCode, len(body))
	}
	res.Body.Close()

	// A past date revalidates normally (200 + full body).
	res = get(map[string]string{"If-Modified-Since": "Wed, 21 Oct 1998 07:28:00 GMT"})
	body = readAll(t, res)
	if res.StatusCode != 200 || int64(len(body)) != int64(len(fileBytes(t, env.files["s-a1"]))) {
		t.Errorf("past IMS: want 200 + full body, got %d (%dB)", res.StatusCode, len(body))
	}
	res.Body.Close()
}

// TestStreamGuards covers the liveness/scope/authentication matrix.
func TestStreamGuards(t *testing.T) {
	env := newEnv(t, Options{})
	cookies := map[string]*http.Cookie{
		"admin": env.cookie(t, "user-admin", "root", true),
		"alice": env.cookie(t, "user-alice", "alice", false),
		"carol": env.cookie(t, "user-carol", "carol", false),
		"bob":   env.cookie(t, "user-bob", "bob", false),
	}

	cases := []struct {
		name   string
		user   string // "" = anonymous
		songID string
		want   int
	}{
		{"anon is rejected", "", "s-a1", 401},
		{"unknown song", "alice", "nope", 404},
		{"inactive song", "alice", "s-inactive", 404},
		{"out-of-scope foreign library", "alice", "s-b1", 404},
		{"empty scope reaches nothing", "bob", "s-a1", 404},
		{"null-library song hidden from non-admin", "alice", "s-nolib", 404},
		{"admin streams in-scope", "admin", "s-a1", 200},
		{"admin streams foreign library", "admin", "s-b1", 200},
		{"admin streams null-library song", "admin", "s-nolib", 200},
		{"owner streams", "alice", "s-a1", 200},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req, _ := http.NewRequest("GET", env.srv.URL+"/api/stream/"+c.songID, nil)
			if c.user != "" {
				req.AddCookie(cookies[c.user])
			}
			res, err := env.client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			readAll(t, res)
			if res.StatusCode != c.want {
				t.Errorf("want %d, got %d", c.want, res.StatusCode)
			}
		})
	}
}

// TestStreamDownloadDisposition: ?download=1 answers the original bytes with
// the retired server download.view's Content-Disposition, sanitized and percent-encoded.
func TestStreamDownloadDisposition(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)

	res, body := env.do(t, "GET", "/api/stream/s-odd?download=1", alice, nil)
	if res.StatusCode != 200 {
		t.Fatalf("status %d", res.StatusCode)
	}
	if string(body) != string(fileBytes(t, env.files["s-odd"])) {
		t.Errorf("download body != original file bytes")
	}
	wantCD := `attachment; filename="we_ird_na_me.mp3"; filename*=UTF-8''we%22ird%5Cna%0Ame.mp3`
	if got := res.Header.Get("Content-Disposition"); got != wantCD {
		t.Errorf("Content-Disposition =\n%q\nwant\n%q", got, wantCD)
	}
	if res.Header.Get("Content-Type") != "audio/mpeg" {
		t.Errorf("Content-Type = %q", res.Header.Get("Content-Type"))
	}

	// Download on a transcode-pref user must still serve the ORIGINAL file
	// (old download.view never transcodes).
	res, body = env.do(t, "GET", "/api/stream/s-a2?download=1", alice, nil)
	if res.StatusCode != 200 {
		t.Fatalf("status %d", res.StatusCode)
	}
	if string(body) != string(fileBytes(t, env.files["s-a2"])) {
		t.Errorf("download of flac != original flac bytes (must not transcode)")
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") ||
		!strings.Contains(cd, `filename="02 - Two.flac"`) {
		t.Errorf("flac Content-Disposition = %q", cd)
	}
}

// TestStreamShareTokenIgnoredForSignedInUser: the share-token parameter is
// consulted ONLY for anonymous requests; a signed-in caller keeps the
// session path (scope check included) no matter what the parameter says.
func TestStreamShareTokenIgnoredForSignedInUser(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false)
	res, body := env.do(t, "GET", "/api/stream/s-a1?share=tok-123", alice, nil)
	if res.StatusCode != 200 {
		t.Fatalf("share token param must not affect signed-in streamers: got %d", res.StatusCode)
	}
	if string(body) != string(fileBytes(t, env.files["s-a1"])) {
		t.Errorf("stream body != original file bytes")
	}
	// And an out-of-scope song stays unreachable even with a token present.
	res, _ = env.do(t, "GET", "/api/stream/s-b1?share=tok-123", alice, nil)
	if res.StatusCode != 404 {
		t.Errorf("out-of-scope song with token param: want 404, got %d", res.StatusCode)
	}
}
