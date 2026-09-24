# Sonarly Backend Architecture Audit

**Date:** 2026-09-24
**Scope:** `packages/server` (primary), `packages/shared`, `packages/web` (boundary only), deployment & tooling
**Method:** full read-only audit of `packages/server/src` (169 files, ~15.5k LOC), all 49 migrations, all route/repository/feature files, test suite, Docker/CI config, docs
**Status:** No code was modified for this audit.

---

## 1. Executive Summary

Sonarly is a **Fastify 5 + better-sqlite3 (WAL) modular monolith** with a worker thread for background jobs, an OpenSubsonic compatibility API (43 endpoints) alongside a native REST API (117 endpoints), and a React/Vite web client — packaged as a pnpm monorepo and deployed as a single Docker container.

The headline conclusion: **this is a fundamentally healthy codebase with a small number of high-impact defects, not an architecture in crisis.** The engineering culture visible in the repo is strong: SQL is parameterized everywhere (no injection found), HTTP range requests are implemented correctly, streaming is memory-safe end-to-end, the scanner is resilient to unmounted drives and interrupted jobs, the DB-backed job queue survives crashes, and there are ~834 real tests including integration tests that run actual worker threads.

The real problems are concentrated and fixable:

1. **Multi-user library isolation is cosmetic.** `user_libraries` (migration 036) is written by admin CRUD but **never consulted by any read/stream/download path**. Every authenticated user can list, search, stream, and download every song in every library. If per-user library assignment is a shipped feature (the admin UI exists), this is the single most important gap in the product.
2. **A handful of data-integrity bugs**: non-transactional playlist rewrites (`playlists/repository.ts:111-153`), rescan nulling `songs.average_rating` (`songs/repository.ts:185-234` × `library/scanner.ts:291-339`), conflict deletion that resurrects on next scan (`conflicts/routes.ts:57-66`), and batch tag edits queuing N full library scans (`songs/routes.ts:296-299`).
3. **No CI test workflow** — the only GitHub workflow builds and pushes a Docker image on tags without running the test suite.
4. **Architecture is "routes → repositories" with no application/domain layer.** This works at the current size and is honestly organized by feature, but business rules are beginning to duplicate across the two API surfaces (two divergent `canViewPlaylist` implementations, two range parsers, copy-pasted row interfaces) — the cost of the missing layer is already visible.
5. **SQLite is the right database today.** The audit does *not* support migrating to PostgreSQL or rewriting in Go as a near-term action. The synchronous driver and single-writer model are real constraints at large scale, but the observed workload (single self-hosted container, one worker, WAL + busy_timeout correctly configured) is well within SQLite's envelope. The greenfield stack debate (Go/Postgres) is evaluated honestly in §15 and deferred with explicit triggers.

The recommended path is **Option B: deepen the existing modular monolith** — fix correctness and security defects first, then extract a thin application-service layer to stop cross-surface duplication, then performance (indexes, FTS5 search, pagination), with PostgreSQL evaluated only against measured triggers.

---

## 2. Current Architecture

```text
                        ┌────────────────────────────────────────────┐
                        │              Docker container              │
                        │                                            │
  Web client (React)    │   ┌──────────────────────────────────────┐  │
  Subsonic clients ─────┼──▶│  Fastify 5 (main process)            │  │
  (Symfonium, etc.)     │   │                                      │  │
                        │   │  /api/*  ── session preHandler ──┐   │  │
                        │   │  /rest/* ── subsonic auth hook   │   │  │
                        │   │  static SPA hosting              │   │  │
                        │   │       │                          │   │  │
                        │   │  features/*/routes.ts (36 files) │   │  │
                        │   │       │  direct calls, no service layer  │
                        │   │  features/*/repository.ts (raw SQL)│   │  │
                        │   │       │                          │   │  │
                        │   │  chokidar watchers ──▶ pushJob ──┼─┐ │  │
                        │   │  schedulers (in worker)          │ │ │  │
                        │   │  SSE /api/events ◀── job:completed┘ │ │  │
                        │   └───────┬──────────────────────────┘   │  │
                        │           │ better-sqlite3 (sync)        │  │
                        │   ┌───────▼──────────────────────────┐   │  │
                        │   │  Worker thread (1, serial loop)  │   │  │
                        │   │  scan · resync · ingest ·        │   │  │
                        │   │  organize · artist_images ·      │   │  │
                        │   │  cleanup_review                  │   │  │
                        │   │  DB-backed queue: scan_jobs      │   │  │
                        │   └───────┬──────────────────────────┘   │  │
                        │           │                              │  │
                        │   ┌───────▼──────────────────────────┐   │  │
                        │   │  SQLite (WAL, FK on, busy 5s)    │   │  │
                        │   │  31 tables · 49 migrations       │   │  │
                        │   └──────────────────────────────────┘   │  │
                        │                                          │  │
                        │  ffmpeg (stream transcode, spawned/req)  │  │
                        │  python3 + mutagen 1.48.1 (tag writes)   │  │
                        │  filesystem: library roots, ingest dir,  │  │
                        │  DATA_DIR (db, artist images, uploads)   │  │
                        └────────────────────────────────────────────┘
```

**Runtime flow per request type:**

- **Native API**: `session cookie → global preHandler (app.ts:195-216) → route handler → repository (raw SQL) → SQLite`. Errors funnel to a central handler that sanitizes 5xx (`app.ts:163-167`).
- **OpenSubsonic**: `u/t/s token, apiKey, or session → /rest/* hook (opensubsonic/auth.ts) → route → shared serializers (responses.ts/xml.ts) → JSON or XML envelope`.
- **Background**: `trigger (API/scheduler/watcher/boot) → INSERT scan_jobs → worker poll (1s) → execute → markJobCompleted/Failed → parentPort message → SSE broadcast if stats changed`.
- **Streaming**: `GET /rest/stream.view → decideTranscode → spawn ffmpeg pipe OR fs.createReadStream with byte-range → response; SIGKILL ffmpeg on client disconnect`.

---

## 3. Repository Structure Assessment

**What exists (observed):**

```
packages/
  server/           Fastify backend, 169 src files
    src/
      index.ts      entry: writers → config → buildApp → listen (no SIGTERM handlers)
      app.ts        bootstrap: DB, migrations, worker spawn, watchers, plugins, routes
      config.ts     zod-validated env config (SESSION_SECRET min 32, no default)
      db/           connection.ts (pragmas), migrate.ts (ledger runner), migrations/ (49)
      features/     32 feature dirs — routes + repository + index per feature
    tests/          69 files, 506 tests, mirrors src/features
    scripts/        one-off tools (navidrome migration, probes, trigger-scan)
  shared/           16 files, ~673 LOC: entity types + a few runtime constants/guards
  web/              React/Vite client, 39 test files, 328 tests
docker/             Dockerfile.server (multi-stage), Dockerfile.dev, entrypoint.sh (PUID/PGID)
.github/workflows/  release-docker.yml only
```

**Good:**

- **Feature-first organization** (`features/<domain>/{routes,repository,index}.ts`) is the right call for this size and is followed consistently. A new contributor can find "where playlists live" in one guess.
- `packages/shared` is genuinely single-source: entity types are declared once and consumed by server + web; zero duplicated `interface Song/Album/Artist` in server src.
- Tests mirror `src/features` and use real file-backed SQLite + real worker threads — not mock theater.
- Migrations are numbered, transactional, ledger-tracked, and copied into dist at build.

**Problematic / confusing:**

- **No layer between routes and repositories.** The feature dirs are horizontally thin but vertically shallow: `songs/routes.ts` (702 LOC) contains validation, authorization checks, tag-writing orchestration, streaming, and DTO shaping. Business rules that must hold across the web + Subsonic surfaces get duplicated (see §7).
- `features/opensubsonic/routes/browsing.ts` at **1,198 LOC** is a god file: 17 endpoints, fetch helpers, row interfaces, serializers.
- Two near-identical implementations of the same concept in several places (`canViewPlaylist`, `parseByteRange`/`parseRange`, `fetchPlaylistSongs`, `SongRow`/`AlbumRow` interfaces ×5).
- Root `package.json:10` — `"lint": "echo 'Linting not configured'"`. No linter or formatter anywhere.
- Dead/legacy items: `scripts/test-smart-compiler.ts` (hardcodes `/root/projects/...` paths), `scripts/probe-navidrome*.ts` (undocumented one-offs), `USE_CRYPTO` config parsed but never consumed, `events/index.ts` extends EventEmitter but never emits (it's an SSE registry).
- Docs drift: `docs/deployment.md` contradicts the root `compose.yaml` on library paths (and contradicts `agents/architecture.md`, which is correct); `docs/db-schema.md` says "migrations 001–046 / 25 tables" (actual: 049 / ~31 tables); `docs/api.md` omits ~20 endpoints including the auth-exempt `GET /api/libraries`.

**Verdict:** organized by feature, scales fine structurally; the scaling limit is the missing application layer inside each feature, not the folder layout.

---

## 4. Domain Model

Core entities (as built, migrations 001–049):

```text
users ──┬── sessions / api_keys / user_preferences
        ├── user_libraries ── libraries ──(songs.library_id)── songs
        ├── user_songs / user_albums / user_artists / user_playlists   (starred, rating, play_count, last_played)
        ├── listening_history                                          (played_at, duration_listened, completion, client)
        ├── bookmarks                                                  (resume position)
        └── playlists ── playlist_songs ── songs
                └── playlist_shares (can_edit) · share_token (link visibility)

artists ──┬── albums ──┬── songs ──┬── song_artists / song_composers (position)
          │            │           ├── song_genres ── genres (self-FK parent → tree)
          │            │           ├── cover_arts (dedup'd blob, sha256 hash)
          │            │           └── labels (album_labels)
          │            └── album_artists / album_genres / album_labels
          └── (image url/local path, MusicBrainz ids JSON, bio)

jobs: scan_jobs (durable queue) · ingest_jobs (per-file audit) · upload_sessions (chunked upload)
```

**Key domain observations:**

- **Track ≡ MediaFile today.** `songs.file_path` is UNIQUE (001) and one row = one physical file. Duplicate detection (`duplicates/index.ts`) resolves *identity* (title+album+artist-set) to merge two files into one row, but the schema cannot represent "one logical track, multiple files" (FLAC + MP3 of the same album). This is the most consequential domain limitation for a music server — see §15/§16 for when it matters and why it does **not** justify a rewrite now.
- **Per-user interaction state is properly modeled** (`user_*` junction tables with rating/star/play_count) and consistently keyed.
- **Per-user content scoping is modeled but unenforced** (`user_libraries`, no FKs, never read — see §6 F1).
- **Denormalization exists deliberately** (`albums.artist_name` text alongside `artist_id`, `songs.genre` text alongside `genre_id`, `songs.average_rating` aggregate). These are read optimizations; `average_rating` already has a staleness bug (§6 F4).
- **Libraries are first-class** (path, organize_pattern, is_default) with a filesystem-authoritative media model: files live under library roots, the DB indexes them. Correct design for a self-hosted server.

---

## 5. Dependency Graph

**Healthy edges:**

```text
routes ──▶ repositories ──▶ db/connection
routes ──▶ shared types (@sonarly/shared)
worker  ──▶ scanner/ingest/organizer ──▶ repositories ──▶ db
opensubsonic routes ──▶ repositories (shared with native routes) ✔
```

- Cross-feature imports are mostly disciplined: opensubsonic reuses the same repositories as native routes — this is the single best structural decision in the codebase (one data path, two API adapters, matching the "OpenSubsonic as adapter" principle).
- The worker is the only long-running job consumer; both DB connections carry WAL + FK + busy_timeout.

**Problematic edges / coupling:**

| From | To | Problem |
|---|---|---|
| `songs/routes.ts` | `tags/writer`, `ingest/organize-existing`, `library/queue`, `cover-art/repository`, `duplicates` | Route file orchestrates file moves, tag writes, job enqueueing, blob GC — the "application logic in controller" smell, ×14 admin-gated modules repeating the `session.isAdmin` check |
| `library/watcher.ts`, `scheduler.ts`, `app.ts` | `library/queue` | Push **non-JSON payloads** for ingest jobs; worker's `JSON.parse` fallback silently imports into the default library with the global pattern (§6 F8) |
| `features/events` | nothing / anything | Misleading module: not an event bus, just SSE client registry; its EventEmitter inheritance is dead |
| `statistics/routes.ts` | `users/repository` + ~20 aggregate queries/request | Read-heavy analytics computed synchronously per request |
| `auto-dj/*`, `smart-playlists/*` | repositories directly | Recommendation/rule compilation is application logic living beside SQL; duplicated user-scoping logic between compiler and auto-dj |

**Circular dependencies:** none found. **God modules:** `opensubsonic/routes/browsing.ts` (1,198 LOC), `statistics/repository.ts` (728), `users/admin-routes.ts` (704), `songs/routes.ts` (702), `library/scanner.ts` (689). All are large-but-cohesive except `songs/routes.ts` and `browsing.ts`, which are genuinely multi-responsibility.

---

## 6. Critical Findings

Ordered by impact. Facts verified in code; severity reflects a self-hosted, multi-user server deployment.

### F1 — HIGH: Library-level tenant isolation is unenforced
`db/migrations/036_user_libraries.sql` creates the membership table; `features/libraries/repository.ts:99-129` writes it via admin CRUD. **Zero read, search, stream, or download queries consult it** (grep-verified across all features). `songs.library_id` is only an opt-in filter the caller supplies. Consequences: any authenticated user can `GET /api/songs`, search, and stream every song in every library; `/rest/getMusicFolders.view` returns all libraries. If the intended model is "all users see everything," the table and admin UI are misleading dead weight; if per-user libraries are a feature, this is a High-severity authorization gap. **Decision required — this gates the fix design.** Locations: `app.ts:195-216` (hook), `songs/routes.ts`, `search/routes.ts`, `opensubsonic/routes/retrieval.ts:21,106`, `opensubsonic/routes/browsing.ts:90-99`.

### F2 — MEDIUM: Unauthenticated `GET /api/libraries` discloses filesystem paths
`app.ts:198` exempts `/api/libraries` from auth; `libraries/admin-routes.ts:49-51` returns library names + absolute `path` + organize patterns to anonymous callers. Also undocumented in `docs/api.md`'s public-endpoint list. Fix: require session (or admin) and correct the docs.

### F3 — HIGH (data integrity): Playlist rewrite is not transactional
`playlists/repository.ts:111-153` — `UPDATE playlists` → `DELETE FROM playlist_songs` → loop re-INSERT with no `db.transaction`. A crash/error mid-sequence permanently empties or half-writes a playlist. better-sqlite3 is synchronous so the window is small, but this is the riskiest write path in the repo. The same file wraps other multi-writes in transactions — this one was simply missed.

### F4 — MEDIUM (user-visible data loss): Rescan nulls `songs.average_rating`
`upsertSong` (`songs/repository.ts:185-234`) sets `average_rating = excluded.average_rating`; the scanner-built song object (`library/scanner.ts:291-339`) never sets it, so any changed-file rescan overwrites the aggregate with NULL. The merge path (`scanner.ts:404+`) accidentally preserves it; the plain scan path does not. Only `favorites.setRating` (`favorites/repository.ts:64-70`) recomputes. Ratings silently decay on rescan.

### F5 — HIGH (functional bug): Conflict deletion resurrects
`DELETE /api/conflicts` (`conflicts/routes.ts:57-66`) calls `deleteSongById` (DB row only) — files stay on disk, so the watcher/scheduler re-imports every "deleted" collision on the next scan, with new song ids (cascading away `user_songs`/`listening_history` history). Compare `DELETE /api/songs/:id`, which unlinks the file first. The conflict is guaranteed to come back.

### F6 — MEDIUM: Batch tag edits queue N full library scans
`queueResync` (`songs/routes.ts:296-299`) does a raw `INSERT INTO scan_jobs`, bypassing the resync coalescing in `library/queue.ts:15-20`. `PUT /api/songs/tags` on N songs queues N full scans. One-line fix: route through `pushJob`.

### F7 — MEDIUM: Share-token handling diverges across surfaces
- `GET /api/playlists/:id` spreads `...playlist`, leaking `shareToken` to any viewer (public/shared), not just the owner (`management-routes.ts:220-229`); the list endpoint strips it.
- Two `canViewPlaylist` versions disagree: `management-routes.ts:29-45` (token valid regardless of visibility) vs `opensubsonic-routes.ts:209-222` (requires `visibility='link'`), and `shareTokenGrantsSong` requires `'link'` — so a token on a private playlist opens metadata but not streaming.
- Token lifecycle diverges: OpenSubsonic `updatePlaylist` clears the token when visibility≠'link'; management PUT keeps it.

### F8 — MEDIUM-LOW: Watcher/scheduler/boot ingest jobs carry non-JSON payloads
`library/watcher.ts:81`, `scheduler.ts:107`, `app.ts:152` push the raw path string as payload; `worker.ts:103-108` falls back to `payload = {}`. Files dropped into `INGEST_PATH/<libraryId>/` are imported with the **default** library and **global** organize pattern, ignoring that library's pattern, until a rescan re-resolves by path prefix. Latent inconsistency; fix by JSON-encoding `{sourcePath, libraryId}` at push time.

### F9 — MEDIUM: Session lifecycle gaps
- Password reset via `PUT /api/admin/users/:id` updates hashes but only invalidates sessions when `isAdmin` changes (`admin-routes.ts:359-399`) — a compromised account's sessions survive up to 7 days.
- `POST /api/setup` TOCTOU: `userCount()` check and `createUser` are separated by `await hashPassword` (`auth-routes.ts:113-135`) — two concurrent first-run requests can create two admins.
- Login throttle: in-memory `Map` never evicts stale keys; `trustProxy` unset (`app.ts:158`), so behind the documented reverse proxy all clients share one IP → trivial targeted lockout of a known username (5 requests/15 min).

### F10 — MEDIUM: Upload reassembly buffers the whole file in memory
`uploads/chunked.ts:44-52` reads all chunks (up to 1 GiB) into the main Fastify process heap and `Buffer.concat`s. Fix: stream chunk→fd→`fs.createWriteStream` pipeline. Also: stale `upload_sessions` rows + chunk dirs are never GC'd (no sweeper exists); missing chunk at complete → 500 instead of 4xx.

### F11 — MEDIUM: No CI test workflow
`.github/workflows/` contains only `release-docker.yml` (tag-triggered build/push, no test job). ~834 tests exist but nothing runs them on push/PR, and the Docker build doesn't run them either. Combined with a dirty working tree observed during the audit (a spec-compliance regression being committed to make a test match code — see §13 note), this is the highest-leverage process fix.

### F12 — MEDIUM: No health endpoint, no Docker HEALTHCHECK, no SIGTERM handling
No `/health` route exists; `Dockerfile.server`/`compose.yaml` define no healthcheck; `index.ts` installs no signal handlers, so the graceful-shutdown path in `app.ts:264-279` (worker shutdown race, watcher stop, `closeDb`) likely never runs under `docker stop` — containers get SIGKILLed mid-write after the 10s grace. WAL makes this safe-ish, but job state relies on the stale-job sweep.

### F13 — MEDIUM-LOW: FFmpeg-missing fallback is dead code
`retrieval.ts:40-66` intends to fall back to direct file serving if ffmpeg is unavailable, but `spawn()` emits ENOENT asynchronously — the `try/catch` never fires and the request 500s. On any host without ffmpeg in PATH, every transcode-decided stream fails.

### F14 — LOW-MEDIUM: Unbounded growth & heavy synchronous reads
- `listening_history` is never pruned (grep-verified) — the hottest analytics table grows forever.
- `getUserStatistics` fires ~20 aggregate queries per request; `getTopRated*` each recompute a global AVG over `user_songs` (3 redundant scans) — `statistics/repository.ts:645-681`.
- `auto-dj` runs `ORDER BY RANDOM()` over the whole `songs` table, synchronously in the HTTP handler; errors swallowed into `{songs: []}` with HTTP 200 (`auto-dj/routes.ts:79-82`), masking DB failures.
- Smart playlist list view compiles rules per smart row per request (`management-routes.ts:179`); the 30s grant cache is an unbounded Map (`playlists/repository.ts:167-220`).
- `ingest_jobs` grows by one row per file forever (contrast: scan jobs pruned to 50).

### F15 — LOW-MEDIUM: Integrity constraint gaps
- `user_libraries` has **no FKs**; `deleteLibraryById` doesn't clean it → orphans.
- `genres.name` not UNIQUE while artists/labels are; `getOrCreateGenreByName` is check-then-insert → duplicate genres under concurrency.
- `albums` has no `UNIQUE(name, artist_id)`; `ensureAlbum` check-then-act → duplicate albums when scanner and ingest race.
- Migration 038's rebuild silently dropped `UNIQUE(source_path)` on `ingest_jobs`.
- Unindexed FK-cascade child columns (`playlist_songs.song_id`, `user_songs.song_id`, `bookmarks.song_id`, `api_keys.user_id`, …) → parent deletes full-scan child tables.
- `songs.title` unindexed; search is leading-wildcard `LIKE '%…%'` → full scans.

### F16 — LOW: Security hygiene items
- `.env.example` ships a default `SESSION_SECRET` that passes the `min(32)` zod check with no runtime warning; rotating it silently breaks all stored Subsonic passwords (AES key = SHA-256 of the secret, `auth/encryption.ts`).
- `maxBitRate` query param overrides (instead of min'ing with) the admin cap (`transcode/service.ts:44-46`) — a capped user passes `maxBitRate=99999` for full quality; negative values produce invalid ffmpeg args → 500.
- Login username enumeration via timing (no dummy bcrypt compare for unknown users).
- No security headers (helmet/CSP/`X-Content-Type-Options`).
- `apiKey` accepted as query param → keys in access logs; Subsonic `t/s` tokens likewise (inherent to protocol).
- Cover-art/avatar upload trusts client `mimetype` (no magic-byte sniffing, unlike artist images which are sniffed).
- Cover-art DELETE is silently reverted: next rescan re-embeds album art into the file (`scanner.ts:520-549` × `songs/routes.ts:612-624`).
- Inactive (`active=0`) songs remain streamable by id on both endpoints.

---

## 7. Code Quality Findings

Format: Problem · Location · Why it matters · Risk · Recommended change · Priority.

| # | Problem | Location | Why / Risk | Change | Priority |
|---|---|---|---|---|---|
| Q1 | God route file: 17 endpoints + fetchers + serializers + row interfaces | `opensubsonic/routes/browsing.ts` (1,198 LOC) | Hardest file to test/review in the repo; row interfaces copy-pasted into 4 more files | Split per resource (`albums.ts`, `artists.ts`, `search.ts`…); centralize row types | Medium |
| Q2 | Controller doing application orchestration | `songs/routes.ts:77-167` (tag write → move → DB → resync), `:577-640` | File/DB/job coordination untestable without HTTP; multi-step failure leaves drift | Extract `SongApplicationService`; routes validate + delegate | High |
| Q3 | Duplicated authz helpers with divergent semantics | `playlists/management-routes.ts:29-52` vs `opensubsonic-routes.ts:209-222` | Share behavior differs by surface (F7) | Single `PlaylistAccessPolicy` used by both | High |
| Q4 | Duplicated range parsers (byte-identical today) | `songs/routes.ts:670-702` / `retrieval.ts:240-272` | Guaranteed drift eventually | Move to `shared/http/range.ts` | Medium |
| Q5 | Two admin-gate styles | DB re-check (`users/admin-routes.ts:50-61`) vs session flag ×14 modules | Session flag is 7-day stale; only safe because role changes nuke sessions | One `requireAdmin` preHandler (DB re-check) registered globally | Medium |
| Q6 | Unguarded `JSON.parse` in row mappers | `songs/repository.ts:103-105`, `artists/repository.ts:21-23`, `albums/repository.ts:41-46` | One malformed row 500s a whole list endpoint | try/catch → `undefined` (mirror `parseRules`) | Low |
| Q7 | Thrown validation errors → 500 | `songs/routes.ts:553` (scrobble body), `lyrics-routes.ts:65` | Client bugs surface as server errors; scrobble accepts unbounded `completion`/`durationListened` | Validate → 400; clamp numeric fields | Medium |
| Q8 | Mass assignment on preferences | `user-preferences/routes.ts:21` | Unknown keys persist into schemaless blob | Key allowlist | Low |
| Q9 | `isAdmin` never type-checked | `users/admin-routes.ts:274,366` | Truthy string `"false"` grants admin (admin-only today) | zod boolean | Low |
| Q10 | `sanitizeEmail` dead (identical branches); `USE_CRYPTO` dead config; `events` EventEmitter dead; `reader.ts:104` unreachable `??` | various | Dead code misleads | Delete | Low |
| Q11 | `smartGrantCache` unbounded Map | `playlists/repository.ts:167-220` | Slow memory growth keyed by rule version | LRU or periodic sweep | Low |
| Q12 | `deleteSessionsForUser` full-scans + JSON.parses every session row | `auth/session.ts:10-21` | O(all sessions) per role change/deletion | Store `user_id` column or index a JSON extract | Low |
| Q13 | Mixed timestamp formats (`datetime('now')` vs ISO `toISOString()`) | `libraries/repository.ts:134` vs `playlists` defaults | String comparisons fragile; documented pitfall in one file, violated in another | Standardize on ISO everywhere | Low |
| Q14 | `toOpenSubsonicSong` does blocking `statSync` per song in list endpoints | `browsing.ts:703-709,760` | N+1 sync fs calls in search3/getAlbum/getStarred2 | Batch-stat or store size in DB | Medium |
| Q15 | Biased shuffle `sort(() => Math.random() - 0.5)` | `management-routes.ts:459` | Non-uniform randomization | Fisher-Yates | Low |
| Q16 | Scripts committed with hardcoded personal paths | `scripts/test-smart-compiler.ts` | Broken on any other machine | Delete or parameterize | Low |

**Not found (checked and clean):** SQL injection (parameterized everywhere; dynamic fragments interpolate fixed whitelists only), path traversal in file-serving (all paths DB-indexed; upload validation is double-guarded), command injection (ffmpeg argv-style, mutagen stdin JSON, no shell), XML injection in the Subsonic serializer (vendored xml-js escaping verified), session fixation (`regenerate()` on login/setup), CSRF (sameSite=strict), whole-file buffering in streaming.

---

## 8. Database Assessment

**Technology:** SQLite via better-sqlite3, WAL, `foreign_keys=ON`, `busy_timeout=5000` on both connections, `PRAGMA optimize` — correctly configured for a single-writer + concurrent-reader workload.

**Schema health (32 tables, 37 indexes):** Well-normalized core (artists/albums/songs + junction tables with positions for multi-artist/multi-genre/composer/label), deliberate read-optimized denormalization, explicit FK actions throughout. 49 migrations, ledger-tracked, transactional per file, `.cjs` data migrations careful (041's JSON→relational move is conflict-safe).

**Issues (detail in §6 F3/F4/F15):** non-transactional playlist rewrite; rescan nulling `average_rating`; `user_libraries` FK-less; missing uniqueness on `genres.name`/`albums(name,artist_id)`; unindexed FK-cascade children; leading-wildcard search columns; unbounded `listening_history`/`ingest_jobs`; `synchronous` never set to `NORMAL` (WAL default is FULL — commit latency higher than needed on scrobbles/scan upserts); no `BEGIN IMMEDIATE` usage (busy_timeout mostly covers it).

**Query patterns:** raw `db.prepare` per call, no helper layer (idiomatic better-sqlite3, fine). Batch-attachment pattern (`getSongArtistEntriesForMany` + one chunked `IN` query) eliminates N+1 in list endpoints — genuinely well done. `IN`-chunking at 500 respects SQLite host-variable limits. Transactions used correctly in scrobble/junction setters/migrations; missed in the playlist rewrite and per-song scan persist (a SIGKILLed scan can leave a song without artist/genre links — low probability, real).

**Concurrency model:** one writer thread (worker) + one writer connection (main), WAL readers never block, 5s busy timeout absorbs collisions, per-song scan commits keep transactions small. Adequate today.

**Scale verdict:** healthy to roughly ~100k tracks / tens of concurrent users. Pressure points beyond that: leading-wildcard search full scans, `ORDER BY RANDOM()` in request path, statistics' ~20-query fan-out, unindexed cascade children, and the synchronous driver blocking the event loop on long aggregates.

---

## 9. API Assessment

**Surface:** 160 endpoints — 117 native `/api/*`, 43 `/rest/*` (OpenSubsonic). Auth gates: global `/api` preHandler with exempt list (`/api/login`, `/api/logout`, `/api/setup`, `/api/me`, `/api/avatars`, `/api/libraries` — see F2); Subsonic hook handles `/rest/*` (apiKey → u/t/s → session chain).

**Strengths:** consistent `{error}` shape and sanitized 5xx via central handler; correct HTTP semantics on streaming (206/416, Accept-Ranges, Content-Disposition sanitization); playlist authorization thorough and duplicated across both surfaces; share tokens scoped by SQL EXISTS to the linked playlist's content; zod on ~10 route groups; manual allowlist validation elsewhere mostly real.

**Weaknesses:**

- **Pagination is nearly absent**: only `GET /api/admin/system-tasks/history` paginates properly. `/api/songs` and `/api/albums` hard-cap at 500, `/api/artists` and `/api/playlists` unbounded, `/rest/search3` counts have **no max clamp** (authenticated DoS amplifier, `browsing.ts:313-318`). No cursor/offset conventions exist.
- **Validation gaps** (§7 Q7–Q9): playlist `songIds` elements unchecked, login body types unchecked, scrobble fields unbounded → 500s instead of 400s, `/rest/*` `size/count` NaN → 500.
- **Contract leaks**: absolute `filePath` + `checksum` on song DTOs (deliberate shared-type field — flag for review); `shareToken` to non-owner viewers (F7); ingest/organize paths and raw worker errors to any session user; statistics routes return raw `err.message` on 500, violating the app's own leak policy; lrclib/musicbrainz 502s include upstream messages.
- **OpenSubsonic drift**: `serverVersion: '0.1.0'` hardcoded vs released v0.7.0; docs claim `u`+`p` password auth but `p` is **not implemented** (client-compat landmine); `scrobble.view submission=false` treated as no-op instead of now-playing; `getIndexes.lastModified = Date.now()` defeats client caching; **in-flight regression**: `getAlbumInfo2.view` made to return `albumInfo` (spec says `albumInfo2`) with the test changed to match the code, not the spec.
- **Docs drift**: `docs/api.md` omits ~20 endpoints (uploads, events, statistics, auto-dj, `/api/stream/:id`, deletes) and misdocuments auth.
- **hideExplicit** applied on most lists but missing on search albums and the lyrics route.

---

## 10. Media & Streaming Assessment

**This is the strongest area of the codebase.**

- **Direct streaming**: `fs.createReadStream` (64 KiB chunks), byte-range parser handles suffix (`-N`) and open-ended (`N-`) forms, correct 206/416, `Accept-Ranges`, HEAD special-cased on the Subsonic route. Memory-safe end-to-end; no whole-file buffering anywhere in the stream path.
- **Transcoding**: live ffmpeg per request (`-map 0:a:0`, codec by target format, pipe:1 stdout with backpressure), **SIGKILL on client disconnect**, argv-spawn with no shell, pinned ffmpeg + mutagen in the runtime image. Correct design for a self-hosted server; no pre-transcode cache (fine at this scale).
- **Uploads**: chunked protocol with server-issued session UUIDs, fileId regex, chunk bounds, double-guarded relative-path validation (segment check + resolved containment), 10 MB multipart cap (413 verified in vendored multipart), 1 GiB file cap. Files enter the library only through the standard ingest pipeline — clean separation.
- **Tag I/O**: music-metadata for read (rich schema: MBIDs, ReplayGain, ISRC, explicit, synced lyrics); writes via embedded Python/mutagen with stdin-JSON payload (injection-free), 60s timeout + SIGKILL, atomic tmp→fsync→rename rewrites. (music-metadata v11 is read-only — the Python dependency is justified, though it makes the writer a second runtime to maintain.)
- **Artwork**: dedup'd blobs in DB (sha256), album→song embedding sync during scan, magic-byte sniffing for artist images, orphan GC on tag-edit routes. Issues: uncached on-demand `parseFile` in getCoverArt for unreconciled songs; `/api/cover-art/:id` lacks Cache-Control (Subsonic path has `private, max-age=86400`); scan-time embedding mutates user files (intentional, convergent, but causes one extra re-hash pass and self-triggers the watcher once).

**Gaps:** F10 (upload reassembly memory), F13 (dead ffmpeg fallback), no ffmpeg concurrency cap (any authenticated user can CPU-DoS the host via transcode requests — pair with rate limiting), inactive songs streamable, `/api/stream/:id` records no play accounting (players tracker only sees Subsonic clients — likely unintended), duplicated range parsers.

**Scalability verdict:** fine for small→medium personal libraries and many concurrent *direct* streams (static-file serving is cheap). Live transcode is the scarce resource: unbounded ffmpeg spawns + no cache means concurrent transcodes scale linearly with CPU, and each transcode re-decodes from the top on every seek. This is the first thing that would need a manager (concurrency cap → later, a transcode cache) at higher load.

---

## 11. Background Processing Assessment

**Model:** durable DB-backed queue (`scan_jobs`), one worker thread, strictly serial, 1s poll. Job types: `scan`, `resync`, `ingest`, `organize`, `artist_images`, `cleanup_review`. Triggers: API, boot, three interval schedulers (scan 60m, artist images 24h, ingest 60m), chokidar watchers (2s debounce, resync-coalesced), worker-internal review cleanup (24h).

**Done well:** stale-`running` sweep at boot; terminal-state guard on shutdown (doesn't clobber completed jobs); crash respawn with supervisor in `app.ts`; scheduler drift guards with persisted timestamps + overlap prevention; per-file error isolation with failure cap; job pruning (50 terminal scan jobs); probe-before-deactivate so an unmounted drive can't wipe the catalog; checksum-based move/replace detection; deactivate-instead-of-delete semantics.

**Gaps:**

- No retry anywhere — a failed scan waits for the next trigger (acceptable for scans; review-cleanup has 5-min retry).
- No cancellation — `docker stop` SIGKILLs a long scan after 3s (pairs with F12).
- `scan` jobs don't coalesce (only `resync` does) — repeated API triggers stack full scans.
- Payload smuggled in the `stats` JSON column (hacky but functional); ingest payload bug F8.
- No scan progress reporting (`updateJobStats` only used by organize); `/api/scans/status` hides pending jobs (NULL `started_at` sorts last) and the TS type `'full'|'incremental'|'watch'` is fiction vs actual values.
- SSE events: only `connected` + `library:changed`; no replay/Last-Event-ID; write backpressure ignored (slow client accumulates buffers).
- Player tracking is in-memory, per-user (not per-device), and never fed by the web player's own stream endpoint.
- Scrobble has no server-side threshold and no idempotency key — double submissions double-count.

**Nothing here justifies an external queue.** The DB-backed single worker is the right answer for a single-container self-hosted app; the fixes are coalescing, payload typing, and lifecycle (SIGTERM), not Redis/BullMQ.

---

## 12. Security Assessment

Prioritized. Evidence-based only; nothing destructive was attempted.

| Sev | Finding | Location | Fix |
|---|---|---|---|
| **High** | Library tenant isolation unenforced (F1) | `user_libraries` unused in data plane | Decide model; enforce membership in every content query + stream/download, or remove the feature surface |
| **Medium** | Unauthenticated `/api/libraries` path disclosure (F2) | `app.ts:198`, `libraries/admin-routes.ts:49` | Require session/admin; fix docs |
| **Medium** | Password reset doesn't invalidate sessions (F9) | `users/admin-routes.ts:359-399` | `deleteSessionsForUser` on password change |
| **Medium** | Default `SESSION_SECRET` in `.env.example` passes validation | `.env.example:4` | Startup warning if default; document rotation impact on Subsonic passwords |
| **Medium** | No rate limiting except login; unbounded ffmpeg spawns (transcode DoS) | `transcode/service.ts:77-99` | `@fastify/rate-limit` on `/rest/stream.view` + global ffmpeg concurrency cap |
| **Medium** | `maxBitRate` overrides admin cap; negative → ffmpeg error 500 | `retrieval.ts:30`, `transcode/service.ts:44-46` | Clamp `min(requested, userCap)`, validate range |
| **Medium-Low** | Login username enumeration via timing; throttle Map leak; proxy IP lockout (F9) | `auth-routes.ts:35-80` | Dummy bcrypt compare; evict stale keys; set `trustProxy` |
| **Medium-Low** | Setup TOCTOU → double admin (F9) | `auth-routes.ts:113-135` | Wrap check+create in one synchronous section |
| **Low** | shareToken compared non-constant-time; no expiry; leaked to non-owners (F7) | `management-routes.ts:40,220-229` | Strip from DTOs; constant-time compare; optional expiry |
| **Low** | `isAdmin` truthy-string grants admin; preferences mass assignment; scrobble field poisoning (Q7–Q9) | various | zod schemas on bodies |
| **Low** | No security headers; mimetype-trusting image uploads; inactive songs streamable; `apiKey` in query/logs | various | helmet or manual headers; magic-byte sniff; `active=1` filters |
| **Info** | Subsonic `t/s` tokens replayable & in logs (protocol-inherent); `getIndexes.lastModified` defeats client caching | `opensubsonic/auth.ts`, `browsing.ts:117` | Document; consider per-token lastModified |

**Verified clean:** SQLi, path traversal, command injection, XSS-in-XML, CSRF (sameSite=strict + JSON APIs), session fixation, upload traversal, ffmpeg lifecycle, error-message leaking on 5xx (except statistics routes), secrets handling (bcrypt 12, AES-256-GCM, timingSafeEqual, worker never sees SESSION_SECRET).

---

## 13. Performance Assessment

**Confirmed bottlenecks (code-level facts, high confidence):**

1. **Search**: leading-wildcard `LOWER(x) LIKE '%…%'` on songs/albums/artists — full table scan per keystroke-class request (`search/routes.ts:175-177`, `browsing.ts:321-323`). Fine ≤ ~10k tracks, degrades linearly.
2. **Statistics endpoints**: ~20 synchronous aggregate queries per request, plus 3 redundant global-AVG scans in top-rated queries (`statistics/repository.ts:645-681`). better-sqlite3 blocks the event loop for the duration.
3. **Auto-DJ**: `ORDER BY RANDOM()` over the full `songs` table, 2–3 queries per request, synchronous in the handler.
4. **OpenSubsonic list serialization**: per-song blocking `statSync` (`browsing.ts:703-709,760`) — N sync syscalls per list response.
5. **Upload reassembly**: ≤1 GiB buffered in main-process heap (`chunked.ts:44-52`).

**Likely bottlenecks (inference from query shapes):** unindexed FK-cascade columns on parent deletes; `ensureAlbum`/`ensureArtist` check-then-insert under scanner+ingest concurrency; smart-playlist list view compiling rules N times per page; `buildGenrePaths` rebuilding the genre tree per request in suggestions.

**Architectural risks (not yet bottlenecks):** synchronous driver + long aggregates under many concurrent readers; unbounded `listening_history`; no transcode concurrency cap; single worker serializing all background work (a 50k-file initial scan blocks ingest for its duration — acceptable, but worth a priority lane later).

**Premature to optimize:** cover-art BLOB reads (SQLite blobs at this scale are fine; revisit if artwork moves to disk+derivative cache); SSE fan-out; session sweeps.

---

## 14. Technology Stack Assessment

| Technology | Current role | Assessment | Verdict | Reason | Alternative | Migration difficulty |
|---|---|---|---|---|---|---|
| Node 20 + TypeScript (strict) | Runtime/language | Solid; type safety good; tests excluded from `tsc` | **Keep** | Ecosystem fit, team velocity | Go (see §15) | N/A |
| Fastify 5 | HTTP framework | Used effectively (hooks, error handler, multipart); `trustProxy` unset | **Keep** | Not a bottleneck | — | — |
| better-sqlite3 | DB driver/DB | Correct pragmas; sync driver is the constraint at scale; zero-dbo Ops | **Keep, isolate** | Right-sized for single-container self-host; migration path exists if triggers fire (§16) | PostgreSQL + Drizzle/Kysely | High (see §15) |
| music-metadata | Tag reading | Excellent schema coverage; read-only | **Keep** | — | — | — |
| Python + mutagen 1.48.1 (pinned) | Tag writing | Justified (reader is read-only); second runtime in the image | **Keep but isolate** | Injection-free, atomic, timeout-guarded | Pure-JS writer (id3/flac libs) — fragmented ecosystem; not worth it | Medium |
| ffmpeg | Transcoding | Correctly spawned/managed; no concurrency cap | **Keep** | Industry standard | — | — |
| chokidar 3 | FS watching | Debounced + coalesced correctly; self-trigger loop via cover writes | **Keep** (upgrade to v4 opportunistically) | — | native fs.watch (worse) | Low |
| zod | Validation | Used on config + ~10 route groups; gap elsewhere | **Keep** | — | — | — |
| bcrypt (cost 12) | Passwords | Current best practice | **Keep** | — |argon2 (marginal gain) | Low, optional |
| @fastify/session + SQLite store | Sessions | Fixation-safe, server-side store, sweeper | **Keep** | — | — | — |
| xml-js | Subsonic XML | Escaping verified correct; old but stable | **Keep but isolate** | Compat surface only | hand-rolled (worse) | — |
| `scan_jobs` DB queue + 1 worker thread | Background jobs | Durable, simple, correct lifecycle | **Keep** | External queue = unneeded infra | — | — |
| In-process caches (2 small Maps) | Caching | Adequate; one unbounded | **Keep, bound the Map** | Redis unjustified for single-container | Redis | — |
| LIKE-based search | Search | Works ≤10k tracks; no ranking/fuzzy | **Replace with SQLite FTS5** (not an engine) | Keeps operational simplicity, adds ranking/prefix speed | Meilisearch/Typesense (unjustified ops burden) | Medium |
| vitest | Tests | 834 tests, integration-grade fixtures | **Keep** | Add coverage thresholds later | — | — |
| Docker (single container) + compose | Deployment | Multi-stage, non-root PUID/PGID, pinned mutagen | **Keep** (+healthcheck) | Matches self-host model | K8s (never) | — |
| GitHub Actions | CI/CD | Release-only, no test job, actions pinned by tag | **Keep, add CI workflow** | — | — | Low |

---

## 15. Architecture Alternatives

### Option A — Minimal Evolution
Keep stack and structure; fix F1–F16, add CI/health/SIGTERM, add missing indexes, FTS5 search, pagination, rate limiting.

- **Benefits:** lowest risk, immediate risk reduction; no relearning; all fixes independently shippable.
- **Drawbacks:** application-layer duplication (Q1–Q5) remains; domain concepts stay implicit.
- **Operational complexity:** unchanged. **Migration difficulty:** trivial. **Performance:** fixes the confirmed bottlenecks.
- **When:** always the first phase regardless of later choices.

### Option B — Deepened Modular Monolith (recommended target)
Option A + extract a thin application-service layer inside each feature (`features/<x>/service.ts`), unify cross-surface policies (playlist access, share tokens, range parsing, admin gate) into explicit shared services, enforce dependency rules (§19), split the two god route files, introduce typed job payloads, and add `/health`, metrics hooks, request IDs.

- **Benefits:** kills the duplication that is already costing correctness (F7); makes business rules unit-testable without HTTP; keeps single-container ops; preserves all 834 tests as a safety net.
- **Drawbacks:** 2–4 months of incremental refactoring discipline; requires the team to say "no" to logic in routes going forward.
- **Operational complexity:** unchanged. **Performance:** neutral-to-positive (batch-stat fix, statistics consolidation).
- **When:** the default choice for a codebase this healthy. This is the 5-year-ownership answer.

### Option C — Greenfield (PostgreSQL and/or Go)
The external proposal: Go (or TS) + PostgreSQL + FTS/trigram + DB-backed jobs + OpenSubsonic as adapter + Track≠MediaFile domain.

**Honest evaluation against this repository:**

- **Go rewrite: not justified *from where Sonarly is today* — but recorded as the preferred *greenfield* language.** The two judgments are distinct, and both are captured in Decision Record DR-1 below. The existing TS/Fastify code is not the bottleneck anywhere; streaming, scanning, and job handling are already correct. A rewrite would throw away ~834 tests and working, audited subsystems (scanner resilience, upload pipeline, Subsonic compat) to fix problems that are layering/correctness problems, not language problems — every finding in §6 (unenforced `user_libraries`, non-transactional playlist writes, conflict resurrection, rating loss, missing coalescing) would reproduce identically in a Go codebase, because they are domain invariants, not runtime defects. That said, "insufficient evidence that Node is an inferior implementation of Sonarly" is the correct phrasing — **not** "Go doesn't make sense." Sonarly's workload shape (filesystem-heavy scanning, long-lived workers, subprocess management, cancellation propagation, streaming, single-binary self-hosted deployment) is an unusually good fit for Go, and on pure implementation quality — ignoring migration cost and existing code — Go + SQLite would be a serious (arguably preferred) greenfield choice over TypeScript + Fastify + SQLite. TypeScript retains one genuine structural advantage for *this* product: protocol-shaped data boundaries (OpenSubsonic + native API) where Zod gives runtime validation and static types from one definition, plus type-safe shared contracts with the web client via `@sonarly/shared`.
- **PostgreSQL: defer with triggers.** The proposal's strongest argument is multi-client concurrency. But: the deployment is a single container; SQLite WAL already isolates the one writer; the confirmed problems (search, statistics fan-out, ORDER BY RANDOM) are query-shape problems that FTS5 + query fixes solve at far lower cost. Postgres earns its operational cost only when one or more of these become true: (a) measured write contention (SQLITE_BUSY under normal load), (b) multiple app replicas, (c) library > ~500k tracks or > ~50 concurrent writers, (d) need for concurrent long analytics. The better-sqlite3 sync driver blocking the event loop is the real technical driver — mitigable today by moving heavy analytics to the worker.
- **Track≠MediaFile: adopt the *modeling* insight without the rewrite.** The repo already does identity-based duplicate merging; when multi-format libraries become a requirement, evolve `songs` → `tracks` + `media_files` via migration, not greenfield. Same for "OpenSubsonic as adapter" — the codebase already follows this; Option B completes it.

- **Benefits of C (if ever executed):** comfortable concurrency headroom, trigram search, natural multi-replica path.
- **Drawbacks:** full rewrite risk; new operational surface (backup/upgrade story changes); test suite rewrite; months of feature freeze. **Failure mode:** the classic second-system rewrite stalls at 80% compatibility while the working app atrophies.
- **When:** only if the triggers above fire and Option B is already done.

**Recommendation: A immediately, B as the target state, C rejected for now with written triggers.**

### Decision Record DR-1 — Implementation language (recorded 2026-09-24)

- **Decision:** Sonarly remains **TypeScript + Fastify 5 + better-sqlite3 + Zod**. No rewrite. PostgreSQL, Redis, Elasticsearch, and microservices are likewise deferred; each has written triggers (below and §22).
- **Greenfield vs. from-here distinction (explicitly recorded):** *If Sonarly were designed from zero today with unlimited implementation budget,* **Go + SQLite** would be the preferred backend implementation — the system's shape (filesystem scanning, bounded workers, cancellation via `context`, streaming I/O, ffmpeg subprocess management, single-binary deployment) fits Go exceptionally well. *From Sonarly's current state,* TypeScript stays, because the audit found no evidence that Node/Fastify produces architectural, correctness, or performance problems; the identified problems are domain invariants that any language would reproduce.
- **Why TypeScript remains defensible (even arguably better) here:** Zod's single-definition runtime+static validation at protocol boundaries; end-to-end type safety with the React client through `@sonarly/shared`; the audited, correct streaming/scanner/job subsystems already exist and are tested.
- **Consequences:** engineering effort goes to correctness, isolation, and query design (Phases 0–5), not platform change. The "rewrite in Go" option is **closed, not deleted** — it is re-openable only as a *product* decision (e.g., a ground-up Sonarly 2.0), never as a migration of this codebase.
- **Revisit triggers for any language/platform change:** (a) measured evidence that the Node runtime is the bottleneck (event-loop blocking under real load that worker offload cannot fix); (b) a product decision to support multi-replica deployment; (c) a ground-up rewrite for product reasons — at which point Go + SQLite is the default starting proposal, per this record.
- **PostgreSQL triggers (unchanged):** measured SQLITE_BUSY contention under normal load; multiple app replicas; library > ~500k tracks or > ~50 concurrent writers; concurrent long-running analytics requirements.

> **STATUS CHANGE (2026-09-24, same day):** Trigger (c) has fired as an explicit **product decision**. A full greenfield Go rewrite is now **open as a parallel exploration track** on dedicated branch `feat/go-rewrite` (worktree `.worktrees/go-rewrite`), proceeding alongside — not instead of — the Phase 0–1 correctness/security fixes on the TypeScript codebase. The analysis above stands unchanged (Go is the preferred *greenfield* implementation; the TS stack remains correct and maintained for v1). The Go track is treated as Sonarly v2 exploration: it must reach functional parity with the audit's target architecture (§16–§19) before any cutover discussion, and v1 continues to receive fixes regardless of v2's outcome.

---

## 16. Recommended Target Architecture

**A hardened modular monolith**: same runtime, same database, same deployment; the change is *inside* each feature — a three-layer interior (API → application → repository) with explicitly shared policies, plus typed background jobs and real observability. No new infrastructure.

Principles applied:

1. **OpenSubsonic and native REST are two adapters over one application layer** (the codebase's best existing instinct, made total).
2. **Business rules live in application services**, unit-testable without HTTP; repositories own SQL only; routes own HTTP only.
3. **Cross-feature policies are explicit modules** (playlist access, streaming, tagging) rather than copy-paste.
4. **Background work is typed and lifecycle-managed** (JSON payloads, coalescing, SIGTERM drain).
5. **SQLite stays**, with FTS5 for search and a documented trigger list for a future Postgres evaluation.
6. **Observability is built in**: `/health` + `/ready`, request IDs, structured job lifecycle logs — no metrics stack until needed.

```text
Client (web / Subsonic apps)
   │  /api/* (session)          /rest/* (token/apiKey)
   ▼
┌────────────────────────────────────────────────┐
│ API adapters            features/<x>/routes.ts │  HTTP in/out, validation, authz preHandlers
│        │                                       │
│ Application             features/<x>/service.ts│  business rules, transactions, orchestration
│        │                                       │
│ Policies (shared)       policies/playlist-access, streaming, tagging, admin
│        │                                       │
│ Repositories            features/<x>/repository.ts │  raw SQL, row mappers — no business rules
└────────┼───────────────────────────────────────┘
         ▼
   SQLite (WAL)  ◀──  worker thread: typed jobs (scan/ingest/organize/…) via db queue
         ▲
   ffmpeg / mutagen / fs (behind application services, never in routes)
```

---

## 17. Proposed Directory Structure

Evolution of the current tree — **no big-bang move**; this is the destination as features are touched (strangler-style):

```text
packages/server/src/
  index.ts                  entry: config → buildApp → listen + SIGTERM/SIGINT
  app.ts                    composition root only (plugins, hooks, worker, watchers)
  config.ts                 zod env (unchanged)
  db/
    connection.ts  migrate.ts  migrations/
  lib/                      ← renamed from "shared concepts that aren't features"
    http/range.ts           unified byte-range parser (kills Q4)
    http/errors.ts          typed AppError → status mapping (kills 500-instead-of-400)
    validation.ts           zod helpers for route bodies/queries
    result.ts               (only if it earns its place — no generic Either framework)
  policies/
    playlist-access.ts      ONE canView/canEdit/share-token policy (kills Q3, F7)
    admin.ts                ONE requireAdmin (DB re-check) (kills Q5)
    streaming-policy.ts     active checks, bitrate clamping, share-token grants
  features/
    songs/
      routes.ts             thinned: HTTP only
      service.ts            NEW: tag edit orchestration, delete-with-file, stream prep
      repository.ts         SQL only
      search-index.ts       FTS5 sync (triggers from scanner/service)
    playlists/
      routes.ts  service.ts  repository.ts
    library/
      routes.ts  service.ts  repository.ts  scan-repository.ts
      scanner.ts  worker.ts  queue.ts (typed payloads)  watcher.ts  scheduler.ts
    ingest/  uploads/  tags/  cover-art/  artists/  albums/  genres/
    auth/  users/  opensubsonic/ (split browsing.ts per resource)  …
  jobs/
    payloads.ts             typed JobPayload union (kills F8's stringly-typed stats smuggling)
    events.ts               SSE registry (renamed; drop dead EventEmitter)
  observability/
    health.ts               /health /ready
    logging.ts              request IDs, child loggers per feature
  shared/ (existing entity types — unchanged, consumed via @sonarly/shared)
```

Rules for what may **not** appear: no `utils/` dumping ground; no cross-feature repository imports (go through the owning feature's service); no new abstractions without two real consumers.

---

## 18. Module Responsibilities

Target-state responsibilities (current owners noted where they differ):

- **auth / users** — credentials, sessions, API keys, admin gates, profile. Owns `requireAdmin` policy; sessions invalidated on any credential change.
- **libraries** — library CRUD, organize patterns, default-library invariant; **owns the library-membership decision (F1)** — either enforces `user_libraries` in a `LibraryAccessPolicy` consumed by every content query, or the feature is removed.
- **catalog (songs/albums/artists/genres/years/labels)** — read models, tag editing (via tags feature), lyrics, cover-art references. Application services own multi-step writes (tag→move→DB→resync) as single transactions-with-compensation.
- **playlists** — static + smart; owns `PlaylistAccessPolicy` (the single source for owner/public/share/ACL semantics across both API surfaces); smart rules compiled via `smart-playlists/compiler` (already solid — keep).
- **playback (stream/transcode/players/bookmarks/scrobble)** — one `StreamingService` behind both endpoints: range parsing, transcode decision (with clamped bitrate), active-song check, play accounting for *all* clients, ffmpeg concurrency cap. Kills F13/Q4/inactive-streaming/accounting gaps.
- **ingestion (ingest/uploads/duplicates/conflicts/organize)** — quarantine pipeline, identity-based duplicate strategies, organize jobs, conflict *file* lifecycle (F5 fix: delete files, not just rows).
- **library runtime (scanner/watcher/scheduler/queue/worker)** — filesystem→DB reconciliation, checksum identity, activity recompute, typed job payloads, coalescing for all job types, SIGTERM drain.
- **search** — FTS5 index maintenance + query service (replaces LIKE; keeps playlist scoping and hideExplicit consistent).
- **statistics / home / auto-dj / suggestions** — read-optimized query services; heavy aggregates moved off the request path (worker-computed snapshots) if profiling confirms need.
- **opensubsonic** — pure adapter: auth hook + serializers + per-resource route files; contains zero business rules.
- **observability** — health/readiness, request IDs, job lifecycle logging.

---

## 19. Dependency Rules

```text
routes (API adapters)
  │  may import: services, policies, lib, zod schemas
  │  must never: import repositories of OTHER features, spawn processes, touch fs
  ▼
services (application layer)
  │  may import: own feature's repository, other features' SERVICES (not repos), policies, lib
  │  must never: import fastify (request/reply), opensubsonic serializers
  ▼
repositories
  │  may import: db connection, row types
  │  must never: import routes, services, fastify; contain zero business rules
  ▼
db (SQLite)  ·  worker may import: services/repositories/jobs — never routes

policies  ← imported by routes AND services; import repositories only
lib       ← imported by anyone; imports nothing from features
jobs/events  ← payload types shared by main + worker; no runtime imports
```

Enforcement: a single `dependency-cruiser` (or eslint-boundaries) rule in CI, plus code review. **Current violations to fix:** `songs/routes.ts` importing `ingest/organize-existing`, `library/queue`, `tags/writer`, `cover-art/repository` (Q2); `statistics/routes.ts` importing `users/repository`; `auto-dj` importing other features' repositories. Cross-feature data needs go through the owning feature's service — this is the rule whose absence already produced F7/Q3.

---

## 20. Migration Roadmap

Ordered by Impact × Risk × Effort. Each phase ships independently; no phase requires the next.

**Phase 0 — Safety net (Critical, ~1 week)**
- CI workflow running `pnpm test` + `tsc` on push/PR (F11); include tests in `tsconfig` typecheck (T2).
- `SIGTERM`/`SIGINT` handlers → `app.close()` (F12); `/health` endpoint + Docker `HEALTHCHECK`.
- Backup/restore runbook (SQLite file + WAL checkpoint) in `docs/deployment.md`.
- Risk: none. Rollback: revert.

**Phase 1 — Correctness fixes (Critical, 1–2 weeks)** — all small, test-covered:
- Wrap playlist create/update in a transaction (F3); persist-song transaction or compensation (F5-adjacent); `queueResync` through `pushJob` (F6); preserve `average_rating` on rescan (F4); conflicts delete files first (F5); JSON-encode ingest payloads (F8); stream upload reassembly (F10); ffmpeg `error`-event fallback (F13); scrobble 400s + clamps (Q7); typecheck + zod gaps (Q8/Q9).
- Tests: one regression test per fix; run suite in CI.
- Rollback: each fix is an independent revert.

**Phase 2 — Security fixes (High, 1–2 weeks)**:
- Decide + implement F1 (library isolation) — **the only phase-2 item needing a product decision**.
- Authenticate `/api/libraries` (F2); session invalidation on password change (F9); shareToken stripping + unified `canViewPlaylist` (F7); rate-limit `/rest/stream.view` + ffmpeg concurrency cap; clamp `maxBitRate`; login timing equalization + throttle eviction + `trustProxy`; default-secret warning.
- Rollback: per-fix revert.

**Phase 3 — Structural (High, ongoing, strangler-style)**:
- Introduce `lib/http/range.ts`, `lib/http/errors.ts`, `policies/admin.ts`; thin `songs/service.ts` + `playlists/service.ts` first (highest-churn features); split `opensubsonic/routes/browsing.ts` per resource; unify player accounting in `StreamingService`.
- Add dependency-rule lint to CI. Done when no route imports another feature's repository.

**Phase 4 — Performance (Medium)**:
- Missing indexes (F15); FTS5 search + ranking; pagination conventions (cursor for songs/albums, clamps on search3); batch-stat in Subsonic serializers (Q14); statistics consolidation (cache global averages; move heavy aggregates to worker snapshots if profiled); `synchronous=NORMAL`; bound `smartGrantCache` (Q11); prune `listening_history` (configurable retention); `ingest_jobs` pruning.

**Phase 5 — Observability (Medium)**:
- Request IDs + per-feature child loggers; job lifecycle structured logs (`job queued/started/finished/failed` with type+duration+counts); scan progress in `updateJobStats`; fix `/api/scans/status` pending-job visibility.

**Phase 6 — Optional future evaluations (only on triggers)**:
- Postgres migration (triggers in §15); transcode cache; per-device player model; artwork derivative cache on disk; `tracks`/`media_files` split for multi-format libraries.

---

## 21. Implementation Backlog

### Must do
| ID | Title | Evidence | Solution | Risk | Tests |
|---|---|---|---|---|---|
| B1 | CI test workflow | `.github/workflows/` release-only | `ci.yml`: pnpm install, tsc, vitest (server+web) on push/PR | None | — |
| B2 | SIGTERM graceful shutdown | `index.ts` no handlers | signal → `app.close()`; extend worker drain beyond 3s | Low | integration: job completes on close |
| B3 | Transactional playlist writes | `playlists/repository.ts:111-153` | `db.transaction` wrapper | Low | crash-mid-write regression test |
| B4 | Preserve `average_rating` on rescan | `songs/repository.ts:185-234` | exclude column from upsert; recompute on demand | Low | rescan-after-rate test |
| B5 | Conflicts delete files | `conflicts/routes.ts:57-66` | unlink file, then row (mirror songs delete) | Medium (irreversible) | integration test with watcher |
| B6 | Route `queueResync` through coalescing | `songs/routes.ts:296-299` | one-line: `pushJob(db,'resync','')` | Low | batch tag edit → 1 job test |
| B7 | Library isolation decision + enforcement | F1 | product decision; if enforced: `LibraryAccessPolicy` in all content queries + streams | **High** (behavior change) | 401/403 matrices per surface |
| B8 | Authenticate `/api/libraries` | F2 | remove exempt entry or require admin | Medium (web client impact) | auth test |
| B9 | Session invalidation on password change | `admin-routes.ts:359-399` | `deleteSessionsForUser` on hash update | Low | admin reset → old cookie 401 |
| B10 | Unified playlist access policy | F7/Q3 | `policies/playlist-access.ts`; strip shareToken from DTOs | Medium | cross-surface share semantics tests |
| B11 | Upload reassembly streaming | `chunked.ts:44-52` | fd pipeline concat | Low | 1 GiB upload memory test |
| B12 | FFmpeg missing fallback | `retrieval.ts:40-66` | `proc.on('error')` → direct-file path | Low | no-ffmpeg host test |
| B13 | Scrobble validation + 400s | `songs/routes.ts:201-239,553` | zod body; clamp completion/duration | Low | bad-body → 400 tests |
| B14 | `/health` + Docker healthcheck | F12 | route + `HEALTHCHECK` instruction | None | smoke test |

### Should do
- FTS5 search + ranking (replaces leading-wildcard LIKE) · pagination conventions + search3 clamps · ffmpeg concurrency cap + rate limit · missing indexes + `synchronous=NORMAL` · statistics consolidation · login hardening (timing, throttle eviction, trustProxy) · default-secret warning · split `browsing.ts` · songs/playlists service extraction · scan progress reporting + status fix · `getAlbumInfo2` spec fix + `serverVersion` + `p`-auth doc alignment · tests typechecked.

### Could do
- LRU for `smartGrantCache` · session `user_id` column · magic-byte sniffing on image uploads · security headers · per-device players · `inPlaylist` ownership check · `isSmartPlaylistRule` runtime validation (bogus field silently matches `s.title` today) · smart-playlist compiler: match secondary genres via `song_genres` · delete stale scripts (`test-smart-compiler.ts`) · chokidar v4 · eslint/prettier + dependency-rule lint · coverage thresholds.

### Do not do
- Go or any language rewrite · PostgreSQL before triggers fire · Redis · Elasticsearch/Meilisearch/Typesense · Kafka/NATS/event bus (the EventEmitter-shaped hole in `events/` is not a reason) · Kubernetes/helm · microservices (domain count is not a service boundary; single-container self-host is the deployment truth) · GraphQL · CQRS/event-sourcing · generic `utils/` or `*Manager` classes · an ORM query-builder rewrite of repositories (raw SQL here is a feature) · replacing xml-js (verified correct; compat surface only).

---

## 22. "Do Not Overengineer" List

1. **Microservices** — 32 features in one container behind one admin; no organizational or operational boundary exists that a module boundary doesn't already solve.
2. **Redis / external cache** — two in-process Maps serve the actual cache needs; add Redis only for multi-replica, which this deployment model rejects.
3. **Dedicated search engine** — FTS5 covers the realistic corpus (personal libraries ≤ low millions of tracks) with zero new ops.
4. **Message queue (RabbitMQ/Kafka/BullMQ)** — the `scan_jobs` table is already a durable, inspectable queue; adding a broker adds a SPOF and a second thing to back up.
5. **Go rewrite** — the audit found zero problems attributable to Node/Fastify; the problems are layering and missing enforcement, portable to any language, fixable in place. Recorded as DR-1 (§15): Go + SQLite is the *preferred greenfield* choice, but rewriting this codebase is closed unless the DR-1 revisit triggers fire.
6. **PostgreSQL (today)** — correct pragmas, one writer, WAL; the triggers for migration are written down in §15 so the decision is evidence-based later, not fashion-based now.
7. **DDD ceremony** — no aggregates/repositories-per-aggregate/value-object taxonomy; entities and junction tables are already a clean model. Application services + policies solve the actual problem.
8. **Generic plugin system** — one deployment, one binary; feature flags and a plugin API are solutions to problems this product doesn't have.
9. **Transcode caching / CDN** — live transcode is correct at this scale; cap concurrency first, cache only if usage proves it.
10. **Observability stack (Prometheus/OTel/ELK)** — request IDs + structured job logs + `/health` first; metrics only after there's something to alert on.

---

## 23. Top 10 Highest-Value Improvements (grouped, not ranked)

**Critical (correctness/security — do first):**
1. **CI workflow running the existing 834 tests on every push** — the entire safety net currently depends on humans remembering to run it locally.
2. **Decide and enforce (or remove) library-level isolation** — F1 is the only finding that changes what the product *is* for multi-user deployments.
3. **Close the data-integrity holes**: transactional playlist writes, `average_rating` rescan preservation, conflicts file deletion, resync coalescing (B3–B6).
4. **Session lifecycle**: invalidate on password change; SIGTERM drain; setup TOCTOU (B9, B2).

**High priority:**
5. **Unified cross-surface policies**: one playlist-access policy, one admin gate, one range parser, one streaming service with clamped bitrate + concurrency cap + play accounting for all clients (kills F7, F13, Q3–Q5, several Lows at once).
6. **Search and pagination**: FTS5 + ranking; cursor pagination for songs/albums; clamp `search3` counts.
7. **Observability floor**: `/health` + Docker healthcheck, request IDs, structured job lifecycle logs, honest scan status.
8. **Thin application layer in the two highest-churn features** (songs, playlists), with a dependency-rule lint so it can't regress.

**Medium priority:**
9. **Performance pass**: missing indexes, `synchronous=NORMAL`, statistics consolidation, batch-stat in Subsonic serializers, bounded caches, history pruning.
10. **Docs/reality reconciliation**: `docs/api.md` endpoint inventory, `db-schema.md` refresh, `deployment.md` path fix, `agents/` corrections — the docs culture here is good; the drift is recent and cheap to fix.

---

## 24. Questions / Unknowns

1. **Is per-user library assignment an intended security boundary, or is "all users see all libraries" the product model?** (F1's severity hinges on this; admin UI for assignment exists.) Resolve with the product owner.
2. **Production scale**: actual library sizes, user counts, concurrent stream counts, and transcode usage. Needed to trigger (or retire) the Postgres question and prioritize the transcode manager. Server telemetry or user report.
3. **Was the observed dirty working tree (getAlbumInfo2 spec regression, browsing/retrieval edits) intentional?** The audit ran against the working tree; HEAD greenness was unverifiable. Needs `git status`/CI on a clean tree.
4. **Why does the web player not call `recordStream`?** Deliberate (Subsonic-only now-playing) or oversight? Code comment/history silent.
5. **Is `GET /api/libraries`'s public exemption load-bearing for the web client's login/setup flow?** If yes, F2's fix needs a narrower public DTO (names only, no paths).
6. **Settings-table vs env precedence** for `REVIEW_RETENTION_DAYS`/`ARTIST_IMAGE_INTERVAL_MINUTES` (docs say DB; config models env) — unverified whether a settings override exists.
7. **Expected artwork volume**: if cover_arts blobs grow past comfortable SQLite sizes, the disk-derivative-cache option (§22.9) needs revisiting.
8. **Subsonic client compatibility expectations**: is `p`-password auth (documented, unimplemented) needed by any client the user cares about? Determines whether to implement or fix the doc.

---

*End of audit. No production code was modified during this assessment.*
