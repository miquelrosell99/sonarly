# Rollback

Canonical: `docs/deployment.md`. Discipline per the `deployment-runbook`
skill (rollback triggers, verification, postmortem); these are the
Sonarly-specific mechanics.

## Why rollback is a restore, not a switch

Migrations are **forward-only**, embedded, and run automatically at container
start (ledger `schema_migrations`). There is no down-migration — so rolling
the image back across a migration requires rolling the **database** back too.

## The rollback sequence

1. `docker compose down`
2. Restore the pre-upgrade DB into `./config/sonarly/data` (from
   `./backups/`; server must be down — see `references/backups.md`).
3. Pin the previous image tag in the gitignored `compose.yaml`
   (`image: ghcr.io/miquelrosell99/sonarly:PREVIOUS`).
4. `docker compose up -d` → verify (`references/health-checks.md`).

Rollback that does **not** cross a migration (pure code regression, same DB
schema) skips step 2 — just pin the previous tag and `up -d`.

## Hard rules

- **Never re-tag** — a bad release is fixed by the next patch version (SemVer
  in `CHANGELOG.md`); tags are immutable.
- **Never tag a local build with a registry tag** (`docker build -t
  ghcr.io/miquelrosell99/sonarly:X.Y.Z .`) — it shadows the registry image on
  the host until the next pull, and the rollback pin then means a different
  image than upstream.
- Rotating `SESSION_SECRET` is **not** a rollback tool — it seals Subsonic
  client passwords (AES-256-GCM) and session cookies; rotation breaks both.
- If the DB was migrated forward and no backup exists, the exit is a new
  forward fix, not a rollback.
