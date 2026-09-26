package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func newDirectServer(t *testing.T) (*httptest.Server, string, []byte) {
	t.Helper()
	filePath := "media/spike_128k.mp3"
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Skip("media not generated; run ./genmedia.sh")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/sc/", func(w http.ResponseWriter, r *http.Request) { // ServeContent
		directServeContent(w, r, "media/"+strings.TrimPrefix(r.URL.Path, "/sc/"))
	})
	mux.HandleFunc("/v1/", func(w http.ResponseWriter, r *http.Request) { // wire-parity custom
		directCustomV1(w, r, "media/"+strings.TrimPrefix(r.URL.Path, "/v1/"))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, filePath, data
}

func do(t *testing.T, method, url string, headers map[string]string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestDirectRangeParityMatrix(t *testing.T) {
	srv, _, data := newDirectServer(t)
	size := int64(len(data))

	type tc struct {
		name        string
		rangeHeader string
	}
	cases := []tc{
		{"no range", ""},
		{"full range", "bytes=0-999999999"},
		{"first 100", "bytes=0-99"},
		{"middle", "bytes=100-199"},
		{"open-ended", "bytes=100-"},
		{"suffix 100", "bytes=-100"},
		{"suffix == size", "bytes=-481115"},
		{"suffix > size", "bytes=-999999999"},
		{"start == size", "bytes=481115-"},
		{"start > size", "bytes=999999999-"},
		{"end < start", "bytes=200-100"},
		{"zero suffix", "bytes=-0"},
		{"garbage", "bytes=abc-def"},
		{"non-bytes unit", "items=0-99"},
		{"MULTI-RANGE", "bytes=0-99,200-299"},
		{"multi-range 3 parts", "bytes=0-9,20-29,40-49"},
	}

	for _, mode := range []string{"sc", "v1"} {
		for _, c := range cases {
			t.Run(mode+"/"+c.name, func(t *testing.T) {
				headers := map[string]string{}
				if c.rangeHeader != "" {
					headers["Range"] = c.rangeHeader
				}
				res := do(t, "GET", srv.URL+"/"+mode+"/spike_128k.mp3", headers)
				defer res.Body.Close()
				body, _ := io.ReadAll(res.Body)

				report := func() string {
					return fmt.Sprintf("status=%d CL=%q CR=%q CT=%q AR=%q TE=%v body=%dB",
						res.StatusCode, res.Header.Get("Content-Length"), res.Header.Get("Content-Range"),
						res.Header.Get("Content-Type"), res.Header.Get("Accept-Ranges"),
						res.TransferEncoding, len(body))
				}
				t.Logf("%s", report())

				// Verify body content matches the file for 200/206.
				switch res.StatusCode {
				case 200:
					if int64(len(body)) != size {
						t.Errorf("200 body %d != file size %d", len(body), size)
					}
					if string(body) != string(data) {
						t.Errorf("200 body != file bytes")
					}
					if res.Header.Get("Content-Length") != fmt.Sprintf("%d", size) {
						t.Errorf("200 missing/wrong Content-Length")
					}
				case 206:
					// Go 1.21+ answers multi-range with 206 multipart/byteranges
					// (the old server answers 416). Verify it is well-formed and skip the
					// single-range Content-Range checks.
					if strings.HasPrefix(res.Header.Get("Content-Type"), "multipart/byteranges") {
						parts := strings.Count(string(body), "Content-Range: bytes")
						if parts < 2 {
							t.Errorf("multipart body missing range parts (%d):\n%s", parts, body)
						}
						break
					}
					cr := res.Header.Get("Content-Range")
					var s, e int64
					if _, err := fmt.Sscanf(cr, "bytes %d-%d/%d", &s, &e, new(int64)); err != nil {
						t.Fatalf("bad Content-Range %q (%s)", cr, report())
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
				case 416:
					if len(body) == 0 {
						t.Errorf("416 with empty body (%s)", report())
					}
				default:
					t.Errorf("unexpected status (%s)", report())
				}
			})
		}
	}
}

// Captures behavioral deltas between ServeContent and the wire-parity handler.
func TestDirectGoVsV1Deltas(t *testing.T) {
	srv, _, data := newDirectServer(t)
	size := int64(len(data))

	get := func(mode string, hdrs map[string]string) *http.Response {
		return do(t, "GET", srv.URL+"/"+mode+"/spike_128k.mp3", hdrs)
	}

	// 1. Multi-range: Go 1.23 DOES multipart/byteranges 206 (added in Go 1.21);
	//    the retired server answers 416. Biggest client-visible delta found.
	res := get("sc", map[string]string{"Range": "bytes=0-99,200-299"})
	ct := res.Header.Get("Content-Type")
	t.Logf("SC multi-range:  status=%d CT=%q", res.StatusCode, ct)
	if res.StatusCode != 206 || !strings.HasPrefix(ct, "multipart/byteranges") {
		t.Errorf("expected Go 206 multipart, got %d %q", res.StatusCode, ct)
	}
	res.Body.Close()
	res = get("v1", map[string]string{"Range": "bytes=0-99,200-299"})
	t.Logf("V1 multi-range:  status=%d CT=%q", res.StatusCode, res.Header.Get("Content-Type"))
	if res.StatusCode != 416 {
		t.Errorf("expected v1 416 for multi-range, got %d", res.StatusCode)
	}
	res.Body.Close()

	// 2. 416 responses: Go adds "Content-Range: bytes */size"; the retired server doesn't.
	res = get("sc", map[string]string{"Range": "bytes=999999999-"})
	t.Logf("SC 416 headers:  CR=%q", res.Header.Get("Content-Range"))
	if res.Header.Get("Content-Range") != fmt.Sprintf("bytes */%d", size) {
		t.Errorf("Go 416 missing Content-Range */size")
	}
	res.Body.Close()
	res = get("v1", map[string]string{"Range": "bytes=999999999-"})
	t.Logf("V1 416 headers:  CR=%q", res.Header.Get("Content-Range"))
	if res.Header.Get("Content-Range") != "" {
		t.Errorf("v1 416 should not set Content-Range")
	}
	res.Body.Close()

	// 3. HEAD + Range: the retired server ignores Range on HEAD (200 + full CL); Go's
	//    ServeContent runs the range logic → 206 headers.
	res = do(t, "HEAD", srv.URL+"/sc/spike_128k.mp3", map[string]string{"Range": "bytes=0-99"})
	t.Logf("SC HEAD+Range:   status=%d CL=%q CR=%q", res.StatusCode, res.Header.Get("Content-Length"), res.Header.Get("Content-Range"))
	res.Body.Close()
	res = do(t, "HEAD", srv.URL+"/v1/spike_128k.mp3", map[string]string{"Range": "bytes=0-99"})
	t.Logf("V1 HEAD+Range:   status=%d CL=%q CR=%q", res.StatusCode, res.Header.Get("Content-Length"), res.Header.Get("Content-Range"))
	if res.StatusCode != 200 || res.Header.Get("Content-Length") != fmt.Sprintf("%d", size) {
		t.Errorf("v1 HEAD+Range should be 200 + full CL")
	}
	res.Body.Close()

	// 4. Last-Modified / conditional requests: Go sets Last-Modified and
	//    honors If-Modified-Since (304); the retired server does neither.
	res = get("sc", nil)
	lm := res.Header.Get("Last-Modified")
	res.Body.Close()
	t.Logf("SC Last-Modified: %q", lm)
	if lm == "" {
		t.Errorf("ServeContent should set Last-Modified")
	}
	res = get("sc", map[string]string{"If-Modified-Since": "Wed, 21 Oct 2098 07:28:00 GMT"})
	t.Logf("SC IMS future:   status=%d body=%dB", res.StatusCode, mustLen(res))
	if res.StatusCode != 304 {
		t.Errorf("expected 304, got %d", res.StatusCode)
	}
	res.Body.Close()
	res = get("v1", map[string]string{"If-Modified-Since": "Wed, 21 Oct 2098 07:28:00 GMT"})
	t.Logf("V1 IMS future:   status=%d body=%dB", res.StatusCode, mustLen(res))
	if res.StatusCode != 200 {
		t.Errorf("v1 handler has no precondition support (expected 200), got %d", res.StatusCode)
	}
	res.Body.Close()

	// 5. HEAD no-range: both 200 + full CL, empty body.
	for _, mode := range []string{"sc", "v1"} {
		res = do(t, "HEAD", srv.URL+"/"+mode+"/spike_128k.mp3", nil)
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		t.Logf("%s HEAD:          status=%d CL=%q body=%dB", mode, res.StatusCode, res.Header.Get("Content-Length"), len(body))
		if res.StatusCode != 200 || res.Header.Get("Content-Length") != fmt.Sprintf("%d", size) || len(body) != 0 {
			t.Errorf("%s HEAD wrong", mode)
		}
	}

	// 6. Absent file: 404 on both. (Route now resolves the name from the URL.)
	for _, mode := range []string{"sc", "v1"} {
		res = do(t, "GET", srv.URL+"/"+mode+"/nope.mp3", nil)
		res.Body.Close()
		t.Logf("%s absent file:   status=%d", mode, res.StatusCode)
		if res.StatusCode != 404 {
			t.Errorf("absent file: want 404, got %d", res.StatusCode)
		}
	}
}

func mustLen(res *http.Response) int {
	b, _ := io.ReadAll(res.Body)
	return len(b)
}

// Content-Type parity: pinned map (old mime-types values) vs Go host lookup.
func TestContentTypeMapVsV1(t *testing.T) {
	srv, _, _ := newDirectServer(t)
	res := do(t, "GET", srv.URL+"/sc/spike_128k.mp3", nil)
	t.Logf("SC CT (explicit pin): %q", res.Header.Get("Content-Type"))
	res.Body.Close()
	if res.Header.Get("Content-Type") != "audio/mpeg" {
		t.Errorf("mp3 CT")
	}
	// Measured separately in the findings doc:
	//   the retired server mime-types:  flac→audio/x-flac  wav→audio/wav   opus→audio/ogg
	//   Go host lookup: flac→audio/flac    wav→audio/x-wav opus→audio/ogg
}
