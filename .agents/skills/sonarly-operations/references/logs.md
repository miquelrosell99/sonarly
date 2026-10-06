# Logs

- Server logs are **`log/slog` JSON to stdout only** — no file logs, no
  log-level env var, no structured log dir. Tail with
  `docker logs -f sonarly` (or `docker compose logs -f`).
- chi middleware: RequestID, RealIP, Recoverer, Compress(5). API requests have
  a 60 s timeout; exempt: `/api/stream/*` and the SSE feed.
- Browser crashes POST anonymously to `/api/client-errors` and surface in the
  server log as `client error report` — useful for "the UI broke for a user"
  reports.

## What to grep when

- Boot/config failures (the most common incident): look at the first lines —
  fail-fast config errors print plainly (e.g. `SESSION_SECRET must be set and
  at least 32 characters`).
- Migration progress at upgrade: migration filenames + timing appear around
  startup; a hang here means the DB is on a network share or locked.
- Scan/ingest health: job lifecycle lines from the worker; correlate with
  `scan_jobs` via the sqlite query in `references/monitoring.md`.
- No access/error log separation exists — everything is one stdout stream.

Adding a log-level knob or file output is a code change (server/),
not configuration — record it in `docs/configuration.md` + this skill if it
ever ships.
