# Deploying Sonarly

Sonarly is distributed and run as a single Docker image. The image contains the Fastify backend and the built React web UI. This document covers Docker-only deployment for production and development.

## Requirements

- Docker Engine 20.10+
- Docker Compose v2+
- A Linux/macOS/Windows host with a filesystem that can bind-mount directories

## Production deployment

The production image is built from `docker/Dockerfile.server` and orchestrated with `compose.yaml`.

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
docker compose -f compose.yaml up -d --build
```

The web interface is available at `http://localhost:4533` (or the host port you configured with `SONARLY_PORT`).

On first visit the server will redirect to `/setup` to create the admin account.

---

## Development deployment

For active development use `compose.dev.yaml`. It bind-mounts the package source directories and runs the backend with `tsx watch` and the frontend with the Vite dev server.

```bash
cp .env.example .env
# edit .env and set SESSION_SECRET
docker compose -f compose.dev.yaml up -d --build
```

Exposed ports:

| Host port | Default | Maps to | Purpose |
|-----------|---------|---------|---------|
| `SONARLY_DEV_WEB_PORT` | `4534` | `5173` | Vite dev server (React UI) |
| `SONARLY_DEV_API_PORT` | `3001` | `3000` | Fastify backend directly |

The Vite dev server proxies `/api` and `/rest` to the backend, so for normal use you only need port `4534`.

### Hot reload behavior

| Change | Action needed |
|--------|---------------|
| TypeScript/React source in `packages/*/src/` | Nothing (HMR / `tsx watch`) |
| `.env` variables | `docker compose -f compose.dev.yaml up -d` (recreate container) |
| `package.json`, `vite.config.ts`, `tsconfig.json`, new dependencies | `docker compose -f compose.dev.yaml up -d --build` |
| `docker/Dockerfile.dev`, `docker/entrypoint.sh` | `docker compose -f compose.dev.yaml up -d --build` |
| Database reset | `docker compose -f compose.dev.yaml down`, then delete `./config/sonarly/data/sonarly.db` |

---

## Environment variables

Create a `.env` file next to the compose file.

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_SECRET` | *(required)* | Secret used to sign session cookies. Must be at least 32 characters. The container refuses to start without it. |
| `SESSION_COOKIE_SECURE` | `false` | Set to `true` only when serving Sonarly behind HTTPS. Defaults to `false` so cookies work over plain HTTP in self-hosted setups. |
| `WATCHER_USE_POLLING` | `false` | Set to `true` when library/ingest volumes are on filesystems without inotify support (Docker Desktop, NFS, some network shares). |
| `PUID` | `1000` | User ID the container process runs as. Match this to the owner of your bind mounts. |
| `PGID` | `1000` | Group ID the container process runs as. Match this to the group of your bind mounts. |
| `SONARLY_PORT` | `4533` | Host port mapped to the production container's internal port `3000`. |
| `SONARLY_DEV_WEB_PORT` | `4534` | Host port for the Vite dev server in development. |
| `SONARLY_DEV_API_PORT` | `3001` | Host port for direct backend access in development. |
| `SONARLY_DEV_ALLOWED_HOSTS` | *(empty)* | Comma-separated list of hosts the Vite dev server is allowed to respond to. Use `true` to allow all hosts (not recommended outside trusted networks). |

Internal variables set by the compose files (usually not changed):

| Variable | Production | Development | Description |
|----------|------------|-------------|-------------|
| `PORT` | `3000` | `3000` | Internal port the backend listens on. |
| `NODE_ENV` | `production` | `development` | Runtime mode. |
| `DATA_DIR` | `/data/db` | `/data/db` | Directory containing the SQLite database. |
| `LIBRARY_PATH` | `/data/library` | `/data/library` | Organized music library. |
| `INGEST_PATH` | `/data/ingest` | `/data/ingest` | Drop music files here for import. |
| `SCAN_INTERVAL_MINUTES` | `60` | `60` | Interval between automatic library rescans. |

Optional settings stored in the database (can be changed in the web UI):

- `REVIEW_RETENTION_DAYS` — days to keep files in the ingest review folder (default `30`).
- `ARTIST_IMAGE_INTERVAL_MINUTES` — minutes between artist image sync jobs (default `1440`; set `0` to disable).

---

## Volumes

The compose files mount three bind volumes:

### Production (`compose.yaml`)

| Host path | Container path | Purpose |
|-----------|----------------|---------|
| `./config/sonarly/data` | `/data/db` | SQLite database and runtime data |
| `./config/sonarly/library` | `/data/library` | Organized music library |
| `./config/sonarly/ingest` | `/data/ingest` | Files dropped for import |

### Development (`compose.dev.yaml`)

Same data volumes as production, plus bind mounts for the source code and anonymous volumes for `node_modules`:

| Host path | Container path | Purpose |
|-----------|----------------|---------|
| `./config/sonarly/data` | `/data/db` | SQLite database |
| `./config/sonarly/library` | `/data/library` | Library |
| `./config/sonarly/ingest` | `/data/ingest` | Ingest folder |
| `./packages/server` | `/app/packages/server` | Backend source |
| `./packages/web` | `/app/packages/web` | Frontend source |
| `./packages/shared` | `/app/packages/shared` | Shared package source |

Make sure the host data directories exist and are writable by the container user:

```bash
mkdir -p ./config/sonarly/data ./config/sonarly/library ./config/sonarly/ingest
```

---

## Permissions

The container runs as a non-root user. By default it uses UID/GID `1000` (the `node` user in the image). The entrypoint adjusts the `node` user's UID/GID at runtime to match `PUID`/`PGID`, then drops privileges with `su-exec`.

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

## File watcher polling fallback

Sonarly uses filesystem watchers to detect new or changed files in `LIBRARY_PATH` and `INGEST_PATH`. Some filesystems (NFS, Docker Desktop volumes, certain network shares) do not support inotify events. If changes are not detected automatically, enable polling:

```bash
WATCHER_USE_POLLING=true docker compose -f compose.yaml up -d
```

---

## Image details

### Production image (`docker/Dockerfile.server`)

- **Builder stage:** `node:20-alpine` with `python3`, `make`, `g++` to compile native dependencies (`bcrypt`, `better-sqlite3`).
- **Runner stage:** `node:20-alpine` with:
  - Runtime tooling: `python3`, `py3-pip`, `ffmpeg`, `libstdc++`, `su-exec`
  - Python package: `mutagen` (used by the metadata tag writer)
- The runner copies the built server from `/app/standalone` and the built web UI into `/app/web-dist`.
- Exposes port `3000`.
- Entrypoint: `docker/entrypoint.sh`, which adjusts the `node` user and runs `node dist/index.js`.

### Development image (`docker/Dockerfile.dev`)

- Based on `node:20-alpine`.
- Installs build tools and runtime tooling (`ffmpeg`, `mutagen`).
- Installs workspace dependencies from `pnpm-lock.yaml`.
- Exposes ports `3000` and `5173`.
- Default command: `pnpm -r --parallel dev`.

---

## Updating Sonarly

To update to a new version:

```bash
docker compose -f compose.yaml down
docker compose -f compose.yaml up -d --build
```

The database is preserved in the bind-mounted `./config/sonarly/data` directory. Back up that directory before major updates.

---

## Troubleshooting

### Container exits with "SESSION_SECRET is required"

`SESSION_SECRET` is missing or shorter than 32 characters. Generate one with:

```bash
openssl rand -hex 32
```

### Changes in library/ingest are not detected

Set `WATCHER_USE_POLLING=true` and recreate the container.

### Permission denied on bind mounts

Ensure the host directories are owned by the UID/GID configured via `PUID`/`PGID` (default `1000:1000`).
