---
name: sonarly-library-operations
description: Operate and modify Sonarly's music library pipeline — scanning, ingest, organize, duplicates, conflicts, uploads, and the background job system
type: prompt
whenToUse: When working on library scanning, file ingestion, the ingest/review pipeline, auto-organization, duplicate detection, upload handling, or the scan_jobs worker queue
---

# Sonarly Library Operations

## Map of the subsystem

- `packages/server/src/features/library/` — `scanner.ts` (filesystem→DB reconciliation), `queue.ts` (DB-backed `scan_jobs` queue), `worker.ts` (single serial worker thread), `watcher.ts` (chokidar, 2s debounce → coalesced `resync`), `scheduler.ts` (interval triggers), `routes.ts` (`POST /api/scans`, `GET /api/scans/status`).
- `packages/server/src/features/ingest/` — `ingest.ts` (`processIngestFolder`), `validator.ts` (extension allowlist `.mp3/.flac/.ogg/.m4a`, requires title+artist+album), `organizer.ts` (pattern → target path, `sanitize()` per segment), `organize-existing.ts`, `organize-job.ts`, `review-cleanup.ts`.
- `packages/server/src/features/uploads/` — chunked upload protocol (5 MiB chunks from `web/src/hooks/useUpload.ts`, 1 GiB cap, double-guarded path validation in `chunked.ts`).
- `packages/server/src/features/duplicates/index.ts` — identity = title + album + artist-set; five strategies (`keep_file_replace_metadata` is the default).
- `packages/server/src/features/conflicts/` — collision files (` (n)` suffixes) from the organizer.

## Job system facts

- Job types: `scan`, `resync`, `ingest`, `organize`, `artist_images`, `cleanup_review`. Only `resync` coalesces (`library/queue.ts:15-20`).
- Payload is smuggled in the `stats` JSON column; **ingest jobs from watcher/scheduler/boot pass a bare path string** and the worker falls back to default library + global pattern — pass `{sourcePath, libraryId}` JSON instead.
- Jobs survive restarts; stale `running` rows are swept at worker boot. There is no retry and no cancellation.
- Scan behavior: checksum-based move detection (`idx_songs_checksum`), deactivate-instead-of-delete, probe-before-deactivate (unmounted drives can't wipe the catalog), per-file failure cap of 20, activity recompute over albums/artists/labels at the end of every scan.
- Scan/ingest write the album cover into every song file whose embedded art differs (`scanner.ts` syncSongCoverWithAlbum) — this mutates user files, bumps mtimes, and self-triggers one extra watcher pass. Intentional; don't "fix" without understanding convergence.
- `ingest_jobs` is an audit table (one row per file, statuses pending/imported/skipped/needs_review/failed) and is never pruned.

## Operational commands

- Trigger a scan manually: `pnpm --filter @sonarly/server trigger-scan` (runs `scripts/trigger-scan.ts`).
- Watch scan state: `sqlite3 <data>/sonarly.db "select id,type,status,started_at,finished_at from scan_jobs order by rowid desc limit 10"` — note pending jobs have NULL `started_at`.
- Ingest drop dir: `INGEST_PATH` env (default under `DATA_DIR`); per-library subdir `<INGEST_PATH>/<libraryId>/`; quarantine at `<root>/review/` (retention `REVIEW_RETENTION_DAYS`, default 30, daily cleanup).
- Organize pattern: default `{albumArtist}/({year}) {album}/{disc:00}{track:00} - {title}`; tokens `artist, albumArtist, album, title, track, track:00, disc, disc:00, year, genre`; stored per library (`libraries.organize_pattern`) and globally (settings).

## Invariants to preserve

- `songs.file_path` is UNIQUE; `songs.checksum` (SHA-256) drives move detection — never null it out on rescan.
- `upsertSong` sets `average_rating = excluded.average_rating`; scanner-built song objects don't set it, so preserve the column explicitly when touching the upsert.
- New files must enter the library only through the ingest pipeline (validation → duplicate strategy → organize → persist).
- Tests: `tests/features/library/`, `tests/features/ingest/`, `tests/features/uploads/`, `tests/integration/ingest-flow.test.ts` use real worker threads + temp dirs (`tests/integration/helpers.ts`); `waitForJob()` polls `scan_jobs` (10s ceiling).
