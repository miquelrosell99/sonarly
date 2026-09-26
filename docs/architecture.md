# Architecture

Sonarly is a self-hosted music server. A single Go process serves three things:

1. **OpenSubsonic API** (`/rest/`) — compatible with Subsonic/OpenSubsonic clients (Feishin, Symphonium, DSub, Ultrasonic, …), implemented as an adapter over the same services the native API uses.
2. **Native management REST API** (`/api/`) — used by the React web UI for library management. Contract: [`server/api/openapi.yaml`](../server/api/openapi.yaml).
3. **Static web UI** (`/*`) — the built React app, served by `internal/staticfs` with an SPA fallback (production).

The server runs a DB-backed job queue with a single worker for scanning, ingest, organize, and artist-image jobs. A pure-Go polling watcher detects library changes and queues coalesced resyncs; interval schedulers trigger periodic work.

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

packages/web/           # React web client
└── src/
    ├── features/       # domain-first pages/components (albums, playlists, admin, …)
    ├── components/     # shared UI primitives (PlayerBar, Sidebar, ui/*, …)
    ├── contract/       # generated OpenAPI types + typed wrapper/capabilities
    ├── types/          # domain types (entities, preferences, smart-playlist rules)
    ├── hooks/          # react-query hooks and interaction logic
    ├── stores/         # Zustand client-state stores (player, library)
    └── lib/            # api client, utilities

docker/                 # Dockerfile (all-in-one image), entrypoint.sh, compose example
docs/                   # this documentation
```

## Server

### Modules (`server/internal/modules/`)

The server is a modular monolith: each domain owns its package, its repository functions (parameterized SQL), and its HTTP handlers. Cross-module imports go through the owning module, never its internal files.

| Module | Responsibility |
|---|---|
| `system` | health probes (`/health`, `/healthz`, `/ready`) |
| `auth` | sessions (SQLite store, signed cookie wire-compatible with the pre-cutover format), login throttle, API keys, secret box for Subsonic passwords |
| `users` | user CRUD, admin gates, profiles, preferences (allowlisted keys), avatars |
| `libraries` | admin-managed library folders, user↔library assignment |
| `catalog` | songs/albums/artists/genres/years read APIs, scoped by `user_libraries` |
| `library` | scanner (filesystem↔DB reconciliation), job queue with typed payloads, single-goroutine worker, polling watcher, schedulers |
| `ingest` | drop-folder import, validation, organize, duplicates, review quarantine |
| `uploads` | chunked upload sessions with streaming reassembly + stale-session GC |
| `tags` | metadata read/write (pure-Go reader; python3+mutagen writer) |
| `cover-art`/art | embedded + cached artwork |
| `playlists` | static + smart playlists, ONE access policy (owner/edit/view/none), shares, share tokens; the whitelisting smart-playlist SQL compiler |
| `search` | FTS5 prefix search, synced inside the write transactions |
| `statistics`/`home`/`autodj` | listening stats, home aggregation, auto-dj scoring |
| `playback` | streaming (direct + ffmpeg transcode), scrobble, bookmarks |
| `players`/`events` | now-playing tracking, SSE job-event feed |
| `interactions` | favorites/ratings over the same junction rows the adapter writes |
| `opensubsonic` | the full `/rest` adapter: envelope, auth hook, DTOs, ~40 endpoints |
| `admin` | dashboard: system-tasks (+history), status, missing files, ingest runs |
| `suggestions`/`providers`/`artistimages` | autocomplete whitelist, MusicBrainz/LRCLIB proxies (rate-limited), artist image sync job |

### Request pipeline

- `cmd/sonarly/main.go` wires config → db (pragmas + migrations) → modules → chi router → graceful shutdown via `signal.NotifyContext`.
- Middleware: request logging (slog), session resolution, per-route admin/scoping guards.
- Native routes live in each module; errors serialize as JSON `{"error": "..."}`.
- The `/rest` adapter runs its own envelope/auth layer but delegates to the same services — there is ONE policy and ONE data path for playlists, streams, and user data.

### Database

- SQLite via `modernc.org/sqlite` (pure Go, no CGO): WAL, foreign keys, `busy_timeout`, `synchronous=NORMAL`, a single connection (one writer).
- Migrations: embedded numbered SQL files in `server/internal/db/migrations/`, each in its own transaction, recorded in the `schema_migrations` ledger. Idempotent DDL (`CREATE … IF NOT EXISTS`) so re-running is safe.
- See [db-schema.md](db-schema.md) for the schema and [db-schema conventions](#data-flow).

### Background work

- The job queue (`scan_jobs` with typed JSON payloads) coalesces by type+target; a single-goroutine worker executes jobs with transactional per-song persistence and context-cancelled shutdown.
- Schedulers: periodic full scans (`SONARLY_SCAN_INTERVAL_MINUTES`), ingest sweeps, artist image sync, review-folder cleanup — all context-driven, `0` disables.
- The watcher polls the filesystem (`SONARLY_WATCH_POLL_INTERVAL`) and queues coalesced resyncs; pure Go, so it works on filesystems without inotify.

### Data flow

- Audio metadata is read in pure Go (`internal/audio`: vendored `dhowden/tag` fork + own properties reader) — no CGO and no external process.
- Metadata is *written* with a Python Mutagen subprocess (`tags` module), the same approach as always.
- Library organization renames files into a configurable pattern (default: `{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}`); the extension is always appended.
- Scanning ensures artists/albums/genres exist, fills album-level metadata (release type, MusicBrainz ids, labels, …), and upserts songs. Album-level fields are only filled when empty, so user edits made in the UI survive rescans.
- SQLite stores songs, albums, artists, playlists, users, sessions, libraries, and job state; audio files, cover art, and avatars live on the filesystem under `SONARLY_DATA_DIR`.

## Web app

- React 18 + Vite 6 + Tailwind CSS 3, routed with wouter, server state via TanStack Query (`hooks/`), client state in Zustand stores (`stores/`).
- Feature-first pages under `src/features/<name>/`; shared primitives under `src/components/`.
- API access goes through `src/contract/` (OpenAPI-generated types + a typed wrapper) with `src/lib/api.ts` for the few non-generated paths; auth errors are handled centrally.
- Route-level code splitting: Vite emits per-route chunks with cache-friendly vendor chunks (react / tanstack / dnd-kit / wouter / zustand).
- Design tokens and visual principles: [design-language.md](design-language.md).

## Libraries

Libraries are admin-managed folders stored in the `libraries` table (`modules/libraries`). On first start, a default library is seeded from `SONARLY_LIBRARY_PATH` so single-folder deployments keep working. Admins manage libraries at `/admin/libraries`; the scanner, watcher, schedulers, and OpenSubsonic `getMusicFolders` all read from this table.

Assignment to users is a security boundary: `user_libraries` is enforced on every content query and stream/download path (admins bypass; share-token grants stay scoped to playlist content).

In Docker, the library bind mount is configured with `LIBRARY_MUSIC` (mounted at `/media/music`); additional libraries can be mounted at other `/media/<name>` paths and created in the admin panel.

## OpenSubsonic compatibility notes

The `/rest/` endpoints must always return a `subsonic-response` envelope, even on errors — many Subsonic clients abort sync on plain HTTP 4xx/5xx bodies. Errors are enveloped (`status:"failed"` + `error{code,message}`) with HTTP 200. Use standard Subsonic error codes (10 missing auth/param, 40 bad credentials, 70 data not found). Symphonium syncs via `search3.view` with an empty query and paginates; `albumCount` on artist objects and `songCount`/`duration` on album objects must reflect real database counts.

The full behavioral contract (auth precedence, format negotiation, XML mapping, per-endpoint quirks) is written down in [opensubsonic-quirks.md](opensubsonic-quirks.md) — implement against its decisions, not against the spec text alone.
