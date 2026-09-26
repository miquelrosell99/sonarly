# Architecture

Sonarly is a self-hosted music server. A single Go process serves three things:

1. **OpenSubsonic API** (`/rest/`) — compatible with Subsonic/OpenSubsonic clients (Feishin, Symphonium, DSub, Ultrasonic, …), implemented as an adapter over the same services the native API uses.
2. **Native management REST API** (`/api/`) — used by the React web UI. Contract: [`server/api/openapi.yaml`](../server/api/openapi.yaml).
3. **Static web UI** (`/*`) — the built React app, served by `internal/staticfs` with an SPA fallback (production).

A DB-backed job queue with a single worker runs scanning, ingest, organize, and artist-image jobs. A pure-Go polling watcher detects library changes and queues coalesced resyncs; interval schedulers trigger periodic work.

## Repository layout

```
server/                 # Go server (the only server)
├── cmd/sonarly/        # entrypoint: config → db → modules → http server
├── internal/
│   ├── config/         # env config (SESSION_SECRET, SONARLY_*); validated at boot
│   ├── db/             # connection pragmas + embedded migration runner (ledger)
│   ├── httpserver/     # chi router, middleware, error contract {"error": "..."}
│   ├── staticfs/       # SPA static serving with index.html fallback
│   ├── buildinfo/      # version string (ldflags-injected)
│   └── modules/        # one package per domain (below)
└── api/openapi.yaml    # native REST contract, coverage-tested against the router

web/                    # React web client
└── src/
    ├── features/       # domain-first pages/components (albums, playlists, admin, …)
    ├── components/     # shared UI primitives (PlayerBar, Sidebar, ui/*, …)
    ├── contract/       # generated OpenAPI types + typed wrapper
    ├── types/          # domain types (entities, preferences, smart-playlist rules)
    ├── hooks/          # react-query hooks and interaction logic
    ├── stores/         # Zustand client-state stores (player, library, theme)
    └── lib/            # api client, utilities

docker/                 # Dockerfile (all-in-one image), entrypoint.sh, compose example
docs/                   # user-facing documentation
```

## Server modules (`server/internal/modules/`)

The server is a modular monolith: each domain owns its package, its repository functions (parameterized SQL), and its HTTP handlers. Cross-module imports go through the owning module, never its internal files.

| Module | Responsibility |
|---|---|
| `system` | health probes (`/health`, `/healthz`, `/ready`) |
| `auth` | sessions (SQLite store, signed cookie), login throttle, API keys, secret box for Subsonic passwords |
| `users` | user CRUD, admin gates, profiles, preferences (allowlisted keys), avatars |
| `libraries` | admin-managed library folders, user↔library assignment |
| `catalog` | songs/albums/artists/genres/years read APIs, scoped by `user_libraries` |
| `library` | scanner (filesystem↔DB reconciliation), job queue with typed payloads, single-goroutine worker, polling watcher, schedulers |
| `ingest` | drop-folder import, validation, organize, duplicates, review quarantine |
| `uploads` | chunked upload sessions with streaming reassembly + stale-session GC |
| `tags` | metadata read/write (pure-Go reader; python3+mutagen writer) |
| `coverart`/`artistimages` | embedded + cached artwork, artist image sync |
| `playlists` | static + smart playlists, one access policy, shares, share tokens; the whitelisting smart-playlist SQL compiler |
| `search` | FTS5 prefix search, synced inside the write transactions |
| `statistics`/`home`/`autodj` | listening stats, home aggregation, auto-dj scoring |
| `playback` | streaming (direct + ffmpeg transcode), scrobble, bookmarks |
| `players`/`events` | now-playing tracking, SSE job-event feed |
| `interactions` | favorites/ratings over the same junction rows the adapter writes |
| `opensubsonic` | the full `/rest` adapter: envelope, auth hook, DTOs, ~40 endpoints |
| `admin` | dashboard: system tasks (+history), status, missing files, ingest runs |
| `suggestions`/`providers`/`artistimages` | autocomplete whitelist, MusicBrainz/LRCLIB proxies (rate-limited), artist image sync job |

## Request pipeline

- `cmd/sonarly/main.go` wires config → db (pragmas + migrations) → modules → chi router → graceful shutdown via `signal.NotifyContext`. A boot push enqueues the initial scan.
- Middleware: request logging (slog), session resolution, per-route admin/scoping guards.
- Native routes live in each module; errors serialize as JSON `{"error": "..."}` with a proper status code.
- The `/rest` adapter runs its own envelope/auth layer but delegates to the same services — one policy and one data path for playlists, streams, and user data.
- Static serving: existing files from `SONARLY_WEB_DIST` with cache headers; unmatched non-API routes fall back to `index.html`; `/api/*` and `/rest/*` are never intercepted.

## Database

- SQLite via `modernc.org/sqlite` (pure Go, no CGO): WAL, foreign keys, `busy_timeout`, `synchronous=NORMAL`, a single writer connection.
- Migrations: embedded numbered SQL files in `server/internal/db/migrations/`, each in its own transaction, recorded in the `schema_migrations` ledger, forward-only. See [db-schema.md](db-schema.md) for the schema.

## Background work

- The job queue (`scan_jobs` with typed JSON payloads) coalesces pending jobs by type+target; a single-goroutine worker executes jobs with transactional per-song persistence and context-cancelled shutdown. Jobs survive restarts; stale `running` rows are failed at worker boot.
- Schedulers (all `0`-disablable): periodic full scans (`SONARLY_SCAN_INTERVAL_MINUTES`), ingest sweeps, artist image sync, review-folder cleanup.
- The watcher polls the filesystem (`SONARLY_WATCH_POLL_INTERVAL`, default 5 s) and queues coalesced resyncs — pure Go, so it works on network filesystems without inotify.

## Data flow

- Audio metadata is read in pure Go (`internal/audio`: vendored `dhowden/tag` fork + own properties reader) — no CGO, no external process.
- Metadata is *written* with a Python Mutagen subprocess (`tags` module) — an explicit user action, never part of scanning.
- Scanning upserts songs and fills album-level fields only when empty, so user edits survive rescans. Files removed from disk are deactivated, not deleted.
- Library organization renames files into a configurable pattern (default `{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}`), stored per library.
- Audio files, cover art, and avatars live on the filesystem under `SONARLY_DATA_DIR`; everything else is in SQLite.

## Web app

- React 18 + Vite 6 + Tailwind CSS 3, wouter router, TanStack Query for server state, Zustand for client state.
- Feature-first pages under `src/features/<name>/`; shared primitives under `src/components/`.
- API access through `src/contract/` (OpenAPI-generated types + typed wrapper); auth errors are handled centrally.
- Every route is lazy-loaded (per-route chunks); long lists render through virtualized lists/grids.
- Design tokens and visual principles: [design-language.md](design-language.md).

## Libraries and scoping

Libraries are admin-managed folders in the `libraries` table; the first is seeded from `SONARLY_LIBRARY_PATH`. Assignment to users is a security boundary: `user_libraries` is enforced on every content query and stream/download path (admins bypass; share-token grants stay scoped to playlist content).

## OpenSubsonic compatibility

`/rest/` endpoints always return a `subsonic-response` envelope, even on errors (HTTP 200 with `status:"failed"` + `error{code,message}`) — many clients abort sync on HTTP 4xx/5xx bodies. Standard codes: 10 missing auth/param, 40 bad credentials, 70 data not found / out of scope. The full behavioral contract — auth precedence, format negotiation, XML mapping, 62 per-endpoint quirks — is recorded in [`.audits/opensubsonic-quirks.md`](../.audits/opensubsonic-quirks.md) (internal engineering record).
