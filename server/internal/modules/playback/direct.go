package playback

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// contentTypeByExt is the pinned the retired server mime-types table, measured in the S2
// spike against the old server's node_modules (docs/s2-streaming-findings.md §3.2):
// flac → audio/x-flac (NOT audio/flac), wav → audio/wav (NOT audio/x-wav),
// opus → audio/ogg. Host mime databases differ and container images may lack
// /etc/mime.types entirely — Content-Type must never depend on the host.
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
	if ct, ok := contentTypeByExt[strings.ToLower(strings.TrimPrefix(filepath.Ext(filePath), "."))]; ok {
		return ct
	}
	return "application/octet-stream"
}

// DirectStreamer serves files as-is behind the S2 wire-parity guards. It is
// stateless — the zero value is ready to use.
type DirectStreamer struct{}

// Stream answers w with the file at filePath. Guards, in order:
//
//   - missing/unopenable file → 404 (old answered a Subsonic code-70 envelope
//     on the /rest routes; the native route has no envelope, 404 is the Go
//     error contract);
//   - ?download variant → Content-Disposition with the old filename sanitization
//     and encodeURIComponent-shaped filename* parameter;
//   - HEAD → Range header stripped before handing to ServeContent, so HEAD
//     answers 200 + full Content-Length exactly like the retired server (S2 delta 3);
//   - Range header present but invalid for the old server (multi-range, zero suffix,
//     unparseable) → 416 + "Invalid range" (S2 surprises 1 and 2);
//   - otherwise http.ServeContent does the I/O: single-range 206s are
//     byte-identical to the retired server, and Last-Modified/If-Modified-Since → 304 is the
//     accepted the Go server improvement (S2 sign-off S3).
//
// Accept-Ranges: bytes is set explicitly because ServeContent only sets it on
// 206; the retired server advertised it on full 200s too.
func (DirectStreamer) Stream(w http.ResponseWriter, r *http.Request, filePath string, download bool) {
	f, err := os.Open(filePath)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	h := w.Header()
	h.Set("Content-Type", contentTypeFor(filePath))
	if download {
		h.Set("Content-Disposition", contentDisposition(filepath.Base(filePath)))
	}

	if r.Method == http.MethodHead {
		// the retired server special-cases HEAD before range parsing: 200 + full size, the
		// Range header is ignored. ServeContent would answer 206.
		head := r.Clone(r.Context())
		head.Header = r.Header.Clone()
		head.Header.Del("Range")
		h.Set("Accept-Ranges", "bytes")
		http.ServeContent(w, head, st.Name(), st.ModTime(), f)
		return
	}

	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		if _, ok := parseRangeLegacy(rangeHeader, st.Size()); !ok {
			w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
			io.WriteString(w, "Invalid range")
			return
		}
	}

	h.Set("Accept-Ranges", "bytes")
	http.ServeContent(w, r, st.Name(), st.ModTime(), f)
}

// contentDisposition ports the retired server download.view:
//
//	attachment; filename="<safe>"; filename*=UTF-8''<encodeURIComponent(name)>
//
// safe replaces " \ and CR/LF with _ (the old filename.replace); the filename*
// parameter replicates JS encodeURIComponent's unreserved set so the header
// is byte-identical to the retired server for filenames containing e.g. parentheses.
func contentDisposition(filename string) string {
	safe := strings.NewReplacer(`"`, "_", `\`, "_", "\r", "_", "\n", "_").Replace(filename)
	return `attachment; filename="` + safe + `"; filename*=UTF-8''` + encodeURIComponent(filename)
}

// encodeURIComponent mirrors JavaScript's encodeURIComponent: every byte
// outside A-Za-z0-9 and - _ . ! ~ * ' ( ) is percent-encoded (uppercase hex,
// UTF-8 bytes for non-ASCII).
func encodeURIComponent(s string) string {
	const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if strings.IndexByte(unreserved, c) >= 0 {
			b.WriteByte(c)
		} else {
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&0x0f])
		}
	}
	return b.String()
}
