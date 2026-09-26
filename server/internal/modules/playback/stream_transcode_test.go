package playback

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"syscall"
	"testing"
	"time"
)

// TestTranscodeHeadersBodyAndTTFB: real ffmpeg, query-driven decision
// (mp3 134 kbps + maxBitRate=64 → transcode). Asserts the retired server wire shape,
// ID3v2-headed mp3 output, and a sane TTFB (S2 measured 42 ms).
func TestTranscodeHeadersBodyAndTTFB(t *testing.T) {
	requireFFmpeg(t)
	env := newEnv(t, Options{})
	plain := env.cookie(t, "user-plain", "plain", false)

	start := time.Now()
	res, body := env.do(t, "GET", "/api/stream/s-a1?maxBitRate=64", plain, nil)
	ttfb := time.Since(start)
	t.Logf("transcode TTFB(headers)=%s status=%d CT=%q AR=%q CL=%q TE=%v body=%dB first3=%02x%02x%02x",
		ttfb, res.StatusCode, res.Header.Get("Content-Type"), res.Header.Get("Accept-Ranges"),
		res.Header.Get("Content-Length"), res.TransferEncoding, len(body), body[0], body[1], body[2])

	if ttfb > 5*time.Second {
		t.Errorf("transcode TTFB %s > 5s", ttfb)
	}
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
		t.Errorf("body does not start with an ID3v2 tag + MP3 frame sync")
	}
	// 3.1 s @ 64 kbps CBR ≈ 25 KiB; wide margin for muxer overhead.
	if len(body) < 10*1024 || len(body) > 60*1024 {
		t.Errorf("body %d outside expected 64k transcode size", len(body))
	}
}

// TestTranscodeIgnoresRange: Range headers on a transcode request are ignored
// (200 chunked from t=0 — wire parity; clients send Range out of habit).
func TestTranscodeIgnoresRange(t *testing.T) {
	requireFFmpeg(t)
	env := newEnv(t, Options{})
	plain := env.cookie(t, "user-plain", "plain", false)

	req, _ := http.NewRequest("GET", env.srv.URL+"/api/stream/s-a1?maxBitRate=64", nil)
	req.Header.Set("Range", "bytes=200000-")
	req.AddCookie(plain)
	res, err := env.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body := readAll(t, res)
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

// TestTranscodeHEAD: headers only, no ffmpeg spawned (wire parity, asserted in
// the S2 spike). Runs without ffmpeg — a HEAD must never reach exec.
func TestTranscodeHEAD(t *testing.T) {
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false) // transcode_format=mp3 → flac transcodes
	env.drainSpawned()

	res, body := env.do(t, "HEAD", "/api/stream/s-a2", alice, nil)
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "audio/mpeg" ||
		res.Header.Get("Accept-Ranges") != "none" || len(body) != 0 {
		t.Errorf("HEAD transcode parity broken: status=%d CT=%q AR=%q body=%dB",
			res.StatusCode, res.Header.Get("Content-Type"), res.Header.Get("Accept-Ranges"), len(body))
	}
	select {
	case pid := <-env.svc.TranscodingStreamer().spawned:
		t.Errorf("HEAD spawned ffmpeg: %d", pid)
	default:
	}
	if pids := env.svc.TranscodingStreamer().LivePIDSnapshot(); len(pids) != 0 {
		t.Errorf("HEAD left ffmpeg processes: %v", pids)
	}
}

// TestTranscodeMaxBitRateClamp: the S2 clamp (min(requested, userCap)) is
// ENFORCED on the wire — verified by a fake ffmpeg that records its argv.
// user-alice carries max_bitrate_kbps=320 + transcode_format=mp3.
func TestTranscodeMaxBitRateClamp(t *testing.T) {
	// Emit a few bytes and exit 0: a minimal "successful transcode".
	fake := fakeFFmpeg(t, `printf '\377\373\220\144\144\144\144'`)
	env := newEnv(t, Options{FFmpegPath: fake})
	alice := env.cookie(t, "user-alice", "alice", false)
	plain := env.cookie(t, "user-plain", "plain", false)

	cases := []struct {
		name string
		url  string
		cook *http.Cookie
		want string
	}{
		{"user cap applies alone", "/api/stream/s-a2", alice, "320k"},
		{"min(requested 9999, cap 320) → cap", "/api/stream/s-a2?maxBitRate=9999", alice, "320k"},
		{"requested 128 under cap → requested", "/api/stream/s-a2?maxBitRate=128", alice, "128k"},
		{"out-of-range requested ignored → cap", "/api/stream/s-a2?maxBitRate=999999", alice, "320k"},
		{"no prefs, requested honored", "/api/stream/s-a1?maxBitRate=64", plain, "64k"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			os.WriteFile(os.Getenv("FAKE_FFMPEG_LOG"), nil, 0o644)
			res, body := env.do(t, "GET", c.url, c.cook, nil)
			if res.StatusCode != 200 {
				t.Fatalf("status %d", res.StatusCode)
			}
			if len(body) == 0 {
				t.Errorf("expected the fake transcode body")
			}
			argv := readFakeArgv(t)
			if len(argv) != 1 {
				t.Fatalf("want exactly 1 ffmpeg spawn, got %d: %v", len(argv), argv)
			}
			if got := lastBitrateArg(t, argv[0]); got != c.want {
				t.Errorf("-b:a = %q, want %q (argv: %s)", got, c.want, argv[0])
			}
		})
	}
}

// TestDisconnectKillsFFmpeg: client disconnect → SIGKILL via
// exec.CommandContext, observed through /proc like the S2 measurements.
func TestDisconnectKillsFFmpeg(t *testing.T) {
	requireFFmpeg(t)
	env := newEnv(t, Options{})
	plain := env.cookie(t, "user-plain", "plain", false)

	var latencies []time.Duration
	for i := 0; i < 3; i++ {
		req, _ := http.NewRequest("GET", env.srv.URL+"/api/stream/s-a1?maxBitRate=64", nil)
		req.AddCookie(plain)
		res, err := env.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		pid := env.waitSpawned(t)
		// Mid-stream: read ~4 KiB then bail.
		if _, err := io.ReadFull(res.Body, make([]byte, 4096)); err != nil {
			t.Fatalf("mid-stream read: %v", err)
		}
		closeStart := time.Now()
		res.Body.Close() // conn teardown cancels the request ctx
		l, ok := waitPIDGone(pid, 3*time.Second)
		if !ok {
			t.Fatalf("ffmpeg pid %d survived disconnect by %s", pid, l)
		}
		latencies = append(latencies, time.Since(closeStart))
	}
	t.Logf("disconnect→SIGKILL observed: %v (S2 measured 3.4 ms median)", latencies)
	for _, l := range latencies {
		if l > 100*time.Millisecond {
			t.Errorf("kill latency %s > 100 ms", l)
		}
	}
}

// TestTranscodeExternalKillMidStream: ffmpeg dying on its own mid-stream
// leaves the client with a truncated 200 (headers committed) and an slog
// error carrying the request ID and stderr tail (S2 decision D5).
func TestTranscodeExternalKillMidStream(t *testing.T) {
	requireFFmpeg(t)
	env := newEnv(t, Options{})
	plain := env.cookie(t, "user-plain", "plain", false)

	// Healthy full-transcode length for a sound comparison.
	res, full := env.do(t, "GET", "/api/stream/s-a1?maxBitRate=64", plain, nil)
	if res.StatusCode != 200 {
		t.Fatalf("healthy transcode: status %d", res.StatusCode)
	}
	t.Logf("healthy transcode: %d bytes", len(full))
	env.drainSpawned()

	req, _ := http.NewRequest("GET", env.srv.URL+"/api/stream/s-a1?maxBitRate=64", nil)
	req.Header.Set("X-Request-Id", "req-external-kill")
	req.AddCookie(plain)
	res, err := env.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	pid := env.waitSpawned(t)
	head := make([]byte, 4096)
	if _, err := io.ReadFull(res.Body, head); err != nil {
		t.Fatalf("pre-kill read: %v", err)
	}
	if err := syscall.Kill(pid, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	tail, _ := io.ReadAll(res.Body)
	res.Body.Close()

	if res.StatusCode != 200 {
		t.Errorf("headers already committed; client must see 200 (got %d)", res.StatusCode)
	}
	if len(head)+len(tail) >= len(full) {
		t.Errorf("expected truncated stream, got %d >= %d bytes", len(head)+len(tail), len(full))
	}
	if !mp3FrameSync(head) {
		t.Errorf("stream content is not mp3")
	}
	deadline := time.Now().Add(2 * time.Second)
	for !strings.Contains(env.logBuf.String(), "transcode process failed mid-stream") && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	logs := env.logBuf.String()
	if !strings.Contains(logs, "transcode process failed mid-stream") {
		t.Errorf("expected slog error record; log:\n%s", logs)
	}
	if !strings.Contains(logs, "req-external-kill") {
		t.Errorf("slog record missing request ID")
	}
}

// TestTranscodeFailureBeforeFirstByte: corrupt input dies before any output
// byte → 500 (accepted deviation, S2 sign-off S2; the retired server answered an empty 200).
func TestTranscodeFailureBeforeFirstByte(t *testing.T) {
	requireFFmpeg(t)
	env := newEnv(t, Options{})
	alice := env.cookie(t, "user-alice", "alice", false) // format target → transcode decision

	res, _ := env.do(t, "GET", "/api/stream/s-corrupt", alice, nil)
	if res.StatusCode != 500 {
		t.Errorf("want 500 on pre-first-byte failure; got %d", res.StatusCode)
	}
}

// TestTranscodeSemaphoreRejectsAndDirectBypasses: cap=2, both slots held by
// slow readers → 3rd transcode answers 503 + Retry-After immediately while
// direct streams complete untouched (S2 §5, sign-off S1).
func TestTranscodeSemaphoreRejectsAndDirectBypasses(t *testing.T) {
	// Dribble ~4 s (20 × 0.2 s): long enough to hold a slot while saturated,
	// short enough that the post-saturation transcode finishes quickly.
	fake := fakeFFmpeg(t, `
i=0
while [ $i -lt 20 ]; do
  printf '\377\373\220\144\144\144\144'
  sleep 0.2
  i=$((i+1))
done`)
	env := newEnv(t, Options{FFmpegPath: fake, MaxConcurrentTranscodes: 2})
	alice := env.cookie(t, "user-alice", "alice", false)
	plain := env.cookie(t, "user-plain", "plain", false)

	// Phase 1: occupy both slots with readers that take a little then hold.
	hold := make(chan struct{})
	holderDone := make(chan struct{}, 2)
	for i := 0; i < 2; i++ {
		go func() {
			defer func() { holderDone <- struct{}{} }()
			req, _ := http.NewRequest("GET", env.srv.URL+"/api/stream/s-a2", nil)
			req.AddCookie(alice)
			res, err := env.client.Do(req)
			if err != nil {
				t.Errorf("holder request: %v", err)
				return
			}
			defer res.Body.Close()
			io.CopyN(io.Discard, res.Body, 8)
			<-hold
			// Returning (and closing the body) disconnects the client: the
			// handler's ctx cancels, the fake ffmpeg is SIGKILLed, the slot
			// frees. Draining the dribble here would stall for its full run.
		}()
	}
	for i := 0; i < 2; i++ {
		env.waitSpawned(t)
	}

	// Phase 2: direct streams are NOT capped — three complete during saturation.
	directDone := make(chan error, 3)
	for i := 0; i < 3; i++ {
		go func() {
			res, body := env.do(t, "GET", "/api/stream/s-a1", plain, nil)
			if res.StatusCode != 200 || int64(len(body)) != int64(len(fileBytes(t, env.files["s-a1"]))) {
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

	// Phase 3: a transcode while saturated → immediate 503 + Retry-After: 3.
	t0 := time.Now()
	res, _ := env.do(t, "GET", "/api/stream/s-a2", alice, nil)
	rejectIn := time.Since(t0)
	if res.StatusCode != 503 {
		t.Errorf("want 503 while full, got %d", res.StatusCode)
	}
	if got := res.Header.Get("Retry-After"); got != "3" {
		t.Errorf("Retry-After = %q, want 3", got)
	}
	if rejectIn > 500*time.Millisecond {
		t.Errorf("rejection took %s — must be immediate", rejectIn)
	}

	// Phase 4: release holders; the next transcode succeeds again.
	close(hold)
	for i := 0; i < 2; i++ {
		<-holderDone
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if pids := env.svc.TranscodingStreamer().LivePIDSnapshot(); len(pids) == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	res, body := env.do(t, "GET", "/api/stream/s-a2", alice, nil)
	if res.StatusCode != 200 || len(body) == 0 {
		t.Errorf("post-saturation transcode: status=%d body=%dB", res.StatusCode, len(body))
	}
}

// TestTranscodeMissingFFmpegFallsBackToDirect: an unresolvable binary path
// surfaces synchronously from exec.Start (no the old B12 race), so the service
// falls back to direct file serving with zero client impact.
func TestTranscodeMissingFFmpegFallsBackToDirect(t *testing.T) {
	env := newEnv(t, Options{FFmpegPath: "/no/such/ffmpeg-deadbeef"})
	alice := env.cookie(t, "user-alice", "alice", false)

	res, body := env.do(t, "GET", "/api/stream/s-a2", alice, nil)
	if res.StatusCode != 200 {
		t.Fatalf("fallback to direct failed: status %d", res.StatusCode)
	}
	if string(body) != string(fileBytes(t, env.files["s-a2"])) {
		t.Errorf("fallback body != original file bytes")
	}
	if res.Header.Get("Content-Type") != "audio/x-flac" {
		t.Errorf("fallback Content-Type = %q, want audio/x-flac", res.Header.Get("Content-Type"))
	}
	if res.Header.Get("Accept-Ranges") != "bytes" {
		t.Errorf("fallback Accept-Ranges = %q, want bytes", res.Header.Get("Accept-Ranges"))
	}
	if !strings.Contains(env.logBuf.String(), "falling back to direct") {
		t.Errorf("expected fallback slog record; log:\n%s", env.logBuf.String())
	}
}
