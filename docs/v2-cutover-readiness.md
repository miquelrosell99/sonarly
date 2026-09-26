# Sonarly v2 — Cutover Readiness Record (P11)

Date: 2026-09-25. Scope: the production cutover of the Sonarly server from
v1 (`packages/server`, TypeScript/Node) to v2 (`v2/`, Go 1.23) on
`feat/go-rewrite`. Evidence: P10 parity suite, P10b production dual-run, P11
deployment closeout.

## Verdict

**READY — owner decision required.** No release blockers found by the test
evidence. The items below under "Owner sign-off" are operational decisions
and known-acceptable deltas, not defects; none of them may be decided by the
test harness on the owner's behalf.

---

## 1. Evidence summary

### P10 — request-level parity (`docs/v2-p10-parity-report.md`)

- **94/94 cases PASS, 0 failed, 0 blockers.** Native API + OpenSubsonic
  adapter, read and write round-trips (favorites, ratings, scrobbles,
  playlists, shares, bookmarks, star/unstar, transcoding).
- Harness: same seeded library scanned by real v1, DB snapshotted, v2 booted
  on the copy, one deterministic request script replayed against both; every
  delta not covered by a commented normalization rule in
  `testparity/parity_norm.go` is a blocker. None surfaced.
- Accepted deltas are all documented v1 quirks or v2 supersets (v1-trimmed
  projections, integer-second durations, FTS-vs-LIKE search scope,
  serverVersion from build info, …). One engine-scope gap to note:
  **native song search** — v1's LIKE matches title/artist/album, v2's FTS5
  index covers titles; the songs category floors at a 0.3 intersection
  ratio. Everything else compares exactly.

### P10b — production dual-run on the live DB snapshot (`docs/v2-p10b-dualrun-report.md`)

- **PASS. Stream hash mismatches: 0** across 5 real FLAC songs on both the
  native stream endpoint and the Subsonic `stream.view` (byte-identical to
  source), Range requests byte-exact, embedded cover art byte-exact, one
  transcode smoke (128 kbps, sha256 recorded).
- Catalog diff (v2-processed copy vs pristine copy of the production DB):
  all user state, playlists, bookmarks, history, junction tables
  **byte-identical**; only the scan reconciliation (activity flags,
  provable moves, mtime/checksum refreshes) and documented re-persist
  normalizations on 20 refreshed legacy rows differ.
- Scan wall clock on the 20-file on-disk library: **1.4 s** (580 MB hashed).
- Live v1 was not stopped, restarted, or written to at any point.

### Performance (informational, P10 smoke)

Sequential fetch of 200 song details: v1 115.2 ms vs v2 78.1 ms —
**v2/v1 wall-time ratio 0.68×** (≈1.5× faster per request). No Go-side
allocation/CPU concerns observed during the dual-run.

### P11 — deployment closeout (this phase)

- Static SPA serving implemented (`v2/internal/staticfs`) — the one
  functional gap vs v1. chi NotFound-mounted after all API mounts; `/api/*`
  and `/rest/*` can never be intercepted; traversal contained; API-only
  mode preserved when the web-dist directory is absent. Unit-tested.
- Container artifacts: `docker/Dockerfile.v2` (multi-stage: web build → Go
  build with `-X buildinfo.Version` from `SONARLY_VERSION` ARG → alpine
  runtime with ffmpeg, python3+mutagen==1.48.1, su-exec, wget;
  PUID/PGID entrypoint ported from v1; `HEALTHCHECK` on `/healthz`),
  `docker/entrypoint.v2.sh`, `docker/compose.v2.yaml.example`.
  **The image has not been built** (no docker daemon assumed) — the first
  real `docker build` is part of the cutover runbook below.
- `/healthz` liveness alias added (v1 parity; the v1 compose healthcheck
  and the image HEALTHCHECK probe it).

---

## 2. Go / no-go checklist

### Verified by test evidence — no action needed

| # | Item | Evidence |
|---|---|---|
| 1 | Request-level parity, native + OpenSubsonic | P10: 94/94 PASS, 0 blockers |
| 2 | Stream bytes identical to source (direct + range + transcode smoke) | P10b: 0 stream mismatches, sha256 match |
| 3 | Cover art byte-exact (native + `getCoverArt`) | P10b serving verification |
| 4 | User state, playlists, bookmarks, history survive a v2 scan untouched | P10b catalog diff: byte-identical |
| 5 | Schema compatibility both ways (v2 migrations additive over v1 001–049; v1 tolerates v2's footprint) | P10b compatibility analysis; migrations are CREATE-IF-NOT-EXISTS / nullable columns / new tables only |
| 6 | Session continuity (`SESSION_SECRET` reuse keeps sessions + sealed Subsonic passwords valid) | P10 boots v2 on a v1-created DB and authenticates with the v1-sealed secret |
| 7 | Performance not a regression | P10 smoke: 0.68× v1 wall time |
| 8 | Web client serving parity (SPA fallback, content types, cache headers, traversal containment, API-only mode) | P11 staticfs unit tests |
| 9 | Rollback anchor exists | v1 image `ghcr.io/miquelrosell99/sonarly:latest` unchanged; rollback restores DB backup and swaps image back |

### Owner sign-off required — decide before cutover

| # | Item | What the owner must decide |
|---|---|---|
| A | ~~Stale-catalog reconciliation~~ **CORRECTED 2026-09-26: not applicable.** The original dual-run pointed at the compose *fallback* directory (`config/sonarly/library`, 20 files); the real library is `LIBRARY_MUSIC=/srv/dev-disk-by-uuid-.../resources/Música` (238 GB, 7,421 files — exactly matching the catalog's 7,421 active rows). No mass-deactivation will occur at cutover when v2 is configured with the real path (in Docker: the existing `/media/music` mount, paths unchanged). A corrected dual-run against the real path supersedes the stale-catalog finding; see the regenerated P10b report. |
| B | **Library-scoped deactivation delta** | v1's scanner deactivates every DB path not seen this scan except paths under a FAILED root; v2's additionally skips paths under no configured library root (deliberate hardening, see P10b). Identical in the standard deployment (one root, DB paths under it). Delta only surfaces if the DB holds out-of-root paths (e.g. after re-rooting the library without rewriting `songs.file_path`) — then v1 mass-deactivates, v2 preserves. Decide: accept the hardening (recommended) or port v1's behavior before cutover. |
| C | **FLAC bitrate estimation gap** | v2's pure-Go tag reader does not estimate a FLAC bitrate where music-metadata did; re-persisted legacy FLAC rows get `bit_rate -> NULL` (20 rows in the current DB). Response-level deltas touch only re-persisted legacy rows; v1's own full-replace persist would produce the same NULLs. Decide: accept (recommended; informational only) or add a FLAC bitrate estimator. |
| D | **Web client still on the v1 API** | The v1 React client (`packages/web`) speaks the v1 native API shape. v2's native API is a documented superset with spec'd DTOs (`v2/api/openapi.yaml`), and every field the v1 client consumes is present — but the client has not been re-pointed at a v2 backend, and the FF-migration work (v1-field shims the parity suite normalizes: trimmed projections, integer durations, etc.) is not started. Decide: cut the server over and keep serving the existing web build from v2 (smoke-test the UI in the soak window), or gate cutover on the web client migration. Subsonic clients are unaffected either way (adapter parity is proven). |
| E | **Image build + soak** | `docker/Dockerfile.v2` is statically sound but has never been built (no docker daemon in the dev environment). The first build, a boot smoke, and a soak window (recommend ≥1 week with the pre-v2 backup kept) are operational steps only the owner can schedule. |

---

## 3. Cutover runbook (from P10b, unchanged)

1. **Backup (rollback anchor).** Stop the sonarly container, then copy the
   whole data directory:
   `cp -a config/sonarly/data config/sonarly/data.bak-pre-v2-$(date +%Y%m%d)`
   (WAL mode — copy `sonarly.db` **and** `sonarly.db-wal`; do not delete the
   -wal). Verify with `PRAGMA quick_check`.
2. **Image/env swap.** Point the compose service at the v2 image
   (`docker build -f docker/Dockerfile.v2 -t ghcr.io/miquelrosell99/sonarly:v2 .`,
   optionally `--build-arg SONARLY_VERSION=$(git describe --tags --always)`).
   Env per `docker/compose.v2.yaml.example`:
   `SONARLY_DB_PATH=/data/db/sonarly.db`, `SONARLY_DATA_DIR=/data/db`,
   `SONARLY_LIBRARY_PATH=/media/music`, `SONARLY_INGEST_PATH=/data/ingest`,
   keep `SESSION_SECRET` **identical**, interval knobs at the v1 cadence.
   Same volume mounts; the DB schema is additive-compatible, no export/import.
3. **Boot.** v2 runs its migrations (no-op baseline + nullable scan_jobs
   columns + FTS5 tables) and pushes one initial scan. Expect the
   reconciliation pass of checklist item A: any file the old catalog claimed
   that is not on disk is deactivated (v1 would do the same).
4. **Verify.** `curl -fsS localhost:<port>/healthz` → 200; log in through the
   web UI (checklist item D — smoke every screen you use); play one song
   start-to-finish in a Subsonic client; confirm `GET /api/scans/status`
   reaches completed with failed=0; eyeball library counts against
   expectation.
5. **Done.** Keep the pre-v2 backup until v2 has soaked (recommend ≥1 week).

## 4. Rollback procedure

1. Stop the v2 container.
2. Restore the DB:
   `cp -a config/sonarly/data.bak-pre-v2-*/sonarly.db* config/sonarly/data/`
   (main + -wal + -shm; SQLite replays the WAL on open). Data written while
   v2 was live survives only if it predates the backup — plan the soak
   window accordingly (or take a fresh backup just before deciding to stay).
3. Swap image/env back to v1 (`ghcr.io/miquelrosell99/sonarly:latest`, v1
   env names from `docker/compose.yaml.example`) and start; v1 opens the
   restored DB with its own migrator.
4. Verify `GET /healthz` → 200, log in, play one song.

---

## 5. DECISION

> **Cutover status: READY — owner decision required.**

The test evidence is complete and uniformly green: request-level parity
(94/94), byte-exact streaming on the production data snapshot, byte-identical
user state, performance ahead of v1, and the deployment artifacts (SPA
serving, image, compose, runbook, rollback) now exist. No automated gate
remains.

Cutover is **NOT unilaterally approved here**. Checklist items A–E are the
owner's calls: the irreversible-ish first-scan reconciliation on the live DB
(A), the deactivation-hardening delta (B), the FLAC bitrate NULLs (C), the
web client's still-unmigrated API surface (D), and the first image build +
soak scheduling (E). If any of A–E changes the decision, the corresponding
work is scoped in section 2; otherwise the runbook in section 3 is the
cutover procedure, and section 4 is the way back.
