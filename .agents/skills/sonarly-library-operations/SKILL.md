---
name: sonarly-library-operations
description: Operate and modify Sonarly's music library pipeline — scanning, ingest, organize, duplicates, conflicts, uploads, and the background job system
type: prompt
whenToUse: When working on library scanning, file ingestion, the ingest/review pipeline, auto-organization, duplicate detection, upload handling, or the scan_jobs worker queue
---

# Sonarly Library Operations

## Map of the subsystem

- `v2/internal/modules/library/` — `scanner.go` (filesystem→DB reconciliation), `queue.go` (DB-backed `scan_jobs` queue with typed payloads), `worker.go` (single-goroutine worker, context-cancelled), `watcher.go` (pure-Go polling watcher → coalesced `resync`), `scheduler.go` (interval triggers), `persist.go` (the ONE song-persistence path shared by scanner/ingest/tags: upsert + unconditional junction rewrites + FTS sync, all in one transaction), `fts.go` (search-index maintenance), `routes.go` (`POST /api/scans`, `GET /api/scans/status`).
- `v2/internal/modules/ingest/` — `ingest.go` (drop-folder processing), `validator.go` (extension allowlist, requires title+artist+album), `organizer.go` (pattern → target path, per-segment sanitize), `organize_job.go`, `duplicates.go` (identity = title + album + artist-set; five strategies, `keep_file_replace_metadata` default), `review_cleanup.go` (quarantine retention), `routes.go` (`/api/ingest`, `/api/ingest/trigger`), `settings.go`.
- `v2/internal/modules/uploads/` — chunked upload protocol (`chunked.go`: streaming reassembly, incremental 1 GiB cap, double-guarded path validation), `gc.go` (stale-session + orphan-dir sweeper), `routes.go`. Web client sends 5 MiB chunks.
- Conflicts: collision files (` (n)` suffixes) produced by the organizer are surfaced via `/api/conflicts` (admin).

## Job system facts

- Job types (`library/queue.go`): `scan`, `resync`, `ingest`, `organize`, `artist_images`, `cleanup_review`. Each has a typed JSON payload struct (`ScanPayload`, `IngestPayload`, `OrganizePayload`, `ArtistImagesPayload`) decoded by its handler — the typed `payload` column (migration 0002) replaced v1's stats-column smuggling; never add a bare-string payload.
- `Queue.Push` coalesces pending jobs of the same type **and target** (v1 only coalesced `resync`); it returns the coalesced job id.
- Jobs survive restarts; stale `running` rows are failed at worker boot (`FailStaleRunning`). Terminal rows are pruned (`PruneTerminal`, keeps N) — `ingest_jobs` remains the per-file audit table (pending/imported/skipped/needs_review/failed) and is never pruned.
- Scan behavior: checksum-based move detection (`songs.checksum`), deactivate-instead-of-delete, probe-before-deactivate (an unmounted drive must not mass-deactivate the catalog; failed roots are excluded from the deactivation pass), per-file failure cap (`maxScanFailures = 20`), FTS rows removed for deactivated songs, activity (`active`) recompute at the end of every scan.
- **v2 scans are read-only for user files** — a deliberate deviation from v1 (v1 wrote the album cover back into song files, bumping mtimes and triggering an extra watcher pass). Do not reintroduce file mutation into the scan path; tag writes go through the `tags` module explicitly.

## Operational commands

- Trigger a scan: `POST /api/scans` (session cookie or API key) or from the web UI (admin → system tasks). Ingest sweep: `POST /api/ingest/trigger`.
- Watch scan state: `sqlite3 <data>/sonarly.db "select id,type,status,started_at,finished_at from scan_jobs order by rowid desc limit 10"` — pending jobs have NULL `started_at`; status orders by `COALESCE(started_at, created_at)` (migration 0002), so queued work is visible.
- Ingest drop dir: `SONARLY_INGEST_PATH`; per-library subdir `<ingest>/<libraryId>/`; quarantine at `<library>/review/` (retention default `SONARLY_REVIEW_RETENTION_DAYS` = 30, overridable by the `review_retention_days` settings key, clamped 1–365, daily cleanup).
- Organize pattern: default `{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}`; tokens `artist, albumArtist, album, title, track, track:00, disc, disc:00, year, genre`; stored per library (`libraries.organize_pattern`) and globally (`settings`).

## Invariants to preserve

- `songs.file_path` is UNIQUE; `songs.checksum` (SHA-256) drives move detection — never null it out on rescan.
- New files enter the library only through `library.PersistSong` (scanner or ingest → validation → duplicate strategy → organize → persist). There is one persistence path; keep it that way.
- `average_rating` is denormalized on `songs` — preserve it explicitly when touching PersistSong (scanner-built rows don't set it).
- The FTS tables (`songs_fts`, `albums_fts`, `artists_fts`) must mirror the active corpus at transaction commit — syncs happen inside PersistSong and the deactivation pass; a future writer that bypasses them breaks `/api/search` (migration 0004 re-asserts the invariant only at migrate time).
- `user_libraries` scoping applies to every content read; `songs.library_id IS NULL` rows are admin-only.
- Tests: `*_test.go` next to source in `library/`, `ingest/`, `uploads/` — real file-backed SQLite, temp dirs, queue/worker end-to-end tests (including mid-scan cancellation). Run `go test ./... -count=1` from `v2/`.
