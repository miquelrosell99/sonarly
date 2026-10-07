# Deployment

Canonical: `docs/deployment.md` + `docs/configuration.md` + the tracked
template `docker/compose.yaml.example`.

## Install

```sh
cp .env.example .env                      # set SESSION_SECRET (≥32 chars) + LIBRARY_MUSIC
cp docker/compose.yaml.example compose.yaml
docker compose up -d
```

First boot: the setup wizard at `/setup` exists **only while zero users**
→ create the admin account → the default library is seeded from
`SONARLY_LIBRARY_PATH` → the first scan is auto-enqueued. Give migrations a
minute on first boot of a large DB (healthcheck start_period covers it).

## Upgrade (owner flow, standing authorization)

1. Back up first (`references/backups.md`) — migrations run automatically at
   container start and are forward-only.
2. The gitignored root `compose.yaml` tracks `ghcr.io/miquelrosell99/sonarly:latest`,
   so pulling is enough — no tag edit.
3. `docker compose -f compose.yaml pull && docker compose -f compose.yaml up -d`
4. Confirm healthy (`references/health-checks.md`) + `docker logs sonarly`
   shows migrations applied (ledger `schema_migrations`).

## Compose shape (live, gitignored)

- `${SONARLY_PORT:-4533}:3000`, `${SONARLY_INGEST_PATH:-./config/sonarly/ingest}`,
  `${LIBRARY_MUSIC:-./config/sonarly/library}`; `PUID`/`PGID` default 1000
  (fleet host uses its own values in `.env`).
- **No `build:` section** in the live file — `compose --build` is a no-op
  there; the example template does have one for source builds.
- `restart: unless-stopped`.

## Key env vars (server defaults from `internal/config`)

| Var | Default | Notes |
|---|---|---|
| `SESSION_SECRET` | — | **required, ≥32 chars**, else boot fails |
| `SONARLY_LIBRARY_PATH` | — | required; seeds the default library |
| `SONARLY_ADDR` | `:8080` binary / `:3000` image | |
| `SONARLY_DB_PATH` | `/data/db/sonarly.db` | |
| `SONARLY_DATA_DIR` | `/data/db` | |
| `SONARLY_INGEST_PATH` | empty = drop folder disabled | |
| `SONARLY_WEB_DIST` | `/app/web-dist` | missing dir = API-only mode |
| `SESSION_COOKIE_SECURE` | false | set true behind HTTPS |
| `SONARLY_WATCH_POLL_INTERVAL` | 5 s | 0 disables the watcher |
| `SONARLY_SCAN_INTERVAL_MINUTES` | 60 | |
| `SONARLY_INGEST_INTERVAL_MINUTES` | 60 | |
| `SONARLY_ARTIST_IMAGE_INTERVAL_MINUTES` | 1440 | rate-limited external provider |
| `SONARLY_REVIEW_CLEANUP_INTERVAL_MINUTES` | 1440 | |
| `SONARLY_REVIEW_RETENTION_DAYS` | 30 | clamped 1–365 |
| `SONARLY_TRANSCODE_CONCURRENCY` | 2 | |
| `SONARLY_FFMPEG_PATH` | ffmpeg | |

Compose-level: `SONARLY_PORT`, `PUID`/`PGID`, `LIBRARY_MUSIC`, build-arg
`SONARLY_VERSION` (becomes the OpenSubsonic `serverVersion`). Dev-only:
`SONARLY_DEV_ALLOWED_HOSTS`.

## Image tags

A pushed `v*` tag publishes `:vX.Y.Z`, `:X.Y.Z`, `:X.Y`, `:latest` to
`ghcr.io/miquelrosell99/sonarly`. The live stack pins a full semver tag —
never `:latest`. Never re-tag; next patch instead.
