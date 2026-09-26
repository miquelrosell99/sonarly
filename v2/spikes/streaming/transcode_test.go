package main

import (
	"bytes"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// newTranscodeServer spins a real server with the production-shaped handler
// (503/Retry-After on full slots, spawn-failure fallback to direct).
func newTranscodeServer(t *testing.T, cap int) (*httptest.Server, *transcodeStreamer, *bytes.Buffer) {
	t.Helper()
	if _, err := os.Stat("media/spike.flac"); err != nil {
		t.Skip("media not generated; run ./genmedia.sh")
	}
	logBuf := &bytes.Buffer{}
	log := slog.New(slog.NewTextHandler(logBuf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	tr := newTranscodeStreamer(cap, log)
	svc := newStreamingService("media", tr, log)
	mux := http.NewServeMux()
	svc.routes(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(func() {
		srv.Close()
		if pids := tr.livePIDSnapshot(); len(pids) > 0 {
			t.Errorf("zombie ffmpeg processes left: %v", pids)
		}
	})
	return srv, tr, logBuf
}

// mp3FrameSync accounts for the ID3v2 tag ffmpeg's mp3 muxer writes at the
// head of pipe output (v1 behaves identically — same argv), then checks the
// MPEG frame sync.
func mp3FrameSync(b []byte) bool {
	off := 0
	if len(b) >= 10 && string(b[:3]) == "ID3" {
		size := int(b[6]&0x7f)<<21 | int(b[7]&0x7f)<<14 | int(b[8]&0x7f)<<7 | int(b[9]&0x7f)
		off = 10 + size
	}
	return len(b) >= off+2 && b[off] == 0xFF && b[off+1]&0xE0 == 0xE0
}

func TestTranscodeHeadersBodyAndDecode(t *testing.T) {
	srv, _, _ := newTranscodeServer(t, 2)

	res, err := http.Get(srv.URL + "/transcode/spike.flac?format=mp3&maxBitRate=128")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}

	t.Logf("status=%d CT=%q AR=%q CL=%q TE=%v body=%dB first2=%02x%02x",
		res.StatusCode, res.Header.Get("Content-Type"), res.Header.Get("Accept-Ranges"),
		res.Header.Get("Content-Length"), res.TransferEncoding, len(body), body[0], body[1])

	if res.StatusCode != 200 {
		t.Fatalf("status %d", res.StatusCode)
	}
	if res.Header.Get("Content-Type") != "audio/mpeg" {
		t.Errorf("CT = %q", res.Header.Get("Content-Type"))
	}
	if res.Header.Get("Accept-Ranges") != "none" {
		t.Errorf("AR = %q", res.Header.Get("Accept-Ranges"))
	}
	if res.Header.Get("Content-Length") != "" {
		t.Errorf("transcode must not set Content-Length (got %q)", res.Header.Get("Content-Length"))
	}
	if len(res.TransferEncoding) != 1 || res.TransferEncoding[0] != "chunked" {
		t.Errorf("expected chunked, got %v", res.TransferEncoding)
	}
	if !mp3FrameSync(body) {
		t.Errorf("body does not start with an MP3 frame sync")
	}
	// 30s @ 128 kbps CBR ≈ 480 KiB; allow wide margin for muxer overhead.
	if len(body) < 400*1024 || len(body) > 580*1024 {
		t.Errorf("body %d outside expected 128k transcode size", len(body))
	}

	// End-to-end proof: the piped output decodes with ffprobe.
	if ffprobe, err := exec.LookPath("ffprobe"); err == nil {
		tmp := t.TempDir() + "/out.mp3"
		if err := os.WriteFile(tmp, body, 0o644); err == nil {
			out, err := exec.Command(ffprobe, "-v", "error", "-show_entries",
				"format=duration,bit_rate,format_name", "-of", "csv=p=0", tmp).Output()
			if err != nil {
				t.Errorf("ffprobe on transcode output: %v", err)
			} else {
				t.Logf("ffprobe(decode check): %s", strings.TrimSpace(string(out)))
			}
		}
	}
}

// v1 parity: Range headers on transcode requests are ignored; the stream
// always starts from t=0 with a 200 (clients send Range out of habit).
func TestTranscodeIgnoresRange(t *testing.T) {
	srv, _, _ := newTranscodeServer(t, 2)

	req, _ := http.NewRequest("GET", srv.URL+"/transcode/spike.flac?format=mp3&maxBitRate=128", nil)
	req.Header.Set("Range", "bytes=200000-")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	t.Logf("Range on transcode: status=%d CR=%q AR=%q body=%dB first2=%02x%02x",
		res.StatusCode, res.Header.Get("Content-Range"), res.Header.Get("Accept-Ranges"),
		len(body), body[0], body[1])
	if res.StatusCode != 200 {
		t.Errorf("transcode must ignore Range (want 200, got %d)", res.StatusCode)
	}
	if res.Header.Get("Content-Range") != "" {
		t.Errorf("no Content-Range expected on transcode")
	}
	if !mp3FrameSync(body) {
		t.Errorf("body does not start at stream origin")
	}
}

func TestTranscodeHEAD(t *testing.T) {
	srv, _, _ := newTranscodeServer(t, 2)
	req, _ := http.NewRequest("HEAD", srv.URL+"/transcode/spike.flac?format=mp3", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	t.Logf("HEAD: status=%d CT=%q AR=%q CL=%q body=%dB", res.StatusCode,
		res.Header.Get("Content-Type"), res.Header.Get("Accept-Ranges"),
		res.Header.Get("Content-Length"), len(body))
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "audio/mpeg" ||
		res.Header.Get("Accept-Ranges") != "none" || len(body) != 0 {
		t.Errorf("HEAD transcode parity broken")
	}
	// And no ffmpeg should have been spawned for a HEAD.
	if pids := livePIDs(t); len(pids) != 0 {
		t.Errorf("HEAD spawned ffmpeg: %v", pids)
	}
}

func livePIDs(t *testing.T) []int {
	t.Helper()
	// read via /proc directly
	var out []int
	entries, _ := os.ReadDir("/proc")
	for _, e := range entries {
		var pid int
		if _, err := fmt.Sscanf(e.Name(), "%d", &pid); err == nil {
			if _, err := os.Stat(fmt.Sprintf("/proc/%d/exe", pid)); err == nil {
				if exe, err := os.Readlink(fmt.Sprintf("/proc/%d/exe", pid)); err == nil && strings.Contains(exe, "ffmpeg") {
					out = append(out, pid)
				}
			}
		}
	}
	return out
}

// waitPIDGone polls /proc/<pid> at ~1 ms resolution.
func waitPIDGone(pid int, timeout time.Duration) (time.Duration, bool) {
	start := time.Now()
	for time.Since(start) < timeout {
		if !pidAlive(pid) {
			return time.Since(start), true
		}
		time.Sleep(time.Millisecond)
	}
	return timeout, false
}

func TestDisconnectKillsFFmpeg(t *testing.T) {
	srv, tr, _ := newTranscodeServer(t, 2)

	killLatencies := func(immediate bool) []time.Duration {
		var lat []time.Duration
		for i := 0; i < 5; i++ {
			req, _ := http.NewRequest("GET", srv.URL+"/transcode/spike_2496.flac?format=mp3&maxBitRate=320", nil)
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			var pid int
			select {
			case pid = <-tr.spawned:
			case <-time.After(5 * time.Second):
				t.Fatal("no ffmpeg spawned")
			}
			if !immediate {
				// mid-stream: read ~256 KiB then bail
				buf := make([]byte, 256*1024)
				if _, err := io.ReadFull(res.Body, buf); err != nil {
					t.Fatalf("mid-stream read: %v", err)
				}
			}
			closeStart := time.Now()
			res.Body.Close() // client disconnect; conn teardown cancels the request ctx
			l, ok := waitPIDGone(pid, 3*time.Second)
			if !ok {
				t.Fatalf("ffmpeg pid %d survived disconnect by %s", pid, l)
			}
			lat = append(lat, time.Since(closeStart))
		}
		return lat
	}

	mid := killLatencies(false)
	imm := killLatencies(true)
	sort.Slice(mid, func(i, j int) bool { return mid[i] < mid[j] })
	sort.Slice(imm, func(i, j int) bool { return imm[i] < imm[j] })
	t.Logf("disconnect→SIGKILL latency: mid-stream median=%s max=%s | immediate median=%s max=%s",
		mid[len(mid)/2], mid[len(mid)-1], imm[len(imm)/2], imm[len(imm)-1])
}

// ffmpeg dying on its own mid-stream (external kill): client sees a truncated
// stream; v2 logs with slog incl. request ID. v1: truncated stream + console.
func TestExternalKillMidStream(t *testing.T) {
	srv, tr, logBuf := newTranscodeServer(t, 2)

	// Healthy full-transcode length of the SAME url for a sound comparison.
	res, err := http.Get(srv.URL + "/transcode/spike_2496.flac?format=mp3&maxBitRate=320")
	if err != nil {
		t.Fatal(err)
	}
	full, _ := io.ReadAll(res.Body)
	res.Body.Close()
	t.Logf("healthy transcode: %d bytes", len(full))
	// Drain the spawned-PID channel so the kill test below gets ITS pid.
	for {
		select {
		case <-tr.spawned:
		default:
			goto drained
		}
	}
drained:

	req, _ := http.NewRequest("GET", srv.URL+"/transcode/spike_2496.flac?format=mp3&maxBitRate=320", nil)
	req.Header.Set("X-Request-Id", "req-external-kill")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var pid int
	select {
	case pid = <-tr.spawned:
	case <-time.After(5 * time.Second):
		t.Fatal("no ffmpeg spawned")
	}
	// consume ~256 KiB so the client is genuinely mid-stream
	buf := make([]byte, 256*1024)
	if _, err := io.ReadFull(res.Body, buf); err != nil {
		t.Fatalf("pre-kill read: %v", err)
	}
	if err := syscall.Kill(pid, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body) // stream ends early

	t.Logf("after external kill: status=%d truncatedBody=%dB first2=%02x%02x",
		res.StatusCode, len(buf)+len(body), buf[0], buf[1])
	if res.StatusCode != 200 {
		t.Errorf("headers already committed; client must see 200")
	}
	if len(buf)+len(body) >= len(full) {
		t.Errorf("expected truncated stream")
	}
	if !mp3FrameSync(buf) {
		t.Errorf("stream content is not mp3")
	}
	deadline := time.Now().Add(2 * time.Second)
	for !strings.Contains(logBuf.String(), "transcode process failed mid-stream") && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !strings.Contains(logBuf.String(), "transcode process failed mid-stream") {
		t.Errorf("expected slog error record; log:\n%s", logBuf.String())
	}
	if !strings.Contains(logBuf.String(), "req-external-kill") {
		t.Errorf("slog record missing request ID")
	}
}

// Corrupt input / missing file: ffmpeg dies BEFORE any output byte. v1: empty
// 200. Spike-recommended v2: 500 (headers not yet committed — Go lets us).
func TestTranscodeFailureBeforeFirstByte(t *testing.T) {
	srv, _, _ := newTranscodeServer(t, 2)

	res, err := http.Get(srv.URL + "/transcode/corrupt.mp3?format=mp3")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	t.Logf("corrupt input: status=%d body=%dB", res.StatusCode, len(body))
	if res.StatusCode != 500 {
		t.Errorf("want 500 on pre-first-byte failure (v1 answers empty 200); got %d", res.StatusCode)
	}

	res, err = http.Get(srv.URL + "/transcode/does-not-exist.mp3?format=mp3")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	t.Logf("missing input: status=%d body=%dB", res.StatusCode, len(body))
	if res.StatusCode != 500 {
		t.Errorf("want 500 for missing input file; got %d", res.StatusCode)
	}
}

// Go's exec.Start reports spawn failures SYNCHRONOUSLY — the v1 B13 async
// trap (spawn 'error' event fires after reply headers) cannot occur. When the
// binary is missing we can still fall back to direct serving with zero client
// impact, matching the INTENT of the v1 B12 fix without the race.
func TestSpawnFailureIsSynchronous(t *testing.T) {
	srv, tr, _ := newTranscodeServer(t, 2)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/transcode/spike.flac?format=mp3", nil)
	req.Header.Set("X-Request-Id", "req-spawn-fail")

	origPath := os.Getenv("PATH")
	t.Setenv("PATH", "") // ffmpeg unresolvable
	res, err := tr.stream(rec, req, "media/spike.flac", "mp3", 128)

	if err == nil {
		t.Fatal("expected synchronous spawn error")
	}
	if res.Failure != "spawn" {
		t.Errorf("failure = %q", res.Failure)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("%d bytes written before spawn error — B12-style trap exists!", rec.Body.Len())
	}
	t.Logf("spawn error surfaced synchronously: %v (after %d ns)", err, res.SpawnNanos)

	// Handler-level: with ffmpeg unresolvable the route falls back to direct
	// serving — the client gets the full original file, zero visible failure.
	fallbackSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		svc := newStreamingService("media", tr, slog.New(slog.NewTextHandler(io.Discard, nil)))
		mux := http.NewServeMux()
		svc.routes(mux)
		mux.ServeHTTP(w, r)
	}))
	defer fallbackSrv.Close()
	res2, err := http.Get(fallbackSrv.URL + "/transcode/spike.flac?format=mp3")
	if err != nil {
		t.Fatal(err)
	}
	defer res2.Body.Close()
	body, _ := io.ReadAll(res2.Body)
	st, _ := os.Stat("media/spike.flac")
	t.Logf("spawn-fail fallback: status=%d body=%dB file=%dB", res2.StatusCode, len(body), st.Size())
	if res2.StatusCode != 200 || int64(len(body)) != st.Size() {
		t.Errorf("fallback to direct failed: status %d, %d bytes", res2.StatusCode, len(body))
	}

	// Healthy-path sanity with PATH restored.
	t.Setenv("PATH", origPath)
	res3, err := http.Get(srv.URL + "/transcode/spike.flac?format=mp3&maxBitRate=128")
	if err != nil {
		t.Fatal(err)
	}
	defer res3.Body.Close()
	body3, _ := io.ReadAll(res3.Body)
	if res3.StatusCode != 200 || !mp3FrameSync(body3) {
		t.Errorf("healthy transcode broken")
	}
}

// Concurrency cap: when slots are full → immediate 503 + Retry-After, no
// queue, no client hang. Direct streams are NOT capped.
func TestSemaphoreRejectsAndDirectBypasses(t *testing.T) {
	srv, tr, _ := newTranscodeServer(t, 2)

	// Phase 1: occupy both slots with clients that read a little then hold.
	hold := make(chan struct{})
	var held sync.WaitGroup
	for i := 0; i < 2; i++ {
		held.Add(1)
		go func() {
			defer held.Done()
			res, err := http.Get(srv.URL + "/transcode/spike_2496.flac?format=mp3&maxBitRate=320")
			if err != nil {
				t.Errorf("holder request: %v", err)
				return
			}
			defer res.Body.Close()
			io.CopyN(io.Discard, res.Body, 128*1024)
			<-hold
			io.Copy(io.Discard, res.Body)
		}()
	}
	for i := 0; i < 2; i++ {
		select {
		case <-tr.spawned:
		case <-time.After(10 * time.Second):
			t.Fatal("holders did not spawn ffmpeg")
		}
	}

	// Phase 2: while saturated, direct streams must complete fast (uncapped).
	directDone := make(chan error, 3)
	for i := 0; i < 3; i++ {
		go func() {
			res, err := http.Get(srv.URL + "/direct/spike_128k.mp3")
			if err != nil {
				directDone <- err
				return
			}
			defer res.Body.Close()
			body, _ := io.ReadAll(res.Body)
			if res.StatusCode != 200 || int64(len(body)) != fileSize(t, "media/spike_128k.mp3") {
				directDone <- fmt.Errorf("direct: status=%d body=%dB", res.StatusCode, len(body))
				return
			}
			directDone <- nil
		}()
	}
	for i := 0; i < 3; i++ {
		select {
		case err := <-directDone:
			if err != nil {
				t.Errorf("direct during saturation: %v", err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("direct stream blocked behind the transcode cap")
		}
	}
	t.Logf("direct streams during saturation: 3/3 OK (not capped)")

	// Phase 3: a transcode while saturated → immediate 503 + Retry-After.
	t0 := time.Now()
	res, err := http.Get(srv.URL + "/transcode/spike_2496.flac?format=mp3&maxBitRate=128")
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, res.Body)
	res.Body.Close()
	rejectIn := time.Since(t0)
	t.Logf("transcode while full: status=%d Retry-After=%q responseIn=%s",
		res.StatusCode, res.Header.Get("Retry-After"), rejectIn)
	if res.StatusCode != 503 || res.Header.Get("Retry-After") == "" {
		t.Errorf("want 503 + Retry-After while full, got %d", res.StatusCode)
	}
	if rejectIn > 500*time.Millisecond {
		t.Errorf("rejection took %s — must be immediate", rejectIn)
	}

	// Phase 4: release holders, then hammer 2×cap concurrent transcodes.
	close(hold)
	held.Wait()

	const total = 6
	type result struct {
		status     int
		retryAfter string
		responseIn time.Duration
	}
	results := make(chan result, total)
	var wg sync.WaitGroup
	startGate := make(chan struct{})
	for i := 0; i < total; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-startGate
			t0 := time.Now()
			res, err := http.Get(srv.URL + "/transcode/spike_2496.flac?format=mp3&maxBitRate=128")
			if err != nil {
				t.Errorf("request: %v", err)
				return
			}
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			results <- result{res.StatusCode, res.Header.Get("Retry-After"), time.Since(t0)}
		}()
	}
	close(startGate)
	wg.Wait()
	close(results)

	var got200, got503 int
	var maxReject time.Duration
	for r := range results {
		t.Logf("status=%d Retry-After=%q responseIn=%s", r.status, r.retryAfter, r.responseIn)
		switch r.status {
		case 200:
			got200++
		case 503:
			got503++
			if r.retryAfter == "" {
				t.Errorf("503 without Retry-After")
			}
			if r.responseIn > maxReject {
				maxReject = r.responseIn
			}
		default:
			t.Errorf("unexpected status %d", r.status)
		}
	}
	t.Logf("cap=2 × %d concurrent → %d accepted, %d rejected (max reject latency %s)",
		total, got200, got503, maxReject)
	if got200 != 2 || got503 != total-2 {
		t.Errorf("want 2×200 + %d×503; got %d/%d", total-2, got200, got503)
	}
}

func fileSize(t *testing.T, path string) int64 {
	t.Helper()
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return st.Size()
}
