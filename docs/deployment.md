# Deploying Sonarly

Sonarly ships as a single Docker image that contains the Fastify server and the built React web UI.

## Docker Compose (recommended)

From the `docker/` directory:

```bash
cp .env.example .env
# Edit .env and set SESSION_SECRET
vim .env

docker compose up -d
```

The web interface is available at http://localhost:4533.

## Environment variables

Create a `.env` file next to `docker-compose.yml`:

```bash
SESSION_SECRET=$(openssl rand -hex 32)
```

| Variable | Default | Description |
| --- | --- | --- |
| `SESSION_SECRET` | *(required)* | Secret used to sign session cookies. Must be at least 32 characters. The container refuses to start without it. See `docker/.env.example`. |
| `SESSION_COOKIE_SECURE` | `false` | Set to `true` only when serving Sonarly over HTTPS. Defaults to `false` so the cookie works over plain HTTP. |
| `WATCHER_USE_POLLING` | `false` | Set to `true` when the library/ingest volumes are on filesystems without inotify support (Docker Desktop, NFS, etc.). |
| `PUID` | `1000` | User ID the container process runs as. Match this to the owner of your bind mounts. |
| `PGID` | `1000` | Group ID the container process runs as. Match this to the group of your bind mounts. |
| `PORT` | `3000` | Internal port the server listens on. Usually left at `3000` and mapped to `4533` on the host. |
| `DATA_DIR` | `/data` | Path where the SQLite database and other runtime data are stored. |
| `LIBRARY_PATH` | `/data/library` | Path to the organized music library. |
| `INGEST_PATH` | `/data/ingest` | Path where new files can be dropped for import. |
| `SCAN_INTERVAL_MINUTES` | `60` | Interval between automatic library rescans. |

## Volumes

The compose file mounts three bind volumes by default:

| Host path | Container path | Purpose |
| --- | --- | --- |
| `./config` | `/data` | SQLite database, session store, and other runtime configuration. |
| `./library` | `/data/library` | Organized music library managed by Sonarly. |
| `./ingest` | `/data/ingest` | Drop music files here to import them into the library. |

Make sure the host directories exist and are writable by the container user:

```bash
mkdir -p config library ingest
```

## Permissions

The container runs as a non-root user with UID/GID `1000` by default. Set `PUID`/`PGID` to match the owner of your bind mounts so the server can read and write the library, ingest, and config directories.

```bash
chown -R 1000:1000 config library ingest
```

## File watcher polling fallback

Sonarly uses filesystem watchers to detect new or changed files. Some filesystems (NFS, Docker Desktop volumes, etc.) do not support inotify events. If changes are not detected automatically, enable polling:

```bash
WATCHER_USE_POLLING=true docker compose up -d
```
