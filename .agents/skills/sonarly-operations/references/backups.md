# Backups

Canonical: `docs/deployment.md`. No built-in export/backup command exists —
backups are file-level, into the repo's `./backups/` dir (gitignored; the
live DB is 700 MB+ class, never commit it).

## What matters

- **`./config/sonarly/data/sonarly.db` (+ `-wal`/`-shm`)** — users, sessions,
  catalog metadata, playlists, ratings, job history, API keys. The irreplaceable
  state.
- `./config/sonarly/data/` also holds avatars + artist images + upload
  staging — copy the whole dir.
- The music library is backed up by normal file backup; the catalog itself is
  rebuildable by a full rescan, but **playlists, ratings, and users are not**.

## Offline copy (documented path; server stopped)

```sh
docker compose stop sonarly
cp -a ./config/sonarly/data "./backups/data-$(date +%F)"
docker compose start sonarly
```

## Online copy (no downtime; checkpoints the WAL)

```sh
sqlite3 ./config/sonarly/data/sonarly.db ".backup './backups/sonarly-$(date +%F).db'"
```

The `.backup` API is the only live-copy that is safe. **Never `cp` the raw
DB files while the server runs** — WAL semantics make the copy torn or
"database is locked".

## Restore

Server down → copy the backup dir/file back into
`./config/sonarly/data/` → `docker compose up -d` → verify
(`references/health-checks.md` + `references/rollback.md`). Restoring a
pre-upgrade backup is the only way to undo a forward migration.

## Hygiene

- `./backups/` is gitignored (`.gitignore`) — a stray `git add -A` must never
  commit a 700 MB binary.
- Prune old backups deliberately; the DB grows with the catalog.
