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
- Planned: per-module layout under `internal/modules/` mirroring the audit's
  module boundaries (auth, users, library, catalog, playlists, playback,
  search, ingestion, jobs); OpenSubsonic as an adapter over the same services;
  FTS5 search

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
