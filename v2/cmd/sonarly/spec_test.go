// Spec coverage test: walks the production chi router (the one mountRoutes
// registers) and asserts v2/api/openapi.yaml documents exactly the native
// routes — the spec cannot drift from the code silently.
//
// Scope: every /api route plus /health and /ready. The OpenSubsonic adapter
// under /rest is a separate (Subsonic-compatible) contract and is
// deliberately excluded: the test fails if /rest routes ever leak into the
// spec, and fails if a registered native route is missing from it.
package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"gopkg.in/yaml.v3"

	"github.com/miquelrosell99/sonarly/v2/internal/config"
	"github.com/miquelrosell99/sonarly/v2/internal/db"
	"github.com/miquelrosell99/sonarly/v2/internal/httpserver"
)

const specPath = "../../api/openapi.yaml"

// httpMethods is the OpenAPI operation-key set (lowercase).
var httpMethods = map[string]bool{
	"get": true, "post": true, "put": true, "delete": true,
	"head": true, "options": true, "patch": true, "trace": true,
}

type openAPISpec struct {
	OpenAPI    string                    `yaml:"openapi"`
	Paths      map[string]map[string]any `yaml:"paths"`
	Components struct {
		Schemas         map[string]any `yaml:"schemas"`
		Responses       map[string]any `yaml:"responses"`
		Parameters      map[string]any `yaml:"parameters"`
		SecuritySchemes map[string]any `yaml:"securitySchemes"`
	} `yaml:"components"`
}

// loadSpec parses the OpenAPI document next to the v2 module root.
func loadSpec(t *testing.T) *openAPISpec {
	t.Helper()
	raw, err := os.ReadFile(specPath)
	if err != nil {
		t.Fatalf("read spec: %v", err)
	}
	var spec openAPISpec
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse spec: %v", err)
	}
	return &spec
}

// newContractRouter mounts the production route registry on a scratch
// database. No goroutine starts; only route registration runs.
func newContractRouter(t *testing.T) chi.Router {
	t.Helper()
	dir := t.TempDir()
	database, err := db.Open(context.Background(), filepath.Join(dir, "sonarly.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.Migrate(context.Background(), database); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	cfg := config.Config{
		DataDir:              filepath.Join(dir, "data"),
		LibraryPath:          filepath.Join(dir, "library"),
		IngestPath:           filepath.Join(dir, "ingest"),
		SessionSecret:        "0123456789abcdef0123456789abcdef",
		TranscodeConcurrency: 1,
		FFmpegPath:           "ffmpeg",
	}
	srv := httpserver.New(cfg, discardLogger())
	if _, err := mountRoutes(context.Background(), srv, database, cfg, discardLogger()); err != nil {
		t.Fatalf("mountRoutes: %v", err)
	}
	return srv.Router()
}

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// walkedRoutes flattens the chi router into "METHOD /path" keys. Route
// groups that only nest other routes (no handler of their own) are skipped
// by chi.Walk automatically.
func walkedRoutes(t *testing.T, r chi.Router) map[string]bool {
	t.Helper()
	routes := map[string]bool{}
	err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		routes[method+" "+normalizeChiRoute(route)] = true
		return nil
	})
	if err != nil {
		t.Fatalf("chi.Walk: %v", err)
	}
	return routes
}

// normalizeChiRoute maps chi's registration shape to the canonical URL a
// client uses: chi registers index routes inside r.Route("/x") as "/x/"
// (answering the mount point via redirect); the spec documents "/x".
func normalizeChiRoute(route string) string {
	if route != "/" {
		route = strings.TrimSuffix(route, "/")
	}
	return route
}

// specRoutes flattens spec paths into "METHOD /path" keys.
func specRoutes(spec *openAPISpec) map[string]bool {
	routes := map[string]bool{}
	for path, ops := range spec.Paths {
		for method := range ops {
			if !httpMethods[method] {
				continue
			}
			routes[strings.ToUpper(method)+" "+path] = true
		}
	}
	return routes
}

func inSpecScope(route string) bool {
	return route == "/health" || route == "/ready" || strings.HasPrefix(route, "/api/")
}

func TestSpecCoversRouter(t *testing.T) {
	spec := loadSpec(t)
	router := newContractRouter(t)
	walked := walkedRoutes(t, router)
	documented := specRoutes(spec)

	var missing []string
	for key := range walked {
		method, route, _ := strings.Cut(key, " ")
		if !inSpecScope(route) {
			continue // /rest adapter: separate contract, must not be here
		}
		if !documented[key] {
			missing = append(missing, key)
		}
		// A registered route the spec knows nothing about (no path entry at
		// all) is a different failure than a missing operation.
		if _, ok := spec.Paths[route]; !ok {
			missing = append(missing, method+" "+route+" (path not in spec)")
		}
	}

	var undocumented []string
	for key := range documented {
		_, route, _ := strings.Cut(key, " ")
		if !inSpecScope(route) {
			undocumented = append(undocumented, key+" (out of scope — only /api, /health, /ready belong here)")
			continue
		}
		if !walked[key] {
			undocumented = append(undocumented, key)
		}
	}

	if len(missing) > 0 || len(undocumented) > 0 {
		sort.Strings(missing)
		sort.Strings(undocumented)
		t.Errorf("registered routes missing from the spec:\n  %s", strings.Join(missing, "\n  "))
		t.Errorf("spec routes with no registered handler:\n  %s", strings.Join(undocumented, "\n  "))
	}

	// The /rest adapter must never drift into this spec.
	for key := range documented {
		if _, route, _ := strings.Cut(key, " "); strings.HasPrefix(route, "/rest") {
			t.Errorf("spec documents OpenSubsonic route %s — the native spec must not cover /rest", key)
		}
	}

	t.Logf("coverage: %d router routes checked against %d spec operations", len(walked), len(documented))
}

// TestSpecInvariants pins the structural promises the codegen pipeline and
// the web client rely on, independent of any external linter.
func TestSpecInvariants(t *testing.T) {
	spec := loadSpec(t)

	if !strings.HasPrefix(spec.OpenAPI, "3.1") {
		t.Errorf(`openapi = %q, want 3.1.x (nullable-free union types depend on it)`, spec.OpenAPI)
	}
	if len(spec.Paths) == 0 {
		t.Fatal("spec has no paths")
	}

	// Every operation must declare responses.
	for path, ops := range spec.Paths {
		for method, op := range ops {
			if !httpMethods[method] {
				continue
			}
			doc, ok := op.(map[string]any)
			if !ok {
				t.Errorf("%s %s: operation is not a mapping", strings.ToUpper(method), path)
				continue
			}
			responses, ok := doc["responses"].(map[string]any)
			if !ok || len(responses) == 0 {
				t.Errorf("%s %s: operation declares no responses", strings.ToUpper(method), path)
			}
		}
	}

	// The SSE feed must be marked as such — the web client's EventSource
	// depends on the content type.
	events, ok := spec.Paths["/api/events"]["get"].(map[string]any)
	if !ok {
		t.Fatal("/api/events GET missing from spec")
	}
	responses := events["responses"].(map[string]any)
	ok200 := responses["200"].(map[string]any)
	content := ok200["content"].(map[string]any)
	if _, ok := content["text/event-stream"]; !ok {
		t.Error("/api/events 200 must be text/event-stream")
	}

	// Auth contract: session cookie (+ API key header) must stay declared.
	if _, ok := spec.Components.SecuritySchemes["sessionId"]; !ok {
		t.Error("security scheme sessionId (cookie) missing")
	}
	if _, ok := spec.Components.SecuritySchemes["apiKey"]; !ok {
		t.Error("security scheme apiKey (X-API-Key header) missing")
	}

	// Every local $ref must resolve — a renamed schema must not leave
	// dangling references behind.
	raw, err := os.ReadFile(specPath)
	if err != nil {
		t.Fatalf("read spec: %v", err)
	}
	refRe := regexp.MustCompile(`\$ref: '#/components/(schemas|responses|parameters|securitySchemes)/([A-Za-z0-9]+)'`)
	seen := map[string]bool{}
	for _, m := range refRe.FindAllStringSubmatch(string(raw), -1) {
		kind, name := m[1], m[2]
		if seen[kind+"/"+name] {
			continue
		}
		seen[kind+"/"+name] = true
		var table map[string]any
		switch kind {
		case "schemas":
			table = spec.Components.Schemas
		case "responses":
			table = spec.Components.Responses
		case "parameters":
			table = spec.Components.Parameters
		case "securitySchemes":
			table = spec.Components.SecuritySchemes
		}
		if _, ok := table[name]; !ok {
			t.Errorf("$ref to unknown %s %q", kind, name)
		}
	}
}

// TestShareTokenQueryAndHead guards two shapes that are easy to lose in a
// spec edit: the stream HEAD handler and the playlist shareToken query.
func TestSpecKeepsStreamingAndShareShapes(t *testing.T) {
	spec := loadSpec(t)

	stream, ok := spec.Paths["/api/stream/{id}"]
	if !ok {
		t.Fatal("/api/stream/{id} missing from spec")
	}
	if _, ok := stream["head"]; !ok {
		t.Error("/api/stream/{id} HEAD missing from spec (chi registers it explicitly, v1 parity)")
	}
	get := stream["get"].(map[string]any)
	names := paramNames(get["parameters"].([]any), spec)
	for _, want := range []string{"id", "maxBitRate", "download", "share"} {
		if !names[want] {
			t.Errorf("/api/stream/{id} GET missing %q query/path parameter", want)
		}
	}

	playlist := spec.Paths["/api/playlists/{id}"]["get"].(map[string]any)
	if !paramNames(playlist["parameters"].([]any), spec)["shareToken"] {
		t.Error("/api/playlists/{id} GET missing shareToken query parameter")
	}
}

// paramNames collects the `name` of every parameter, resolving local
// `#/components/parameters/...` $refs the way codegen would.
func paramNames(params []any, spec *openAPISpec) map[string]bool {
	names := map[string]bool{}
	for _, p := range params {
		doc, ok := p.(map[string]any)
		if !ok {
			continue
		}
		if ref, ok := doc["$ref"].(string); ok {
			name := strings.TrimPrefix(ref, "#/components/parameters/")
			if param, ok := spec.Components.Parameters[name].(map[string]any); ok {
				if n, ok := param["name"].(string); ok {
					names[n] = true
				}
			}
			continue
		}
		if name, ok := doc["name"].(string); ok {
			names[name] = true
		}
	}
	return names
}
