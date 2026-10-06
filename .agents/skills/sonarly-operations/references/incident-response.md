# Incident response

Canonical: `docs/troubleshooting.md` (the failure-mode catalog). Triage
discipline per the `deployment-runbook` skill; these are the Sonarly-specific
modes and fixes.

## First moves

1. `docker compose ps` — up/(healthy)? restarting loop?
2. `docker logs --tail=200 sonarly` — boot config errors are fail-fast and
   print plainly.
3. What changed — last image tag, last `.env` edit, disk pressure on
   `./config/sonarly`, library mount dropped?

## Failure modes → fixes

- **Container unhealthy / restart-looping** — invalid config:
  `SESSION_SECRET` missing/`<32` chars, `SONARLY_LIBRARY_PATH` unset → fix
  `.env`, `docker compose up -d` (recreate). Or: migrations still running on
  first boot of a big DB — watch the logs, don't restart-loop it.
- **Empty library** — files outside `SONARLY_LIBRARY_PATH` (the ingest folder
  is NOT scanned); trigger `POST /api/scans` or Admin → System tasks; network
  share → raise `SONARLY_WATCH_POLL_INTERVAL` to 30–60 s; verify the mount
  with `docker exec sonarly ls /media/music | head`.
- **Subsonic clients fail** — URL must end `/rest`; token+salt auth only (no
  `p=` mode — disable "legacy password" in the client); `SESSION_SECRET`
  rotation breaks stored passwords → re-enter the password in the client; a
  user with no library assigned sees an empty server.
- **"database is locked"** — a second accessor (second container on the data
  dir, a live raw `cp`, an editor) — one instance per DB, and use
  `sqlite3 .backup` for copies.
- **Missing artwork** — embed art or add `cover.jpg`/`folder.jpg`, then
  rescan.
- **Files parked in `review/`** — failed validation (bad extension,
  unparseable, missing title+artist+album); auto-deleted after retention
  (default 30 d). Fix tags and re-drop, or tune `SONARLY_REVIEW_RETENTION_DAYS`.
- **Duplicates on import** — five strategies; default `keep_file_replace_metadata`
  (see `docs/troubleshooting.md` for the table).
- **Slow** — first scan is one-time cost; DB must be on local disk (never a
  network share); transcode concurrency default 2 (`SONARLY_TRANSCODE_CONCURRENCY`).

## Hard don'ts

- Don't rotate `SESSION_SECRET` as a "fix" — it seals Subsonic passwords and
  cookies; everyone re-logs and every Subsonic client needs its password
  re-entered.
- Don't copy raw DB files live; don't run two instances on one DB.
- Don't `docker compose --build` against the live compose file (it has no
  `build:` section by design) and don't tag local builds with registry tags.
