package main

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
)

// errSlotsFull is returned by stream when the transcode semaphore is saturated.
// Policy (measured in this spike): reject with 503 + Retry-After, no queue.
var errSlotsFull = errors.New("transcode slots full")

const copyChunkBytes = 64 * 1024 // v1 createReadStream highWaterMark parity

// transcodeStreamer owns the ffmpeg concurrency cap. One instance per server
// (cap lives in the streaming service, not per-route — audit §18 playback).
type transcodeStreamer struct {
	sem      chan struct{} // capacity = max concurrent transcodes
	log      *slog.Logger
	capLabel int

	mu       sync.Mutex
	livePIDs map[int]struct{}

	// spawned is a test/measurement hook: receives each ffmpeg PID after a
	// successful Start.
	spawned chan int
}

func newTranscodeStreamer(maxConcurrent int, log *slog.Logger) *transcodeStreamer {
	if maxConcurrent <= 0 {
		maxConcurrent = 2
	}
	return &transcodeStreamer{
		sem:      make(chan struct{}, maxConcurrent),
		log:      log,
		capLabel: maxConcurrent,
		livePIDs: map[int]struct{}{},
		spawned:  make(chan int, 256),
	}
}

func ffmpegArgs(filePath, format string, maxKbps int) []string {
	codec := formatToCodec[format]
	args := []string{
		"-hide_banner", "-loglevel", "error",
		"-i", filePath,
		"-map", "0:a:0",
		"-c:a", codec,
	}
	if maxKbps > 0 {
		args = append(args, "-b:a", fmt.Sprintf("%dk", maxKbps))
	} else {
		args = append(args, "-q:a", "2")
	}
	container := "mp3"
	switch format {
	case "aac":
		container = "adts"
	case "opus":
		container = "opus"
	}
	return append(args, "-f", container, "pipe:1")
}

type streamResult struct {
	PID            int
	SpawnNanos     int64 // duration of exec.Cmd.Start (process spawn cost)
	Bytes          int64
	CopyErr        error
	WaitErr        error
	StderrTail     string
	ClientGone     bool
	Failure        string // "spawn" | "copy" | "exit" | ""
	DisconnectedAt time.Time
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

func requestID(r *http.Request) string {
	if v := r.Header.Get("X-Request-Id"); v != "" {
		return v
	}
	return "-"
}

// stream runs one transcode to w. Spawn errors are returned synchronously
// (Go exec.Start semantics — the v1 B12 async-spawn trap does not exist here).
// Semaphore-full is errSlotsFull. Mid-stream failures are logged with slog
// and reported in the result; the client sees a truncated stream (v1 parity).
func (t *transcodeStreamer) stream(w http.ResponseWriter, r *http.Request, filePath, format string, maxKbps int) (*streamResult, error) {
	res := &streamResult{}

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
	//    (SIGKILL on Linux) on client disconnect — v1 parity via stdlib.
	cmd := exec.CommandContext(r.Context(), "ffmpeg", ffmpegArgs(filePath, format, maxKbps)...)
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
		return res, fmt.Errorf("ffmpeg spawn: %w", err) // synchronous — CONFIRMED in tests
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
	buf := make([]byte, copyChunkBytes)
	for {
		n, readErr := stdout.Read(buf)
		if n > 0 {
			written, writeErr := w.Write(buf[:n])
			res.Bytes += int64(written)
			if writeErr != nil {
				res.CopyErr = writeErr
				res.ClientGone = errors.Is(r.Context().Err(), context.Canceled)
				_ = cmd.Process.Kill() // ctx cancellation is racing us; ensure dead
				break
			}
		}
		if readErr != nil {
			if readErr != io.EOF {
				res.CopyErr = readErr
				_ = cmd.Process.Kill()
			}
			break
		}
	}

	if res.CopyErr != nil {
		res.Failure = "copy"
		res.StderrTail = stderr.String()
		t.log.Warn("transcode aborted",
			"req", requestID(r), "pid", res.PID, "file", filePath,
			"bytes", res.Bytes, "copyErr", res.CopyErr.Error(),
			"clientGone", res.ClientGone, "ffmpegStderr", res.StderrTail)
	}

	waitErr := cmd.Wait()
	res.WaitErr = waitErr
	if waitErr != nil && res.CopyErr == nil {
		// ffmpeg died on its own mid-stream (external kill, corrupt input):
		// the client has already consumed a truncated-but-clean chunked stream.
		res.StderrTail = stderr.String()
		if res.Bytes == 0 {
			// Died before any output: response headers are not committed yet,
			// so upgrade to 500. (v1 answers an empty 200 here — the one
			// deliberate wire deviation recommended by this spike.)
			res.Failure = "exit-early"
			t.log.Error("transcode failed before first byte",
				"req", requestID(r), "pid", res.PID, "file", filePath,
				"waitErr", waitErr.Error(), "ffmpegStderr", res.StderrTail)
			http.Error(w, "Transcode failed", http.StatusInternalServerError)
			return res, nil
		}
		res.Failure = "exit"
		t.log.Error("transcode process failed mid-stream",
			"req", requestID(r), "pid", res.PID, "file", filePath,
			"bytes", res.Bytes, "waitErr", waitErr.Error(),
			"ffmpegStderr", res.StderrTail)
	} else if waitErr == nil {
		t.log.Info("transcode complete",
			"req", requestID(r), "pid", res.PID, "file", filePath,
			"bytes", res.Bytes, "spawnMs", float64(res.SpawnNanos)/1e6)
	}
	return res, nil
}

// livePIDSnapshot returns the ffmpeg PIDs currently tracked (test aid).
func (t *transcodeStreamer) livePIDSnapshot() []int {
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
