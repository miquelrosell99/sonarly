# Deployment

Canonical: `docs/deployment.md` + `docs/configuration.md` + the tracked
template `docker/compose.yaml.example`.

## Upgrade (owner flow, standing authorization)

1. Back up first (`references/backups.md`) — migrations run automatically at
   container start and are forward-only.
2. The live stack tracks `ghcr.io/miquelrosell99/sonarly:latest`, so pulling
   is enough — no tag edit.
3. Redeploy from the live stack location (below), then confirm healthy
   (`references/health-checks.md`) + `docker logs sonarly` shows migrations
   applied (ledger `schema_migrations`).

### Fleet host (source/stack split

The app source lives in the git repo; the RUNNING stack is the thin
Komodo-managed deployment at `/etc/periphery/stacks/sonarly/` (compose copy +
gitignored `.env` + `config/` + `backups/`). Komodo owns the container
(stack `sonarly`, run_directory = that folder): update = commit + push +
`v*` tag in the source tree, let CI publish, then **Komodo Redeploy**, which
pulls `:latest`. Do NOT run raw `docker compose` while Komodo is reachable —
Komodo would fight the out-of-band change on its next reconcile.

**Komodo unreachable:** run compose from the live stack folder so its
`.env` and `config/` bind paths resolve — NEVER from the repo checkout
(incident-pattern documented in the notees repo 2026-10-20: a dev `up` from
the checkout targets the wrong project/data or collides on the pinned port):

```sh
cd /etc/periphery/stacks/sonarly
docker compose pull && docker compose up -d
```

### Fresh host (no live stack)

`cp docker/compose.yaml.example compose.yaml` + `.env` (set
`SESSION_SECRET` ≥32 chars + `LIBRARY_MUSIC`) in the deploy folder, then
`docker compose up -d`. First boot: the setup wizard at `/setup` exists
**only while zero users** → create the admin account → the default library
is seeded from `SONARLY_LIBRARY_PATH` → the first scan is auto-enqueued.
Give migrations a minute on first boot of a large DB (healthcheck
start_period covers it).

## Compose shape (live stack)

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
`ghcr.io/miquelrosell99/sonarly`. The live stack tracks `:latest` for
upgrades; rollbacks pin an explicit older semver tag. Never re-tag; next
patch instead.
