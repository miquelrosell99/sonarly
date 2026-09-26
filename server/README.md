# Sonarly — Go server

Go implementation of the Sonarly server, started
per Decision Record DR-1 in `docs/audits/2026-09-24-backend-architecture-audit.md`.

## Status

**Parity-complete (P10/P10b, 2026-09-25).** Request-level parity with the
retired TypeScript server is proven — 94/94 parity cases, 0 blockers
(`docs/p10-parity-report.md`) — and a production dual-run against the live
DB snapshot passed with 0 stream mismatches and byte-identical user state
(`docs/p10b-dualrun-report.md`). The last functional gap, static SPA
serving, closed in P11. Deployment artifacts live in `docker/`
(Dockerfile, entrypoint.sh, compose.yaml.example). Cutover executed
2026-09-26; the evidence, go/no-go checklist, runbook and rollback are in
`docs/cutover-readiness.md`.

## Stack

- Go 1.23, `net/http` + chi v5
- SQLite via `modernc.org/sqlite` (pure Go, no CGO) — WAL, foreign keys,
  busy_timeout, synchronous=NORMAL, single connection (one writer)
- Migrations: embedded SQL files, ledger table, per-file transactions
  (same semantics as the retired TypeScript migrator)
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
  stale-session sweeper the old server lacked — see `internal/modules/uploads/`. Ingest
  job execution itself is P7b; the queue accepts the typed payload now.
- Search + statistics + home + auto-dj + events + players (P8): FTS5
  prefix search maintained inside PersistSong's transaction (regular, not
  external-content FTS5 tables — the build's xUpdate lacks REPLACE
  semantics and reports SQLITE_CORRUPT for deletes of absent rowids),
  consolidated statistics (six statements per request; the global rating
  average is computed once per request in a MATERIALIZED CTE), the home
  aggregator, the auto-dj scoring port (generation failures answer 502,
  never a silent empty 200), a session-only SSE feed fanning the
  worker's job events out with a 30s heartbeat, and a now-playing tracker
  hooked into the playback service so EVERY stream is counted (previously
  only Subsonic clients were counted) — see `internal/modules/{search,statistics,home,autodj,events,players}/`
- OpenSubsonic adapter (P6.5/P9a/P9b): the full `/rest` surface over the
  same services — envelope + auth hook (P6.5), 24 browsing/retrieval
  endpoints (P9a), and the starring/now-playing/playlist/bookmark endpoints
  (P9b) against `docs/opensubsonic-quirks.md`; playlist and bookmark
  endpoints delegate to the playlists/playback modules so there is ONE
  policy and ONE data path — see `internal/modules/opensubsonic/`
- Interactions (P9c start): native favorites/ratings (POST /api/favorites,
  /api/ratings) writing the same user_* junction rows as the adapter, the
  /api/me/preferences read/patch surface behind an explicit key allowlist,
  and the /api/avatars/{id} 404 stub — see `internal/modules/interactions/`
  and `internal/modules/users/preferences.go`
- Native parity completion (P9c): the libraries admin surface (CRUD with the
  is_default transaction invariant, user↔library assignment both directions,
  scoped picker list), song/album tag editing through the python3+mutagen
  `audio.TagWriter` (write → organize → PersistSong → coalesced resync),
  magic-byte-sniffed cover-art uploads, the admin suggestion whitelist, the
  MusicBrainz/LRCLIB proxies (process-global rate limit, 10s timeouts,
  generic 502s, no caching), the artist image sync as a real P4b job
  handler, avatars (POST /api/me/avatar + file-backed GET), the admin
  dashboard (system-tasks + paginated history, status, missing management,
  ingest runs), media settings, and the organize HTTP routes — see
  `internal/modules/{libraries,tags,suggestions,providers,artistimages,admin}/`

## Runtime dependencies

- **ffmpeg** — transcoding (`GET /api/stream/{id}?maxBitRate=`, Subsonic
  transcode requests) shells out to it via `playback.TranscodingStreamer`
  (path overridable with `SONARLY_FFMPEG_PATH`). Without it, transcode
  requests fail; direct streams, catalog, and search are unaffected.
- **python3 + mutagen** — tag editing shells out to `python3` with
  `mutagen` (shelling out, behind the `audio.TagWriter` interface).
  Without them, tag-edit endpoints answer 500 "Failed to write tags";
  everything else is unaffected (metadata reads are pure Go).

The runtime image (`docker/Dockerfile`) installs both.

## Web client serving

The server serves the built web client (Vite output) from the directory
named by `SONARLY_WEB_DIST` (default `./web-dist`):

- Existing files are served with an embedded extension→mime map and cache
  headers (`no-cache` for `.html`, `max-age=3600` for everything else).
- Extensionless GET routes (SPA deep links like `/library/artist/<id>`)
  fall back to `index.html` with status 200.
- `/api/*` and `/rest/*` are never intercepted — the fallback is installed
  on chi's NotFound hook *after* every API mount, so only requests no route
  claimed reach it; unmatched API paths keep the JSON 404 shape.
- Path traversal is contained (`path.Clean` + prefix check under the root).
- If the directory does not exist the server runs **API-only**, exactly as
  before P11 (unmatched paths get chi's default 404).

See `internal/staticfs/`.

## Layout

```
cmd/sonarly/        entrypoint
internal/config/    env config (SESSION_SECRET >= 32 chars required)
internal/db/        connection pragmas + embedded migration runner
internal/httpserver/ chi router, middleware, error contract {"error": "..."}
internal/staticfs/  SPA static-file serving with index.html fallback (P11)
internal/modules/   one package per domain module
```

## Run (dev)

```
cd server
SESSION_SECRET=<32+ chars> SONARLY_LIBRARY_PATH=/path/to/music go run ./cmd/sonarly
```

Optional: point `SONARLY_WEB_DIST` at a web build
(`pnpm --filter @sonarly/web... build` at the repo root produces
`packages/web/dist`) to serve the UI.

Endpoints: `GET /health`, `GET /healthz` (container-probe alias), `GET /ready`.

## Build

```
cd server
go build -ldflags "-X github.com/miquelrosell99/sonarly/server/internal/buildinfo.Version=$(git -C .. describe --tags --always)" -o sonarly ./cmd/sonarly
```

A dev build without `-ldflags` reports version `0.0.0-dev` (surfaced as the
OpenSubsonic `serverVersion`).

## Docker

Multi-stage all-in-one image (web build → Go build → alpine runtime with
ffmpeg, python3+mutagen, su-exec, wget; non-root via PUID/PGID; HEALTHCHECK
on `/healthz`; EXPOSE 3000). Build context is the **repo root**:

```
# from the repo root (the directory containing packages/ and server/)
docker build -f docker/Dockerfile \
  --build-arg SONARLY_VERSION=$(git describe --tags --always) \
  -t sonarly:local .
```

Compose shape: `docker/compose.yaml.example`. The cutover runbook,
go/no-go checklist and rollback are in `docs/cutover-readiness.md`.
