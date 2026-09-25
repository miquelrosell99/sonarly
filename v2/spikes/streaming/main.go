// Demo server for the S2 streaming spike. NOT imported by cmd/sonarly.
//
//	go run . -addr 127.0.0.1:18099 -cap 2 -media ./media
//
// Routes (mirror of the planned P5 StreamingService split):
//
//	GET /direct/<file>          ServeContent mode (stdlib range handling)
//	GET /direct/<file>?mode=v1  custom v1-parity range handler
//	GET /transcode/<file>?format=mp3&maxBitRate=128   semaphore-capped ffmpeg pipe
//
// Both direct modes bypass the transcode semaphore by construction (cap lives
// in the TranscodingStreamer only).
package main

import (
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type streamingService struct {
	mediaDir string
	log      *slog.Logger
	direct   http.HandlerFunc
	tr       *transcodeStreamer
}

func newStreamingService(mediaDir string, tr *transcodeStreamer, log *slog.Logger) *streamingService {
	return &streamingService{mediaDir: mediaDir, log: log, tr: tr}
}

func (s *streamingService) routes(mux *http.ServeMux) {
	mux.HandleFunc("/direct/", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/direct/")
		filePath := filepath.Join(s.mediaDir, filepath.Clean("/"+name))
		if r.URL.Query().Get("mode") == "v1" {
			directCustomV1(w, r, filePath)
			return
		}
		directServeContent(w, r, filePath)
	})
	mux.HandleFunc("/transcode/", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/transcode/")
		filePath := filepath.Join(s.mediaDir, filepath.Clean("/"+name))
		format := r.URL.Query().Get("format")
		if format == "" {
			format = "mp3"
		}
		maxKbps := 0
		if raw := r.URL.Query().Get("maxBitRate"); raw != "" {
			if v, ok := parseMaxBitRate(raw); ok {
				maxKbps = v
			}
		}

		if r.Method == http.MethodHead {
			// v1 parity: HEAD on a transcode-decided stream → headers only.
			w.Header().Set("Content-Type", transcodeContentType(format))
			w.Header().Set("Accept-Ranges", "none")
			w.WriteHeader(http.StatusOK)
			return
		}

		res, err := s.tr.stream(w, r, filePath, format, maxKbps)
		if err != nil {
			switch {
			case err == errSlotsFull:
				w.Header().Set("Retry-After", "3")
				http.Error(w, "Transcode slots full", http.StatusServiceUnavailable)
			default:
				// Spawn/pipe failure BEFORE any body byte: v1 B12-parity fallback
				// to direct serving is possible here because Go surfaces spawn
				// errors synchronously (measured in tests).
				s.log.Error("transcode spawn failed, falling back to direct",
					"req", requestID(r), "file", filePath, "err", err.Error())
				directServeContent(w, r, filePath)
			}
			return
		}
		_ = res
	})
}

func main() {
	addr := flag.String("addr", "127.0.0.1:18099", "listen address")
	capN := flag.Int("cap", 2, "max concurrent transcodes")
	mediaDir := flag.String("media", "./media", "media directory")
	flag.Parse()

	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	tr := newTranscodeStreamer(*capN, log)
	svc := newStreamingService(*mediaDir, tr, log)
	mux := http.NewServeMux()
	svc.routes(mux)

	log.Info("spike server listening", "addr", *addr, "cap", *capN, "media", *mediaDir)
	if err := http.ListenAndServe(*addr, mux); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
