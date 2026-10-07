# Maintenance

Canonical: `docs/configuration.md` + `docs/deployment.md`.

## Background intervals (defaults; all env-tunable)

| Task | Env | Default |
|---|---|---|
| Polling watcher | `SONARLY_WATCH_POLL_INTERVAL` | 5 s (0 disables) |
| Full scan | `SONARLY_SCAN_INTERVAL_MINUTES` | 60 |
| Ingest sweep | `SONARLY_INGEST_INTERVAL_MINUTES` | 60 |
| Artist-image sync | `SONARLY_ARTIST_IMAGE_INTERVAL_MINUTES` | 1440 (rate-limited provider; also on-demand from System tasks) |
| Review cleanup | `SONARLY_REVIEW_CLEANUP_INTERVAL_MINUTES` | 1440 |
| Review retention | `SONARLY_REVIEW_RETENTION_DAYS` | 30 (clamped 1–365) |

Plus: sessions have a **7-day absolute lifetime** (no rolling renewal;
invalidated on role/password change) and API keys are SHA-256-hashed in
`api_keys` — key management routes are still half-built, so rotation = DB
surgery or user re-creation (see `sonarly-user-management` skill).

## Routine

- **Upgrades:** see `references/deployment.md` — backup →
  `pull && up -d` (the live compose tracks `:latest`) → healthy + smoke.
- **DB on local disk, always**; library may live on NFS/SMB (the polling
  watcher exists because inotify doesn't cross network shares).
- **Disk:** `sonarly.db` (+ WAL) grows with the catalog; checkpoints happen on
  `.backup`/clean shutdown — a huge `-wal` after a crash is normal and is
  folded back on next open. Prune `./backups/` deliberately.
- **Ingest folder:** keep it clear of junk; review/ parked files are
  auto-deleted per retention.
- **`.env` drift:** after pulls, re-check against `.env.example`
  (new tunables appear; defaults stay conservative).

## Health of the law

Any change to how the stack is deployed, backed up, migrated, or monitored
updates the matching `docs/` page and this skill's references in the same
pass — docs and skills are part of the change.
