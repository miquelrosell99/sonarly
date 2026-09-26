// Package playback hosts the playback domain: streaming (direct serving and
// ffmpeg transcoding behind one decision function), scrobbling, and
// bookmarks. It is the v2 replacement for v1's
// features/{transcode,opensubsonic/routes/retrieval,songs scrobble,bookmarks}
// paths and implements the architecture the S2 spike signed off
// (docs/v2-s2-streaming-findings.md §8): one StreamingService-shaped service
// that both the native routes here and the future OpenSubsonic adapter
// (P6/P9) reuse.
//
// Layering follows the v2 convention (routes → service → streamers/repository):
// routes parse and validate HTTP, the service enforces liveness + library
// scope and orchestrates, DirectStreamer and TranscodingStreamer own the wire
// behavior.
//
// Streaming semantics (all measured/frozen by S2):
//
//   - Liveness + scope: the song must be active = 1 AND inside the caller's
//     library scope, else 404 — inactive songs were an audit gap (S5) that v1
//     silently streamed. Out-of-scope ids are indistinguishable from missing
//     ones (same contract as the catalog module).
//   - Direct: http.ServeContent behind the v1-parity guards (multi-range →
//     416, bytes=-0 → 416, HEAD strips Range so it answers 200 + full size),
//     a pinned Content-Type map (v1 mime-types values — never the host's
//     /etc/mime.types), explicit Accept-Ranges: bytes, and the accepted v2
//     improvements Last-Modified + If-Modified-Since → 304 (sign-off S3).
//   - Transcode: exec.CommandContext bound to the request context (client
//     disconnect SIGKILLs ffmpeg, measured 3.4 ms), argv-style spawn (no
//     shell), stdout streamed in 64 KiB chunks, no Content-Length, Range
//     headers ignored (v1 parity), Accept-Ranges: none. ffmpeg dying before
//     its first byte answers 500 instead of v1's empty 200 (accepted
//     deviation, sign-off S2); dying mid-stream truncates the 200 and is
//     logged via slog with the request ID and the stderr tail.
//   - Concurrency: a buffered-channel semaphore (default cap 2,
//     SONARLY_TRANSCODE_CONCURRENCY) owned by the TranscodingStreamer.
//     Saturation rejects with 503 + Retry-After: 3 immediately — no queue
//     (sign-off S1). Direct streams never touch the semaphore.
//   - ffmpeg path: SONARLY_FFMPEG_PATH defaults to PATH lookup. A missing or
//     unexecutable binary surfaces synchronously from exec.Start (Go has no
//     v1-B12 async-spawn trap), so the service falls back to direct file
//     serving with zero bytes written.
//   - HEAD on a transcode-decided stream answers headers only (Content-Type
//     by format, Accept-Ranges: none) and spawns no process (v1 parity).
//   - ?download=1 forces the direct variant with v1 download.view's
//     Content-Disposition (sanitized filename + encodeURIComponent-shaped
//     filename* parameter) and never transcodes.
//
// Scrobble semantics: POST /api/songs/{id}/scrobble validates the body with
// v1's parseScrobbleBody rules (audit B13: completion clamped to [0,100],
// durationListened clamped to >= 0, playedAt must parse as a date, type
// errors are 400s; client/source are additionally bounded to 255 characters,
// a v2 hardening over v1) and then upserts user_songs (play_count + 1,
// last_played) and inserts the listening_history row in ONE transaction.
// There is deliberately no idempotency key: v1 has none, so a retried
// scrobble double-counts exactly like v1; if that ever changes it changes in
// both implementations together.
//
// Bookmark semantics: PK (user_id, song_id) upsert (v1 createBookmark); GET
// /api/bookmarks lists the caller's own bookmarks joined with song display
// info, dropping bookmarks whose song is inactive or out of scope; DELETE is
// a no-op success for a missing bookmark (v1 parity).
//
// Deferred by design: share-token streaming (the `share` query parameter is
// reserved and answered 404 until P6), GET /api/players (needs the SSE /
// now-playing subsystem, P8 — recordStream play accounting lands with it),
// and the OpenSubsonic stream/download adapter endpoints (P6/P9), which will
// reuse this service so play behavior stays identical across adapters.
package playback
