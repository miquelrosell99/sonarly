// Package catalog hosts the read-only catalog domain: songs, albums,
// artists, genres, years, and cover art blobs. It is the Go server replacement for
// the old features/{songs,albums,artists,genres,years,cover-art} read paths.
//
// Layering follows the Go server convention (routes → service → repository): routes
// parse and validate HTTP, services resolve the caller's library scope and
// enforce it on every read, repositories run raw parameterized SQL and map
// rows to DTOs.
//
// Scope rules (features/libraries/policy.go in the retired server, internal/modules/libraries
// here): admins are unrestricted; other users only reach songs in libraries
// assigned via user_libraries; songs with a NULL library_id are admin-only.
// List queries carry the scope as a WHERE condition; detail endpoints probe
// the policy one-shots and answer 404, never 403, so out-of-scope ids cannot
// be distinguished from missing ones.
//
// JSON-column parsing is defensive (audit Q6): one malformed producers /
// synced_lyrics / catalog_numbers column omits that field instead of failing
// the whole response.
//
// Song DTOs deliberately exclude filePath and checksum. the retired server leaked the
// absolute server path and content hash in every song response; the retired server web
// client only ever displayed the path (cosmetic info popover in the edit
// modal) and nothing consumes checksum outside test mocks. The admin
// missing-files view is served by its own endpoint (/admin/missing), not the
// catalog API, so nothing in the Go server web client needs either field.
package catalog
