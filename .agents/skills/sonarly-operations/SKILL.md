---
name: sonarly-operations
description: Operate a Sonarly deployment — the single-container ghcr.io/miquelrosell99/sonarly stack (host port 4533 → app :3000, SQLite DB under ./config/sonarly/data). Use when deploying, upgrading, restarting, health-checking, rolling back, backing up, migrating, monitoring, or troubleshooting a Sonarly server. Covers deployment, health checks, logs, rollback, database migrations, backups, monitoring, incident response, and maintenance.
type: prompt
whenToUse: When deploying or upgrading the Sonarly stack, or when it is unhealthy, needs a backup/restore, a migration check, or operational triage
---

# Sonarly operations

Production stack = one all-in-one container (`compose.yaml`):

- image `ghcr.io/miquelrosell99/sonarly:latest` — host port
  `${SONARLY_PORT:-4533}` → app `:3000`
- volumes: `./config/sonarly/data:/data/db` (SQLite DB + avatars + artist
  images + upload staging), `${SONARLY_INGEST_PATH:-./config/sonarly/ingest}:/data/ingest`,
  `${LIBRARY_MUSIC:-./config/sonarly/library}:/media/music`
- entrypoint adjusts a `sonarly` user to `${PUID:-1000}`/`${PGID:-1000}` and
  `su-exec`s — never root; healthcheck `wget /healthz` (30 s/5 s/3×/15 s)

**`./config/sonarly/data/sonarly.db` (+ its WAL) is the whole database** —
users, sessions, catalog metadata, playlists, job history, API keys. The music
folder itself is backed up by normal file backup; the catalog is rebuildable
by rescan (playlists/ratings are NOT — they live in the DB).

## Non-negotiable laws

1. **One instance per DB file.** SQLite runs `SetMaxOpenConns(1)` (single
   writer); never point two containers at one data dir, and keep the DB on
   local disk (library may live on NFS/SMB, the DB must not).
2. **Never copy raw DB files live** ("database is locked" / torn WAL) — stop
   the container first, or use the online `sqlite3 .backup` recipe
   (`references/backups.md`).
3. **Migrations are forward-only and automatic** (embedded, ledgered, run at
   container start). Rollback = restore the pre-upgrade DB + pin the previous
   image tag — there is no down-migration.
4. **Never rotate `SESSION_SECRET` casually** — it seals
   `users.subscript_password_encrypted` (AES-256-GCM) and signs cookies;
   rotation logs everyone out and breaks every Subsonic client's stored
   password.
5. **The live root `compose.yaml` is gitignored** and tracks `:latest` (no
   `build:` section; redeploys are `pull && up -d`, rollbacks pin an explicit
   older tag); the tracked template is `docker/compose.yaml.example`. Never
   tag a local build with a registry tag — it shadows the registry image until
   the next pull.
6. **Never re-tag; same-day fix = next patch.** Tags are immutable releases.
7. **Fleet-agnostic artifacts** — never hardcode host names, IPs, or tailnet
   names; write `<host>`, `<tailnet>`, `<lan-ip>` or "the fleet host". Real
   values live only in gitignored `.env` / host config.
8. **Deployment and rollback discipline follows the `deployment-runbook`
   skill** — pre-deploy checklist, health checks, rollback triggers,
   postmortem. If it is not installed in this environment, fetch and follow it
   from GitHub:
   <https://github.com/majiayu000/claude-skill-registry/blob/main/skills/data/deployment-runbook/SKILL.md>

## Read by topic

| Topic | Reference | Canonical docs |
|---|---|---|
| Deployment | `references/deployment.md` | `docs/deployment.md`, `docs/configuration.md` |
| Health checks | `references/health-checks.md` | `docs/deployment.md` |
| Logs | `references/logs.md` | `docs/troubleshooting.md` |
| Rollback | `references/rollback.md` | `docs/deployment.md` |
| Database migrations | `references/database-migrations.md` | `docs/db-schema.md` |
| Backups | `references/backups.md` | `docs/deployment.md` |
| Monitoring | `references/monitoring.md` | `docs/troubleshooting.md` |
| Incident response | `references/incident-response.md` | `docs/troubleshooting.md` |
| Maintenance | `references/maintenance.md` | `docs/configuration.md` |

Post-deploy verification: `docker compose ps` shows `(healthy)`, then
`curl -fsS http://127.0.0.1:4533/healthz` and a login round-trip through the
web UI at `http://<host>:4533/`.
