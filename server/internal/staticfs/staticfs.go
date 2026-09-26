// Package staticfs serves the built web client (web-dist) with SPA
// fallback (the last functional gap closed before cutover — packages/server app.ts
// serves web-dist through fastify-static with a NotFoundHandler that
// answers extensionless GET routes with index.html).
//
// Mount installs the handler on the router's NotFound hook — the clean chi
// idiom for a catch-all that must never shadow API routes: registered
// routes (all of /api/* and /rest/*) keep precedence, and the handler only
// sees requests nothing else claimed. When the web-dist directory does not
// exist, Mount is a no-op and the server stays API-only exactly as before.
package staticfs

import (
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// Handler serves files from root, falling back to index.html for
// extensionless GET routes (the SPA's client-side router owns those URLs).
type Handler struct {
	root  string
	index string
}

// New returns a Handler for dir, or (nil, nil) when dir does not exist —
// the caller then skips mounting and the server runs API-only.
func New(dir string) (*Handler, error) {
	info, err := os.Stat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("stat web dist: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("web dist %s is not a directory", dir)
	}
	return &Handler{root: dir, index: filepath.Join(dir, "index.html")}, nil
}

// Mount installs the SPA fallback on r's NotFound handler. A missing dir
// leaves r untouched (API-only mode); any other stat failure is an error.
func Mount(r chi.Router, dir string) error {
	h, err := New(dir)
	if err != nil {
		return err
	}
	if h == nil {
		return nil
	}
	r.NotFound(h.ServeHTTP)
	return nil
}

// ServeHTTP is the NotFound fallback: /api/* and /rest/* keep the API's
// JSON 404 shape, existing files are served with explicit content types
// and cache headers, extensionless GETs get index.html (status 200), and
// everything else is a JSON 404 like any unmatched API route.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if isAPIPath(r.URL.Path) {
		writeError(w, http.StatusNotFound, "Not Found")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeError(w, http.StatusNotFound, "Not Found")
		return
	}

	full, ok := h.resolve(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "Not Found")
		return
	}
	if info, err := os.Stat(full); err == nil && info.Mode().IsRegular() {
		h.serveFile(w, r, full, info.ModTime())
		return
	}

	// SPA fallback: only URLs a file could never own. A missing path with
	// an extension is a genuine miss and keeps the 404 (the old server served
	// index.html for those too; the Go server is stricter so a broken asset URL cannot silently
	// return HTML).
	if path.Ext(r.URL.Path) == "" {
		h.serveFile(w, r, h.index, time.Time{})
		return
	}
	writeError(w, http.StatusNotFound, "Not Found")
}

// resolve maps a URL path to a file under root with traversal contained:
// the path is cleaned (neutralizing ../..) and the result must stay under
// root before anything touches the filesystem.
func (h *Handler) resolve(urlPath string) (string, bool) {
	rel := path.Clean("/" + urlPath) // "/" prefix makes Clean treat it as absolute
	full := filepath.Join(h.root, filepath.FromSlash(rel))
	if full != h.root && !strings.HasPrefix(full, h.root+string(os.PathSeparator)) {
		return "", false
	}
	return full, true
}

// serveFile streams a file with the extension-mapped content type and the
// cache policy: index.html is never cached, everything else may live for an
// hour (the web build fingerprints its js/css assets).
func (h *Handler) serveFile(w http.ResponseWriter, r *http.Request, full string, modTime time.Time) {
	ext := strings.ToLower(path.Ext(full))
	w.Header().Set("Content-Type", contentType(ext))
	if ext == ".html" {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "max-age=3600")
	}
	f, err := os.Open(full)
	if err != nil {
		writeError(w, http.StatusNotFound, "Not Found")
		return
	}
	defer f.Close()
	// ServeContent supplies Range/If-Modified-Since/HEAD handling. A zero
	// modTime disables the Last-Modified/304 path for index.html: the SPA
	// shell must revalidate every load, and the packaged build carries no
	// meaningful mtime.
	http.ServeContent(w, r, path.Base(full), modTime, f)
}

func isAPIPath(p string) bool {
	return p == "/api" || p == "/rest" || strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/rest/")
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	fmt.Fprintf(w, `{"error":%q}`, msg)
}

// contentType is the small explicit mime map for the web build's assets.
// It is embedded (rather than mime.TypeByExtension, which leans on the
// host's /etc/mime.types — absent or spotty in slim images) so content
// types are identical in every environment.
func contentType(ext string) string {
	switch ext {
	case ".html":
		return "text/html; charset=utf-8"
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".json", ".map":
		return "application/json"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".ico":
		return "image/x-icon"
	case ".woff2":
		return "font/woff2"
	case ".txt":
		return "text/plain; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}
