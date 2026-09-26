package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
)

// contentTypeByExt is the deterministic the retired server mime-types table (measured in this
// spike against packages/server node_modules). the retired server answers:
// flac → audio/x-flac (note: NOT audio/flac), wav → audio/wav (NOT audio/x-wav),
// opus → audio/ogg. Host mime databases differ; pinning the map keeps the
// the Go server wire identical to the retired server on any container image.
var contentTypeByExt = map[string]string{
	"mp3":  "audio/mpeg",
	"flac": "audio/x-flac",
	"m4a":  "audio/mp4",
	"ogg":  "audio/ogg",
	"opus": "audio/ogg",
	"aac":  "audio/aac",
	"wav":  "audio/wav",
}

func contentTypeFor(filePath string) string {
	ext := extOf(filePath)
	if ct, ok := contentTypeByExt[ext]; ok {
		return ct
	}
	return "application/octet-stream"
}

func extOf(filePath string) string {
	for i := len(filePath) - 1; i >= 0; i-- {
		if filePath[i] == '.' {
			return toLowerASCII(filePath[i+1:])
		}
		if filePath[i] == '/' {
			return ""
		}
	}
	return ""
}

func toLowerASCII(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

// ---------------------------------------------------------------------------
// Mode A: http.ServeContent (stdlib range handling)
// ---------------------------------------------------------------------------

func directServeContent(w http.ResponseWriter, r *http.Request, filePath string) {
	serveDirect(w, r, filePath, func(w http.ResponseWriter, r *http.Request, f *os.File, st os.FileInfo) {
		w.Header().Set("Content-Type", contentTypeFor(filePath))
		// the retired server sets Accept-Ranges: bytes even on full 200 responses; ServeContent
		// only sets it on 206. Set it up-front for parity (harmless: the 416
		// path in ServeContent doesn't touch it).
		w.Header().Set("Accept-Ranges", "bytes")
		http.ServeContent(w, r, st.Name(), st.ModTime(), f)
	})
}

// ---------------------------------------------------------------------------
// Mode B: wire-parity custom handler (port of retrieval.ts direct path)
// ---------------------------------------------------------------------------

func directCustomV1(w http.ResponseWriter, r *http.Request, filePath string) {
	serveDirect(w, r, filePath, func(w http.ResponseWriter, r *http.Request, f *os.File, st os.FileInfo) {
		size := st.Size()
		h := w.Header()
		h.Set("Content-Type", contentTypeFor(filePath))
		h.Set("Accept-Ranges", "bytes")

		// the retired server special-cases HEAD BEFORE range parsing: 200 + full size,
		// Range header ignored.
		if r.Method == http.MethodHead {
			h.Set("Content-Length", fmt.Sprintf("%d", size))
			w.WriteHeader(http.StatusOK)
			return
		}

		rangeHeader := r.Header.Get("Range")
		if rangeHeader == "" {
			h.Set("Content-Length", fmt.Sprintf("%d", size))
			w.WriteHeader(http.StatusOK)
			streamFile(w, f, 0, size)
			return
		}

		br, ok := parseRangeV1(rangeHeader, size)
		if !ok {
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			io.WriteString(w, "Invalid range")
			return
		}
		h.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", br.start, br.end, size))
		h.Set("Content-Length", fmt.Sprintf("%d", br.end-br.start+1))
		w.WriteHeader(http.StatusPartialContent)
		streamFile(w, f, br.start, br.end-br.start+1)
	})
}

func serveDirect(w http.ResponseWriter, r *http.Request, filePath string, send func(http.ResponseWriter, *http.Request, *os.File, os.FileInfo)) {
	f, err := os.Open(filePath)
	if err != nil {
		// old: statSync throws after index → Subsonic error 70 envelope. A plain
		// 404 is the spike approximation; song-not-in-DB is a plain 404 in the retired server.
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	send(w, r, f, st)
}

// streamFile copies length bytes from f starting at offset in 64 KiB chunks
// (the old fs.createReadStream highWaterMark is 64 KiB; no full-file buffering).
func streamFile(w http.ResponseWriter, f *os.File, offset, length int64) {
	sr := io.NewSectionReader(f, offset, length)
	buf := make([]byte, 64*1024)
	io.CopyBuffer(struct{ io.Writer }{w}, sr, buf)
}
