# Sonarly v2 — Go rewrite (exploration branch)

Greenfield Go implementation of the Sonarly server, started on `feat/go-rewrite`
per Decision Record DR-1 in `docs/audits/2026-09-24-backend-architecture-audit.md`.

## Status

Early scaffold. The v1 TypeScript server (`packages/server`) remains the
production codebase and continues to receive fixes; v2 proceeds until it
reaches functional parity with the audit's target architecture (audit §16–§19)
before any cutover discussion.

## Stack

- Go 1.23, `net/http` + chi v5
- SQLite via `modernc.org/sqlite` (pure Go, no CGO) — WAL, foreign keys,
  busy_timeout, synchronous=NORMAL, single connection (one writer)
- Migrations: embedded SQL files, ledger table, per-file transactions
  (same semantics as v1's `db/migrate.ts`)
- Graceful shutdown via `signal.NotifyContext`
- Library runtime (P4b): DB-backed job queue with typed payloads and
  coalescing, a single-goroutine worker executing scans with transactional
  per-song persistence, a pure-Go polling library watcher, and interval
  schedulers — all context-driven (see `internal/modules/library/`)
- Playlists (P6): static + smart playlists with a single access policy
  (owner/edit/view/none), per-user shares, link sharing with share tokens
  (crypto/rand, minted iff visibility=link), a whitelisting smart-playlist
  SQL compiler (fully parameterized; inPlaylist ownership checks; genre via
  the song_genres junction), and the streaming endpoint's anonymous
  share-token hook — see `internal/modules/playlists/`
- Uploads (P7a): chunked upload sessions (raw-body chunks, streaming
  reassembly with an incremental 1 GiB cap, typed missing-chunk 4xx) plus a
  stale-session sweeper v1 lacked — see `internal/modules/uploads/`. Ingest
  job execution itself is P7b; the queue accepts the typed payload now.
- Search + statistics + home + auto-dj + events + players (P8): FTS5
  prefix search maintained inside PersistSong's transaction (regular, not
  external-content FTS5 tables — the build's xUpdate lacks REPLACE
  semantics and reports SQLITE_CORRUPT for deletes of absent rowids),
  consolidated statistics (six statements per request; the global rating
  average is computed once per request in a MATERIALIZED CTE), the home
  aggregator, the auto-dj scoring port (generation failures answer 502,
  never v1's silent empty 200), a session-only SSE feed fanning the
  worker's job events out with a 30s heartbeat, and a now-playing tracker
  hooked into the playback service so EVERY stream is counted (v1 only saw
  Subsonic clients) — see `internal/modules/{search,statistics,home,autodj,events,players}/`
- OpenSubsonic adapter (P6.5/P9a/P9b): the full `/rest` surface over the
  same services — envelope + auth hook (P6.5), 24 browsing/retrieval
  endpoints (P9a), and the starring/now-playing/playlist/bookmark endpoints
  (P9b) against `docs/v2-opensubsonic-quirks.md`; playlist and bookmark
  endpoints delegate to the playlists/playback modules so there is ONE
  policy and ONE data path — see `internal/modules/opensubsonic/`
- Interactions (P9c start): native favorites/ratings (POST /api/favorites,
  /api/ratings) writing the same user_* junction rows as the adapter, the
  /api/me/preferences read/patch surface behind an explicit key allowlist,
  and the /api/avatars/{id} 404 stub — see `internal/modules/interactions/`
  and `internal/modules/users/preferences.go`

## Layout

```
cmd/sonarly/        entrypoint
internal/config/    env config (SESSION_SECRET >= 32 chars required)
internal/db/        connection pragmas + embedded migration runner
internal/httpserver/ chi router, middleware, error contract {"error": "..."}
internal/modules/   one package per domain module
```

## Run (dev)

```
cd v2
SESSION_SECRET=<32+ chars> SONARLY_LIBRARY_PATH=/path/to/music go run ./cmd/sonarly
```

Endpoints: `GET /health`, `GET /ready`.
