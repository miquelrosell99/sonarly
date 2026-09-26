# Deploying Sonarly

Sonarly is distributed and run as a single Docker image. The image contains the Go server and the built React web UI. This document covers Docker deployment for production.

## Requirements

- Docker Engine 20.10+
- Docker Compose v2+
- A Linux/macOS/Windows host with a filesystem that can bind-mount directories

## Production deployment

The production image is built from `docker/Dockerfile.v2` and orchestrated with `compose.yaml` (copied from `docker/compose.v2.yaml.example`).

### 1. Configure environment variables

Copy the example environment file and set a strong `SESSION_SECRET`:

```bash
cp .env.example .env
```

Edit `.env` and set `SESSION_SECRET` to a random string of at least 32 characters:

```bash
SESSION_SECRET=$(openssl rand -hex 32)
```

### 2. Start the container

```bash
docker compose -f compose.yaml up -d
```

The web interface is available at `http://localhost:4533` (or the host port you configured with `SONARLY_PORT`).

On first visit the server will redirect to `/setup` to create the admin account.

---

## Environment variables

Create a `.env` file next to the compose file.

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_SECRET` | *(required)* | Secret used to seal the Subsonic password column and sign session cookies. Must be at least 32 characters. The server refuses to start without it. Changing it logs everyone out and breaks existing Subsonic client passwords. |
| `SESSION_COOKIE_SECURE` | `false` | Set to `true` only when serving Sonarly behind HTTPS. Defaults to `false` so cookies work over plain HTTP in self-hosted setups. |
| `PUID` | `1000` | User ID the container process runs as. Match this to the owner of your bind mounts. |
| `PGID` | `1000` | Group ID the container process runs as. Match this to the group of your bind mounts. |
| `SONARLY_PORT` | `4533` | Host port mapped to the container's internal port `3000`. |
| `LIBRARY_MUSIC` | *(see `.env.example`)* | Host path to the main music library, bind-mounted to `/media/music` in the container. |
| `SONARLY_INGEST_PATH` | `./config/sonarly/ingest` | Host path for the ingest/review folder, bind-mounted to `/data/ingest`. |

Internal variables set by the compose file (usually not changed):

| Variable | Default | Description |
|----------|---------|-------------|
| `SONARLY_ADDR` | `:3000` | Listen address. |
| `SONARLY_DB_PATH` | `/data/db/sonarly.db` | SQLite database file. |
| `SONARLY_DATA_DIR` | `/data/db` | Server-owned state (SQLite DB, avatars, artist images, upload staging). |
| `SONARLY_LIBRARY_PATH` | `/media/music` | Root of the music library (required; the server refuses to start without it). |
| `SONARLY_INGEST_PATH` | `/data/ingest` | Drop folder for ingest. |
| `SONARLY_WEB_DIST` | `/app/web-dist` | Built web client served by the binary; a missing directory puts the server in API-only mode. |
| `SONARLY_SCAN_INTERVAL_MINUTES` | `60` | Interval between automatic library rescans (`0` disables). |
| `SONARLY_WATCH_POLL_INTERVAL` | `5` | Filesystem poll cadence in seconds for library change detection. |
| `SONARLY_ARTIST_IMAGE_INTERVAL_MINUTES` | `1440` | Interval for artist image/metadata sync (`0` disables). |
| `SONARLY_INGEST_INTERVAL_MINUTES` | `60` | Interval between ingest folder sweeps (`0` disables). |
| `SONARLY_REVIEW_CLEANUP_INTERVAL_MINUTES` | `1440` | Interval for review-folder retention sweeps. |
| `SONARLY_REVIEW_RETENTION_DAYS` | `30` | Default retention for files in the ingest review folder (overridable per-deployment from the settings UI). |
| `SONARLY_TRANSCODE_CONCURRENCY` | `2` | Max concurrent ffmpeg transcodes. |
| `SONARLY_FFMPEG_PATH` | `ffmpeg` | ffmpeg binary; resolved via PATH unless overridden. |

---

## Volumes

The compose file mounts three bind volumes:

| Host path | Container path | Purpose |
|-----------|----------------|---------|
| `./config/sonarly/data` | `/data/db` | SQLite database and server-owned state (avatars, artist images, upload staging) |
| `${SONARLY_INGEST_PATH:-./config/sonarly/ingest}` | `/data/ingest` | Drop folder for ingest |
| `${LIBRARY_MUSIC:-./config/sonarly/library}` | `/media/music` | The music library. Read-only is sufficient for scanning/streaming; tag editing and organize need write access. |

Make sure the host data directories exist and are writable by the container user:

```bash
mkdir -p ./config/sonarly/data ./config/sonarly/ingest
```

Each library gets its own ingest subfolder inside the ingest path, named by the library ID (for example, `/data/ingest/<library-id>/`). Files dropped into a library's subfolder are imported into that library.

---

## Permissions

The container runs as a non-root user. The entrypoint creates a `sonarly` user at runtime and adjusts its UID/GID to match `PUID`/`PGID`, then drops privileges with `su-exec`.

Set ownership on the bind mounts to match:

```bash
chown -R 1000:1000 ./config/sonarly
```

If you use a different `PUID`/`PGID`, match those values instead:

```bash
PUID=1001 PGID=1001 docker compose up -d
chown -R 1001:1001 ./config/sonarly
```

---

## Health check

The image declares a container `HEALTHCHECK` against `GET /healthz` (also available: `/health`, `/ready`). Orchestrators and monitoring can use the same endpoints:

```bash
curl -f http://localhost:4533/healthz
```

---

## Updating Sonarly

The database lives in the bind-mounted `./config/sonarly/data` directory. Back up that directory before updating.

### Pre-built image (default)

The compose file runs the `ghcr.io/miquelrosell99/sonarly` image, published by CI on every version tag. To update to the latest release:

```bash
docker compose -f compose.yaml pull
docker compose -f compose.yaml up -d
```

Database migrations run automatically on startup from the embedded SQL files (ledger-tracked, idempotent) — no manual migration step.

### Building from source

```bash
docker build -f docker/Dockerfile.v2 \
  --build-arg SONARLY_VERSION=$(git describe --tags --always) \
  -t ghcr.io/miquelrosell99/sonarly:v2.0.0-rc1 .
docker compose -f compose.yaml up -d
```

Note: tagging your local build as an existing registry tag shadows the registry image until the next `docker compose pull`.

### Rollback

Migrations are forward-only. To roll back to a previous release:

1. Stop the container: `docker compose -f compose.yaml down`.
2. Restore the database backup taken before the update into `./config/sonarly/data` (the SQLite file must match the older binary's schema).
3. Pull or build the previous image tag and `docker compose -f compose.yaml up -d`.

The v1→v2 cutover runbook (including the pre-cutover backup) is preserved in [v2-cutover-readiness.md](v2-cutover-readiness.md).

---

## Troubleshooting

### Container exits with "SESSION_SECRET must be set and at least 32 characters"

`SESSION_SECRET` is missing or shorter than 32 characters. Generate one with:

```bash
openssl rand -hex 32
```

### Container exits with "SONARLY_LIBRARY_PATH must be set"

The library path is not configured. Set `LIBRARY_MUSIC` in `.env` (mounted at `/media/music`).

### Permission denied on bind mounts

Ensure the host directories are owned by the UID/GID configured via `PUID`/`PGID` (default `1000:1000`).

### Transcoding fails

The runtime image installs `ffmpeg`; if you override the runtime image or run the binary directly, install ffmpeg and ensure it is on `PATH` (or set `SONARLY_FFMPEG_PATH`).

### Tag editing fails

Tag writing shells out to `python3` with `mutagen` installed (both are in the runtime image). Missing tooling answers 500 "Failed to write tags"; scanning and streaming are unaffected.
