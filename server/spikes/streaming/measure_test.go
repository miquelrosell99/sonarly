package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func median(d []time.Duration) time.Duration {
	sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
	return d[len(d)/2]
}

// vmRSSKiB reads VmRSS from /proc/self/status.
func vmRSSKiB(t *testing.T) int64 {
	t.Helper()
	data, err := os.ReadFile("/proc/self/status")
	if err != nil {
		t.Skip("/proc unavailable")
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			f := strings.Fields(line)
			v, _ := strconv.ParseInt(f[1], 10, 64)
			return v // KiB
		}
	}
	return 0
}

// pidRSSKiB reads VmRSS of an arbitrary pid.
func pidRSSKiB(pid int) int64 {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return -1
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			f := strings.Fields(line)
			v, _ := strconv.ParseInt(f[1], 10, 64)
			return v
		}
	}
	return -1
}

// ttfb measures client-side time-to-headers and time-to-first-byte.
func ttfb(t *testing.T, client *http.Client, url string) (time.Duration, time.Duration) {
	t.Helper()
	t0 := time.Now()
	res, err := client.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	headers := time.Since(t0)
	t1 := time.Now()
	one := make([]byte, 1)
	if _, err := res.Body.Read(one); err != nil && err != io.EOF {
		t.Fatal(err)
	}
	firstByte := time.Since(t1)
	res.Body.Close()
	return headers, firstByte
}

func TestMeasureTTFB(t *testing.T) {
	srv, _, _ := newTranscodeServer(t, 2)
	client := &http.Client{Timeout: 60 * time.Second}

	const n = 15
	var directHeaders, directFirst []time.Duration
	for i := 0; i < n; i++ {
		h, f := ttfb(t, client, srv.URL+"/direct/spike_128k.mp3")
		directHeaders = append(directHeaders, h)
		directFirst = append(directFirst, f)
	}
	var transHeaders, transFirst []time.Duration
	for i := 0; i < n; i++ {
		h, f := ttfb(t, client, srv.URL+"/transcode/spike.flac?format=mp3&maxBitRate=128")
		transHeaders = append(transHeaders, h)
		transFirst = append(transFirst, f)
	}

	t.Logf("DIRECT   ttfb-headers median=%s min=%s | first-byte median=%s min=%s",
		median(directHeaders), directHeaders[0], median(directFirst), directFirst[0])
	t.Logf("TRANSCODE ttfb-headers median=%s min=%s | first-byte median=%s min=%s",
		median(transHeaders), transHeaders[0], median(transFirst), transFirst[0])
}

// Raw process spawn cost: exec.Cmd.Start + immediate kill, no HTTP involved.
func TestMeasureSpawnCost(t *testing.T) {
	var durs []time.Duration
	for i := 0; i < 30; i++ {
		cmd := exec.Command("ffmpeg", ffmpegArgs("media/spike.flac", "mp3", 128)...)
		cmd.Stdout = io.Discard
		cmd.Stderr = io.Discard
		t0 := time.Now()
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		durs = append(durs, time.Since(t0))
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}
	t.Logf("ffmpeg exec.Start cost: median=%s min=%s max=%s",
		median(durs), durs[0], durs[len(durs)-1])
}

// Server-side: time from stream() entry to first response byte (includes
// semaphore + spawn + ffmpeg init + first MP3 frame).
type firstByteWriter struct {
	w    http.ResponseWriter
	ch   chan struct{}
	once sync.Once
}

func (f *firstByteWriter) Header() http.Header { return f.w.Header() }
func (f *firstByteWriter) WriteHeader(s int)   { f.w.WriteHeader(s) }
func (f *firstByteWriter) Write(b []byte) (int, error) {
	f.once.Do(func() { close(f.ch) })
	return f.w.Write(b)
}

func TestMeasureServerSideFirstByte(t *testing.T) {
	_, tr, _ := newTranscodeServer(t, 2)
	var durs []time.Duration
	for i := 0; i < 10; i++ {
		rec := httptest.NewRecorder()
		fbw := &firstByteWriter{w: rec, ch: make(chan struct{})}
		req := httptest.NewRequest("GET", "/x", nil)
		t0 := time.Now()
		done := make(chan struct{})
		go func() {
			tr.stream(fbw, req, "media/spike.flac", "mp3", 128)
			close(done)
		}()
		select {
		case <-fbw.ch:
			durs = append(durs, time.Since(t0))
		case <-time.After(10 * time.Second):
			t.Fatal("no first byte in 10s")
		}
		<-done
	}
	t.Logf("server-side spawn→first-byte: median=%s min=%s", median(durs), durs[0])
}

// RSS sanity: 20 concurrent direct range streams + 2 transcodes vs rest.
func TestMeasureRSSUnderLoad(t *testing.T) {
	srv, tr, _ := newTranscodeServer(t, 2)

	runtime.GC()
	time.Sleep(100 * time.Millisecond)
	rest := vmRSSKiB(t)
	var m0 runtime.MemStats
	runtime.ReadMemStats(&m0)
	t.Logf("at rest: VmRSS=%d KiB HeapInuse=%d KiB", rest, m0.HeapInuse/1024)

	stop := make(chan struct{})
	var wg sync.WaitGroup

	// 20 direct range streams, read slowly (~25 ms per 64 KiB read).
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req, _ := http.NewRequest("GET", srv.URL+"/direct/spike_320k.mp3", nil)
			req.Header.Set("Range", "bytes=0-2399999")
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Errorf("range stream: %v", err)
				return
			}
			defer res.Body.Close()
			buf := make([]byte, 64*1024)
			for {
				select {
				case <-stop:
					return
				default:
				}
				if _, err := res.Body.Read(buf); err != nil {
					return
				}
				time.Sleep(25 * time.Millisecond)
			}
		}()
	}

	// 2 transcode streams drained slowly (they stay open the whole window).
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, err := http.Get(srv.URL + "/transcode/spike_2496.flac?format=mp3&maxBitRate=320")
			if err != nil {
				t.Errorf("transcode: %v", err)
				return
			}
			defer res.Body.Close()
			buf := make([]byte, 16*1024)
			for {
				select {
				case <-stop:
					return
				default:
				}
				if _, err := res.Body.Read(buf); err != nil {
					return
				}
				time.Sleep(20 * time.Millisecond)
			}
		}()
	}

	// Let streams establish; sample from t≈0 at 50 ms ticks. ffmpeg encodes
	// this synthetic 60 s file in ~0.5–1 s wall (≈100× realtime — see
	// findings), so early ticks are the ones that catch the children.
	time.Sleep(200 * time.Millisecond)
	var maxRSS int64 = -1
	var ffmpegRSS []int64
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if r := vmRSSKiB(t); r > maxRSS {
			maxRSS = r
		}
		for _, pid := range tr.livePIDSnapshot() {
			if v := pidRSSKiB(pid); v > 0 {
				ffmpegRSS = append(ffmpegRSS, v)
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	close(stop)
	wg.Wait()

	runtime.GC()
	time.Sleep(100 * time.Millisecond)
	after := vmRSSKiB(t)
	var m1 runtime.MemStats
	runtime.ReadMemStats(&m1)

	t.Logf("under load (20 range + 2 transcode): max VmRSS=%d KiB (delta %d KiB)",
		maxRSS, maxRSS-rest)
	t.Logf("ffmpeg children RSS samples: %v KiB", ffmpegRSS)
	t.Logf("after drain+GC: VmRSS=%d KiB (delta vs rest %d KiB), HeapInuse delta=%d KiB",
		after, after-rest, (int64(m1.HeapInuse)-int64(m0.HeapInuse))/1024)
	if maxRSS-rest > 64*1024 {
		t.Errorf("Go RSS grew >64 MiB under streaming load — buffering somewhere?")
	}
	if pids := tr.livePIDSnapshot(); len(pids) > 0 {
		t.Errorf("ffmpeg leaked: %v", pids)
	}
}
