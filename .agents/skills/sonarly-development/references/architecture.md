# Architecture (development view)

Canonical: `agents/architecture.md` (+ user-facing `docs/architecture.md`).
Stack: Go 1.23 server (`server/`, module
`github.com/miquelrosell99/sonarly/server`; chi v5 router,
`modernc.org/sqlite` pure-Go driver, CGO off), React 18 + Vite 6 + Tailwind
web (`web/`), single all-in-one image (alpine 3.20 + ffmpeg + python3/mutagen
for tag writing).

## Three surfaces, one process

1. `/rest/*` — OpenSubsonic adapter (one policy, one data path shared with
   the native API). Behavioral contract: `QUIRKS.md` in the module — envelope
   always HTTP 200 with codes 10/40/70, `f` param format negotiation,
   auth precedence apiKey → header → `u/t/s` → cookie. Implement against the
   decisions there.
2. `/api/*` — native management REST; the contract is
   `server/api/openapi.yaml` (hand-maintained, redocly-linted); web types are
   generated from it and committed.
3. `/*` — the built SPA (`internal/staticfs`, index.html fallback).

Entry point `server/cmd/sonarly/main.go`: config → db → modules → chi router
(`internal/httpserver`: RequestID/RealIP/Recoverer/Compress middleware, 60 s
API timeout exempting `/api/stream/*` and SSE).

## Modular monolith

~25 domain packages under `server/internal/modules/`: system, auth, users,
libraries, catalog, library, ingest, uploads, tags, playlists, search,
statistics, home, autodj, playback, players, events, interactions,
opensubsonic, admin, suggestions, providers, artistimages. One package per
domain; cross-module imports go through the owning module, never its internal
files. DTOs are per-module (`dto.go`); there is no shared types package.

Load-bearing single paths:

- `library.PersistSong` is the ONE song-persistence path: upsert +
  unconditional junction rewrites + FTS sync in one transaction.
- `Queue.Push` is the only way to enqueue background work (DB-backed
  `scan_jobs` table, typed JSON payloads, single-goroutine worker) — never
  INSERT into `scan_jobs` directly.
- Pragmas are set once in `internal/db`: WAL, foreign_keys, busy_timeout 5 s,
  synchronous NORMAL, mmap 256 MB, `SetMaxOpenConns(1)` (single writer).

FTS5 tables (`songs_fts`, `albums_fts`, `artists_fts`, regular self-contained)
are synced inside write transactions.

## Data + background work

Libraries are admin-managed folders; `user_libraries` scopes every
content/stream path per user (security boundary). The default library is
seeded from `SONARLY_LIBRARY_PATH` at first boot. Background work: pure-Go
polling watcher (coalesced resyncs — works on NFS/SMB where inotify doesn't)
plus interval schedulers (scan, ingest sweep, artist images, review cleanup);
all context-driven for clean shutdown. The SSE feed `/api/events`
(30 s heartbeat, `library:changed`) drives web invalidation.

Version is injected at link time:
`go build -ldflags "-X …/internal/buildinfo.Version=$(git describe --tags --always)"`
— it becomes the OpenSubsonic `serverVersion`.

## Web side

Feature-first `web/src/features/` (admin, albums, artists, ingest, …),
shared `components/` + `components/ui/`, canonical API client
`web/src/lib/api.ts` (~65 call sites; 401 → `sonarly:unauthorized`).
`web/src/contract/schema.ts` is generated from openapi.yaml — committed,
never hand-edited; the generated type wins on drift.

## Status discipline

`docs/development.md` and `docs/architecture.md` are maintainer-oriented but
live with the user docs — update them (and this skill) in the same pass as
behavior changes. Where docs disagree with code, code wins; fix the doc
forward (e.g. the `packages/web/` vs `web/` staleness).
