package playback

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// errSlotsFull is returned by Stream when the transcode semaphore is
// saturated. Policy (measured in the S2 spike): reject with 503 + Retry-After,
// no queue — a queued stream would hold an HTTP connection and a client
// timeout against a realtime encoder for zero benefit at self-host scale.
var errSlotsFull = errors.New("transcode slots full")

// retryAfterSeconds is the Retry-After value answered with 503s so clients
// can back off deterministically (S2 §5).
const retryAfterSeconds = "3"

const copyChunkBytes = 64 * 1024 // v1 createReadStream highWaterMark parity

// streamOutcome labels the terminal state of one transcode attempt, for
// tests and logging.
type streamOutcome struct {
	PID        int
	SpawnNanos int64
	Bytes      int64
	Failure    string // "slots-full" | "spawn" | "copy" | "exit-early" | "exit" | ""
	CopyErr    error  // set when Failure == "copy"
	ClientGone bool
	StderrTail string
}

// TranscodingStreamer owns the ffmpeg concurrency cap. One instance per
// server — the cap lives in the streaming service, not per-route (S2
// decision D6; audit §18 playback). Direct streams never touch it.
type TranscodingStreamer struct {
	sem        chan struct{} // capacity = max concurrent transcodes
	ffmpegPath string        // binary to exec; "ffmpeg" resolves via PATH
	log        *slog.Logger

	mu       sync.Mutex
	livePIDs map[int]struct{}

	// spawned is a test hook: receives each ffmpeg PID after a successful
	// Start so tests can assert disconnect-kill without /proc races.
	spawned chan int
}

// NewTranscodingStreamer builds the streamer. maxConcurrent <= 0 falls back
// to 2 (the S2-measured default: two ffmpeg children ≈ 106 MB RSS worst
// case). ffmpegPath "" means "ffmpeg" (PATH lookup).
func NewTranscodingStreamer(maxConcurrent int, ffmpegPath string, log *slog.Logger) *TranscodingStreamer {
	if maxConcurrent <= 0 {
		maxConcurrent = 2
	}
	if ffmpegPath == "" {
		ffmpegPath = "ffmpeg"
	}
	return &TranscodingStreamer{
		sem:        make(chan struct{}, maxConcurrent),
		ffmpegPath: ffmpegPath,
		log:        log,
		livePIDs:   map[int]struct{}{},
		spawned:    make(chan int, 256),
	}
}

// HeadHeaders writes the v1-parity HEAD response for a transcode-decided
// stream: Content-Type by format, Accept-Ranges: none, no body, and no
// ffmpeg spawned (asserted in the S2 spike).
func HeadHeaders(w http.ResponseWriter, format string) {
	h := w.Header()
	h.Set("Content-Type", transcodeContentType(format))
	h.Set("Accept-Ranges", "none")
	w.WriteHeader(http.StatusOK)
}

// ErrSlotsFull reports whether err is semaphore saturation; routes translate
// it to 503 + Retry-After.
func ErrSlotsFull(err error) bool { return errors.Is(err, errSlotsFull) }

// RetryAfter is the Retry-After value for slot rejections.
func RetryAfter() string { return retryAfterSeconds }

// Stream runs one transcode to w. Spawn errors are returned synchronously —
// Go's exec.Cmd.Start has no v1-B12 async-spawn trap, so the caller can fall
// back to direct serving with zero bytes written (S2 surprise 3). Semaphore
// saturation is errSlotsFull. Mid-stream failures are logged with slog
// including the request ID; the client sees a truncated stream (v1 parity,
// S2 decision D5). ffmpeg dying before its first output byte upgrades to a
// 500 (accepted deviation, S2 sign-off S2).
func (t *TranscodingStreamer) Stream(w http.ResponseWriter, r *http.Request, filePath, format string, maxKbps int) (*streamOutcome, error) {
	res := &streamOutcome{}

	// 1. Concurrency cap. Reject fast when full (no queue): holding a client
	//    connection in a queue burns client timeouts for a realtime stream.
	select {
	case t.sem <- struct{}{}:
		defer func() { <-t.sem }()
	case <-r.Context().Done():
		return res, r.Context().Err()
	default:
		res.Failure = "slots-full"
		return res, errSlotsFull
	}

	// 2. Spawn ffmpeg. CommandContext wires r.Context() to process Kill
	//    (SIGKILL on Linux) on client disconnect — v1 parity via stdlib,
	//    measured at 3.4 ms in the S2 spike.
	cmd := exec.CommandContext(r.Context(), t.ffmpegPath, ffmpegArgs(filePath, format, maxKbps)...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		res.Failure = "spawn"
		return res, fmt.Errorf("stdout pipe: %w", err)
	}
	var stderr stderrTail
	cmd.Stderr = &stderr

	start := time.Now()
	if err := cmd.Start(); err != nil {
		res.SpawnNanos = time.Since(start).Nanoseconds()
		res.Failure = "spawn"
		return res, fmt.Errorf("ffmpeg spawn: %w", err) // synchronous — CONFIRMED in S2 tests
	}
	res.PID = cmd.Process.Pid
	res.SpawnNanos = time.Since(start).Nanoseconds()
	t.mu.Lock()
	t.livePIDs[res.PID] = struct{}{}
	t.mu.Unlock()
	select {
	case t.spawned <- res.PID:
	default:
	}
	defer func() {
		t.mu.Lock()
		delete(t.livePIDs, res.PID)
		t.mu.Unlock()
	}()

	// 3. Headers — v1 parity: Content-Type by format, Accept-Ranges: none,
	//    no Content-Length → net/http answers chunked. Range request headers
	//    are deliberately ignored (stream always starts at 0 — v1 parity).
	h := w.Header()
	h.Set("Content-Type", transcodeContentType(format))
	h.Set("Accept-Ranges", "none")

	// 4. Copy stdout → response in 64 KiB chunks; kill on write failure.
	reqID := middleware.GetReqID(r.Context())
	buf := make([]byte, copyChunkBytes)
	for {
		n, readErr := stdout.Read(buf)
		if n > 0 {
			written, writeErr := w.Write(buf[:n])
			res.Bytes += int64(written)
			if writeErr != nil {
				res.Failure = "copy"
				res.CopyErr = writeErr
				res.ClientGone = errors.Is(r.Context().Err(), context.Canceled)
				_ = cmd.Process.Kill() // ctx cancellation is racing us; ensure dead
				break
			}
		}
		if readErr != nil {
			if readErr != io.EOF {
				res.Failure = "copy"
				res.CopyErr = readErr
				_ = cmd.Process.Kill()
			}
			break
		}
	}

	if res.Failure == "copy" {
		res.StderrTail = stderr.String()
		t.log.Warn("transcode aborted",
			"req", reqID, "pid", res.PID, "file", filePath,
			"bytes", res.Bytes, "copyErr", res.CopyErr.Error(),
			"clientGone", res.ClientGone, "ffmpegStderr", res.StderrTail)
	}

	waitErr := cmd.Wait()
	if waitErr != nil && res.Failure == "" {
		// ffmpeg died on its own mid-stream (external kill, corrupt input):
		// the client has already consumed a truncated-but-clean chunked stream.
		res.StderrTail = stderr.String()
		if res.Bytes == 0 {
			// Died before any output: response headers are not committed yet,
			// so upgrade to 500. (v1 answers an empty 200 here — the one
			// deliberate wire deviation, S2 sign-off S2.)
			res.Failure = "exit-early"
			t.log.Error("transcode failed before first byte",
				"req", reqID, "pid", res.PID, "file", filePath,
				"waitErr", waitErr.Error(), "ffmpegStderr", res.StderrTail)
			http.Error(w, "Transcode failed", http.StatusInternalServerError)
			return res, nil
		}
		res.Failure = "exit"
		t.log.Error("transcode process failed mid-stream",
			"req", reqID, "pid", res.PID, "file", filePath,
			"bytes", res.Bytes, "waitErr", waitErr.Error(),
			"ffmpegStderr", res.StderrTail)
	} else if waitErr == nil && res.Failure == "" {
		t.log.Info("transcode complete",
			"req", reqID, "pid", res.PID, "file", filePath,
			"bytes", res.Bytes, "spawnMs", float64(res.SpawnNanos)/1e6)
	}
	return res, nil
}

// stderrTail keeps the last 4 KiB of ffmpeg stderr for slog context.
type stderrTail struct {
	mu  sync.Mutex
	buf []byte
}

func (s *stderrTail) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buf = append(s.buf, p...)
	if len(s.buf) > 4096 {
		s.buf = s.buf[len(s.buf)-4096:]
	}
	return len(p), nil
}

func (s *stderrTail) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.TrimSpace(string(s.buf))
}

// LivePIDSnapshot returns the ffmpeg PIDs currently tracked (test aid).
func (t *TranscodingStreamer) LivePIDSnapshot() []int {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]int, 0, len(t.livePIDs))
	for pid := range t.livePIDs {
		out = append(out, pid)
	}
	return out
}

// pidAlive reports whether /proc/<pid> still exists (Linux; no external tools).
func pidAlive(pid int) bool {
	_, err := os.Stat(fmt.Sprintf("/proc/%d", pid))
	return err == nil
}
