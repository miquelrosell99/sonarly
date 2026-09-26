package main

import (
	"sort"
	"strings"
	"testing"
)

// Route inventory guard: pins the full native surface — every /api route
// plus the /health, /healthz and /ready probes — so an endpoint disappearing
// from the router (or a new one landing unnoticed) fails CI. The /rest
// OpenSubsonic adapter is a separate contract and deliberately out of scope
// here; server/api/openapi.yaml coverage is guarded separately by
// TestSpecCoversRouter.
//
// Keep this list in sync with the router: adding or retiring a native route
// means updating the inventory in the same change.
var pinnedRoutes = []string{
	"DELETE /api/admin/ingest-runs",
	"DELETE /api/admin/ingest-runs/{id}",
	"DELETE /api/admin/libraries/{id}",
	"DELETE /api/admin/libraries/{id}/users/{userId}",
	"DELETE /api/admin/missing/albums",
	"DELETE /api/admin/missing/albums/{id}",
	"DELETE /api/admin/missing/artists",
	"DELETE /api/admin/missing/artists/{id}",
	"DELETE /api/admin/missing/songs",
	"DELETE /api/admin/missing/songs/{id}",
	"DELETE /api/admin/users/{id}",
	"DELETE /api/admin/users/{id}/libraries/{libraryId}",
	"DELETE /api/albums/{id}",
	"DELETE /api/albums/{id}/cover-art",
	"DELETE /api/artists/{id}",
	"DELETE /api/conflicts",
	"DELETE /api/genres/{id}",
	"DELETE /api/ingest",
	"DELETE /api/ingest/{id}",
	"DELETE /api/playlists/{id}",
	"DELETE /api/playlists/{id}/share-link",
	"DELETE /api/playlists/{id}/share/{userId}",
	"DELETE /api/songs/{id}",
	"DELETE /api/songs/{id}/bookmark",
	"DELETE /api/songs/{id}/cover-art",
	"GET /api/admin/ingest-runs",
	"GET /api/admin/ingest-runs/{id}",
	"GET /api/admin/libraries",
	"GET /api/admin/libraries/{id}/users",
	"GET /api/admin/missing",
	"GET /api/admin/status",
	"GET /api/admin/system-tasks",
	"GET /api/admin/system-tasks/history",
	"GET /api/admin/users",
	"GET /api/admin/users/{id}/libraries",
	"GET /api/albums",
	"GET /api/albums/{id}",
	"GET /api/artist-images/{id}",
	"GET /api/artists",
	"GET /api/artists/{id}",
	"GET /api/artists/{id}/songs",
	"GET /api/avatars/{id}",
	"GET /api/bookmarks",
	"GET /api/conflicts",
	"GET /api/cover-art/{id}",
	"GET /api/events",
	"GET /api/genres",
	"GET /api/genres/{id}/albums",
	"GET /api/genres/tree",
	"GET /api/home",
	"GET /api/ingest",
	"GET /api/ingest/{id}",
	"GET /api/libraries",
	"GET /api/lrclib/search",
	"GET /api/me",
	"GET /api/me/preferences",
	"GET /api/musicbrainz/search",
	"GET /api/organize/preview",
	"GET /api/organize/status/{jobId}",
	"GET /api/playback/auto-dj",
	"GET /api/players",
	"GET /api/playlists",
	"GET /api/playlists/{id}",
	"GET /api/playlists/{id}/albums",
	"GET /api/scans/status",
	"GET /api/search",
	"GET /api/settings/media",
	"GET /api/setup",
	"GET /api/songs",
	"GET /api/songs/{id}",
	"GET /api/songs/{id}/lyrics",
	"GET /api/statistics/me",
	"GET /api/statistics/me/monthly-grouped",
	"GET /api/statistics/overall",
	"GET /api/statistics/users/{id}",
	"GET /api/statistics/users/{id}/monthly-grouped",
	"GET /api/stream/{id}",
	"GET /api/suggestions",
	"GET /api/upload/sessions/{id}",
	"GET /api/users/lookup",
	"GET /api/years",
	"GET /health",
	"GET /healthz",
	"GET /ready",
	"HEAD /api/stream/{id}",
	"PATCH /api/me/preferences",
	"PATCH /api/settings/media",
	"POST /api/admin/artists/refetch",
	"POST /api/admin/libraries",
	"POST /api/admin/libraries/{id}/users",
	"POST /api/admin/system-tasks/{taskId}/run",
	"POST /api/admin/users",
	"POST /api/admin/users/{id}/libraries",
	"POST /api/albums/{id}/cover-art",
	"POST /api/client-errors",
	"POST /api/favorites",
	"POST /api/genres",
	"POST /api/ingest/trigger",
	"POST /api/login",
	"POST /api/logout",
	"POST /api/me/avatar",
	"POST /api/organize",
	"POST /api/organize/job",
	"POST /api/playback/auto-dj",
	"POST /api/playlists",
	"POST /api/playlists/{id}/share",
	"POST /api/playlists/{id}/share-link",
	"POST /api/ratings",
	"POST /api/scans",
	"POST /api/setup",
	"POST /api/songs/{id}/cover-art",
	"POST /api/songs/{id}/scrobble",
	"POST /api/upload/sessions",
	"POST /api/upload/sessions/{id}/complete",
	"POST /api/upload/sessions/{id}/files/{fileId}/complete",
	"PUT /api/admin/libraries/{id}",
	"PUT /api/admin/users/{id}",
	"PUT /api/albums/{id}/tags",
	"PUT /api/genres/{id}",
	"PUT /api/playlists/{id}",
	"PUT /api/songs/{id}/bookmark",
	"PUT /api/songs/{id}/lyrics",
	"PUT /api/songs/{id}/tags",
	"PUT /api/songs/tags",
	"PUT /api/upload/sessions/{id}/files/{fileId}/chunks/{index}",
}

func TestRouteInventory(t *testing.T) {
	router := newContractRouter(t)
	walked := walkedRoutes(t, router)

	registered := map[string]bool{}
	for key := range walked {
		_, route, _ := strings.Cut(key, " ")
		if !inSpecScope(route) {
			continue // /rest adapter: separate contract, own table
		}
		registered[key] = true
	}

	pinned := map[string]bool{}
	for _, key := range pinnedRoutes {
		if pinned[key] {
			t.Errorf("pinned inventory has a duplicate entry: %s", key)
			continue
		}
		pinned[key] = true
		if !registered[key] {
			t.Errorf("pinned route not registered: %s", key)
		}
	}

	var extra []string
	for key := range registered {
		if !pinned[key] {
			extra = append(extra, key)
		}
	}
	if len(extra) > 0 {
		sort.Strings(extra)
		t.Errorf("registered routes missing from the pinned inventory:\n  %s", strings.Join(extra, "\n  "))
	}

	t.Logf("inventory: %d pinned native routes, %d registered in scope", len(pinnedRoutes), len(registered))
}
